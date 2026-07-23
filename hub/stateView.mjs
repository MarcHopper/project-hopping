// The single snapshot builder. Used by BOTH the hub's GET /state (local) and the
// Upstash mirror (cloud/phone), so the dashboard consumes an identical shape
// whether it reads the loopback hub or the mirrored state — parity by
// construction. Hub-only (imports the process registry); never bundled on Vercel.

import {
  getProjectsWithTally,
  getSettings,
  getTouchEvents,
  getSession,
  listSessions,
  listSessionNotes,
  setSessionTodos,
} from "../lib/db.ts";
import { rankProjects } from "../lib/rankProjects.ts";
import { deriveColumns } from "../lib/cycles.ts";
import { tallyWindowLabel } from "../lib/tally.ts";
import { liveSessions } from "./registry.mjs";
import { readLatestTodos } from "./transcript.mjs";

function safeParse(json, fallback) {
  try {
    const v = JSON.parse(json);
    return v ?? fallback;
  } catch {
    return fallback;
  }
}

/**
 * Decorate raw session rows with read-time state (never stored): live-window
 * status from the process registry, parsed todos, and the human's notes.
 */
function decorateSessions() {
  const rows = listSessions();
  const live = liveSessions();
  // Group all notes by session in one query.
  const notesBySession = new Map();
  for (const n of listSessionNotes()) {
    const arr = notesBySession.get(n.session_id) ?? [];
    arr.push(n);
    notesBySession.set(n.session_id, arr);
  }
  return rows.map((s) => {
    const win = live.get(s.session_id);
    return {
      ...s,
      window_open: !!win,
      pid: win?.pid,
      entrypoint: win?.entrypoint,
      todos: safeParse(s.todos_json, []),
      notes: notesBySession.get(s.session_id) ?? [],
    };
  });
}

/**
 * One decorated session for GET /session/<id>. Reads todos fresh from the
 * transcript when none are stored yet (so opening a chat that predates the hook
 * still shows its list), then decorates with live-window + notes.
 */
export function viewSession(sessionId) {
  const s = getSession(sessionId);
  if (!s) return null;
  let todos = safeParse(s.todos_json, []);
  if (!todos.length) {
    try {
      const r = readLatestTodos(sessionId);
      if (r) {
        setSessionTodos(sessionId, JSON.stringify(r.todos), r.at);
        todos = r.todos;
      }
    } catch {
      /* transcript unreadable — fine */
    }
  }
  const win = liveSessions().get(sessionId);
  return {
    ...s,
    window_open: !!win,
    pid: win?.pid,
    entrypoint: win?.entrypoint,
    todos,
    notes: listSessionNotes(sessionId),
  };
}

/** The full dashboard/grid snapshot. */
export function buildSnapshot() {
  const projects = getProjectsWithTally();
  const settings = getSettings();
  const activeIds = projects.filter((p) => !p.archived).map((p) => p.id);
  const columns = deriveColumns(getTouchEvents(), activeIds);
  const { next, ordered } = rankProjects(projects);
  return {
    projects,
    ordered,
    next,
    columns,
    sessions: decorateSessions(),
    settings: { ...settings, windowLabel: tallyWindowLabel(settings.tally_mode) },
    generatedAt: Date.now(),
  };
}
