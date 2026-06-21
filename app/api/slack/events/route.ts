import { NextResponse } from "next/server";
import { verifySlack, isAllowedSlackUser } from "@/lib/slackVerify";
import { cloudPushAction } from "@/lib/cloud";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Slack Events API: the only event we subscribe to is `message.im`. A reply in a
// chat's thread becomes a "continue" action keyed by thread_ts (the hub resolves
// the session). Used to drive a chat from your phone by replying in its thread.
export async function POST(req: Request) {
  const raw = await req.text();

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ ok: true });
  }

  // Slack URL-verification handshake — answer BEFORE the signature check so the
  // URL can be registered before the signing secret is wired (one-time, safe).
  if (body.type === "url_verification") {
    return NextResponse.json({ challenge: body.challenge });
  }

  if (!verifySlack(raw, req.headers.get("x-slack-signature"), req.headers.get("x-slack-request-timestamp"))) {
    return NextResponse.json({ error: "bad signature" }, { status: 401 });
  }

  if (body.type === "event_callback") {
    const e = body.event as {
      type?: string;
      channel_type?: string;
      user?: string;
      text?: string;
      thread_ts?: string;
      bot_id?: string;
      subtype?: string;
    };
    // Only: a human (Marc) replying inside a thread in a DM. Ignore bot echoes.
    if (
      e &&
      e.type === "message" &&
      e.channel_type === "im" &&
      !e.bot_id &&
      !e.subtype &&
      e.thread_ts &&
      e.text &&
      isAllowedSlackUser(e.user)
    ) {
      await cloudPushAction({ kind: "continue", thread_ts: e.thread_ts, prompt: e.text.trim() });
    }
  }

  return NextResponse.json({ ok: true });
}
