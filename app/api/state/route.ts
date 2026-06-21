import { NextResponse } from "next/server";

// The grid polls this every few seconds. Never cache it.
export const dynamic = "force-dynamic";

const CLOUD = !!process.env.HOPPING_CLOUD;

// Shown before the hub has ever mirrored (or if the cloud read fails).
const EMPTY = {
  projects: [],
  ordered: [],
  next: null,
  columns: [{ cells: {}, complete: false }],
  sessions: [],
  settings: {
    tally_mode: "rolling7d",
    tally_reset_at: 0,
    focused_project_id: "",
    notify_interrupt: true,
    notify_nudge: false,
    notify_neglect: true,
    neglect_hour: 9,
    neglect_days: 3,
    last_neglect_fired: "",
    quiet_start: -1,
    quiet_end: -1,
    slack_interrupt: true,
    slack_nudge: false,
    slack_neglect: true,
    active_suppress: true,
    windowLabel: "last 7 days",
  },
  generatedAt: 0,
};

export async function GET() {
  if (CLOUD) {
    // Vercel: read the snapshot the local hub mirrored to Upstash.
    const { cloudGetState } = await import("@/lib/cloud");
    const state = await cloudGetState().catch(() => null);
    return NextResponse.json(state ?? EMPTY);
  }

  // Local: read SQLite directly (better-sqlite3 only ever imported here).
  const { getProjectsWithTally, getTouchEvents, getSettings, listSessions } = await import("@/lib/db");
  const { rankProjects } = await import("@/lib/rankProjects");
  const { deriveColumns } = await import("@/lib/cycles");
  const { tallyWindowLabel } = await import("@/lib/tally");

  const projects = getProjectsWithTally();
  const settings = getSettings();
  const activeIds = projects.filter((p) => !p.archived).map((p) => p.id);
  const columns = deriveColumns(getTouchEvents(), activeIds);
  const { next, ordered } = rankProjects(projects);

  return NextResponse.json({
    projects,
    ordered,
    next,
    columns,
    sessions: listSessions(),
    settings: { ...settings, windowLabel: tallyWindowLabel(settings.tally_mode) },
    generatedAt: Date.now(),
  });
}
