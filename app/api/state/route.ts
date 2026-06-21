import { NextResponse } from "next/server";
import { getProjectsWithTally, getTouchEvents, getSettings } from "@/lib/db";
import { rankProjects } from "@/lib/rankProjects";
import { deriveColumns } from "@/lib/cycles";
import { tallyWindowLabel } from "@/lib/tally";

// The grid polls this every few seconds. Never cache it.
export const dynamic = "force-dynamic";

export async function GET() {
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
    settings: { ...settings, windowLabel: tallyWindowLabel(settings.tally_mode) },
    generatedAt: Date.now(),
  });
}
