import { NextResponse } from "next/server";
import { getSettings, setTallyMode, resetTallies } from "@/lib/db";
import { tallyWindowLabel } from "@/lib/tally";
import type { TallyMode } from "@/lib/types";

export const dynamic = "force-dynamic";

const MODES: TallyMode[] = ["rolling7d", "daily", "weekly", "none"];

export async function GET() {
  const s = getSettings();
  return NextResponse.json({ ...s, windowLabel: tallyWindowLabel(s.tally_mode) });
}

export async function PATCH(req: Request) {
  let body: { tally_mode?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "bad json" }, { status: 400 });
  }
  if (body.tally_mode && MODES.includes(body.tally_mode as TallyMode)) {
    setTallyMode(body.tally_mode as TallyMode);
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ ok: false, error: "invalid tally_mode" }, { status: 400 });
}

// Manual "Reset tallies" button.
export async function POST() {
  resetTallies();
  return NextResponse.json({ ok: true });
}
