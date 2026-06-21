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
  getSettings,
  getTouchEvents,
  setTallyMode,
  resetTallies,
  updateNotifySettings,
} from "../lib/db.ts";
import { rankProjects } from "../lib/rankProjects.ts";
import { deriveColumns } from "../lib/cycles.ts";
import { tallyWindowLabel } from "../lib/tally.ts";

// Exactly the shape the local /api/state returns, so the phone reuses the UI.
function snapshot() {
  const projects = getProjectsWithTally();
  const settings = getSettings();
  const activeIds = projects.filter((p) => !p.archived).map((p) => p.id);
  const columns = deriveColumns(getTouchEvents(), activeIds);
  const { next, ordered } = rankProjects(projects);
  return {
    projects,
    ordered,
    next,
    columns,
    settings: { ...settings, windowLabel: tallyWindowLabel(settings.tally_mode) },
    generatedAt: Date.now(),
  };
}

export function startMirror() {
  if (!cloudConfigured()) {
    startMirror.push = undefined;
    return;
  }
  startMirror.push = () => {
    cloudSetState(snapshot()).catch(() => {});
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
