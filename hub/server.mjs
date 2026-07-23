// The Hopping hub: a tiny always-on local server that turns agent events into
// grid state. Runs under tsx so it imports the SAME lib/db.ts the web app uses
// (single ingest point). Loopback-only — never exposed.
//
//   npm run hub            (dev)
//   launchd plist          (login-launch; see deploy/com.hopping.hub.plist)

import http from "node:http";
import { loadEnv } from "./config.mjs";
loadEnv(); // ensure ~/.hopping.env (Slack + Upstash) is in process.env before anything reads it
import {
  applyEvent,
  getSettings,
  getSession,
  listSessions,
  listSessionNotes,
  setFocusedProjectByPath,
  setSessionResult,
  setSessionSummary,
  setSessionTodos,
  setSessionName,
  setSessionThreadTs,
  addSessionNote,
  setSessionNoteDone,
  deleteSessionNote,
  endSession,
  inQuietHours,
  isProjectSilenced,
} from "../lib/db.ts";
import { startGitWatch } from "./gitwatch.mjs";
import { notify, desktop, slackPost, slackReply } from "./notify.mjs";
import { waitingCard } from "./cards.mjs";
import { readLastResult, readSessionName, readLatestTodos, readRecentMessages } from "./transcript.mjs";
import { userIsActive } from "./presence.mjs";
import { startMirror, startTailsMirror, ingestQueuedActions } from "./mirror.mjs";
import { buildSnapshot, viewSession } from "./stateView.mjs";
import { runContinue } from "./runner.mjs";

const HOST = "127.0.0.1";
const PORT = Number(process.env.HOPPING_HUB_PORT ?? 4319);

function log(...a) {
  console.log(new Date().toISOString(), ...a);
}

// The one place events become state: apply → notify (interrupt) → mirror to cloud.
// Both the HTTP handler and the git watcher call this.
function ingest(input) {
  // A TodoWrite fired inside a subagent carries the PARENT session_id; dropping
  // these keeps subagent checklists out of the chat's own task list. (The
  // transcript backfill re-derives from the main thread, excluding sidechains.)
  if (
    input.type === "todo_update" &&
    typeof input.payload?.transcript_path === "string" &&
    input.payload.transcript_path.includes("/subagents/")
  ) {
    return applyEvent({ ...input, type: "skip" }); // ignore, but stay a no-op
  }

  const result = applyEvent(input);

  // Enrich the chat from its transcript: its real name (Claude's ai-title) on
  // every event, and its last result when it goes waiting. Skip the name read on
  // todo_update — todos already flowed through applyEvent and the 60s loop keeps
  // names fresh, so there's no need to tail the transcript on every checklist tick.
  let snippet = "";
  let ask = "";
  if (result.sessionId && input.type !== "todo_update") {
    try {
      const nm = readSessionName(result.sessionId);
      if (nm) {
        setSessionName(result.sessionId, nm);
        result.sessionName = nm; // so the notification uses the real name too
      }
    } catch {
      /* transcript unreadable — fine */
    }
    if (result.sessionBecameWaiting) {
      try {
        const r = readLastResult(result.sessionId);
        if (r.text) {
          setSessionResult(result.sessionId, r.text);
          setSessionSummary(result.sessionId, r.summary, r.ask); // persist for the dashboard
          snippet = r.summary;
          ask = r.ask; // "what needs to happen"
        }
      } catch {
        /* fine */
      }
    }
  }

  // Fire on a project OR a single-chat transition into waiting (per-chat alert).
  if ((result.becameWaiting || result.sessionBecameWaiting) && getSettings().notify_interrupt) {
    fireInterrupt(result, snippet, ask).catch(() => {}); // async, never blocks ingest
  }

  mirrorNow();
  return result;
}

// Desktop always; Slack only when it earns it (the "balance"): class enabled,
// not the unmapped catch-all, not muted/snoozed, not quiet hours, and — unless
// disabled — not while you're actively at the Mac. Each chat lives in a thread.
async function fireInterrupt(result, snippet, ask) {
  // The 'unmapped' catch-all is noise (e.g. sessions launched from ~) — never
  // notify at all, desktop or Slack.
  if (result.projectId === "unmapped") return;

  const s = getSettings();
  // Chat name first (bold title), project as subtitle, the ask as the body.
  const chatName = result.sessionName || result.name;
  const subtitle = result.sessionName ? result.name : "";
  const body = ask || "is waiting on you";
  desktop(body, { title: chatName, subtitle });

  const allowSlack =
    s.slack_interrupt &&
    result.projectId !== "unmapped" &&
    !isProjectSilenced(result.projectId) &&
    !inQuietHours(s) &&
    !(s.active_suppress && userIsActive());
  if (!allowSlack) return;

  const blocks = waitingCard({
    projectName: result.name,
    sessionName: result.sessionName,
    projectId: result.projectId,
    sessionId: result.sessionId,
    snippet: ask || snippet,
  });
  const sess = result.sessionId ? getSession(result.sessionId) : null;
  if (sess && sess.slack_thread_ts) {
    await slackReply(sess.slack_thread_ts, { text: `⚡ ${chatName} is waiting again`, blocks });
  } else {
    const ts = await slackPost({ text: `⚡ ${chatName} is waiting on you`, blocks });
    if (ts && result.sessionId) setSessionThreadTs(result.sessionId, ts);
  }
}

// Push the current grid snapshot to the cloud (no-op if cloud not configured).
function mirrorNow() {
  try {
    startMirror.push?.();
  } catch {
    /* mirror is best-effort */
  }
}

function send(res, code, obj) {
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(obj));
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => {
      data += c;
      if (data.length > 1_000_000) req.destroy();
    });
    req.on("end", () => resolve(data));
    req.on("error", () => resolve(""));
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${HOST}:${PORT}`);

    if (req.method === "GET" && url.pathname === "/health") {
      return send(res, 200, { ok: true, service: "hopping-hub", port: PORT });
    }

    if (req.method === "GET" && url.pathname === "/state") {
      return send(res, 200, buildSnapshot());
    }

    // GET /session/<id> — one decorated session (fresh todo read if empty).
    const mSession = url.pathname.match(/^\/session\/([^/]+)$/);
    if (req.method === "GET" && mSession) {
      const id = decodeURIComponent(mSession[1]);
      const view = viewSession(id);
      if (!view) return send(res, 404, { ok: false, error: "no such session" });
      return send(res, 200, { ok: true, session: view });
    }

    // POST /session/<id>/notes {op:"add"|"toggle"|"delete", text?, noteId?, done?}
    const mNotes = url.pathname.match(/^\/session\/([^/]+)\/notes$/);
    if (req.method === "POST" && mNotes) {
      const id = decodeURIComponent(mNotes[1]);
      const body = JSON.parse((await readBody(req)) || "{}");
      if (body.op === "add" && body.text) addSessionNote(id, String(body.text));
      else if (body.op === "toggle" && typeof body.noteId === "number")
        setSessionNoteDone(body.noteId, !!body.done);
      else if (body.op === "delete" && typeof body.noteId === "number")
        deleteSessionNote(body.noteId);
      else return send(res, 400, { ok: false, error: "bad note op" });
      mirrorNow();
      return send(res, 200, { ok: true, notes: listSessionNotes(id) });
    }

    // GET /session/<id>/messages?limit=30 — recent human/assistant messages
    // (chain-resolved through any remote-continue fork).
    const mMsgs = url.pathname.match(/^\/session\/([^/]+)\/messages$/);
    if (req.method === "GET" && mMsgs) {
      const id = decodeURIComponent(mMsgs[1]);
      const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit")) || 30));
      const r = readRecentMessages(id, { limit });
      return send(res, 200, {
        ok: true,
        sessionId: id,
        transcript_session_id: r.transcriptSessionId,
        messages: r.messages,
        truncated: r.truncated,
      });
    }

    // POST /session/<id>/continue {prompt} — resume this chat headlessly with a
    // new instruction (reuses the runner: per-session lock, budget, fork-linking).
    const mCont = url.pathname.match(/^\/session\/([^/]+)\/continue$/);
    if (req.method === "POST" && mCont) {
      const id = decodeURIComponent(mCont[1]);
      const body = JSON.parse((await readBody(req)) || "{}");
      const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
      if (!prompt) return send(res, 400, { ok: false, error: "prompt required" });
      if (!getSession(id)) return send(res, 404, { ok: false, error: "no such session" });
      runContinue({ sessionId: id, prompt }).catch(() => {}); // async; result lands on next poll
      mirrorNow();
      return send(res, 200, { ok: true, started: true });
    }

    if (req.method === "POST" && url.pathname === "/event") {
      const body = JSON.parse((await readBody(req)) || "{}");
      if (!body.type) return send(res, 400, { ok: false, error: "type required" });
      const result = ingest({
        path: body.path,
        projectId: body.projectId,
        type: body.type,
        payload: body.payload ?? {},
      });
      log("event", body.type, "->", result.name, `(${result.status})`);
      return send(res, 200, { ok: true, ...result });
    }

    // VS Code "you're here" — set/clear the focused project (path "" clears).
    if (req.method === "POST" && url.pathname === "/focus") {
      const body = JSON.parse((await readBody(req)) || "{}");
      const id = setFocusedProjectByPath(body.path ?? "");
      mirrorNow();
      return send(res, 200, { ok: true, focused: id });
    }

    return send(res, 404, { ok: false, error: "not found" });
  } catch (err) {
    log("ERROR", err?.message ?? String(err));
    try {
      return send(res, 500, { ok: false, error: "internal" });
    } catch {
      /* response already sent */
    }
  }
});

server.on("error", (err) => {
  if (err?.code === "EADDRINUSE") {
    log(`port ${PORT} already in use — is the hub already running?`);
    process.exit(1);
  }
  log("server error", err?.message);
});

// Backfill chat names from transcripts + age out stale chats (a chat idle for
// STALE_HOURS is treated as ended so the "open chats" list stays real).
const STALE_MS = Number(process.env.HOPPING_STALE_HOURS ?? 6) * 3600 * 1000;
const DAY_MS = 24 * 3600 * 1000;
const TODO_BACKFILL_PER_TICK = 10;
function refreshSessions() {
  try {
    const now = Date.now();
    let todoReads = 0;
    for (const s of listSessions()) {
      if (s.last_activity && now - s.last_activity > STALE_MS) {
        endSession(s.session_id);
        continue;
      }
      if (!s.name) {
        const nm = readSessionName(s.session_id);
        if (nm) setSessionName(s.session_id, nm);
      }
      // Backfill todos for chats that predate the PostToolUse hook (the push
      // path). Budgeted so a busy day never floods transcript reads: only recent
      // chats with no stored list, capped per tick.
      if (
        todoReads < TODO_BACKFILL_PER_TICK &&
        (!s.todos_json || s.todos_json === "[]") &&
        s.last_activity &&
        now - s.last_activity < DAY_MS
      ) {
        todoReads++;
        const r = readLatestTodos(s.session_id);
        if (r) setSessionTodos(s.session_id, JSON.stringify(r.todos), r.at);
      }
    }
    mirrorNow();
  } catch {
    /* best-effort */
  }
}

server.listen(PORT, HOST, () => {
  log(`hopping-hub listening on http://${HOST}:${PORT}`);
  refreshSessions(); // backfill names + prune stale on boot
  setInterval(refreshSessions, 60_000);
  startGitWatch(ingest); // watch repos for commits
  startMirror(); // start cloud mirror (no-op if not configured)
  startTailsMirror(); // message tails for the phone (30s, hash-skipped)
  // Drain phone actions from the cloud queue back into the local source of truth.
  setInterval(() => ingestQueuedActions(ingest).catch(() => {}), 2000);
  // Background notification timers (nudge + daily neglect digest).
  import("./schedules.mjs")
    .then((m) => m.startSchedules(notify))
    .catch((e) => log("schedules failed", e?.message));
});
