import { NextResponse } from "next/server";
import { verifySlack, isAllowedSlackUser } from "@/lib/slackVerify";
import { cloudPushAction } from "@/lib/cloud";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Open a Slack modal to collect the "continue" prompt for a session.
async function openContinueModal(triggerId: string, sessionId: string) {
  const token = process.env.HOPPING_SLACK_BOT_TOKEN;
  if (!token) return;
  await fetch("https://slack.com/api/views.open", {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8", Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      trigger_id: triggerId,
      view: {
        type: "modal",
        callback_id: "continue_submit",
        private_metadata: sessionId,
        title: { type: "plain_text", text: "Continue chat" },
        submit: { type: "plain_text", text: "Send" },
        close: { type: "plain_text", text: "Cancel" },
        blocks: [
          {
            type: "input",
            block_id: "p",
            label: { type: "plain_text", text: "What should it do next?" },
            element: { type: "plain_text_input", action_id: "v", multiline: true },
          },
        ],
      },
    }),
  }).catch(() => {});
}

export async function POST(req: Request) {
  const raw = await req.text();
  if (!verifySlack(raw, req.headers.get("x-slack-signature"), req.headers.get("x-slack-request-timestamp"))) {
    return NextResponse.json({ error: "bad signature" }, { status: 401 });
  }

  const payloadStr = new URLSearchParams(raw).get("payload");
  if (!payloadStr) return NextResponse.json({ ok: true });
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(payloadStr);
  } catch {
    return NextResponse.json({ ok: true });
  }

  const user = (payload.user as { id?: string } | undefined)?.id;
  if (!isAllowedSlackUser(user)) return NextResponse.json({ ok: true }); // ignore others silently

  // Modal submit → enqueue the continue prompt.
  if (payload.type === "view_submission") {
    const view = payload.view as {
      private_metadata?: string;
      state?: { values?: Record<string, Record<string, { value?: string }>> };
    };
    const sessionId = view.private_metadata;
    const prompt = view.state?.values?.p?.v?.value?.trim();
    if (sessionId && prompt) await cloudPushAction({ kind: "continue", sessionId, prompt });
    return NextResponse.json({ response_action: "clear" });
  }

  // Button clicks.
  const actions = (payload.actions as { action_id?: string; value?: string }[] | undefined) ?? [];
  for (const a of actions) {
    let v: Record<string, unknown> = {};
    try {
      v = a.value ? JSON.parse(a.value) : {};
    } catch {
      /* url buttons have no value */
    }
    switch (a.action_id) {
      case "hopped":
        await cloudPushAction({ kind: "hopped", projectId: v.projectId as string, sessionId: v.sessionId as string });
        break;
      case "snooze":
        await cloudPushAction({ kind: "snooze", projectId: v.projectId as string, minutes: (v.minutes as number) ?? 60 });
        break;
      case "continue_open": {
        const triggerId = payload.trigger_id as string | undefined;
        if (triggerId && v.sessionId) await openContinueModal(triggerId, v.sessionId as string);
        break;
      }
      default:
        break;
    }
  }

  return NextResponse.json({ ok: true });
}
