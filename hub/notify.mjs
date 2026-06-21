// Notifications transport: macOS desktop (osascript) + Slack (Block Kit).
// kind ∈ 'interrupt' | 'nudge' | 'neglect'. The dedicated "Hopping" bot token
// (HOPPING_SLACK_BOT_TOKEN) is preferred; falls back to the older token.

import { execFile } from "node:child_process";
import { cfg } from "./config.mjs";

function botToken() {
  const c = cfg();
  return c.HOPPING_SLACK_BOT_TOKEN || c.HOPPING_SLACK_TOKEN || c.SLACK_BOT_TOKEN;
}
function channel() {
  return cfg().HOPPING_SLACK_CHANNEL;
}

export function desktop(message, title = "Hopping") {
  const t = String(title).replace(/["\\]/g, " ");
  const m = String(message).replace(/["\\]/g, " ");
  execFile(
    "osascript",
    ["-e", `display notification "${m}" with title "${t}" sound name "Glass"`],
    () => {},
  );
}

async function slackApi(method, body) {
  const token = botToken();
  if (!token) return null;
  try {
    const r = await fetch(`https://slack.com/api/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    const j = await r.json().catch(() => ({}));
    if (!j.ok) console.log(new Date().toISOString(), `slack ${method} error:`, j.error);
    return j;
  } catch (e) {
    console.log(new Date().toISOString(), `slack ${method} failed:`, e?.message);
    return null;
  }
}

// Post a message (optionally a thread reply). Returns the message ts or null.
export async function slackPost({ text, blocks, thread_ts }) {
  const ch = channel();
  if (!ch) return null;
  const j = await slackApi("chat.postMessage", {
    channel: ch,
    text: text || "Hopping",
    blocks,
    thread_ts,
    unfurl_links: false,
  });
  return j?.ok ? j.ts : null;
}

export function slackReply(thread_ts, { text, blocks }) {
  return slackPost({ text, blocks, thread_ts });
}

export async function slackUpdate(ts, { text, blocks }) {
  const ch = channel();
  if (!ch) return null;
  return slackApi("chat.update", { channel: ch, ts, text: text || "Hopping", blocks });
}

// Simple text notification (used by nudge/neglect, and as a desktop fallback).
// opts.slack forces Slack on/off; default = everything except 'nudge'.
export function notify(kind, text, opts = {}) {
  desktop(text);
  const allowSlack = opts.slack !== undefined ? opts.slack : kind !== "nudge";
  if (allowSlack) slackPost({ text });
}
