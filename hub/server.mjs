// The Hopping hub: a tiny always-on local server that turns agent events into
// grid state. Runs under tsx so it imports the SAME lib/db.ts the web app uses
// (single ingest point). Loopback-only — never exposed.
//
//   npm run hub            (dev)
//   launchd plist          (login-launch; see deploy/com.hopping.hub.plist)

import http from "node:http";
import { execFile } from "node:child_process";
import { applyEvent, getProjectsWithTally } from "../lib/db.ts";
import { rankProjects } from "../lib/rankProjects.ts";

const HOST = "127.0.0.1";
const PORT = Number(process.env.HOPPING_HUB_PORT ?? 4319);

function log(...a) {
  console.log(new Date().toISOString(), ...a);
}

// Fire a macOS desktop notification. Best-effort; errors are swallowed so a
// notification failure can never affect ingest.
function notify(title, message) {
  const text = String(message).replace(/["\\]/g, " ");
  const ttl = String(title).replace(/["\\]/g, " ");
  execFile(
    "osascript",
    ["-e", `display notification "${text}" with title "${ttl}" sound name "Glass"`],
    () => {},
  );
}

function send(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => {
      data += c;
      if (data.length > 1_000_000) req.destroy(); // basic guard
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

    // Convenience read endpoint (the grid uses the Next route; this aids debugging).
    if (req.method === "GET" && url.pathname === "/state") {
      const projects = getProjectsWithTally();
      return send(res, 200, { projects, ...rankProjects(projects) });
    }

    if (req.method === "POST" && url.pathname === "/event") {
      const raw = await readBody(req);
      let body;
      try {
        body = JSON.parse(raw || "{}");
      } catch {
        return send(res, 400, { ok: false, error: "bad json" });
      }
      const { path, projectId, type, payload } = body;
      if (!type) return send(res, 400, { ok: false, error: "type required" });

      const result = applyEvent({ path, projectId, type, payload: payload ?? {} });
      log("event", type, "->", result.name, `(${result.status})`);

      if (result.becameWaiting) {
        notify("Hopping", `${result.name} is waiting on you`);
      }
      return send(res, 200, { ok: true, ...result });
    }

    return send(res, 404, { ok: false, error: "not found" });
  } catch (err) {
    log("ERROR", err && err.message ? err.message : String(err));
    try {
      return send(res, 500, { ok: false, error: "internal" });
    } catch {
      /* response already sent */
    }
  }
});

server.on("error", (err) => {
  if (err && err.code === "EADDRINUSE") {
    log(`port ${PORT} already in use — is the hub already running?`);
    process.exit(1);
  }
  log("server error", err && err.message);
});

server.listen(PORT, HOST, () => {
  log(`hopping-hub listening on http://${HOST}:${PORT}`);
});
