// Background notification timers: the cycle nudge and the daily neglect digest.
// Checks once a minute; each class is independently suppressible in settings.

import { getProjectsWithTally, getSettings, setLastNeglectFired, inQuietHours } from "../lib/db.ts";
import { rankProjects } from "../lib/rankProjects.ts";
import { slackPost, desktop } from "./notify.mjs";
import { standupCard } from "./cards.mjs";

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

  // 2. Daily actionable standup at the configured hour, once per day.
  if (s.notify_neglect) {
    const d = new Date(now);
    const today = ymd(d);
    if (d.getHours() === s.neglect_hour && s.last_neglect_fired !== today) {
      setLastNeglectFired(today); // guard first so we never double-fire
      const active = projects.filter((p) => !p.archived && p.id !== "unmapped");
      const { next, ordered } = rankProjects(projects);
      const neglected = active.filter(
        (p) => (p.last_touched_at ?? 0) < now - s.neglect_days * DAY,
      );
      desktop(`🐇 Standup: hop next → ${next ? next.name : "—"} · ${neglected.length} neglected`);
      if (s.slack_neglect && !inQuietHours(s, now)) {
        slackPost({
          text: `🐇 Hopping standup — hop next → ${next ? next.name : "—"}`,
          blocks: standupCard({ projects: ordered.filter((p) => p.id !== "unmapped"), next }),
        }).catch(() => {});
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
