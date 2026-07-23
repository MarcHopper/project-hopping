// Cloud mirror (Phase 5). The hub keeps the local SQLite as source of truth and
// pushes a full snapshot to Upstash after every change, so the Vercel phone app
// can read it. Phone actions ride a Redis queue that we drain back into the
// local applyEvent. No-op (and no Upstash import cost) when not configured.

import {
  cloudConfigured,
  cloudSetState,
  cloudSetKey,
  cloudDrainActions,
} from "../lib/cloud.ts";
import {
  getProjectsWithTally,
  listSessions,
  setTallyMode,
  resetTallies,
  updateNotifySettings,
  setProjectMuted,
  setProjectSnooze,
  addSessionNote,
  setSessionNoteDone,
  deleteSessionNote,
} from "../lib/db.ts";
import { rankProjects } from "../lib/rankProjects.ts";
import { readRecentMessages } from "./transcript.mjs";
import { slackPost } from "./notify.mjs";
import { standupCard } from "./cards.mjs";
import { runContinue } from "./runner.mjs";
import { buildSnapshot } from "./stateView.mjs";
import { agentAction } from "./agents.mjs";

export function startMirror() {
  if (!cloudConfigured()) {
    startMirror.push = undefined;
    return;
  }
  startMirror.push = () => {
    cloudSetState(buildSnapshot()).catch(() => {});
  };
  startMirror.push(); // initial push on boot
}

// Per-chat message tails for the phone (which can't hit the local messages
// endpoint). Separate key + slower cadence than the main state — transcript
// reads are heavy — and hash-skipped so an idle minute costs nothing.
const TAILS_DAY_MS = 24 * 3600 * 1000;
const TAILS_MSG_LIMIT = 10;
const TAILS_TEXT_CAP = 400;
const TAILS_MAX_BYTES = 400 * 1024;
let lastTailsHash = "";

function buildTails() {
  const now = Date.now();
  const sessions = listSessions()
    .filter((s) => s.last_activity && now - s.last_activity < TAILS_DAY_MS)
    .sort((a, b) => (b.last_activity ?? 0) - (a.last_activity ?? 0));
  const out = {};
  let bytes = 0;
  for (const s of sessions) {
    let r;
    try {
      r = readRecentMessages(s.session_id, { limit: TAILS_MSG_LIMIT }); // mtime-cached
    } catch {
      continue;
    }
    const messages = r.messages.map((m) => ({
      role: m.role,
      text: m.text.length > TAILS_TEXT_CAP ? m.text.slice(0, TAILS_TEXT_CAP) + "…" : m.text,
      ts: m.ts,
    }));
    const entry = { messages, truncated: r.truncated };
    const sz = JSON.stringify(entry).length + s.session_id.length + 8;
    if (bytes + sz > TAILS_MAX_BYTES) break; // drop the oldest sessions over budget
    out[s.session_id] = entry;
    bytes += sz;
  }
  return { sessions: out, generatedAt: now };
}

export function startTailsMirror() {
  if (!cloudConfigured()) return;
  const push = () => {
    try {
      const tails = buildTails();
      const hash = JSON.stringify(tails.sessions);
      if (hash === lastTailsHash) return; // nothing changed — skip the write
      lastTailsHash = hash;
      cloudSetKey("tails", tails).catch(() => {});
    } catch {
      /* best-effort */
    }
  };
  push();
  setInterval(push, 30_000);
}

const NOTIFY_KEYS = [
  "notify_interrupt",
  "notify_nudge",
  "notify_neglect",
  "neglect_hour",
  "neglect_days",
];

export async function ingestQueuedActions(ingest) {
  if (!cloudConfigured()) return;
  let actions = [];
  try {
    actions = await cloudDrainActions();
  } catch {
    return;
  }
  if (!actions.length) return;

  for (const a of actions) {
    try {
      if (a.kind) {
        await handleKind(a, ingest);
        continue;
      }
      if (a.settings) {
        const s = a.settings;
        if (s.tally_mode) setTallyMode(s.tally_mode);
        if (s.reset) resetTallies();
        const notify = {};
        for (const k of NOTIFY_KEYS) if (k in s) notify[k] = s[k];
        if (Object.keys(notify).length) updateNotifySettings(notify);
        continue;
      }
      if (!a.projectId || !a.action) continue;
      const type = a.action === "skip" ? "skip" : a.action === "brief" ? "brief" : "hop";
      const payload =
        type === "brief" ? { text: a.brief ?? "" } : a.brief ? { brief: a.brief } : {};
      ingest({ projectId: a.projectId, type, payload }); // ingest() re-mirrors
    } catch {
      /* skip a bad action */
    }
  }
  startMirror.push?.(); // ensure a fresh snapshot after settings-only actions too
}

// Slack interactive actions (Phase 7/8). Each still flows through the hub.
async function handleKind(a, ingest) {
  switch (a.kind) {
    case "hopped":
      if (a.projectId) {
        ingest({
          projectId: a.projectId,
          type: "hop",
          payload: a.sessionId ? { session_id: a.sessionId } : {},
        });
      }
      break;
    case "snooze":
      if (a.projectId) setProjectSnooze(a.projectId, Date.now() + (a.minutes ?? 60) * 60000);
      break;
    case "mute":
      if (a.projectId) setProjectMuted(a.projectId, true);
      break;
    case "unmute":
      if (a.projectId) setProjectMuted(a.projectId, false);
      break;
    case "status": {
      const projects = getProjectsWithTally();
      const { next, ordered } = rankProjects(projects);
      await slackPost({
        text: `🐇 Hopping standup — hop next → ${next ? next.name : "—"}`,
        blocks: standupCard({ projects: ordered.filter((p) => p.id !== "unmapped"), next }),
      });
      break;
    }
    case "continue":
      await runContinue(a);
      break;
    // Dashboard "My notes" — the human's per-chat checklist (Phase 1).
    case "note_add":
      if (a.sessionId && a.text) addSessionNote(a.sessionId, a.text);
      break;
    case "note_toggle":
      if (typeof a.noteId === "number") setSessionNoteDone(a.noteId, !!a.done);
      break;
    case "note_delete":
      if (typeof a.noteId === "number") deleteSessionNote(a.noteId);
      break;
    // Agent actions from the phone (Phase 3).
    case "agent_run":
      if (a.agentId) await agentAction(a.agentId, "run");
      break;
    case "agent_pause":
      if (a.agentId) await agentAction(a.agentId, "pause");
      break;
    case "agent_resume":
      if (a.agentId) await agentAction(a.agentId, "resume");
      break;
    case "agent_ack":
      if (a.agentId) await agentAction(a.agentId, a.done === false ? "unack" : "ack");
      break;
    default:
      break;
  }
}
