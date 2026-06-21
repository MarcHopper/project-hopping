// Notifications: macOS desktop (when at the Mac) + Slack DM (reaches the phone).
// kind ∈ 'interrupt' | 'nudge' | 'neglect'. Nudges stay desktop-only; interrupt
// and neglect also go to Slack so they buzz the phone.

import { execFile } from "node:child_process";
import { cfg } from "./config.mjs";

function desktop(message, title = "Hopping") {
  const t = String(title).replace(/["\\]/g, " ");
  const m = String(message).replace(/["\\]/g, " ");
  execFile(
    "osascript",
    ["-e", `display notification "${m}" with title "${t}" sound name "Glass"`],
    () => {},
  );
}

async function slack(text) {
  const c = cfg();
  const token = c.HOPPING_SLACK_TOKEN || c.SLACK_BOT_TOKEN;
  const channel = c.HOPPING_SLACK_CHANNEL;
  if (!token || !channel) return;
  try {
    const r = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ channel, text, unfurl_links: false }),
    });
    const j = await r.json().catch(() => ({}));
    if (!j.ok) console.log(new Date().toISOString(), "slack error:", j.error);
  } catch (e) {
    console.log(new Date().toISOString(), "slack post failed:", e?.message);
  }
}

export function notify(kind, text) {
  desktop(text);
  if (kind !== "nudge") slack(text);
}
