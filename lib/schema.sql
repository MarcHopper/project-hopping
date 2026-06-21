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
