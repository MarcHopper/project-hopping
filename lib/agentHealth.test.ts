import { describe, it, expect } from "vitest";
import { computeAgentHealth, nextCalendarRun, prevCalendarRun, type AgentInput } from "./agentHealth";

const NOW = Date.parse("2026-07-23T18:00:00.000Z");
const iso = (ms: number) => new Date(ms).toISOString();

function base(over: Partial<AgentInput> = {}): AgentInput {
  return { id: "x", display_name: "X", kind: "launchd", ...over };
}

describe("calendar math", () => {
  it("nextCalendarRun finds the next daily time", () => {
    const from = new Date(2026, 6, 23, 3, 0).getTime(); // Jul 23 03:00 local
    const next = nextCalendarRun([{ Hour: 2, Minute: 30 }], from);
    expect(new Date(next!).getDate()).toBe(24); // already past 02:30 today → tomorrow
    expect(new Date(next!).getHours()).toBe(2);
    expect(new Date(next!).getMinutes()).toBe(30);
  });

  it("prevCalendarRun finds the most recent daily time", () => {
    const now = new Date(2026, 6, 23, 3, 0).getTime();
    const prev = prevCalendarRun([{ Hour: 2, Minute: 30 }], now);
    expect(new Date(prev!).getDate()).toBe(23); // 02:30 today already happened
  });

  it("handles a multi-day-of-month list (mgib: days 1/8/15/22)", () => {
    const from = new Date(2026, 6, 10, 7, 0).getTime(); // Jul 10
    const entries = [1, 8, 15, 22].map((Day) => ({ Day, Hour: 6, Minute: 5 }));
    const next = nextCalendarRun(entries, from);
    expect(new Date(next!).getDate()).toBe(15); // next after Jul 10 is the 15th
  });
});

describe("computeAgentHealth", () => {
  it("frozen-ok + nonzero launchd exit → error (the backup-local case)", () => {
    const a = base({
      id: "backup-local",
      last_exit: 127,
      status: { last_status: "ok", summary: "all good", last_run_iso: iso(NOW - 10 * 86400000) },
      calendar: [{ Hour: 2, Minute: 30 }],
    });
    const [v] = computeAgentHealth([a], { now: NOW });
    expect(v.health).toBe("error");
    expect(v.reasons[0]).toMatch(/exit 127/);
  });

  it("registered agent, scheduled run passed with no status file → error", () => {
    const a = base({ id: "kb", registered: true, status: null, calendar: [{ Hour: 9, Minute: 30 }], last_exit: null });
    const [v] = computeAgentHealth([a], { now: NOW });
    expect(v.health).toBe("error");
  });

  it("unregistered agent with no status but exit 0 → ok (not flagged for missing status)", () => {
    const a = base({ id: "backinstock", registered: false, status: null, calendar: [{ Hour: 6 }], last_exit: 0, running: false });
    const [v] = computeAgentHealth([a], { now: NOW });
    expect(v.health).toBe("ok");
  });

  it("always-on service, exit 143 (SIGTERM) while running → not error", () => {
    const a = base({ id: "hub", last_exit: 143, running: true, status: { last_status: "ok", last_run_iso: iso(NOW) } });
    const [v] = computeAgentHealth([a], { now: NOW });
    expect(v.health).toBe("ok");
  });

  it("status older than the last scheduled run → stale", () => {
    const a = base({
      registered: true,
      calendar: [{ Hour: 9, Minute: 30 }],
      last_exit: 0,
      status: { last_status: "ok", last_run_iso: iso(NOW - 3 * 86400000) },
    });
    const [v] = computeAgentHealth([a], { now: NOW });
    expect(v.health).toBe("stale");
  });

  it("needs_review items → attention", () => {
    const a = base({
      calendar: [{ Hour: 9, Minute: 30 }],
      last_exit: 0,
      status: { last_status: "needs_attention", needs_review: ["firm A"], last_run_iso: iso(NOW - 60000) },
    });
    const [v] = computeAgentHealth([a], { now: NOW });
    expect(v.health).toBe("attention");
  });

  it("healthy recent run → ok", () => {
    const a = base({
      calendar: [{ Hour: 9, Minute: 30 }],
      last_exit: 0,
      status: { last_status: "ok", last_run_iso: iso(NOW - 60000) },
    });
    const [v] = computeAgentHealth([a], { now: NOW });
    expect(v.health).toBe("ok");
  });

  it("paused override masks everything", () => {
    const a = base({ id: "p", last_exit: 127, calendar: [{ Hour: 2 }] });
    const [v] = computeAgentHealth([a], { now: NOW, overrides: { p: { paused: true } } });
    expect(v.health).toBe("paused");
  });

  it("cloud agent with no data → unknown", () => {
    const a = base({ id: "sentinel", kind: "heartbeat", status: null, probe: null });
    const [v] = computeAgentHealth([a], { now: NOW });
    expect(v.health).toBe("unknown");
  });

  it("ack sticks only while the fingerprint matches; a new failure re-alerts", () => {
    const a = base({ id: "w", last_exit: 1, calendar: [{ Hour: 2 }], status: { last_run_iso: iso(NOW) } });
    const [v1] = computeAgentHealth([a], { now: NOW });
    const acks = { w: { fingerprint: v1.fingerprint } };
    expect(computeAgentHealth([a], { now: NOW, acks })[0].acked).toBe(true);
    // exit code changes → fingerprint changes → ack no longer applies
    const a2 = { ...a, last_exit: 2 };
    expect(computeAgentHealth([a2], { now: NOW, acks })[0].acked).toBe(false);
  });
});
