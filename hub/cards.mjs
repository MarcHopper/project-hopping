// Block Kit card builders for Slack. Buttons carry a JSON `value` the Vercel
// interactivity webhook parses; `action_id` names the action.

const GRID_URL = process.env.APP_URL || "https://project-hopping.vercel.app";

function btn(text, action_id, value, style) {
  const b = { type: "button", text: { type: "plain_text", text, emoji: true }, action_id };
  if (value !== undefined) b.value = typeof value === "string" ? value : JSON.stringify(value);
  if (style) b.style = style;
  return b;
}

// A chat that just finished and is waiting on you.
export function waitingCard({ projectName, sessionName, projectId, sessionId, snippet }) {
  const who = sessionName ? `${projectName} · ${sessionName}` : projectName;
  const blocks = [
    { type: "header", text: { type: "plain_text", text: `⚡ ${who} is waiting on you`, emoji: true } },
  ];
  if (snippet) {
    blocks.push({ type: "section", text: { type: "mrkdwn", text: trunc(snippet, 600) } });
  }
  blocks.push({
    type: "actions",
    elements: [
      btn("Hopped ✓", "hopped", { projectId, sessionId }, "primary"),
      btn("Snooze 1h", "snooze", { projectId, minutes: 60 }),
      btn("Continue…", "continue_open", { sessionId }),
      { type: "button", text: { type: "plain_text", text: "Open grid", emoji: true }, url: GRID_URL },
    ],
  });
  return blocks;
}

// The morning standup: every project's state + hop-next, each with quick actions.
export function standupCard({ projects, next }) {
  const blocks = [
    { type: "header", text: { type: "plain_text", text: "🐇 Hopping standup", emoji: true } },
  ];
  if (next) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `*hop next →* ${next.name}` },
    });
  }
  blocks.push({ type: "divider" });
  for (const p of projects.slice(0, 20)) {
    const status =
      p.status === "agent_waiting" ? "⚡ waiting" : p.status === "agent_running" ? "▶︎ running" : `tally ${p.tally}`;
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `*${p.name}* — ${status}${p.last_brief ? `\n_${trunc(p.last_brief, 120)}_` : ""}` },
      accessory: btn("Hopped ✓", "hopped", { projectId: p.id }),
    });
  }
  blocks.push({
    type: "actions",
    elements: [{ type: "button", text: { type: "plain_text", text: "Open grid", emoji: true }, url: GRID_URL }],
  });
  return blocks;
}

function trunc(s, n) {
  s = String(s);
  return s.length > n ? s.slice(0, n) + "…" : s;
}
