// The fairness tally is a COUNT of "hop" (touch) events inside an active window.
// The window depends on the chosen reset mode, but never starts earlier than the
// last manual "Reset tallies". Pure + testable; used by db.ts (via SQL) and by
// any future client that has the raw events.

import type { AppEvent, TallyMode } from "./types";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Local midnight (00:00) of the day containing `now`. */
function startOfDay(now: number): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Local 00:00 of the most recent Monday at or before `now`. */
function startOfWeekMonday(now: number): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay(); // 0=Sun..6=Sat
  const back = day === 0 ? 6 : day - 1; // days since Monday
  return d.getTime() - back * DAY_MS;
}

/**
 * Start (epoch ms) of the active tally window. Touches at/after this instant
 * count. Never earlier than `tallyResetAt` (the manual reset).
 */
export function windowStart(mode: TallyMode, tallyResetAt: number, now: number): number {
  let modeStart: number;
  switch (mode) {
    case "rolling7d":
      modeStart = now - 7 * DAY_MS;
      break;
    case "daily":
      modeStart = startOfDay(now);
      break;
    case "weekly":
      modeStart = startOfWeekMonday(now);
      break;
    case "none":
    default:
      modeStart = 0;
      break;
  }
  return Math.max(modeStart, tallyResetAt);
}

/** Count touches ("hop") per project id at/after `start`. Pure helper. */
export function computeTallies(events: AppEvent[], start: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const ev of events) {
    if (ev.type !== "hop") continue;
    if (ev.created_at < start) continue;
    out[ev.project_id] = (out[ev.project_id] ?? 0) + 1;
  }
  return out;
}

/** Human label for the current window, shown in the settings bar. */
export function tallyWindowLabel(mode: TallyMode): string {
  switch (mode) {
    case "rolling7d":
      return "last 7 days";
    case "daily":
      return "today";
    case "weekly":
      return "this week";
    case "none":
      return "all time";
    default:
      return "";
  }
}
