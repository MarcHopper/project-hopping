// Agent monitor collectors + actions (hub-only). Joins four live sources —
// the Hop Agent Portal registry/status files, `launchctl list` exit codes, plist
// schedules, and cloud probes — into the pure computeAgentHealth. The status
// files are NEVER trusted alone: a nonzero launchd exit outranks a green status.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile, execFileSync } from "node:child_process";
import { computeAgentHealth, HEALTH_RANK } from "../lib/agentHealth.ts";
import {
  listAgentAcks,
  listAgentOverrides,
  setAgentPaused,
  setAgentAck,
  clearAgentAck,
  applyAgentObservation,
  listAgentRuns,
} from "../lib/db.ts";
import { cloudGetKey } from "../lib/cloud.ts";

const HOME = os.homedir();
const AGENTS_DIR = path.join(HOME, "hop-tools", "agents");
const REGISTRY = path.join(AGENTS_DIR, "registry.json");
const STATUS_DIR = path.join(AGENTS_DIR, "status");
const LAUNCH_AGENTS = path.join(HOME, "Library", "LaunchAgents");
const UID = process.getuid?.() ?? 501;
const LABEL_PREFIXES = ["com.hop.", "com.dezlin.", "com.vme.", "com.hopping."];

// ---- collectors ----------------------------------------------------------

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

/** `launchctl list` → { label: { pid, exit } }. One call. */
function launchctlList() {
  const map = new Map();
  try {
    const out = execFileSync("/bin/launchctl", ["list"], { encoding: "utf8" });
    for (const line of out.split("\n")) {
      const m = line.match(/^(-|\d+)\t(-?\d+)\t(\S+)$/);
      if (!m) continue;
      map.set(m[3], { pid: m[1] === "-" ? null : Number(m[1]), exit: Number(m[2]) });
    }
  } catch {
    /* launchctl unavailable */
  }
  return map;
}

const plistCache = new Map(); // file -> { mtime, parsed }
function readPlist(label) {
  const file = path.join(LAUNCH_AGENTS, `${label}.plist`);
  let st;
  try {
    st = fs.statSync(file);
  } catch {
    return null;
  }
  const cached = plistCache.get(file);
  if (cached && cached.mtime === st.mtimeMs) return cached.parsed;
  let parsed = null;
  try {
    const json = execFileSync("/usr/bin/plutil", ["-convert", "json", "-o", "-", file], { encoding: "utf8" });
    const o = JSON.parse(json);
    const sci = o.StartCalendarInterval;
    const calendar = sci ? (Array.isArray(sci) ? sci : [sci]) : null;
    parsed = {
      calendar,
      interval: typeof o.StartInterval === "number" ? o.StartInterval : null,
      stdout: o.StandardOutPath || "",
      stderr: o.StandardErrorPath || "",
    };
  } catch {
    parsed = null;
  }
  plistCache.set(file, { mtime: st.mtimeMs, parsed });
  return parsed;
}

/** Pull the launchd label out of a registry entry (explicit field or schedule text). */
function labelOf(entry) {
  if (entry.launchd_label) return entry.launchd_label;
  const m = (entry.schedule || "").match(/com\.[a-z0-9]+(?:\.[a-z0-9-]+)+/i);
  return m ? m[0] : null;
}

function statusFor(id) {
  return readJson(path.join(STATUS_DIR, `${id}.json`), null);
}

// Cloud probes (best-effort; missing token/data → the agent reads "unknown").
async function heartbeatProbe(id) {
  try {
    const v = await cloudGetKey(`heartbeat:${id}`);
    if (v && typeof v.at === "number") return { ok: true, last_run: v.at, summary: v.summary || "" };
  } catch {
    /* ignore */
  }
  return null;
}

// ---- assemble the health snapshot ----------------------------------------

let cache = { at: 0, agents: [] };
const CACHE_MS = 60_000;
const lastFingerprint = new Map(); // id -> fingerprint (for run-history observation)

export async function collectAgents(force = false) {
  const nowMs = Date.now();
  if (!force && nowMs - cache.at < CACHE_MS) return cache.agents;

  const registry = readJson(REGISTRY, { agents: [] }).agents || [];
  const launch = launchctlList();
  const inputs = [];
  const seenLabels = new Set();

  for (const entry of registry) {
    const label = labelOf(entry);
    if (label) seenLabels.add(label);
    const lc = label ? launch.get(label) : null;
    const plist = label ? readPlist(label) : null;
    const status = statusFor(entry.id);
    const isCloud = !label && /gh|github|vercel|cron|sentinel|uptime|heartbeat/i.test(entry.id + (entry.schedule || ""));
    const kind = label ? "launchd" : entry.kind || (isCloud ? "heartbeat" : "launchd");
    inputs.push({
      id: entry.id,
      display_name: entry.display_name || entry.id,
      kind,
      registered: true,
      label: label || undefined,
      schedule_text: entry.schedule || "",
      calendar: plist?.calendar || undefined,
      interval: plist?.interval || undefined,
      status,
      running: lc ? lc.pid != null : false,
      last_exit: lc ? lc.exit : null,
      loaded: !!lc,
      probe: kind === "heartbeat" ? await heartbeatProbe(entry.id) : null,
      grace_min: entry.grace_min,
      log_path: entry.log_path || status?.log_path || plist?.stderr || "",
    });
  }

  // Auto-surface loaded launchd labels that aren't in the registry (the 8 unportaled).
  for (const [label, lc] of launch) {
    if (seenLabels.has(label)) continue;
    if (!LABEL_PREFIXES.some((p) => label.startsWith(p))) continue;
    const plist = readPlist(label);
    inputs.push({
      id: label,
      display_name: label,
      kind: "launchd",
      registered: false,
      label,
      schedule_text: "(unregistered)",
      calendar: plist?.calendar || undefined,
      interval: plist?.interval || undefined,
      status: null,
      running: lc.pid != null,
      last_exit: lc.exit,
      loaded: true,
      log_path: plist?.stderr || plist?.stdout || "",
    });
  }

  const agents = computeAgentHealth(inputs, {
    overrides: listAgentOverrides(),
    acks: listAgentAcks(),
    now: nowMs,
  });

  // Run-history observer: record a row whenever an agent's fingerprint changes.
  for (const a of agents) {
    if (lastFingerprint.get(a.id) !== a.fingerprint) {
      lastFingerprint.set(a.id, a.fingerprint);
      try {
        applyAgentObservation(a.id, { status: a.health, exit_code: a.last_exit, summary: a.summary });
      } catch {
        /* best-effort */
      }
    }
  }

  agents.sort((x, y) => HEALTH_RANK[x.health] - HEALTH_RANK[y.health] || x.display_name.localeCompare(y.display_name));
  cache = { at: nowMs, agents };
  return agents;
}

/** Synchronous read of the last collected snapshot (for stateView). */
export function agentsSnapshot() {
  return cache.agents;
}

// ---- actions -------------------------------------------------------------

function resolveLabel(agentId) {
  // Only allow labels we actually know about (registry or a live launchd label).
  const a = cache.agents.find((x) => x.id === agentId);
  if (a?.label) return a.label;
  if (LABEL_PREFIXES.some((p) => agentId.startsWith(p))) return agentId; // auto-surfaced
  return null;
}

function runLaunchctl(args) {
  return new Promise((resolve) => {
    execFile("/bin/launchctl", args, (err) => resolve(!err));
  });
}

export async function agentAction(agentId, op) {
  const a = cache.agents.find((x) => x.id === agentId);
  switch (op) {
    case "ack":
      if (a) setAgentAck(agentId, a.fingerprint);
      return { ok: true };
    case "unack":
      clearAgentAck(agentId);
      return { ok: true };
    case "run": {
      const label = resolveLabel(agentId);
      if (!label) return { ok: false, error: "no launchd label" };
      const ok = await runLaunchctl(["kickstart", "-k", `gui/${UID}/${label}`]);
      return { ok };
    }
    case "pause": {
      const label = resolveLabel(agentId);
      if (!label) return { ok: false, error: "no launchd label" };
      await runLaunchctl(["bootout", `gui/${UID}/${label}`]);
      setAgentPaused(agentId, true); // vanished label now reads "paused", not "error"
      return { ok: true };
    }
    case "resume": {
      const label = resolveLabel(agentId);
      if (!label) return { ok: false, error: "no launchd label" };
      await runLaunchctl(["bootstrap", `gui/${UID}`, path.join(LAUNCH_AGENTS, `${label}.plist`)]);
      setAgentPaused(agentId, false);
      return { ok: true };
    }
    default:
      return { ok: false, error: "unknown op" };
  }
}

// ---- log tail (allowlisted paths only) -----------------------------------

function allowedLogPaths() {
  const set = new Set();
  for (const a of cache.agents) if (a.log_path) set.add(a.log_path);
  return set;
}

export function agentLogTail(agentId, lines = 200) {
  const a = cache.agents.find((x) => x.id === agentId);
  const p = a?.log_path;
  if (!p || !allowedLogPaths().has(p)) return { ok: false, error: "no log", lines: [] };
  try {
    const st = fs.statSync(p);
    const bytes = 64 * 1024;
    const start = Math.max(0, st.size - bytes);
    const fd = fs.openSync(p, "r");
    try {
      const buf = Buffer.alloc(st.size - start);
      fs.readSync(fd, buf, 0, buf.length, start);
      const all = buf.toString("utf8").split("\n");
      return { ok: true, path: p, lines: all.slice(-lines), truncated: start > 0 };
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return { ok: false, error: "unreadable", lines: [] };
  }
}

export function agentRuns(agentId, limit = 20) {
  return listAgentRuns(agentId, limit);
}
