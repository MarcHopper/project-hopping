import { NextResponse } from "next/server";

// In-app actions from the grid: "I worked on it" (hop), "skip", or leave a brief.
export const dynamic = "force-dynamic";

const CLOUD = !!process.env.HOPPING_CLOUD;

export async function POST(req: Request) {
  let body: { projectId?: string; action?: string; brief?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "bad json" }, { status: 400 });
  }

  const { projectId, action, brief } = body;
  if (!projectId || !action) {
    return NextResponse.json(
      { ok: false, error: "projectId and action required" },
      { status: 400 },
    );
  }

  if (CLOUD) {
    // Vercel: queue the action; the local hub drains + applies it.
    const { cloudPushAction } = await import("@/lib/cloud");
    await cloudPushAction({ projectId, action, brief });
    return NextResponse.json({ ok: true, queued: true });
  }

  const { applyEvent } = await import("@/lib/db");
  switch (action) {
    case "worked":
    case "hop":
      applyEvent({ projectId, type: "hop", payload: brief ? { brief } : {} });
      break;
    case "skip":
      applyEvent({ projectId, type: "skip" });
      break;
    case "brief":
      applyEvent({ projectId, type: "brief", payload: { text: brief ?? "" } });
      break;
    default:
      return NextResponse.json({ ok: false, error: "unknown action" }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
