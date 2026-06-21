# CLAUDE.md — Hopping (`project-hopping`)

Orientation for future Claude sessions working in this repo.

## What this is
"Hopping" — a single-screen dashboard that tells Marc which AI-agent-driven
project to hop to next. Lowest **tally** wins by default; a project with an agent
**waiting on you** preempts the rotation. The whole methodology is the pure
function in `lib/rankProjects.ts`.

## Stack
Next.js 16 (App Router) · React 19 · TypeScript · Tailwind v4 · `better-sqlite3`
(WAL). A standalone Node **hub** (`hub/server.mjs`, run under `tsx`) shares the
same SQLite file as the web app. No Supabase yet (Phase 5).

## Run / operate
```bash
npm run dev      # grid → localhost:3000
npm run hub      # hub → 127.0.0.1:4319 (dev). Prod = launchd (see README).
npm run seed     # idempotent project seed
npm test         # vitest: rankProjects + cycles
npm run build    # production build
```
The hub runs in production as the LaunchAgent `com.hopping.hub`
(`~/Library/LaunchAgents/com.hopping.hub.plist`). Kickstart it after wiping
`data/hopping.db` so it reopens the fresh file:
`launchctl kickstart -k gui/$(id -u)/com.hopping.hub`.

## Architecture rules (don't break these)
- **Single ingest point:** every state mutation goes through `applyEvent` in
  `lib/db.ts`. New sensors (git watcher, VS Code) just `POST /event` to the hub —
  do not add other write paths.
- **Pure core:** `rankProjects.ts`, `cycles.ts`, `tally.ts` are pure and unit
  tested. Keep them dependency-free (no DB imports) so they stay portable to a
  future phone client.
- **Derived, not stored:** the fairness `tally` and the grid `columns` are
  computed from the append-only `events` log. Don't add a stored tally column.
- **Swapping SQLite → Supabase (Phase 5)** should be localized to `lib/db.ts`.
- **Offline-tolerant grid:** `app/page.tsx` keeps the last-good state on fetch
  failure. Don't blank the grid when the hub/network is down.

## Claude Code integration (live, global)
`~/.claude/settings.json` hooks call `~/.claude/hooks/notify-hub.sh`:
`Stop`→`agent_waiting`, `UserPromptSubmit`/`SessionStart`→`agent_running`,
`SessionEnd`→`session_end`. The script is the repo's `deploy/notify-hub.sh`. It
always exits 0 and backgrounds its curl, so it can never block or error a Claude
session. **If you edit `~/.claude/settings.json`, back it up first and append to
the existing hook arrays — never overwrite** (it holds Marc's MCP servers,
secrets, and other hooks: Glass.aiff on Stop, notify-where.sh on Notification,
Tink.aiff on AskUserQuestion).

## Project → event mapping
Events carry an absolute folder `path`; `resolveProjectByPath` does a
**longest-prefix** match (so `dezlin-listing-tool` ≠ `dezlin`). Unknown paths →
the `unmapped` project (never deleted). Projects with an empty `path` (SelliChat,
EveryMOS, DezLin) appear on the grid but won't auto-map — edit paths in-app.

## Roadmap
Phase 3: VS Code extension + git watcher (emit `commit` events; the enum already
has `commit`). Phase 4: three notification classes. Phase 5: Supabase + PWA phone
push. Build in order; the build plan lives in the chat history / Marc's plans dir.
