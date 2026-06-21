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
}

export interface RankResult {
  next: Project | null;
  ordered: Project[];
}
