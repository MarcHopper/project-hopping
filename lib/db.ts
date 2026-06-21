// The single source of truth for all reads/writes. Imported identically by the
// Next.js route handlers AND the standalone hub (run under tsx). Every state
// mutation flows through `applyEvent` — the one ingest point — so swapping
// SQLite for Supabase later is localized to this file.

import Database from "better-sqlite3";
import { readFileSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import type {
  AppEvent,
  EventType,
  Project,
  ProjectRow,
  ProjectStatus,
  Settings,
  TallyMode,
} from "./types";
import { windowStart } from "./tally";

const DB_PATH =
  process.env.HOPPING_DB ?? path.join(process.cwd(), "data", "hopping.db");

// Inlined fallback DDL (kept in sync with lib/schema.sql, which is the readable
// source). Used if the .sql file can't be read from disk (e.g. odd bundling).
const FALLBACK_SCHEMA = `
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, path TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'idle', last_brief TEXT NOT NULL DEFAULT '',
  last_touched_at INTEGER, waiting_since INTEGER,
  archived INTEGER NOT NULL DEFAULT 0, sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, project_id TEXT NOT NULL REFERENCES projects(id),
  type TEXT NOT NULL, payload TEXT NOT NULL DEFAULT '{}', created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  tally_mode TEXT NOT NULL DEFAULT 'rolling7d', tally_reset_at INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_events_project ON events(project_id, created_at);
CREATE INDEX IF NOT EXISTS idx_events_created ON events(created_at);
`;

type DB = Database.Database;

// Singleton on globalThis so Next.js HMR doesn't open N connections (same trick
// as job-tracker's lib/prisma.ts).
const g = globalThis as unknown as { __hoppingDb?: DB };

function loadSchema(): string {
  try {
    return readFileSync(path.join(process.cwd(), "lib", "schema.sql"), "utf8");
  } catch {
    return FALLBACK_SCHEMA;
  }
}

export function getDb(): DB {
  if (g.__hoppingDb) return g.__hoppingDb;

  const dir = path.dirname(DB_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL"); // readers + one writer concurrently
  db.pragma("busy_timeout = 5000"); // wait, don't error, on write contention
  db.pragma("synchronous = NORMAL");
  db.pragma("foreign_keys = ON");
  db.exec(loadSchema());
  migrate(db);
  db.prepare("INSERT OR IGNORE INTO settings (id) VALUES (1)").run();

  g.__hoppingDb = db;
  return db;
}

// Add columns introduced after a db was first created. Each ALTER is wrapped:
// re-adding an existing column throws "duplicate column name", which we ignore.
function migrate(db: DB): void {
  const alters = [
    "ALTER TABLE projects ADD COLUMN last_commit TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE projects ADD COLUMN uncommitted INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE projects ADD COLUMN status_since INTEGER",
    "ALTER TABLE projects ADD COLUMN time_cap_min INTEGER",
    "ALTER TABLE settings ADD COLUMN focused_project_id TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE settings ADD COLUMN notify_interrupt INTEGER NOT NULL DEFAULT 1",
    "ALTER TABLE settings ADD COLUMN notify_nudge INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE settings ADD COLUMN notify_neglect INTEGER NOT NULL DEFAULT 1",
    "ALTER TABLE settings ADD COLUMN neglect_hour INTEGER NOT NULL DEFAULT 9",
    "ALTER TABLE settings ADD COLUMN neglect_days INTEGER NOT NULL DEFAULT 3",
    "ALTER TABLE settings ADD COLUMN last_neglect_fired TEXT NOT NULL DEFAULT ''",
  ];
  for (const sql of alters) {
    try {
      db.exec(sql);
    } catch (e) {
      if (!String((e as Error).message).includes("duplicate column")) throw e;
    }
  }
}

function now(): number {
  return Date.now();
}

// ---- row mapping ---------------------------------------------------------

interface RawProject {
  id: string;
  name: string;
  path: string;
  status: string;
  last_brief: string;
  last_touched_at: number | null;
  waiting_since: number | null;
  archived: number;
  sort_order: number;
  last_commit: string;
  uncommitted: number;
  status_since: number | null;
  time_cap_min: number | null;
}

function toRow(r: RawProject): ProjectRow {
  return {
    id: r.id,
    name: r.name,
    path: r.path,
    status: r.status as ProjectStatus,
    last_brief: r.last_brief,
    last_touched_at: r.last_touched_at,
    waiting_since: r.waiting_since,
    archived: !!r.archived,
    sort_order: r.sort_order,
    last_commit: r.last_commit ?? "",
    uncommitted: r.uncommitted ?? 0,
    status_since: r.status_since ?? null,
    time_cap_min: r.time_cap_min ?? null,
  };
}

// ---- reads ---------------------------------------------------------------

export function listProjectRows(): ProjectRow[] {
  return (
    getDb()
      .prepare("SELECT * FROM projects ORDER BY sort_order, name")
      .all() as RawProject[]
  ).map(toRow);
}

interface RawSettings {
  tally_mode: string;
  tally_reset_at: number;
  focused_project_id: string;
  notify_interrupt: number;
  notify_nudge: number;
  notify_neglect: number;
  neglect_hour: number;
  neglect_days: number;
  last_neglect_fired: string;
}

export function getSettings(): Settings {
  const r = getDb()
    .prepare("SELECT * FROM settings WHERE id = 1")
    .get() as RawSettings | undefined;
  return {
    tally_mode: (r?.tally_mode ?? "rolling7d") as TallyMode,
    tally_reset_at: r?.tally_reset_at ?? 0,
    focused_project_id: r?.focused_project_id ?? "",
    notify_interrupt: r ? !!r.notify_interrupt : true,
    notify_nudge: r ? !!r.notify_nudge : false,
    notify_neglect: r ? !!r.notify_neglect : true,
    neglect_hour: r?.neglect_hour ?? 9,
    neglect_days: r?.neglect_days ?? 3,
    last_neglect_fired: r?.last_neglect_fired ?? "",
  };
}

/** Projects with their windowed fairness tally attached (for ranking + display). */
export function getProjectsWithTally(): Project[] {
  const rows = listProjectRows();
  const settings = getSettings();
  const start = windowStart(settings.tally_mode, settings.tally_reset_at, now());
  const counts = getDb()
    .prepare(
      "SELECT project_id, COUNT(*) AS c FROM events WHERE type = 'hop' AND created_at >= ? GROUP BY project_id",
    )
    .all(start) as { project_id: string; c: number }[];
  const tallyById = new Map(counts.map((c) => [c.project_id, c.c]));
  return rows.map((r) => ({ ...r, tally: tallyById.get(r.id) ?? 0 }));
}

/** All "hop" touch events in chronological order, for cycle/column derivation. */
export function getTouchEvents(): AppEvent[] {
  const raw = getDb()
    .prepare(
      "SELECT id, project_id, type, payload, created_at FROM events WHERE type = 'hop' ORDER BY created_at, id",
    )
    .all() as { id: number; project_id: string; type: string; payload: string; created_at: number }[];
  return raw.map((e) => ({
    id: e.id,
    project_id: e.project_id,
    type: e.type as EventType,
    payload: safeJson(e.payload),
    created_at: e.created_at,
  }));
}

function safeJson(s: string): Record<string, unknown> {
  try {
    const v = JSON.parse(s);
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

// ---- path resolution -----------------------------------------------------

const UNMAPPED_ID = "unmapped";

function ensureUnmapped(): void {
  getDb()
    .prepare(
      "INSERT OR IGNORE INTO projects (id, name, path, sort_order) VALUES (?, 'Unmapped', '', 9999)",
    )
    .run(UNMAPPED_ID);
}

/** Longest-prefix match of an absolute folder against project paths. */
export function resolveProjectByPath(target: string): string {
  ensureUnmapped();
  const rows = listProjectRows().filter((p) => p.path);
  let best: string | null = null;
  let bestLen = -1;
  const t = target.replace(/\/+$/, ""); // trim trailing slash
  for (const p of rows) {
    const q = p.path.replace(/\/+$/, "");
    if (t === q || t.startsWith(q + "/")) {
      if (q.length > bestLen) {
        best = p.id;
        bestLen = q.length;
      }
    }
  }
  return best ?? UNMAPPED_ID;
}

// ---- the single ingest reducer ------------------------------------------

export interface ApplyInput {
  projectId?: string; // in-app actions pass the id directly
  path?: string; // hub events pass an absolute folder path
  type: EventType;
  payload?: Record<string, unknown>;
}

export interface ApplyResult {
  projectId: string;
  name: string;
  status: ProjectStatus;
  becameWaiting: boolean; // hub uses this to fire the desktop notification
}

export function applyEvent(input: ApplyInput): ApplyResult {
  const db = getDb();
  const ts = now();
  const projectId =
    input.projectId ?? resolveProjectByPath(input.path ?? "");
  const payload = input.payload ?? {};

  db.prepare(
    "INSERT INTO events (project_id, type, payload, created_at) VALUES (?, ?, ?, ?)",
  ).run(projectId, input.type, JSON.stringify(payload), ts);

  const prevStatus =
    (
      db.prepare("SELECT status FROM projects WHERE id = ?").get(projectId) as
        | { status?: string }
        | undefined
    )?.status ?? "idle";

  let becameWaiting = false;
  const brief = typeof payload.brief === "string" ? payload.brief : undefined;
  const text = typeof payload.text === "string" ? payload.text : undefined;

  switch (input.type) {
    case "hop": // a touch — closes the loop: back to idle, clears waiting
      db.prepare(
        `UPDATE projects SET status = 'idle', status_since = ?, last_touched_at = ?, waiting_since = NULL${
          brief ? ", last_brief = ?" : ""
        } WHERE id = ?`,
      ).run(...(brief ? [ts, ts, brief, projectId] : [ts, ts, projectId]));
      break;
    case "agent_waiting":
      db.prepare(
        "UPDATE projects SET status = 'agent_waiting', status_since = ?, waiting_since = ? WHERE id = ?",
      ).run(ts, ts, projectId);
      becameWaiting = prevStatus !== "agent_waiting"; // only notify on the transition
      break;
    case "agent_running":
      db.prepare(
        "UPDATE projects SET status = 'agent_running', status_since = ?, waiting_since = NULL WHERE id = ?",
      ).run(ts, projectId);
      break;
    case "session_end":
      db.prepare(
        "UPDATE projects SET status = 'idle', status_since = ?, waiting_since = NULL WHERE id = ?",
      ).run(ts, projectId);
      break;
    case "brief":
      if (text !== undefined) {
        db.prepare("UPDATE projects SET last_brief = ? WHERE id = ?").run(text, projectId);
      }
      break;
    case "commit": {
      // git watcher: record the latest commit subject + uncommitted count.
      const subject = typeof payload.subject === "string" ? payload.subject : "";
      const uncommitted =
        typeof payload.uncommitted === "number" ? payload.uncommitted : 0;
      db.prepare(
        "UPDATE projects SET last_commit = ?, uncommitted = ? WHERE id = ?",
      ).run(subject, uncommitted, projectId);
      break;
    }
    case "skip": // looked, nothing to do — no status change, no touch
    default:
      break;
  }

  const p = db
    .prepare("SELECT name, status FROM projects WHERE id = ?")
    .get(projectId) as { name: string; status: string } | undefined;

  return {
    projectId,
    name: p?.name ?? projectId,
    status: (p?.status ?? "idle") as ProjectStatus,
    becameWaiting,
  };
}

// ---- project CRUD (in-app editor) ---------------------------------------

export function upsertProject(p: {
  id: string;
  name: string;
  path?: string;
  sort_order?: number;
}): void {
  getDb()
    .prepare(
      `INSERT INTO projects (id, name, path, sort_order)
       VALUES (@id, @name, @path, @sort_order)
       ON CONFLICT(id) DO UPDATE SET name = @name, path = @path`,
    )
    .run({
      id: p.id,
      name: p.name,
      path: p.path ?? "",
      sort_order: p.sort_order ?? nextSortOrder(),
    });
}

function nextSortOrder(): number {
  const r = getDb()
    .prepare("SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM projects")
    .get() as { n: number };
  return r.n;
}

export function setArchived(id: string, archived: boolean): void {
  getDb()
    .prepare("UPDATE projects SET archived = ? WHERE id = ?")
    .run(archived ? 1 : 0, id);
}

export function renameProject(id: string, name: string, p?: string): void {
  if (p === undefined) {
    getDb().prepare("UPDATE projects SET name = ? WHERE id = ?").run(name, id);
  } else {
    getDb()
      .prepare("UPDATE projects SET name = ?, path = ? WHERE id = ?")
      .run(name, p, id);
  }
}

export function setProjectPath(id: string, p: string): void {
  getDb().prepare("UPDATE projects SET path = ? WHERE id = ?").run(p, id);
}

export function reorderProjects(ids: string[]): void {
  const db = getDb();
  const stmt = db.prepare("UPDATE projects SET sort_order = ? WHERE id = ?");
  const tx = db.transaction((order: string[]) => {
    order.forEach((id, i) => stmt.run(i, id));
  });
  tx(ids);
}

export function deleteProject(id: string): void {
  if (id === UNMAPPED_ID) return; // never delete the fallback
  const db = getDb();
  const tx = db.transaction(() => {
    db.prepare("DELETE FROM events WHERE project_id = ?").run(id);
    db.prepare("DELETE FROM projects WHERE id = ?").run(id);
  });
  tx();
}

// ---- settings ------------------------------------------------------------

export function setTallyMode(mode: TallyMode): void {
  getDb().prepare("UPDATE settings SET tally_mode = ? WHERE id = 1").run(mode);
}

export function resetTallies(): void {
  getDb().prepare("UPDATE settings SET tally_reset_at = ? WHERE id = 1").run(now());
}

// VS Code "you're here" — resolve a path to a project and mark it focused
// ("" clears focus). Stored in settings, separate from agent status.
export function setFocusedProjectByPath(target: string): string {
  const id = target ? resolveProjectByPath(target) : "";
  getDb().prepare("UPDATE settings SET focused_project_id = ? WHERE id = 1").run(id);
  return id;
}

const NOTIFY_KEYS = [
  "notify_interrupt",
  "notify_nudge",
  "notify_neglect",
  "neglect_hour",
  "neglect_days",
] as const;

export function updateNotifySettings(
  patch: Partial<Record<(typeof NOTIFY_KEYS)[number], number | boolean>>,
): void {
  const db = getDb();
  for (const k of NOTIFY_KEYS) {
    const v = patch[k];
    if (v === undefined) continue;
    const num = typeof v === "boolean" ? (v ? 1 : 0) : v;
    db.prepare(`UPDATE settings SET ${k} = ? WHERE id = 1`).run(num);
  }
}

export function setLastNeglectFired(dateStr: string): void {
  getDb().prepare("UPDATE settings SET last_neglect_fired = ? WHERE id = 1").run(dateStr);
}

export function setProjectTimeCap(id: string, minutes: number | null): void {
  getDb().prepare("UPDATE projects SET time_cap_min = ? WHERE id = ?").run(minutes, id);
}
