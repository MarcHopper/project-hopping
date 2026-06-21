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
  setFocusedProjectByPath,
} from "../lib/db.ts";
import { rankProjects } from "../lib/rankProjects.ts";
import { startGitWatch } from "./gitwatch.mjs";
import { notify } from "./notify.mjs";
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
  if (result.becameWaiting && getSettings().notify_interrupt) {
    notify("interrupt", `⚡ ${result.name} is waiting on you`, result.name);
  }
  mirrorNow();
  return result;
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
      return send(res, 200, { projects, ...rankProjects(projects), settings: getSettings() });
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
