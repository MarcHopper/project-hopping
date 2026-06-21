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
  getProjectsWithTally,
  getSettings,
  getSession,
  listSessions,
  setFocusedProjectByPath,
  setSessionResult,
  setSessionThreadTs,
  inQuietHours,
  isProjectSilenced,
} from "../lib/db.ts";
import { rankProjects } from "../lib/rankProjects.ts";
import { startGitWatch } from "./gitwatch.mjs";
import { notify, desktop, slackPost, slackReply } from "./notify.mjs";
import { waitingCard } from "./cards.mjs";
import { readLastResult } from "./transcript.mjs";
import { userIsActive } from "./presence.mjs";
import { startMirror, ingestQueuedActions } from "./mirror.mjs";

const HOST = "127.0.0.1";
const PORT = Number(process.env.HOPPING_HUB_PORT ?? 4319);

function log(...a) {
  console.log(new Date().toISOString(), ...a);
}

// The one place events become state: apply → notify (interrupt) → mirror to cloud.
// Both the HTTP handler and the git watcher call this.
function ingest(input) {
  const result = applyEvent(input);

  // Enrich a chat that just went waiting with its last result (for the grid + Slack).
  let snippet = "";
  if (result.sessionBecameWaiting && result.sessionId) {
    try {
      const r = readLastResult(result.sessionId);
      if (r.text) {
        setSessionResult(result.sessionId, r.text);
        snippet = r.summary;
      }
    } catch {
      /* transcript unreadable — fine */
    }
  }

  // Fire on a project OR a single-chat transition into waiting (per-chat alert).
  if ((result.becameWaiting || result.sessionBecameWaiting) && getSettings().notify_interrupt) {
    fireInterrupt(result, snippet).catch(() => {}); // async, never blocks ingest
  }

  mirrorNow();
  return result;
}

// Desktop always; Slack only when it earns it (the "balance"): class enabled,
// not the unmapped catch-all, not muted/snoozed, not quiet hours, and — unless
// disabled — not while you're actively at the Mac. Each chat lives in a thread.
async function fireInterrupt(result, snippet) {
  const s = getSettings();
  const who =
    result.sessionName && result.sessionName !== result.name
      ? `${result.name} · ${result.sessionName}`
      : result.name;
  desktop(`⚡ ${who} is waiting on you`);

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
    snippet,
  });
  const sess = result.sessionId ? getSession(result.sessionId) : null;
  if (sess && sess.slack_thread_ts) {
    await slackReply(sess.slack_thread_ts, { text: `⚡ ${who} is waiting again`, blocks });
  } else {
    const ts = await slackPost({ text: `⚡ ${who} is waiting on you`, blocks });
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
      const projects = getProjectsWithTally();
      return send(res, 200, {
        projects,
        ...rankProjects(projects),
        sessions: listSessions(),
        settings: getSettings(),
      });
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

server.listen(PORT, HOST, () => {
  log(`hopping-hub listening on http://${HOST}:${PORT}`);
  startGitWatch(ingest); // watch repos for commits
  startMirror(); // start cloud mirror (no-op if not configured)
  // Drain phone actions from the cloud queue back into the local source of truth.
  setInterval(() => ingestQueuedActions(ingest).catch(() => {}), 2000);
  // Background notification timers (nudge + daily neglect digest).
  import("./schedules.mjs")
    .then((m) => m.startSchedules(notify))
    .catch((e) => log("schedules failed", e?.message));
});
