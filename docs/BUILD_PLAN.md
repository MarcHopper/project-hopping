# Hopping — Build Plan (`project-hopping`)

## Context

Marc runs many projects at once, each driven by AI agents (Claude Code, Cursor, image gen). He is the bottleneck reviewer, and the recurring question is **"which project should I hop to next?"** Today he answers it with a handwritten paper grid (projects-as-rows, cycles-as-columns, a tally per project). This tool replaces the paper grid and then earns its keep by solving the one thing paper can't: **knowing the instant an AI agent has finished and is waiting on him**, so that project preempts the rotation and pings him.

The rule the whole tool serves:
1. **Default:** hop to the lowest-tally project (the most neglected).
2. **Interrupt override:** any project with an agent **waiting on you** jumps the queue, regardless of tally.

This is an OS scheduler: a fair default order, with a hardware interrupt that jumps the queue. The tally is a **fairness counter, not a completion counter** — a check means "I gave this a move," not "this is done."

**Decisions locked with Marc (2026-06-21):**
- Repo/app name: **`project-hopping`** (GitHub repo `project-hopping`, local `~/project-hopping/`, UI title "Hopping").
- First-pass scope: **everything** → build **Phases 0–2** concretely now (repo + grid + hub + Claude Code alert = the full working alert), then continue **Phases 3–5 in order** after Marc validates 0–2. Do not skip ahead.
- Tally reset: **configurable setting**, best-practice default = **rolling 7-day**, with a manual **"Reset tallies"** button. (See "Tally modes".)

**✅ Phases 0–2 SHIPPED (2026-06-21)** — repo live at github.com/tmhopper/project-hopping (private), 13 tests green, hub running as LaunchAgent `com.hopping.hub`, global `~/.claude/settings.json` hooks merged (backup at `~/.claude/settings.json.bak.20260621-010305`). This plan now covers the **continuation: Phases 3–5**.

**Continuation decisions (2026-06-21):**
- **Phone notifications → Slack** (reuse `~/.slack.env` bot, DM Marc) — his phone already has the Slack app, so no web-push/VAPID/SW-push needed. Desktop `osascript` stays for when he's at the Mac.
- **Cloud store → reuse existing Upstash KV** (HTTP REST, ideal for Vercel serverless, matches vme-tools) as a **one-way state mirror**. The local Mac (SQLite) stays the **source of truth**, preserving offline-first. New Upstash DB provisioned via his management token (`~/.upstash.env`). NOT Supabase (avoid net-new account).
- **Phone-app auth → BOTH** a password wall AND magic-link email (either gets you in). Magic-link emails via the `noreplyvme` Gmail sender (`~/.vme-noreply-gmail.env`).
- **Phase 3 terminal detection → stable Terminal Shell Integration API** (`onDidEndTerminalShellExecution` + exit code), NOT the bell-char/`onDidWriteTerminalData` approach (that API is "forever proposed" and unpublishable). Plus a manual "mark as waiting" command as the 100%-reliable fallback.

**Verified environment (discovery done 2026-06-21):**
- No prior "Cycle Manager"/"Hopping" scoping exists anywhere — building fresh from the spec.
- Claude Code **2.1.123**. Hook events `Stop`, `Notification`, `SessionEnd`, plus `SessionStart` / `UserPromptSubmit`, all confirmed; stdin payload carries the working dir as **`cwd`** (Marc's existing `notify-where.sh` already parses it).
- **Existing global hooks must be merged, not replaced:** `~/.claude/settings.json` already has `Stop`→`afplay Glass.aiff`, `Notification`→`notify-where.sh`, `PreToolUse(AskUserQuestion)`→`afplay Tink.aiff`.
- House stack for new apps: **Next.js 16 + React 19 + TypeScript + Tailwind v4 + App Router**, ESLint 9 flat config, no Prettier, repos under `~/`. PWA manifest pattern to reuse from `vme-tools`. No Supabase or `better-sqlite3` anywhere yet (both net-new).
- Tooling present: `jq`, `curl`, `node` (`/opt/homebrew/bin`), `osascript`, `gh` (authed as **`tmhopper`**, repo scope), `git` (Marc / timothymarchopper@gmail.com).

---

## Architecture

```
Agents in projects (Claude Code, Cursor, git) ── events ──▶ LOCAL HUB (127.0.0.1:4319, always-on)
                                                                 │ writes via single reducer
                                                                 ▼
                                                     STORE (SQLite, WAL) ── Phase 5 ▶ Supabase
                                                                 │ reads (poll /api/state)
                                                                 ▼
                                                     THE HOP GRID (Next.js PWA)
```

Phases 0–4 run entirely on Marc's Mac (hub + SQLite). Cloud + phone arrive only at Phase 5, so he is never blocked on infrastructure to get value.

---

## Store & data model

**SQLite via `better-sqlite3` (WAL mode), shared by both the Next.js app and the standalone hub.** WAL lets the hub write while the grid reads without blocking; `busy_timeout=5000` handles the rare write-write contention. `better-sqlite3` is synchronous (no pool, trivially correct for this tiny workload). All access funnels through `lib/db.ts`, so the Phase-5 swap to Supabase is a one-file change. DB at `~/project-hopping/data/hopping.db` (gitignored), resolved by both processes via `process.env.HOPPING_DB ?? ~/project-hopping/data/hopping.db` regardless of cwd.

```sql
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,                 -- slug, e.g. "dezlin"
  name TEXT NOT NULL,
  path TEXT NOT NULL DEFAULT '',       -- absolute folder, maps events → project (longest-prefix)
  status TEXT NOT NULL DEFAULT 'idle', -- idle | agent_running | agent_waiting | blocked
  last_brief TEXT NOT NULL DEFAULT '', -- "where I left off"
  last_touched_at INTEGER,             -- epoch ms, nullable
  waiting_since INTEGER,               -- epoch ms when status → agent_waiting; else NULL
  archived INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS events (    -- append-only audit log; tally & cycles derive from this
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL REFERENCES projects(id),
  type TEXT NOT NULL,                  -- hop | skip | agent_waiting | agent_running | commit | session_end | brief
  payload TEXT NOT NULL DEFAULT '{}',  -- JSON string
  created_at INTEGER NOT NULL          -- epoch ms
);
CREATE TABLE IF NOT EXISTS settings (  -- single-row app config
  id INTEGER PRIMARY KEY CHECK (id = 1),
  tally_mode TEXT NOT NULL DEFAULT 'rolling7d', -- rolling7d | daily | weekly | none
  tally_reset_at INTEGER NOT NULL DEFAULT 0     -- manual "reset now" timestamp (epoch ms)
);
CREATE INDEX IF NOT EXISTS idx_events_project ON events(project_id, created_at);
```

Note: `tally` is **not stored** — it is computed per project as the count of touch events (`hop`) inside the active tally window (see below), so changing the reset mode just recomputes. `waiting_since` is stamped so `rankProjects()` can stay a pure function over the `projects` array.

`lib/db.ts` is the **single ingest point** — its `applyEvent(pathOrId, type, payload)` reducer is the only write path for state. It: resolves the project (longest-prefix path match → falls back to seeded `unmapped` so nothing is lost), inserts the event, and mutates status. A `hop`/"I worked on it" sets `last_touched_at=now`, `status='idle'`, `waiting_since=NULL`, optional `last_brief`. Everything (API routes, hub, future sensors) calls this one function.

---

## The hop logic — `lib/rankProjects.ts` (pure, tested)

`tally` is computed by the caller (windowed count) and passed in on each project, so the function stays pure and reusable by a future phone client.

```ts
export function rankProjects(projects: Project[]): { next: Project | null; ordered: Project[] } {
  const active = projects.filter(p => !p.archived);
  const waiting = active.filter(p => p.status === 'agent_waiting')
    .sort((a,b) => (a.waiting_since ?? Infinity) - (b.waiting_since ?? Infinity) || a.id.localeCompare(b.id));
  const fair = active.filter(p => p.status !== 'agent_waiting')
    .sort((a,b) => a.tally - b.tally || (a.last_touched_at ?? 0) - (b.last_touched_at ?? 0) || a.id.localeCompare(b.id));
  const ordered = [...waiting, ...fair];
  return { next: ordered[0] ?? null, ordered };
}
```

Waiting tier first (interrupt override, oldest wait first); then fair tier (lowest tally, tie-break oldest touch). Ships with a Vitest suite covering: lowest-tally wins, waiting preempts a lower-tally project, oldest-wait-first, tally tie → oldest touch, archived excluded.

**Cycle/column derivation — `lib/cycles.ts` (derived, never stored).** A column = one pass where every active project has been touched once. Replay touch events in order: if a project is touched that was already touched in the current pass → that touch starts the next column; the instant every active project has a touch in the current pass → the column closes and a fresh one opens. Archived projects are excluded from the "every active project" check. The rightmost column is the live one being filled.

---

## Tally modes (Marc's "make it an option")

`tally_mode` in `settings` controls the window over which touches are counted; default **`rolling7d`** (best practice — neglect measured against the recent past, so a project "heals" once caught up). The active window start = `max(modeStart, tally_reset_at)`:
- `rolling7d` → `now − 7 days`
- `weekly` → most recent Monday 00:00 local
- `daily` → today 00:00 local
- `none` → 0 (all-time)

A **"Reset tallies"** button writes `tally_reset_at = now` (manual user reset, independent of mode). A small settings control (gear on the grid) switches mode and shows the current window. Because tallies are derived from the append-only events log, switching modes or resetting just recomputes on the next `/api/state` poll — no data migration, no destructive write.

---

## Repo layout (one repo, no monorepo tooling)

The Next.js app, the hub, and shared code live in one repo. Shared `lib/*.ts` is authored in TS; the hub runs under **`tsx`** (dev dependency, `npx tsx`) so it imports the exact same `lib/*.ts` as the API routes — zero duplication, zero separate build for Marc to babysit.

```
~/project-hopping/
├── app/
│   ├── layout.tsx              # PWA meta (from vme-tools) + manifest link, title "Hopping"
│   ├── globals.css             # @import "tailwindcss"; @theme inline tokens
│   ├── page.tsx                # the single-screen grid (client shell, polls /api/state)
│   └── api/
│       ├── state/route.ts      # GET → { projects(+computed tally), ranked, columns, settings }
│       ├── action/route.ts     # POST { projectId, action: worked|skip|hop, brief? }
│       ├── projects/route.ts   # GET list / POST add  (+ [id]/route.ts: PATCH edit/archive/reorder, DELETE)
│       └── settings/route.ts   # GET / PATCH tally_mode, POST reset-tallies
├── components/                 # Grid, CellModal, HopBanner, ProjectEditor, SettingsBar
├── lib/
│   ├── db.ts                   # SHARED better-sqlite3 + applyEvent reducer + resolveProjectByPath
│   ├── schema.sql              # SHARED (applied idempotently on open)
│   ├── types.ts                # SHARED Project, EventType, Settings
│   ├── rankProjects.ts         # SHARED pure methodology
│   ├── rankProjects.test.ts    # Vitest
│   ├── cycles.ts               # SHARED deriveColumns()
│   └── tally.ts                # SHARED windowStart() + computeTally()
├── hub/server.mjs              # standalone http server 127.0.0.1:4319 (run: npx tsx hub/server.mjs)
├── scripts/seed.ts             # editable seed of real projects
├── deploy/
│   ├── com.hopping.hub.plist   # launchd → ~/Library/LaunchAgents/
│   └── notify-hub.sh           # Claude Code hook → ~/.claude/hooks/
├── public/                     # manifest.json + icon-192/512 (PWA)
├── data/                       # gitignored: hopping.db (+ WAL/SHM), hub logs
└── package.json / postcss.config.mjs / eslint.config.mjs / tsconfig.json / next.config.ts / .gitignore
```

`package.json` scripts: `dev`, `build`, `start`, `lint`, `hub` (`tsx hub/server.mjs`), `seed` (`tsx scripts/seed.ts`), `test` (`vitest run`). Deps: `next@16`, `react@19`, `react-dom@19`, `better-sqlite3`. Dev: `tsx`, `vitest`, `@types/better-sqlite3`, `typescript`, `@tailwindcss/postcss`, `tailwindcss`, `eslint`, `eslint-config-next`, `@types/node/react/react-dom`.

**Grid refresh:** plain `setInterval(() => fetch('/api/state'), 3000)` in `page.tsx`, wrapped in try/catch — on failure it keeps the last good state (offline-tolerant; a down hub never blanks the grid). In-app actions call the loader immediately for instant feedback. `/api/state` sets `export const dynamic = 'force-dynamic'`. No SWR/websockets.

---

## Build — Phase 0 (the grid, local only, offline)

1. Create GitHub repo `project-hopping` (private; flip to public later if Marc wants the methodology visible) via `gh repo create`, clone to `~/project-hopping/`.
2. Scaffold Next.js 16 + React 19 + TS + Tailwind v4 + App Router + ESLint flat config, matching `~/job-tracker` (`postcss.config.mjs`, `globals.css` `@import "tailwindcss"` + `@theme inline`, `tsconfig.json` `@/*`). Add PWA `public/manifest.json` + apple-mobile-web-app meta in `layout.tsx` (pattern from `vme-tools`).
3. `lib/db.ts` + `schema.sql` + `types.ts` + `tally.ts`; `lib/rankProjects.ts` + test; `lib/cycles.ts`.
4. `scripts/seed.ts` — idempotent upsert (never clobbers edited tallies), seeds `unmapped` first then real projects (DezLin, EveryMOS, SelliChat, VME/vme-tools, marchopper-site, job-tracker, lawyer-outreach, Aisha's Notebook, dezlin-listing-tool, Secret Squirrel/lets-talk-freely). Verify each `path` against the real folder at install (`ls -d`); all are editable in-app.
5. Grid UI: rows = active projects, columns = `deriveColumns()` + trailing live column. Tap a cell → modal **[ Nothing here, skip ]** / **[ I worked on it ]**; "I worked on it" reveals a one-line brief field and records a `hop`. `HopBanner` shows **"hop next → EveryMOS (tally 2)"** from `rankProjects()`. `SettingsBar` (tally mode + Reset tallies).

**Done when:** Marc can run a full day off the grid instead of paper; the "hop next" banner is always correct; a new column auto-opens when every active project is touched; **with Wi-Fi off, everything still works**; `npm test` green.

## Build — Phase 1 (the local hub)

1. `hub/server.mjs` — Node `http` on **127.0.0.1:4319** (loopback only). `POST /event {path,type,payload}` → `applyEvent(...)` (same reducer the app uses). `GET /health` → `{ok:true}`. Unknown paths → `unmapped`.
2. `deploy/com.hopping.hub.plist` (RunAtLoad + KeepAlive, abs `/opt/homebrew/bin/npx tsx`, log paths in `data/`) → `~/Library/LaunchAgents/`, `launchctl load`.

**Done when:** `curl -XPOST 127.0.0.1:4319/event -d '{"path":"/Users/hop/job-tracker","type":"agent_waiting"}'` flips job-tracker to `agent_waiting` within 3s and jumps it to the top of the banner; a longest-prefix path (`/Users/hop/dezlin-listing-tool/...`) maps to `dezlin-listing-tool`, not `dezlin`; an unknown path lands on `Unmapped`; killing the hub leaves the grid showing last-good state; after `launchctl load` + relogin, `/health` answers with nothing started by hand.

## Build — Phase 2 (Claude Code alert — the thing Marc actually wants)

State machine: `SessionStart`/`UserPromptSubmit` → `agent_running` (clears waiting when Marc replies in-terminal); **`Stop` → `agent_waiting`** (stamps `waiting_since`, hub fires desktop notification); `SessionEnd` → `idle`. `Notification` is intentionally deferred to Phase 3 to avoid double-firing with the existing `notify-where.sh`.

1. **Back up first:** `cp ~/.claude/settings.json ~/.claude/settings.json.bak.$(date +%Y%m%d-%H%M%S)`.
2. **Merge, don't replace** — append a second group to the existing `Stop` array (keeps Glass.aiff) and add new `UserPromptSubmit`/`SessionStart`/`SessionEnd` keys, all pointing at one script `~/.claude/hooks/notify-hub.sh <running|waiting|session_end>`. Preserve every existing `permissions`/`mcpServers`/`model`/hook. Use the **`update-config` skill** to edit settings.json safely rather than hand-editing; then `jq . ~/.claude/settings.json` to validate and eyeball that Glass.aiff, notify-where.sh, and Tink.aiff groups all survive.
3. Install `deploy/notify-hub.sh` → `~/.claude/hooks/` (`chmod +x`). It reads stdin, extracts `cwd` (`jq` → sed fallback → `$PWD`), backgrounds a `curl -m 2 --connect-timeout 1` to the hub, **always `exit 0`** (a down hub or bad payload can never block or error a Claude session).
4. Hub fires the notification on `agent_waiting`: `osascript -e 'display notification "<name> is waiting on you" with title "Hopping" sound name "Glass"'` (errors swallowed).
5. Close the loop: hopping to the project in the grid (or replying in-terminal via `UserPromptSubmit`) returns status to idle and records the `hop`.

**Done when:** Marc fires a Claude Code task in (e.g.) `~/job-tracker`, switches away, and the moment Claude finishes its turn he gets a "job-tracker is waiting on you" desktop notification **and** that project jumps to the top of the grid as `agent_waiting` — while Glass.aiff still plays (existing hook intact).

---

## Roadmap — Phases 3–5 — superseded by the detailed "CONTINUATION BUILD" section below (kept for history)

- **Phase 3 — VS Code extension + git watcher.** Minimal TS extension: on workspace change POST `agent_running` (tracks "currently in"); watch the integrated terminal for the bell char `` → `agent_waiting` (catches Cursor + CLI agents); show `last_brief` in the status bar. Hub watches each project's `.git` for new commits → `commit` events. Also wire the deferred `Notification` hook (matchers `permission_prompt`/`idle_prompt`) to a distinct "needs permission" state.
## CONTINUATION BUILD — Phases 3, 4, 5 ("do everything that is left")

Build in order; verify each phase empirically (the proven 0–2 method) before moving on. Every new sensor still POSTs to the hub's single `applyEvent` ingest point — no new write paths into SQLite.

### Phase 3 — git watcher (hub) + VS Code extension

**A. Git watcher — in the hub (`hub/server.mjs` + new `hub/gitwatch.mjs`).** Reliable, build first.
- On startup + a 60s rescan, read projects; for each with a non-empty `path` containing `.git/`, `fs.watch('.git/logs/HEAD')` (debounced 500ms). macOS FSEvents fires reliably on append (research-confirmed); core `fs` is enough.
- On change: `git -C <path> log -1 --format=%H%x1f%s` → POST `commit` event `{path, type:'commit', payload:{sha, subject}}`; `git -C <path> status --porcelain | wc -l` for the uncommitted count.
- **db change:** idempotent `ALTER TABLE projects ADD COLUMN last_commit TEXT / uncommitted INTEGER` in `getDb()` (ignore "duplicate column"). `applyEvent` `commit` case updates `last_commit`+`uncommitted` (NOT `last_brief`). Grid shows commit subject + a "●N uncommitted" badge.

**B. VS Code extension — new `vscode-extension/` folder** (TS, esbuild, installs as a local `.vsix`; no Marketplace/signing — research-confirmed).
- **"Currently in":** `window.onDidChangeActiveTextEditor` + `workspace.getWorkspaceFolder(uri)` + `onDidChangeWindowState` → new hub endpoint `POST /focus {path}` sets `settings.focused_project_id`; grid marks that row "● you're here" (separate from `status`, never affects ranking).
- **Agent-done:** `window.onDidEndTerminalShellExecution` → if `execution.commandLine.value` matches `hopping.agentCommandPattern` (default `claude|cursor|aider|codex|gemini|llm|gpt`) → `agent_waiting {path = terminal shellIntegration.cwd ?? workspace}`. `onDidStartTerminalShellExecution` (matching) → `agent_running`.
- **Manual fallback command** `Hopping: Mark current project as waiting` — 100% reliable when shell integration is off.
- **Status-bar item:** polls hub `/state` every 5s; shows focused project `last_brief`+tally; click → opens `http://localhost:3000`.
- Config `hopping.hubPort`/`hopping.agentCommandPattern`; build `.vsix`, `code --install-extension`.

**Done when:** switching workspaces flips the "you're here" marker; a finishing shell-integrated agent command flips its project to `agent_waiting`; a new commit shows subject + uncommitted badge; the manual command works.

### Phase 4 — three notification classes (Slack DM + desktop)

Slack = the **phone** channel (reuse `~/.slack.env` bot; DM Marc; channel id in `~/.hopping.env` as `HOPPING_SLACK_CHANNEL`). New `hub/notify.mjs` wraps `osascript` (desktop) + Slack `chat.postMessage`.
- **1. Interrupt (high):** on `becameWaiting` → desktop + Slack "⚡ {name} is waiting on you" (already dedup'd to the transition).
- **2. Cycle nudge (low, OFF by default):** per-project `time_cap_min`; a 60s hub timer checks running/focused duration vs cap → desktop nudge.
- **3. Daily neglect digest:** a hub timer fires once/day at `settings.neglect_hour` (default 9) → Slack digest of projects untouched ≥ N days, bottom of the tally, ending "hop next → …". `last_neglect_fired` (date) guards single-fire.
- **Suppressible:** `notify_interrupt`/`notify_nudge`/`notify_neglect` + `neglect_hour` in `settings`, toggles in `SettingsBar`. Slack target chosen autonomously; stored in `~/.hopping.env` + plist env.

**Done when:** an `agent_waiting` lands a Slack DM on Marc's phone + desktop banner; the daily digest posts at the set hour; each class toggles off; no duplicate spam.

### Phase 5 — Upstash KV mirror + Vercel phone app (password + magic-link)

**Store:** provision a new Upstash Redis DB via the management API (`~/.upstash.env`); REST URL+token → `~/.hopping.env` (local) + Vercel env (via `~/.vercel.env` PAT). New `lib/cloud.ts` = thin Upstash REST client.
- **Hub mirror:** after every `applyEvent`, write `hopping:state` (JSON snapshot) to Upstash. Hub drains a Redis list `hopping:actions` every ~2s — each `{projectId,action,brief}` runs through local `applyEvent` (source of truth) → re-mirrors. One user, eventual consistency.
- **Vercel app (same repo, env-switched):** route handlers branch on `process.env.HOPPING_CLOUD`. On Vercel they **dynamically import `lib/cloud.ts`** (never `lib/db.ts`, so `better-sqlite3`'s native binary is never required at runtime): `/api/state` reads `hopping:state`; `/api/action`+settings push to `hopping:actions`. Local path unchanged (SQLite).
- **Auth (`middleware.ts`):** gate all except `/login`+`/api/auth/*`; session = signed JWT cookie `hopping_session` (HS256 `JWT_SECRET`, vme-tools pattern). Two ways, same cookie: (a) **password** `POST /api/auth/password` vs `HOPPING_PASSWORD`; (b) **magic-link** `POST /api/auth/magic {email}` (Marc only) → signed link emailed via `noreplyvme` Gmail → `GET /api/auth/verify?token=` sets cookie. `/login` offers both.
- **PWA polish:** add a minimal service worker for installability (no web push — Slack covers phone alerts).
- **Deploy:** `vercel --prod` via PAT; env `HOPPING_CLOUD=1`, `UPSTASH_REDIS_REST_URL/TOKEN`, `HOPPING_PASSWORD`, `JWT_SECRET`, magic-link creds; disable Vercel deployment-protection (app-level auth replaces it).

**Done when:** from Marc's phone off Wi-Fi → Vercel URL → password or magic-link → live grid mirrored from his Mac within seconds → tap "I worked on it" → the Mac hub applies it + desktop grid updates; a waiting agent lands a Slack DM.

---

## Verification (continuation)

- **Phase 3:** `curl 127.0.0.1:4319/focus -d '{"path":".../job-tracker"}'` marks "you're here"; a test commit in a watched repo → `commit` event + subject/uncommitted badge within ~1s; install the `.vsix`, switch workspaces, run a matching terminal command, run the manual command.
- **Phase 4:** test `agent_waiting` → Slack DM + desktop; set `neglect_hour` to now → one digest; toggle each class off → silence.
- **Phase 5:** `npm run build` clean with the cloud branch; deployed URL blocked until login; both password + magic-link grant access; a local hop appears on the deployed grid within seconds; a phone action drains back to the Mac; no `better-sqlite3` native error in Vercel function logs.

## Critical files (continuation)

- New: `hub/gitwatch.mjs`, `hub/notify.mjs`, `lib/cloud.ts`, `middleware.ts`, `app/login/page.tsx`, `app/api/auth/*`, `vscode-extension/` (own `package.json` + `src/extension.ts` + `esbuild.js`).
- Edited: `hub/server.mjs` (`/focus`, mirror, action-drain, wire notify+gitwatch), `lib/db.ts` (commit cols + focused/notify settings + migrations), `app/api/{state,action,settings}/route.ts` (cloud branch), `components/{Grid,SettingsBar}.tsx`, `lib/types.ts`, `lib/schema.sql`, `deploy/com.hopping.hub.plist` (env), `package.json`.
- Reuse vault creds (do NOT ask Marc to paste): `~/.slack.env`, `~/.upstash.env`, `~/.vercel.env`, `~/.vme-noreply-gmail.env`. New local `~/.hopping.env` holds assembled config (Upstash REST URL/token, Slack channel, password, JWT secret).

---

## Verification (end-to-end)

- **Phase 0:** `npm install && npm run seed && npm run dev` → grid renders seeded rows; tap-cell modal increments tally + fills cell + captures brief; touching all active projects opens a new column; banner names lowest-tally and advances; **Wi-Fi off still works**; `npm test` green. Toggle tally mode + "Reset tallies" and confirm the banner re-ranks.
- **Phase 1:** `curl /health` ok; the `agent_waiting` curl flips + promotes job-tracker in ≤3s; prefix-collision and unknown-path cases behave; hub kill = graceful; plist survives relogin.
- **Phase 2:** after backup+merge, `jq` validates settings.json and all three existing hook groups remain; a real Claude Code session in a seeded folder shows `agent_running` on prompt submit, `agent_waiting` + desktop notification on turn finish (Glass.aiff still plays), and returns to idle on reply/hop/SessionEnd.

---

## Critical files & risks

**New files (highest-leverage):** `lib/db.ts` (store + single ingest reducer), `lib/rankProjects.ts` (the methodology, pure+tested), `lib/cycles.ts` + `lib/tally.ts` (derivations), `hub/server.mjs` (always-on hub + osascript notify), `deploy/notify-hub.sh` + `deploy/com.hopping.hub.plist`.
**High-risk edit:** `~/.claude/settings.json` — Marc's live global Claude config (MCP servers, permissions, model). Mitigation is mandatory and ordered: (1) timestamped backup, (2) append-only merge via the `update-config` skill, (3) `jq` validate + eyeball existing hooks survive, (4) rollback = restore the backup. The hook script's always-`exit 0` + backgrounded curl means its own blast radius is nil; the only real risk is JSON malformation, which the backup+validate step contains.
**Patterns to copy:** `~/job-tracker/lib/prisma.ts` (singleton on `globalThis`), `~/job-tracker/postcss.config.mjs` + `app/globals.css` (Tailwind v4), `~/Documents/vme-tools/app/layout.js` + `public/manifest.json` (PWA), `~/.claude/hooks/notify-where.sh` (hook style), `~/Library/LaunchAgents/com.dezlin.backinstock.plist` (plist convention).

---
---

# CONTINUATION 2 — Phases 6–8: live per-chat monitoring + two-way Slack remote control

## Context (why)

After 0–5 shipped, Marc gave two pieces of feedback: (1) the tool *looks* like it only tracks a static project list and he can't see live VS Code Claude Code activity or the **VS Code extension** (it's installed as `tmhopper.hopping-watcher` but only shows a tiny status-bar item and needs a window reload); (2) Slack alerts are one-way — he wants **control** and to **reply/act**. His key elaboration: **"each chat lives within a reply so I can track the entirety of it"** — i.e. every Claude Code chat gets its own Slack thread, results posted there, and he replies to drive it.

**Root cause found (investigation 2026-06-21):** the global hooks DO fire for every Claude Code session (panel + terminal) and carry `session_id`, but (a) sessions launched from `/Users/hop` fall to `unmapped`, and (b) multiple chats in one folder collapse to one project status — so it never feels live/per-chat. **Verified centerpiece is feasible:** `claude -p --resume <session_id> --permission-mode bypassPermissions --output-format json "<prompt>"` continues a specific session headlessly and returns the result; transcripts live at `~/.claude/projects/*/<session_id>.jsonl` (locate by globbing the **globally-unique session_id** — no fragile slug decoding; each line also carries `cwd`).

**Marc selected ALL options** across both areas + a dedicated Slack app. Build in order 6 → 7 → 8; verify each before the next. Every new sensor/action still flows through the hub's single `applyEvent` ingest point and the Upstash queue bridge — no parallel write paths.

> ⚠️ **Surface to Marc (opt-in, powerful):** Phase 8 makes a Slack reply **run an autonomous `claude` agent** in the relevant repo on his Mac (`bypassPermissions`, `--max-budget-usd` capped, **only** his verified Slack user id, signature-verified). This is exactly the "reply with what to do" he asked for — flagging because Slack replies will trigger real, tool-using agent runs.

## Phase 6 — per-session tracking + kill 'Unmapped' + visible VS Code panel

- **`sessions` table** (`lib/db.ts` schema + `FALLBACK_SCHEMA` + `migrate()`): `session_id PK, project_id, cwd, status(running|waiting|ended), name, last_activity, last_result, slack_thread_ts, started_at`. Add `Session` to `lib/types.ts`.
- **Single-ingest preserved:** inside `applyEvent`, after the project rollup, call a private `applySessionEvent(...)` when `payload.session_id` is present — upserts the session row + maps event→session status, and returns `sessionBecameWaiting` (computed from prior session status, mirrors the existing project-level `becameWaiting`). No new write path.
- **Kill 'Unmapped':** new `resolveOrCreateProjectByPath(target)` — if longest-prefix match misses AND `target` is a real absolute path, auto-create a project from the folder basename (slug+name, dedupe ids) instead of `unmapped`; pathless events still use `unmapped`. The VS Code extension also POSTs its workspace folder on activation (a `skip` event — no-op on status, but flows through auto-create) so sessions map to the open workspace root.
- **Transcript reader** `hub/transcript.mjs` (hub-only, Node fs): `findTranscript(sessionId)` = glob `~/.claude/projects/*/<id>.jsonl` (pick newest on collision); `readLastResult(sessionId)` tails the file, returns the last `assistant` text block (or last `result.result`), capped ~4KB + a 140-char summary; `readCwd(sessionId)` from the first line. Called when a session goes `waiting`.
- **Surface open chats:** `listSessions()` (open, joined to project name) → added to `hub/mirror.mjs::snapshot()` + `/api/state` local branch (cloud branch just forwards the mirrored snapshot). New `components/OpenChats.tsx` + per-project expandable session list in `components/Grid.tsx`; add `sessions` to the `StateResponse` type in `app/page.tsx`.
- **Per-chat alerts:** in `hub/server.mjs::ingest`, also fire the interrupt notify on `result.sessionBecameWaiting` (so a 2nd waiting chat in the same folder still pings), de-duped against the project-level fire; text becomes session-aware.
- **Visible VS Code panel:** extend `vscode-extension/` with a **TreeView** sidebar (activity-bar container "Hopping", view `hopping.grid`) via new `src/tree.ts` (`TreeDataProvider` polling `/state` every 5s): projects → their open sessions with `last_result` as description; keep the status-bar item. Re-package + reinstall the `.vsix`.
- **DoD:** a Claude session in a fresh folder creates a `sessions` row + a real project (never `unmapped`); `/state` returns `sessions`; grid + VS Code panel show open chats with result snippets; a 2nd waiting chat in one folder fires its own alert. **Verify:** curl the session lifecycle (`S1`/`S2` same path → two interrupts); `readLastResult` against a real session in the gnarly `My Drive (developer@dezlin.com)` folder proves glob-by-id.

## Phase 7 — dedicated 'Hopping' Slack app + two-way control

- **Create the app from a manifest** `deploy/hopping-slack-manifest.json` (scopes `chat:write`,`im:history`,`im:write`; Interactivity URL `…/api/slack/interactivity`; Events `message.im` → `…/api/slack/events`). Creation ladder (Marc's escalation order): App-Manifest API with a config token → **Playwright** on api.slack.com (his Chrome is signed in; React-fiber recipe for the masked signing secret) → manual create-from-manifest. Store `HOPPING_SLACK_BOT_TOKEN` + `HOPPING_SLACK_SIGNING_SECRET` + `HOPPING_SLACK_CHANNEL` (DM id) + `HOPPING_SLACK_USER_MARC=U04RJNFM5FU` in `~/.hopping.env` **and** Vercel env. Verify with `auth.test` before wiring.
- **Block Kit pipeline** (`hub/notify.mjs` + new `hub/cards.mjs`): `slackPost/slackReply/slackUpdate`; `waitingCard` with buttons **Hopped ✓ / Snooze 1h / Open grid / Continue…**; store the returned `ts` as the session's `slack_thread_ts` (new setter) so every later update is a **thread reply** — one thread per chat. Switch to `HOPPING_SLACK_BOT_TOKEN` (fallback to current token).
- **Two Vercel Slack routes** (`app/api/slack/interactivity/route.ts`, `app/api/slack/events/route.ts`), `runtime="nodejs"`: read **raw body**, HMAC-verify via new `lib/slackVerify.ts` (`node:crypto`, `v0:ts:body`, 300s replay guard, `timingSafeEqual`), authorize **only** `HOPPING_SLACK_USER_MARC`, handle the events `url_verification` challenge. Each maps to a `QueuedAction` and `cloudPushAction(...)` (Vercel never touches the hub). New action kinds interpreted in `mirror.mjs::ingestQueuedActions`: `hopped`{projectId,sessionId}→`hop`; `snooze`{projectId,minutes}; `mute`{projectId,muted}; `status`→re-post standup; `continue`{thread_ts|sessionId,prompt}→Phase 8. Existing phone `{action}`/`{settings}` shapes keep working (branch on `kind`).
- **Control settings** (`migrate()` ALTERs, reuse duplicate-column swallow): `settings.quiet_start/quiet_end` (hour, -1=off, wrap-around aware), `settings.slack_interrupt/slack_nudge/slack_neglect` (per-class Slack routing), `projects.muted`, `projects.snooze_until`. Gate every Slack post in `notify.mjs`/`schedules.mjs` on quiet-hours + class flag + project mute/snooze. Extend `getSettings()`/`Settings`/the `EMPTY` fallback. UI: quiet-hours + 3 Slack toggles in `SettingsBar.tsx`; per-project mute in `CellModal.tsx`.
- **Actionable daily standup:** upgrade the neglect digest in `schedules.mjs` to a `standupCard` (per-project status + hop-next + per-project Hopped/Snooze/Mute buttons + Open grid).
- **DoD:** Hopping app installed; alerts are cards with working buttons; `Hopped ✓` in Slack marks the project done (round-trips Upstash→hub); each waiting chat owns a thread; quiet hours + mute + per-class routing honored. **Verify:** signed curl to both routes (good sig→200 + action lands in `hopping:actions`; bad sig→401); `url_verification` echo; wrong user ignored; quiet-hours suppression.

## Phase 8 — remote-drive loop (reply → continue the chat → result back)

- **Path:** Slack thread reply / `Continue…` → Vercel events route verifies + enqueues `{kind:"continue", thread_ts, prompt}` (Vercel stays stateless — the **hub** resolves `sessionId`+`cwd` from `sessions WHERE slack_thread_ts=?` on drain).
- **Runner** `hub/runner.mjs` (drained in `ingestQueuedActions`): resolve session; **per-session lock** (in-memory `Set`, never double-resume) + small global concurrency cap; immediate `🤖 working…` thread reply; **detached** `child_process.spawn('claude', ['-p','--resume',id,'--permission-mode','bypassPermissions','--output-format','json','--max-budget-usd',cap,prompt], {cwd})`; on exit parse JSON `result`, update the session row, **thread-reply the result** (truncated), re-mirror, release lock; on error/budget/timeout → thread-reply the failure.
- **`--fork-session` decision:** default **no fork** (one thread = one ongoing session id). Safety valve: if the session was active very recently (likely also open interactively in a terminal), use `--fork-session` for that run and say so in-thread — avoids clobbering a live session.
- **Safety (all required):** one-at-a-time per session; `--max-budget-usd` from settings (`continue_budget_usd`, default ~1.00); **only Marc's verified Slack id** (enforced at Vercel + re-checked at hub); `bypassPermissions` justified (his own repos, capped) and documented in the runner header.
- **DoD:** a Slack reply in a chat's thread runs `claude -p --resume` in that session's cwd and posts the result back in-thread; concurrent replies serialize; budget enforced; only Marc can drive it. **Verify:** real round-trip ("say hello and stop" → ack → result in-thread; `sessions.last_result` updated); two fast replies → no double `claude` process (check `ps`); `--max-budget-usd 0.01` → graceful budget reply; forged non-Marc id → ignored.

## Critical files (continuation 2)

- **Edited:** `lib/db.ts` (sessions table + `applySessionEvent` + `resolveOrCreateProjectByPath` + new settings/project columns + readers/setters), `hub/server.mjs` (per-session interrupt), `hub/mirror.mjs` (snapshot adds `sessions`; drain handles new action kinds), `hub/notify.mjs` + `hub/schedules.mjs` (Block Kit + quiet-hours/mute gating + standup), `app/api/state|settings/route.ts`, `app/page.tsx` + `components/{Grid,SettingsBar,CellModal}.tsx`, `vscode-extension/src/extension.ts` + `package.json`, `lib/types.ts`, `lib/schema.sql`, `~/.hopping.env` + Vercel env.
- **New:** `hub/transcript.mjs`, `hub/cards.mjs`, `hub/runner.mjs`, `lib/slackVerify.ts`, `app/api/slack/interactivity/route.ts`, `app/api/slack/events/route.ts`, `components/OpenChats.tsx`, `vscode-extension/src/tree.ts`, `deploy/hopping-slack-manifest.json`.
- **Reuse (no paste):** `~/.slack.env` (signing-secret HMAC pattern from `~/dezlin-cs/lib/slack.py`), `~/.upstash.env`/`~/.vercel.env`, existing `lib/cloud.ts` queue bridge, existing `middleware.ts`/`lib/auth.ts` auth.

## Riskiest parts + de-risking

1. **Slack app creation automation** → ship the manifest so API/Playwright/manual all install the same config; confirm with `auth.test` before wiring. May need a one-time Marc assist if config-token + Playwright both fail.
2. **Resuming a session also open interactively** (Phase 8) → no-fork default + fork-as-safety-valve keyed on recent `last_activity` + per-session lock.
3. **Transcript location** → glob by globally-unique session_id (de-risked; slug decoding only a fallback).
4. **Single-ingest invariant** → sessions updated *inside* `applyEvent`; remote actions ride Upstash→`ingestQueuedActions`→`ingest`→`applyEvent`; the only new side effect is the runner spawning `claude`, whose *result* re-enters via `applyEvent` + mirror.
