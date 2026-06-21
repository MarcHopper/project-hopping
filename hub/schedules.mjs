// Background notification timers: the cycle nudge and the daily neglect digest.
// Checks once a minute; each class is independently suppressible in settings.

import { getProjectsWithTally, getSettings, setLastNeglectFired } from "../lib/db.ts";
import { rankProjects } from "../lib/rankProjects.ts";

const DAY = 86_400_000;
const nudgedFor = new Map(); // projectId -> status_since we already nudged (avoid repeats)

function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

export function runSchedulesOnce(notify) {
  const s = getSettings();
  const projects = getProjectsWithTally();
  const now = Date.now();

  // 1. Cycle nudge: a running project past its per-project time cap (off by default).
  if (s.notify_nudge) {
    for (const p of projects) {
      if (p.archived || !p.time_cap_min || p.status !== "agent_running" || !p.status_since) continue;
      const mins = (now - p.status_since) / 60000;
      if (mins >= p.time_cap_min && nudgedFor.get(p.id) !== p.status_since) {
        nudgedFor.set(p.id, p.status_since); // once per running stretch
        notify("nudge", `⏱ ${p.name} has been running ${Math.round(mins)}m (cap ${p.time_cap_min}m) — time to hop?`);
      }
    }
  }

  // 2. Daily neglect digest at the configured hour, once per day.
  if (s.notify_neglect) {
    const d = new Date(now);
    const today = ymd(d);
    if (d.getHours() === s.neglect_hour && s.last_neglect_fired !== today) {
      setLastNeglectFired(today); // guard first so we never double-fire
      const cutoff = now - s.neglect_days * DAY;
      const neglected = projects
        .filter((p) => !p.archived && p.id !== "unmapped" && (p.last_touched_at ?? 0) < cutoff)
        .sort((a, b) => (a.last_touched_at ?? 0) - (b.last_touched_at ?? 0));
      if (neglected.length) {
        const list = neglected
          .slice(0, 8)
          .map((p) => {
            const ago = p.last_touched_at
              ? `${Math.floor((now - p.last_touched_at) / DAY)}d`
              : "never";
            return `• ${p.name} — ${ago}`;
          })
          .join("\n");
        const { next } = rankProjects(projects);
        notify(
          "neglect",
          `🐢 Neglected (≥${s.neglect_days}d untouched):\n${list}\n\nhop next → ${next ? next.name : "—"}`,
        );
      }
    }
  }
}

export function startSchedules(notify) {
  setInterval(() => {
    try {
      runSchedulesOnce(notify);
    } catch {
      /* never let a notification error kill the timer */
    }
  }, 60_000);
}
