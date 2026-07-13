# Hopping — Handoff & Recovery

**One-liner:** Hopping is a single-screen dashboard that consolidates all your
AI-agent chats/projects and tells you which to hop to next (lowest "tally" wins;
a chat waiting on you jumps the queue). Built across 8 phases. This file is the
durable, portable record — clone the repo and read this to fully resume on any
machine or in a fresh chat.

**Do you need to finish anything? No.** Nothing is half-built or broken. The code
is committed + pushed, the app is deployed, everything is tested. Only two
*optional* items remain (Slack two-way + magic-link email) — both documented
below. You can safely take a break or start fresh.

---

## Where everything already lives (virtual / durable — survives any machine)

| Thing | Location |
|---|---|
| **All code + full git history** | GitHub: `github.com/tmhopper/project-hopping` (private) |
| **Full build plan + every decision** | `docs/BUILD_PLAN.md` (in this repo) |
| **Deployed phone app** | https://project-hopping.vercel.app · password **`hop-a1c2c1`** |
| **Cloud state + phone action queue** | Upstash Redis (`dezlin-tools` DB, `hopping:` key namespace) |
| **Vercel project + env vars** | Vercel project `project-hopping` (team `timothymarchopper-9720s-projects`), git-connected → auto-deploys on push |

To resume anywhere: `git clone`, read this file + `docs/BUILD_PLAN.md`. In a fresh
chat just say: *"Read HANDOFF.md in project-hopping and continue."*

---

## What's built (Phases 0–8)

- **0** Hop grid (Next.js 16 PWA) — rows=projects, columns=cycles, `rankProjects()` "hop next →", configurable tally window.
- **1** Always-on local **hub** (`hub/server.mjs`, 127.0.0.1:4319), single `applyEvent` ingest point.
- **2** Claude Code hooks → the hub → "waiting on you" desktop alert.
- **3** Git watcher (commit + uncommitted badge) + **VS Code extension** (`vscode-extension/`, sidebar panel, shell-integration agent detection, focus tracking).
- **4** Notification classes (interrupt / nudge / daily standup), desktop + Slack.
- **5** **Phone app** — local Mac stays source of truth; hub mirrors a snapshot to Upstash + drains a phone action queue. Auth = password wall + magic-link. Deployed to Vercel.
- **6** Per-chat tracking — each Claude Code chat is its own session (running/waiting/ended) with its name (ai-title) + "what it needs" read from the transcript. "Open chats" panel. Auto-creates a project from the folder (kills "Unmapped"; guards the home dir).
- **7** Two-way Slack — Block Kit cards (Hopped/Snooze/Continue/Open), one thread per chat, signature-verified Vercel webhooks, quiet hours + per-project mute + per-class routing + presence-aware suppression.
- **8** Remote-drive — reply in a chat's Slack thread → hub runs `claude -p --resume` on that session in its repo (budget-capped, you-only) and posts the result back.

---

## What's LIVE on this Mac (machine-local — must be rebuilt on a new computer)

These are the only pieces that don't travel with GitHub:

1. **LaunchAgent** `com.hopping.hub` (`~/Library/LaunchAgents/com.hopping.hub.plist`) — runs the hub at login. Source: `deploy/com.hopping.hub.plist`.
2. **Global Claude Code hooks** in `~/.claude/settings.json` — Stop/UserPromptSubmit/SessionStart/SessionEnd call `~/.claude/hooks/notify-hub.sh`. Source: `deploy/notify-hub.sh`. Backup of the pre-edit settings: `~/.claude/settings.json.bak.20260621-010305`.
3. **`~/.hopping.env`** — hub config (Upstash + Slack + runner). NOT in the repo. Keys listed below.
4. **VS Code extension** — install `vscode-extension/hopping-watcher.vsix` (`npm run package` in that dir; install via the VS Code binary since `code` isn't on PATH).
5. **Local SQLite** `data/hopping.db` — runtime state only; rebuild with `npm run seed`.

### Rebuild on a fresh machine (checklist)
```
git clone github.com/tmhopper/project-hopping && cd project-hopping
npm install && npm run seed
# create ~/.hopping.env (keys below), restore vault files (~/.slack.env etc.)
cp deploy/com.hopping.hub.plist ~/Library/LaunchAgents/ && launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.hopping.hub.plist
cp deploy/notify-hub.sh ~/.claude/hooks/ && chmod +x ~/.claude/hooks/notify-hub.sh
# append the 4 hook groups to ~/.claude/settings.json (see docs/BUILD_PLAN.md Phase 2)
(cd vscode-extension && npm install && npm run package)  # then install the .vsix
```
Vercel env is already in the cloud (no action). See `docs/BUILD_PLAN.md` for full detail.

---

## Credentials map (pointers, not secrets)

- **`~/.hopping.env`** keys: `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, `HOPPING_SLACK_BOT_TOKEN`, `HOPPING_SLACK_SIGNING_SECRET`, `HOPPING_SLACK_CHANNEL` (currently commented out = Slack muted), `HOPPING_SLACK_USER_MARC`, `HOPPING_CLAUDE_BIN=/Users/hop/.local/bin/claude`, `HOPPING_CONTINUE_BUDGET_USD=1.0`, `APP_URL`.
- **Vercel env** (already set): `HOPPING_CLOUD=1`, `NEXT_PUBLIC_HOPPING_CLOUD=1`, `UPSTASH_REDIS_REST_URL/TOKEN`, `JWT_SECRET`, `HOPPING_PASSWORD=hop-a1c2c1`, `MAGIC_EMAIL`, `GMAIL_USER/PASS`, `HOPPING_SLACK_SIGNING_SECRET/BOT_TOKEN/USER_MARC`.
- **Vault files reused** (in `$HOME`, per your credential-vault system): `~/.slack.env`, `~/.upstash.env`, `~/.vercel.env`, `~/.vme-noreply-gmail.env`.

---

## What's LEFT (optional — nothing blocks a fresh start)

1. **Slack two-way (buttons + reply-to-drive).** The whole backend is built + verified with signed test payloads. It just needs a Slack app's two Request URLs pointed at `…/api/slack/interactivity` + `…/api/slack/events`. Blocked this session because the Playwright/Chrome profile was locked. Manifest is ready: `deploy/hopping-slack-manifest.json`. Fastest path: add those 2 URLs to your existing DezLin CS Slack app (Vercel already has that app's secret). Cleaner path: create the dedicated "Hopping" app from the manifest, then swap `HOPPING_SLACK_BOT_TOKEN` + `HOPPING_SLACK_SIGNING_SECRET` in `~/.hopping.env` + Vercel.
2. **Magic-link email.** Needs a Gmail *app password* for the `noreplyvme` account set as `GMAIL_PASS` in Vercel (currently the account password, which Gmail rejects for SMTP). The password wall already works, so this is optional.

## Current runtime state
- **Slack notifications: OFF** (you muted them). Re-enable by uncommenting `HOPPING_SLACK_CHANNEL` in `~/.hopping.env` + turning the `slack_*` toggles back on in the grid's 🔔 Alerts panel, then `launchctl kickstart -k gui/$(id -u)/com.hopping.hub`.
- **Desktop notifications: ON**, and now formatted as **chat name → what it needs** (the agent's last question/sentence). The "Unmapped" catch-all never notifies.

---

## Lessons learned during the build (portable copy)

- **Claude Code internals:** hooks give `session_id` + `cwd` on stdin but NOT `transcript_path`. Transcripts live at `~/.claude/projects/*/<session_id>.jsonl` — find by globbing the globally-unique session id, not by rebuilding the folder slug. The session's title is the `ai-title` line; each line carries `cwd`. `claude` is a shell function → real binary at `~/.local/bin/claude` (not on PATH). `claude -p --resume <id> --output-format json --max-budget-usd N --permission-mode bypassPermissions "<prompt>"` continues a specific session headlessly.
- **Vercel:** new projects have deployment-protection (SSO) ON — disable via `PATCH /v9/projects/<name>?teamId=<team> {"ssoProtection":null}` so app-level auth is the gate. The `vercel` CLI needs an explicit `--scope <team>` non-interactively. Keep native deps (`better-sqlite3`) off the serverless path via dynamic `import()` so they never load there.
- **Next.js:** `middleware.ts` gates ALL matched routes — signature-authenticated webhooks (Slack, etc.) must be added to the public bypass list (they can't use the session cookie).
- **Slack:** echo the `url_verification` challenge BEFORE the signature check (bootstrap). One app = one interactivity URL + one events URL (reuse conflicts). The DezLin CS bot can post but `conversations.history` returns `ok:false` (post-only scope). Free Upstash caps at 1 DB → reuse an existing DB with a key namespace.
- **VS Code extension:** use the stable Terminal Shell Integration API (`onDidEndTerminalShellExecution`), not the forever-proposed `onDidWriteTerminalData`. Install a local `.vsix` via the app binary (`code` isn't on PATH). Exclude the extension folder from the root `tsconfig` or `next build` fails on `vscode` types.
- **noreplyvme Gmail:** `~/.vme-noreply-gmail.env` holds the account password, not an app password → Gmail SMTP rejects it ("Application-specific password required").
- **macOS presence:** `ioreg -c IOHIDSystem | grep HIDIdleTime` (ns since last input) = "is the user at the machine" — route alerts to desktop when present, push/Slack when away.
