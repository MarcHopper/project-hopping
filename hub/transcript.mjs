// Reads a Claude Code session transcript to get "what the chat just did" — the
// last assistant message — so the hub can post it to Slack. Hub-only (Node fs);
// never imported by the Vercel app.
//
// Transcripts live at ~/.claude/projects/<cwd-slug>/<session_id>.jsonl. We locate
// by the globally-unique session_id (glob across project dirs) rather than
// reconstructing the lossy slug — much more robust. Each line also carries `cwd`.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const PROJECTS_DIR = path.join(os.homedir(), ".claude", "projects");

/** Find <session_id>.jsonl across all project dirs; newest mtime wins on collision. */
export function findTranscript(sessionId) {
  let best = null;
  let bestMtime = -1;
  let dirs = [];
  try {
    dirs = fs.readdirSync(PROJECTS_DIR);
  } catch {
    return null;
  }
  for (const d of dirs) {
    const f = path.join(PROJECTS_DIR, d, `${sessionId}.jsonl`);
    try {
      const st = fs.statSync(f);
      if (st.mtimeMs > bestMtime) {
        best = f;
        bestMtime = st.mtimeMs;
      }
    } catch {
      /* not in this dir */
    }
  }
  return best;
}

// Read the tail of a file (transcripts can be large) without loading it all.
function readTail(file, bytes = 256 * 1024) {
  const st = fs.statSync(file);
  const start = Math.max(0, st.size - bytes);
  const fd = fs.openSync(file, "r");
  try {
    const len = st.size - start;
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, start);
    return buf.toString("utf8");
  } finally {
    fs.closeSync(fd);
  }
}

function textFromAssistant(line) {
  const content = line?.message?.content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((c) => c && c.type === "text" && typeof c.text === "string")
    .map((c) => c.text)
    .join("\n")
    .trim();
}

/**
 * Last assistant message text (fallback: last `result` line). Returns
 * { text, summary, isError } with text capped to ~4KB.
 */
export function readLastResult(sessionId, cap = 4000) {
  const file = findTranscript(sessionId);
  if (!file) return { text: "", summary: "", isError: false };
  let lines;
  try {
    lines = readTail(file).split("\n").filter(Boolean);
  } catch {
    return { text: "", summary: "", isError: false };
  }
  for (let i = lines.length - 1; i >= 0; i--) {
    let o;
    try {
      o = JSON.parse(lines[i]);
    } catch {
      continue;
    }
    if (o.type === "assistant") {
      const t = textFromAssistant(o);
      if (t) return finalize(t, false, cap);
    } else if (o.type === "result" && typeof o.result === "string" && o.result.trim()) {
      return finalize(o.result.trim(), !!o.is_error, cap);
    }
  }
  return { text: "", summary: "", isError: false };
}

function finalize(text, isError, cap) {
  const clipped = text.length > cap ? text.slice(0, cap) + "\n…(truncated)" : text;
  const summary = text.replace(/\s+/g, " ").slice(0, 140);
  return { text: clipped, summary, isError };
}

/** The cwd recorded in the transcript (first line) — used to confirm/repair. */
export function readCwd(sessionId) {
  const file = findTranscript(sessionId);
  if (!file) return "";
  try {
    const head = readTail(file, 8192).split("\n").filter(Boolean);
    for (const l of head) {
      try {
        const o = JSON.parse(l);
        if (typeof o.cwd === "string") return o.cwd;
      } catch {
        /* skip */
      }
    }
  } catch {
    /* ignore */
  }
  return "";
}
