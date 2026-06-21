// Phase 8 — the remote-drive loop. A Slack reply in a chat's thread continues
// THAT Claude Code session headlessly (`claude -p --resume <id>`) in its repo and
// posts the result back into the thread.
//
// SAFETY: callers (the Vercel webhook) already verified the Slack signature and
// that the user is Marc. Here we add: one run at a time per session, a small
// global cap, and a hard dollar budget. bypassPermissions is acceptable because
// the run happens in Marc's own repo with a capped budget.

import { spawn } from "node:child_process";
import { getSession, getSessionByThreadTs, setSessionResult } from "../lib/db.ts";
import { slackReply } from "./notify.mjs";

const running = new Set(); // session_ids currently resuming
let active = 0;
const MAX_CONCURRENT = 2;

function trunc(s, n) {
  s = String(s ?? "");
  return s.length > n ? s.slice(0, n) + "\n…(truncated)" : s;
}

export async function runContinue(a) {
  let sess = null;
  if (a.thread_ts) sess = getSessionByThreadTs(a.thread_ts);
  if (!sess && a.sessionId) sess = getSession(a.sessionId);
  const thread = a.thread_ts || sess?.slack_thread_ts || "";

  if (!sess) {
    if (thread) await slackReply(thread, { text: "⚠️ Couldn't find that chat to continue." });
    return;
  }
  const prompt = (a.prompt || "").trim();
  if (!prompt) return;

  if (running.has(sess.session_id)) {
    if (thread) await slackReply(thread, { text: "⏳ Already working on this chat — try again when it's done." });
    return;
  }
  if (active >= MAX_CONCURRENT) {
    if (thread) await slackReply(thread, { text: "⏳ Busy with other chats — try again shortly." });
    return;
  }

  running.add(sess.session_id);
  active++;
  if (thread) await slackReply(thread, { text: "🤖 working…" });

  const budget = String(process.env.HOPPING_CONTINUE_BUDGET_USD ?? "1.0");
  const bin = process.env.HOPPING_CLAUDE_BIN || "claude";
  const cwd = sess.cwd || process.cwd();
  const args = [
    "-p",
    "--resume",
    sess.session_id,
    "--permission-mode",
    "bypassPermissions",
    "--output-format",
    "json",
    "--max-budget-usd",
    budget,
    prompt,
  ];

  let out = "";
  let err = "";
  let child;
  try {
    child = spawn(bin, args, { cwd, env: process.env });
  } catch (e) {
    running.delete(sess.session_id);
    active--;
    if (thread) await slackReply(thread, { text: `⚠️ couldn't start claude: ${e?.message}` });
    return;
  }

  child.stdout.on("data", (d) => (out += d));
  child.stderr.on("data", (d) => (err += d));
  child.on("error", async (e) => {
    running.delete(sess.session_id);
    active--;
    if (thread) await slackReply(thread, { text: `⚠️ run failed: ${e?.message}` });
  });
  child.on("close", async (code) => {
    running.delete(sess.session_id);
    active--;
    let text = "";
    try {
      const j = JSON.parse(out);
      text = typeof j.result === "string" ? j.result : out;
    } catch {
      text = out || err || `(exit ${code})`;
    }
    try {
      setSessionResult(sess.session_id, text, "waiting");
    } catch {
      /* ignore */
    }
    if (thread) await slackReply(thread, { text: trunc(text, 2800) || `(done, exit ${code})` });
  });
}
