// Pure agent-health computation. The whole point: NEVER trust an agent's
// self-reported status file alone. Health is derived from four sources joined by
// the collector (hub/agents.mjs) — the status record, the launchd exit code, the
// plist schedule, and (for cloud agents) a probe — so a frozen "ok" status file
// on an agent that has been exiting 127 for 10 days reads as "error", not green.
// Dependency-free + unit-tested.

export type AgentHealth =
  | "ok"
  | "attention"
  | "error"
  | "stale"
  | "paused"
  | "unknown";

export interface CalEntry {
  Hour?: number;
  Minute?: number;
  Day?: number; // day of month
  Weekday?: number; // 0=Sun
}

export interface StatusRecord {
  last_status?: string; // ok | needs_attention | error
  summary?: string;
  counts?: Record<string, number>;
  needs_review?: unknown[];
  last_run_iso?: string;
  next_run_iso?: string;
  log_path?: string;
}

export interface AgentInput {
  id: string;
  display_name: string;
  kind: "launchd" | "github-actions" | "vercel-cron" | "heartbeat";
  label?: string; // launchd label
  schedule_text?: string; // human text for display
  calendar?: CalEntry[]; // parsed StartCalendarInterval
  interval?: number; // StartInterval seconds
  status?: StatusRecord | null;
  registered?: boolean; // in the Hop Agent Portal registry (expected to write status)
  running?: boolean; // launchctl shows a live PID
  last_exit?: number | null; // launchctl last exit code
  loaded?: boolean; // label is bootstrapped in launchd
  probe?: { ok: boolean; last_run?: number | null; summary?: string } | null;
  grace_min?: number; // per-agent slack before "stale" (default 45)
  log_path?: string;
}

export interface AgentView {
  id: string;
  display_name: string;
  kind: string;
  label?: string;
  health: AgentHealth;
  reasons: string[];
  last_run: number | null;
  next_expected: number | null;
  last_exit: number | null;
  running: boolean;
  paused: boolean;
  acked: boolean;
  fingerprint: string;
  summary: string;
  counts?: Record<string, number>;
  needs_review: unknown[];
  schedule_text?: string;
  log_path?: string;
}

const DAY = 86_400_000;
const MIN = 60_000;

function parseIso(iso?: string): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
}

function dayMatches(d: Date, e: CalEntry): boolean {
  if (e.Day != null && d.getDate() !== e.Day) return false;
  if (e.Weekday != null && d.getDay() !== e.Weekday) return false;
  return true;
}

/** Earliest scheduled run strictly after `from` across all calendar entries (≤45d horizon). */
export function nextCalendarRun(entries: CalEntry[], from: number): number | null {
  let best = Infinity;
  const base = new Date(from);
  for (const e of entries) {
    for (let i = 0; i <= 45; i++) {
      const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + i, e.Hour ?? 0, e.Minute ?? 0, 0, 0);
      if (d.getTime() <= from) continue;
      if (!dayMatches(d, e)) continue;
      best = Math.min(best, d.getTime());
      break;
    }
  }
  return best === Infinity ? null : best;
}

/** Latest scheduled run at or before `now` across all entries (≤45d lookback). */
export function prevCalendarRun(entries: CalEntry[], now: number): number | null {
  let best = -Infinity;
  const base = new Date(now);
  for (const e of entries) {
    for (let i = 0; i <= 45; i++) {
      const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() - i, e.Hour ?? 0, e.Minute ?? 0, 0, 0);
      if (d.getTime() > now) continue;
      if (!dayMatches(d, e)) continue;
      best = Math.max(best, d.getTime());
      break;
    }
  }
  return best === -Infinity ? null : best;
}

function fingerprint(health: AgentHealth, lastExit: number | null, lastRun: number | null): string {
  return `${health}|${lastExit ?? ""}|${lastRun ?? ""}`;
}

function healthOne(
  a: AgentInput,
  now: number,
): { health: AgentHealth; reasons: string[]; lastRun: number | null; nextExpected: number | null } {
  const reasons: string[] = [];
  const grace = (a.grace_min ?? 45) * MIN;
  const statusRun = parseIso(a.status?.last_run_iso);
  const lastRun = statusRun ?? a.probe?.last_run ?? null;

  // Expected schedule anchors.
  let prevScheduled: number | null = null;
  let nextExpected: number | null = null;
  if (a.calendar && a.calendar.length) {
    prevScheduled = prevCalendarRun(a.calendar, now);
    nextExpected = nextCalendarRun(a.calendar, now);
  } else if (a.interval) {
    nextExpected = (lastRun ?? now) + a.interval * 1000;
  }

  // 1) launchd exit code is ground truth — a nonzero exit outranks a green status
  //    file (the backup-local frozen-ok case). A currently-running service whose
  //    last exit was a restart signal (e.g. 143=SIGTERM from a kickstart) is up
  //    now, so only a nonzero exit while NOT running is an error.
  if (a.last_exit != null && a.last_exit !== 0 && !a.running) {
    reasons.push(`launchd last exit ${a.last_exit}`);
    return { health: "error", reasons, lastRun, nextExpected };
  }

  // 2) A run was due but nothing was recorded. Only meaningful for REGISTERED
  //    agents (they carry a write-status contract); auto-surfaced agents that
  //    simply don't report status but exited 0 are treated as ok below.
  if (a.registered && prevScheduled != null && now > prevScheduled + grace) {
    if (statusRun == null) {
      reasons.push("scheduled run passed, no status recorded");
      return { health: "error", reasons, lastRun, nextExpected };
    }
    if (statusRun < prevScheduled) {
      reasons.push("last run is older than the most recent scheduled run");
      return { health: "stale", reasons, lastRun, nextExpected };
    }
  }

  // 3) Interval agents: stale if silent for well over the interval.
  if (a.interval && lastRun != null && now - lastRun > 2 * a.interval * 1000 + grace) {
    reasons.push("silent for over 2x its interval");
    return { health: "stale", reasons, lastRun, nextExpected };
  }

  // 4) Agent asked for attention.
  const ls = a.status?.last_status;
  const nr = a.status?.needs_review?.length ?? 0;
  if (ls === "error") {
    reasons.push("status reports error");
    return { health: "error", reasons, lastRun, nextExpected };
  }
  if (ls === "needs_attention" || nr > 0) {
    reasons.push(nr > 0 ? `${nr} item(s) need review` : "status needs attention");
    return { health: "attention", reasons, lastRun, nextExpected };
  }

  // 5) Cloud agent with no probe/status data at all → unknown (can't confirm alive).
  if (a.kind !== "launchd" && !a.status && !a.probe) {
    reasons.push("no heartbeat configured");
    return { health: "unknown", reasons, lastRun, nextExpected };
  }

  return { health: "ok", reasons, lastRun, nextExpected };
}

export function computeAgentHealth(
  inputs: AgentInput[],
  {
    overrides = {},
    acks = {},
    now,
  }: {
    overrides?: Record<string, { paused?: boolean }>;
    acks?: Record<string, { fingerprint?: string }>;
    now: number;
  },
): AgentView[] {
  return inputs.map((a) => {
    const paused = !!overrides[a.id]?.paused;
    let health: AgentHealth;
    let reasons: string[];
    let lastRun: number | null;
    let nextExpected: number | null;

    if (paused) {
      health = "paused";
      reasons = ["paused from the dashboard"];
      lastRun = parseIso(a.status?.last_run_iso) ?? a.probe?.last_run ?? null;
      nextExpected = null;
    } else {
      ({ health, reasons, lastRun, nextExpected } = healthOne(a, now));
    }

    const fp = fingerprint(health, a.last_exit ?? null, lastRun);
    const acked = health === "ok" || health === "paused" ? false : acks[a.id]?.fingerprint === fp;

    return {
      id: a.id,
      display_name: a.display_name,
      kind: a.kind,
      label: a.label,
      health,
      reasons,
      last_run: lastRun,
      next_expected: nextExpected,
      last_exit: a.last_exit ?? null,
      running: !!a.running,
      paused,
      acked,
      fingerprint: fp,
      summary: a.status?.summary ?? a.probe?.summary ?? "",
      counts: a.status?.counts,
      needs_review: (a.status?.needs_review as unknown[]) ?? [],
      schedule_text: a.schedule_text,
      log_path: a.log_path ?? a.status?.log_path,
    };
  });
}

// Health sort order for the UI (most urgent first).
export const HEALTH_RANK: Record<AgentHealth, number> = {
  error: 0,
  stale: 1,
  attention: 2,
  unknown: 3,
  paused: 4,
  ok: 5,
};

export { DAY as _DAY };
