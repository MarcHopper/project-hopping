// Verify an inbound Slack request (HMAC-SHA256 over `v0:timestamp:rawBody` with
// the app's signing secret) + a 5-minute replay guard. node:crypto — these
// routes must run on the Node runtime, and must read the RAW body.

import crypto from "node:crypto";

export function verifySlack(rawBody: string, signature: string | null, timestamp: string | null): boolean {
  const secret = process.env.HOPPING_SLACK_SIGNING_SECRET;
  if (!secret || !signature || !timestamp) return false;

  // replay guard
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > 300) return false;

  const base = `v0:${timestamp}:${rawBody}`;
  const mine = "v0=" + crypto.createHmac("sha256", secret).update(base).digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(mine), Buffer.from(signature));
  } catch {
    return false; // length mismatch etc.
  }
}

/** Is this Slack user allowed to drive Hopping? (only Marc) */
export function isAllowedSlackUser(userId: string | undefined): boolean {
  const allowed = process.env.HOPPING_SLACK_USER_MARC;
  return !!allowed && userId === allowed;
}
