# Hopping

A single-screen dashboard for one person running many AI-agent-driven projects.
It answers one question at a glance:

> **Which project should I hop to next?**

The rule:

1. **Default** — hop to the project with the **lowest tally** (the most neglected).
2. **Interrupt** — any project with an **agent waiting on you** jumps the queue,
   regardless of tally.

Like an OS scheduler: a fair default order, with a hardware interrupt that jumps
the queue. The **tally** is a fairness counter (a touch = "I gave this a move"),
not a completion counter.

## Vocabulary

- The board = **the hop grid** (rows = projects, columns = cycles)
- A touch = **a hop** · the counter = **the hopping tally**
- The recommendation = **"hop next →"** · the interrupt = **"waiting on you"**

## Run it

```bash
npm install
npm run seed     # seed your projects (idempotent — never clobbers your tallies)
npm run dev      # the grid at http://localhost:3000
npm run hub      # the local hub (dev). In production it runs via launchd — see below.
npm test         # the rankProjects + cycles unit tests
```

The **hub** is a tiny always-on local server (`127.0.0.1:4319`) that turns agent
events into grid state. It is installed as a macOS LaunchAgent so it starts at
login and catches events even when the grid isn't open:

```bash
cp deploy/com.hopping.hub.plist ~/Library/LaunchAgents/
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.hopping.hub.plist
# stop:    launchctl bootout gui/$(id -u)/com.hopping.hub
# restart: launchctl kickstart -k gui/$(id -u)/com.hopping.hub
# logs:    data/hub.out.log · data/hub.err.log
```

## How agent detection works

| Source | Mechanism |
|---|---|
| **Claude Code** | global hooks in `~/.claude/settings.json` run `~/.claude/hooks/notify-hub.sh`, which POSTs to the hub. `Stop` → *waiting on you*, `UserPromptSubmit`/`SessionStart` → *running*, `SessionEnd` → *idle*. |
| Git / VS Code / Cursor | Phase 3+ (see the build plan). |

A project is matched to an event by **longest-prefix** on its folder `path`;
unknown folders land on the `Unmapped` project so nothing is lost.

## Architecture

```
Claude Code hooks ─POST /event─▶ HUB (127.0.0.1:4319) ─▶ SQLite (WAL) ◀─poll /api/state─ THE GRID (Next.js PWA)
```

- **Store:** `better-sqlite3` (WAL) at `data/hopping.db`, shared by the app and
  the hub. All writes flow through the single `applyEvent` reducer in
  [`lib/db.ts`](lib/db.ts) — the one ingest point.
- **Methodology:** the whole ranking rule is the pure function
  [`lib/rankProjects.ts`](lib/rankProjects.ts); columns derive in
  [`lib/cycles.ts`](lib/cycles.ts); the fairness window in
  [`lib/tally.ts`](lib/tally.ts).

## Tally window

The tally counts hops inside a window you choose in the app (best practice:
**rolling 7-day**, so neglect heals once you catch up). Options: 7-day · daily ·
weekly · all-time, plus a manual **Reset tallies** button.

## Phone access

Live at **https://project-hopping.vercel.app** (password wall + magic-link). The
Mac stays the source of truth: the hub mirrors a snapshot to Upstash and drains
phone actions back through `applyEvent`, so you can hop from your phone and it
lands on the Mac. Interrupt + neglect alerts arrive as Slack DMs.

## Status

All phases built: the grid (0), local hub (1), Claude Code alert (2),
git watcher + VS Code extension (3), Slack/desktop notification classes (4),
and the Upstash-mirrored Vercel phone app with password + magic-link auth (5).
The VS Code extension lives in `vscode-extension/`; notifications and cloud
config are read from `~/.hopping.env`.
