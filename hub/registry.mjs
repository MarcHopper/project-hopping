// Live Claude Code process registry. Claude writes one file per running process
// at ~/.claude/sessions/<pid>.json ({pid, sessionId, cwd, startedAt, entrypoint,
// kind, name}). A session's window is "open" iff such a file exists AND its pid
// is alive. This is how the dashboard shows which chats are actually on screen
// vs. merely tracked. Hub-only (Node fs + ps); never imported by the Vercel app.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const SESSIONS_DIR = path.join(os.homedir(), ".claude", "sessions");
const CACHE_MS = 10_000;

let cache = { at: 0, map: new Map() };

/** Set of currently-alive pids, via ONE `ps` call (not per-pid). */
function alivePids() {
  try {
    const out = execFileSync("/bin/ps", ["-axo", "pid="], { encoding: "utf8" });
    const set = new Set();
    for (const line of out.split("\n")) {
      const n = parseInt(line.trim(), 10);
      if (Number.isInteger(n)) set.add(n);
    }
    return set;
  } catch {
    return null; // ps failed — treat liveness as unknown (see caller)
  }
}

/**
 * Map of sessionId → { pid, cwd, startedAt, entrypoint, kind, open:true } for
 * every live Claude Code process. Deduped by sessionId (a resumed session can
 * transiently appear under two pids — newest startedAt wins). 10s cache.
 */
export function liveSessions() {
  const nowMs = Date.now();
  if (nowMs - cache.at < CACHE_MS) return cache.map;

  const map = new Map();
  let files = [];
  try {
    files = fs.readdirSync(SESSIONS_DIR).filter((f) => f.endsWith(".json"));
  } catch {
    cache = { at: nowMs, map };
    return map;
  }

  const alive = alivePids();
  for (const f of files) {
    let o;
    try {
      o = JSON.parse(fs.readFileSync(path.join(SESSIONS_DIR, f), "utf8"));
    } catch {
      continue;
    }
    const sid = o.sessionId;
    const pid = o.pid;
    if (!sid || !Number.isInteger(pid)) continue;
    // If ps worked, require the pid to be alive; if ps failed, keep the entry
    // (better to show a possibly-stale "open" than to blank every window).
    if (alive && !alive.has(pid)) continue;
    const prev = map.get(sid);
    if (prev && (prev.startedAt ?? 0) >= (o.startedAt ?? 0)) continue;
    map.set(sid, {
      pid,
      cwd: typeof o.cwd === "string" ? o.cwd : "",
      startedAt: o.startedAt ?? 0,
      entrypoint: typeof o.entrypoint === "string" ? o.entrypoint : "",
      kind: typeof o.kind === "string" ? o.kind : "",
      open: true,
    });
  }

  cache = { at: nowMs, map };
  return map;
}
