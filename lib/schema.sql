-- Hopping store. Applied idempotently by lib/db.ts on first open.
-- All timestamps are epoch milliseconds (portable to Postgres bigint/timestamptz later).

CREATE TABLE IF NOT EXISTS projects (
  id              TEXT PRIMARY KEY,              -- slug, e.g. "dezlin"
  name            TEXT NOT NULL,
  path            TEXT NOT NULL DEFAULT '',      -- absolute folder; '' when no local repo
  status          TEXT NOT NULL DEFAULT 'idle',  -- idle | agent_running | agent_waiting | blocked
  last_brief      TEXT NOT NULL DEFAULT '',      -- "where I left off"
  last_touched_at INTEGER,                       -- epoch ms, nullable (never touched)
  waiting_since   INTEGER,                       -- epoch ms when status -> agent_waiting; else NULL
  archived        INTEGER NOT NULL DEFAULT 0,    -- 0/1 boolean
  sort_order      INTEGER NOT NULL DEFAULT 0,    -- stable row order in the grid
  last_commit     TEXT NOT NULL DEFAULT '',      -- latest git commit subject (Phase 3)
  uncommitted     INTEGER NOT NULL DEFAULT 0,    -- uncommitted change count (Phase 3)
  status_since    INTEGER,                       -- epoch ms the current status began
  time_cap_min    INTEGER                        -- per-project nudge cap, minutes (Phase 4)
);

-- Append-only audit log. The fairness tally and the grid columns are DERIVED
-- from this table, never stored, so changing the tally window just recomputes.
CREATE TABLE IF NOT EXISTS events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id  TEXT NOT NULL REFERENCES projects(id),
  type        TEXT NOT NULL,                     -- hop | skip | agent_waiting | agent_running | session_end | commit | brief
  payload     TEXT NOT NULL DEFAULT '{}',        -- JSON string
  created_at  INTEGER NOT NULL                   -- epoch ms
);

-- Single-row app config (id is pinned to 1).
CREATE TABLE IF NOT EXISTS settings (
  id                 INTEGER PRIMARY KEY CHECK (id = 1),
  tally_mode         TEXT NOT NULL DEFAULT 'rolling7d', -- rolling7d | daily | weekly | none
  tally_reset_at     INTEGER NOT NULL DEFAULT 0,        -- manual "reset now" timestamp (epoch ms)
  focused_project_id TEXT NOT NULL DEFAULT '',          -- VS Code "you're here" (Phase 3)
  notify_interrupt   INTEGER NOT NULL DEFAULT 1,        -- Slack/desktop on agent waiting (Phase 4)
  notify_nudge       INTEGER NOT NULL DEFAULT 0,        -- per-project time-cap nudges (off by default)
  notify_neglect     INTEGER NOT NULL DEFAULT 1,        -- daily neglect digest
  neglect_hour       INTEGER NOT NULL DEFAULT 9,        -- local hour the digest fires
  neglect_days       INTEGER NOT NULL DEFAULT 3,        -- untouched >= N days = neglected
  last_neglect_fired TEXT NOT NULL DEFAULT ''           -- YYYY-MM-DD once/day guard
);

CREATE INDEX IF NOT EXISTS idx_events_project ON events(project_id, created_at);
CREATE INDEX IF NOT EXISTS idx_events_created ON events(created_at);

-- One Claude Code chat/session (Phase 6). Tracked separately from the project
-- rollup so each open chat is visible, alertable, and gets its own Slack thread.
CREATE TABLE IF NOT EXISTS sessions (
  session_id      TEXT PRIMARY KEY,
  project_id      TEXT NOT NULL REFERENCES projects(id),
  cwd             TEXT NOT NULL DEFAULT '',
  status          TEXT NOT NULL DEFAULT 'running', -- running | waiting | ended
  name            TEXT NOT NULL DEFAULT '',
  last_activity   INTEGER,
  last_result     TEXT NOT NULL DEFAULT '',
  slack_thread_ts TEXT NOT NULL DEFAULT '',
  started_at      INTEGER NOT NULL DEFAULT 0,
  summary             TEXT NOT NULL DEFAULT '',   -- one-line "what happened" (transcript-derived)
  ask                 TEXT NOT NULL DEFAULT '',   -- "what it's waiting on"
  todos_json          TEXT NOT NULL DEFAULT '[]', -- the chat's own TodoWrite list, JSON
  todos_updated_at    INTEGER,                    -- epoch ms of the todos snapshot
  remote_continued_at INTEGER,                    -- epoch ms of last dashboard/phone continue
  resumed_to          TEXT NOT NULL DEFAULT '',   -- forked session id from `claude -p --resume`
  merged_into         TEXT NOT NULL DEFAULT ''    -- set on the headless child so it hides as a dup
);
CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_id, status);
CREATE INDEX IF NOT EXISTS idx_sessions_thread ON sessions(slack_thread_ts);

-- Human-added checklist items per chat (the dashboard "My notes"), distinct from
-- the chat's auto-synced TodoWrite items.
CREATE TABLE IF NOT EXISTS session_notes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id  TEXT NOT NULL,
  text        TEXT NOT NULL,
  done        INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notes_session ON session_notes(session_id);

-- Agent monitor (Phase 3). Registry/status/launchd are read live at snapshot
-- time (never copied in); only this genuinely-persistent state lives here.
CREATE TABLE IF NOT EXISTS agent_acks (
  agent_id    TEXT PRIMARY KEY,
  acked_at    INTEGER NOT NULL,
  fingerprint TEXT NOT NULL DEFAULT ''   -- ack applies only while health fingerprint matches
);
CREATE TABLE IF NOT EXISTS agent_overrides (
  agent_id  TEXT PRIMARY KEY,
  paused    INTEGER NOT NULL DEFAULT 0,
  paused_at INTEGER
);
CREATE TABLE IF NOT EXISTS agent_runs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id    TEXT NOT NULL,
  observed_at INTEGER NOT NULL,
  status      TEXT NOT NULL DEFAULT '',
  exit_code   INTEGER,
  summary     TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_agent_runs ON agent_runs(agent_id, observed_at);
