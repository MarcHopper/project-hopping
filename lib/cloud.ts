// Thin Upstash Redis REST client, namespaced to `hopping:`. Shared by:
//   - the hub (mirror.mjs): writes the state snapshot, drains the action queue
//   - the Vercel phone app: reads the snapshot, pushes phone actions
// Dependency-free (global fetch only) so it bundles cleanly on Vercel with no
// native modules — `better-sqlite3` is never imported on the cloud path.

import { loadPrivateIds, stripPrivateState, stripPrivateTails } from "./privateSessions";

const STATE_KEY = "hopping:state";
const ACTIONS_KEY = "hopping:actions";

function creds() {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url, token } : null;
}

export function cloudConfigured(): boolean {
  return creds() !== null;
}

// One Redis command via the Upstash REST API. Returns the `result` field.
async function redis(command: (string | number)[]): Promise<unknown> {
  const c = creds();
  if (!c) throw new Error("upstash not configured");
  const res = await fetch(c.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${c.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(command),
    // never cache on the Next.js side
    cache: "no-store",
  });
  const json = (await res.json()) as { result?: unknown; error?: string };
  if (json.error) throw new Error(json.error);
  return json.result;
}

// Session names from the last state push, so the tails filter can match a
// "notes…" chat by name (tails are keyed by id only).
const lastNames = new Map<string, string>();

export async function cloudSetState(state: unknown): Promise<void> {
  const st = state as { sessions?: { session_id?: string; name?: string | null }[] };
  for (const s of st?.sessions ?? []) if (s.session_id) lastNames.set(s.session_id, s.name ?? "");
  const clean = stripPrivateState(state, await loadPrivateIds());
  await redis(["SET", STATE_KEY, JSON.stringify(clean)]);
}

export async function cloudGetState<T = unknown>(): Promise<T | null> {
  const r = (await redis(["GET", STATE_KEY])) as string | null;
  if (!r) return null;
  try {
    return JSON.parse(r) as T;
  } catch {
    return null;
  }
}

// Generic namespaced key access (e.g. suffix "tails" → hopping:tails). Used for
// the message-tails mirror, kept separate from the main state so per-poll reads
// stay small and the heavier tails push runs on its own slower cadence.
export async function cloudSetKey(suffix: string, value: unknown): Promise<void> {
  if (suffix === "tails") value = stripPrivateTails(value, await loadPrivateIds(), lastNames);
  await redis(["SET", `hopping:${suffix}`, JSON.stringify(value)]);
}

export async function cloudGetKey<T = unknown>(suffix: string): Promise<T | null> {
  const r = (await redis(["GET", `hopping:${suffix}`])) as string | null;
  if (!r) return null;
  try {
    return JSON.parse(r) as T;
  } catch {
    return null;
  }
}

export interface QueuedAction {
  // phone-app shape (back-compat)
  projectId?: string;
  action?: string; // worked | skip | hop | brief
  brief?: string;
  settings?: Record<string, unknown>;
  // Slack interactive shape (Phase 7/8): discriminated by `kind`
  // + dashboard note actions (Phase 1)
  kind?:
    | "hopped"
    | "snooze"
    | "mute"
    | "unmute"
    | "continue"
    | "status"
    | "note_add"
    | "note_toggle"
    | "note_delete"
    | "agent_run"
    | "agent_pause"
    | "agent_resume"
    | "agent_ack";
  sessionId?: string;
  minutes?: number;
  prompt?: string;
  thread_ts?: string;
  // note actions
  noteId?: number;
  text?: string;
  done?: boolean;
  // agent actions
  agentId?: string;
}

export async function cloudPushAction(action: QueuedAction): Promise<void> {
  await redis(["RPUSH", ACTIONS_KEY, JSON.stringify(action)]);
}

// Atomically pop every queued action (LPOP one at a time). One user, low volume.
export async function cloudDrainActions(): Promise<QueuedAction[]> {
  const out: QueuedAction[] = [];
  for (let i = 0; i < 200; i++) {
    const r = (await redis(["LPOP", ACTIONS_KEY])) as string | null;
    if (!r) break;
    try {
      out.push(JSON.parse(r) as QueuedAction);
    } catch {
      /* skip malformed */
    }
  }
  return out;
}
