// Cloud mirror (Phase 5). The hub keeps the local SQLite as source of truth and
// pushes a full snapshot to Upstash after every change, so the Vercel phone app
// can read it. Phone actions ride a Redis queue that we drain back into the
// local applyEvent. No-op (and no Upstash import cost) when not configured.

import {
  cloudConfigured,
  cloudSetState,
  cloudDrainActions,
} from "../lib/cloud.ts";
import {
  getProjectsWithTally,
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
import { slackPost } from "./notify.mjs";
import { standupCard } from "./cards.mjs";
import { runContinue } from "./runner.mjs";
import { buildSnapshot } from "./stateView.mjs";

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
    default:
      break;
  }
}
