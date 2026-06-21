// Shared types for Hopping. Imported by the Next.js app AND the standalone hub,
// so this file must stay dependency-free.

export type ProjectStatus = "idle" | "agent_running" | "agent_waiting" | "blocked";

export type EventType =
  | "hop" // a touch — "I gave this a move" (increments the fairness tally)
  | "skip" // looked, nothing to do — does NOT count toward a cycle column
  | "agent_waiting" // an agent finished and is waiting on the human (interrupt)
  | "agent_running" // an agent is actively working
  | "session_end" // a Claude Code / agent session ended
  | "commit" // a git commit landed (Phase 4 git watcher)
  | "brief"; // the human left a "where I left off" note

export type TallyMode = "rolling7d" | "daily" | "weekly" | "none";

// A project row as stored. `tally` is NOT stored — it is computed per request
// (see lib/tally.ts) and attached when projects are read for ranking/display.
export interface ProjectRow {
  id: string; // slug, e.g. "dezlin"
  name: string;
  path: string; // absolute folder; "" when the project has no local repo
  status: ProjectStatus;
  last_brief: string;
  last_touched_at: number | null; // epoch ms
  waiting_since: number | null; // epoch ms when status entered agent_waiting
  archived: boolean;
  sort_order: number;
  last_commit: string; // latest git commit subject (Phase 3 git watcher)
  uncommitted: number; // count of uncommitted changes (Phase 3 git watcher)
  status_since: number | null; // epoch ms the current status began (for cycle nudges)
  time_cap_min: number | null; // per-project minutes-before-nudge cap (Phase 4)
  muted: boolean; // suppress this project's Slack alerts (Phase 7)
  snooze_until: number | null; // epoch ms; suppress alerts until then (Phase 7)
}

// A project as handed to the UI / rankProjects — same as the row plus the
// computed windowed tally.
export interface Project extends ProjectRow {
  tally: number;
}

export interface AppEvent {
  id: number;
  project_id: string;
  type: EventType;
  payload: Record<string, unknown>;
  created_at: number; // epoch ms
}

export interface Settings {
  tally_mode: TallyMode;
  tally_reset_at: number; // epoch ms of the last manual "Reset tallies"
  focused_project_id: string; // the project the VS Code extension says you're in ("" = none)
  notify_interrupt: boolean; // Slack/desktop on agent waiting
  notify_nudge: boolean; // per-project time-cap nudges (off by default)
  notify_neglect: boolean; // daily neglect digest
  neglect_hour: number; // local hour (0-23) the digest fires
  neglect_days: number; // a project untouched >= this many days is "neglected"
  last_neglect_fired: string; // YYYY-MM-DD guard so the digest fires once/day
  // Phase 7 — Slack control
  quiet_start: number; // hour 0-23, -1 = off
  quiet_end: number;
  slack_interrupt: boolean; // route interrupt alerts to Slack
  slack_nudge: boolean;
  slack_neglect: boolean;
  active_suppress: boolean; // while active at the Mac, desktop-only (no Slack)
}

export interface RankResult {
  next: Project | null;
  ordered: Project[];
}

// One Claude Code chat/session. Tracked separately from the project rollup so
// the "open chats" view + per-chat alerts + the Slack-thread-per-chat work.
export type SessionStatus = "running" | "waiting" | "ended";

export interface Session {
  session_id: string;
  project_id: string;
  project_name?: string; // joined for display
  cwd: string;
  status: SessionStatus;
  name: string;
  last_activity: number | null; // epoch ms
  last_result: string; // last assistant message text (from the transcript)
  slack_thread_ts: string; // the Slack thread this chat lives in ("" = none yet)
  started_at: number;
}
