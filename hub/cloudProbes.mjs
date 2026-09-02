// Cloud-agent probes (hub-side). The Mac agents prove themselves via launchd + status files;
// cloud agents (Vercel crons, GitHub Actions) run with the Mac closed and keep their own
// ledgers. Rather than teaching every cloud service to write into Hopping's mirror, the hub
// reads each service's OWN source of truth on demand:
//   dezlin-monitor  → tools-dezlin KV `monitor:last` (written by /api/monitor every ~10 min)
//   dezlin-hb       → tools-dezlin KV `dzsec:hb:<job>` ISO beats (lib/heartbeat.js contract)
//   github-actions  → latest workflow run conclusion via the GitHub API (~/.github.env)
// Every probe returns { ok, last_run, summary } for computeAgentHealth, or null → "unknown".
// Freshness is NOT judged here — agentHealth's interval/grace rules do that from last_run.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const HOME = os.homedir();

function envFile(file) {
  const out = {};
  try {
    for (const line of fs.readFileSync(file, "utf8").split("\n")) {
      const m = line.match(/^([A-Z_]+)=(.*)$/);
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {
    /* missing env file → probes depending on it return null */
  }
  return out;
}

async function fetchJson(url, opts = {}, timeoutMs = 8000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { ...opts, signal: ctl.signal });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

function dezlinKvCreds() {
  const env = envFile(path.join(HOME, "tools-dezlin", ".env.local"));
  if (!env.KV_REST_API_URL || !env.KV_REST_API_TOKEN) return null;
  return { url: env.KV_REST_API_URL, token: env.KV_REST_API_TOKEN };
}

async function dezlinKvGet(key) {
  const creds = dezlinKvCreds();
  if (!creds) return null;
  const body = await fetchJson(creds.url, {
    method: "POST",
    headers: { Authorization: `Bearer ${creds.token}`, "content-type": "application/json" },
    body: JSON.stringify(["GET", key]),
  });
  const v = body?.result;
  if (v == null) return null;
  if (typeof v === "string") {
    try {
      return JSON.parse(v);
    } catch {
      return v; // plain string (e.g. an ISO heartbeat)
    }
  }
  return v;
}

async function probeDezlinMonitor() {
  const d = await dezlinKvGet("monitor:last");
  if (!d || !d.at) return null;
  const audit = d.checks?.emailAudit;
  const bits = [d.ok ? "all checks green" : `${(d.failing || []).length} failing`];
  if (d.fixed?.length) bits.push(`auto-fixed ${d.fixed.length}`);
  if (audit && typeof audit.checked === "number") {
    bits.push(`email audit ${audit.verified}/${audit.checked} verified${audit.retried?.length ? `, re-sent ${audit.retried.length}` : ""}`);
  }
  return { ok: !!d.ok, last_run: Date.parse(d.at) || null, summary: bits.join(" · ") };
}

async function probeDezlinHeartbeat(job) {
  const v = await dezlinKvGet(`dzsec:hb:${job}`);
  const at = typeof v === "string" ? Date.parse(v) : null;
  if (!at) return null;
  // A beat only records success; ok:true + last_run lets the staleness rules flag silence.
  return { ok: true, last_run: at, summary: `last successful run ${new Date(at).toLocaleString()}` };
}

async function probeGithubActions(repo, workflow) {
  const env = envFile(path.join(HOME, ".github.env"));
  const token = env.GITHUB_TOKEN || env.GH_TOKEN;
  if (!token) return null;
  const wfPath = workflow ? `/workflows/${workflow}` : "";
  const d = await fetchJson(
    `https://api.github.com/repos/${repo}/actions${wfPath}/runs?per_page=1`,
    { headers: { Authorization: `Bearer ${token}`, "User-Agent": "hopping-hub" } },
  );
  const run = d?.workflow_runs?.[0];
  if (!run) return null;
  const done = run.status === "completed";
  return {
    // An in-flight run is judged by the PREVIOUS conclusion being irrelevant — treat as ok;
    // a completed non-success is a real red.
    ok: !done || run.conclusion === "success",
    last_run: Date.parse(run.updated_at) || null,
    summary: `${run.name}: ${done ? run.conclusion : run.status} (${run.head_branch})`,
  };
}

/** Registry entries opt in via `probe: { type, ... }`. Unknown types → null → "unknown". */
export async function runCloudProbe(spec) {
  if (!spec || typeof spec !== "object") return null;
  switch (spec.type) {
    case "dezlin-monitor":
      return probeDezlinMonitor();
    case "dezlin-hb":
      return spec.job ? probeDezlinHeartbeat(spec.job) : null;
    case "github-actions":
      return spec.repo ? probeGithubActions(spec.repo, spec.workflow) : null;
    default:
      return null;
  }
}
