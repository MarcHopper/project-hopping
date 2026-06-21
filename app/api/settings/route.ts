import { NextResponse } from "next/server";
import type { TallyMode } from "@/lib/types";

export const dynamic = "force-dynamic";

const CLOUD = !!process.env.HOPPING_CLOUD;
const MODES: TallyMode[] = ["rolling7d", "daily", "weekly", "none"];
const NOTIFY_KEYS = ["notify_interrupt", "notify_nudge", "notify_neglect", "neglect_hour", "neglect_days"] as const;

export async function GET() {
  if (CLOUD) {
    const { cloudGetState } = await import("@/lib/cloud");
    const s = (await cloudGetState<{ settings?: unknown }>())?.settings ?? {};
    return NextResponse.json(s);
  }
  const { getSettings } = await import("@/lib/db");
  const { tallyWindowLabel } = await import("@/lib/tally");
  const s = getSettings();
  return NextResponse.json({ ...s, windowLabel: tallyWindowLabel(s.tally_mode) });
}

export async function PATCH(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "bad json" }, { status: 400 });
  }

  const settings: Record<string, unknown> = {};
  if (body.tally_mode) {
    if (!MODES.includes(body.tally_mode as TallyMode)) {
      return NextResponse.json({ ok: false, error: "invalid tally_mode" }, { status: 400 });
    }
    settings.tally_mode = body.tally_mode;
  }
  for (const k of NOTIFY_KEYS) if (body[k] !== undefined) settings[k] = body[k];

  if (CLOUD) {
    if (Object.keys(settings).length) {
      const { cloudPushAction } = await import("@/lib/cloud");
      await cloudPushAction({ settings });
    }
    return NextResponse.json({ ok: true, queued: true });
  }

  const { setTallyMode, updateNotifySettings } = await import("@/lib/db");
  if (settings.tally_mode) setTallyMode(settings.tally_mode as TallyMode);
  const notify: Record<string, number | boolean> = {};
  for (const k of NOTIFY_KEYS) if (k in settings) notify[k] = settings[k] as number | boolean;
  if (Object.keys(notify).length) updateNotifySettings(notify);
  return NextResponse.json({ ok: true });
}

// Manual "Reset tallies" button.
export async function POST() {
  if (CLOUD) {
    const { cloudPushAction } = await import("@/lib/cloud");
    await cloudPushAction({ settings: { reset: true } });
    return NextResponse.json({ ok: true, queued: true });
  }
  const { resetTallies } = await import("@/lib/db");
  resetTallies();
  return NextResponse.json({ ok: true });
}
