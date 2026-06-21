import { NextResponse } from "next/server";
import { applyEvent } from "@/lib/db";

// In-app actions from the grid: "I worked on it" (hop), "skip", or leave a brief.
export const dynamic = "force-dynamic";

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
