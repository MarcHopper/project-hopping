// Private chats never leave the Mac. The hub mirrors every chat's summary and
// its last messages to Upstash for the phone; a chat that handles private notes
// must be left out of both. A chat is private when its name starts with "notes"
// or its session id is listed (one per line) in ~/.hop-private/private-sessions.txt.
// Local dashboards are unaffected: only the cloud writes are filtered.

const NAME_RE = /^notes\b/i;

export function isPrivateSession(
  s: { session_id?: string; name?: string | null },
  ids: Set<string>,
): boolean {
  return (!!s.session_id && ids.has(s.session_id)) || NAME_RE.test(s.name ?? "");
}

/** Drop private sessions from a buildSnapshot()-shaped state. */
export function stripPrivateState<T>(state: T, ids: Set<string>): T {
  const st = state as { sessions?: { session_id?: string; name?: string | null }[] };
  if (!st || !Array.isArray(st.sessions)) return state;
  return { ...st, sessions: st.sessions.filter((s) => !isPrivateSession(s, ids)) } as T;
}

/** Drop private sessions from the tails mirror ({ sessions: { [id]: … } }). */
export function stripPrivateTails<T>(tails: T, ids: Set<string>, names: Map<string, string>): T {
  const t = tails as { sessions?: Record<string, unknown> };
  if (!t || !t.sessions) return tails;
  const out: Record<string, unknown> = {};
  for (const [id, v] of Object.entries(t.sessions)) {
    if (!isPrivateSession({ session_id: id, name: names.get(id) }, ids)) out[id] = v;
  }
  return { ...t, sessions: out } as T;
}

/** Reads the private-id list on the hub. Never called on Vercel (read-only there). */
export async function loadPrivateIds(): Promise<Set<string>> {
  try {
    const { readFileSync } = await import("node:fs");
    const txt = readFileSync(`${process.env.HOME}/.hop-private/private-sessions.txt`, "utf8");
    return new Set(txt.split(/\s+/).filter(Boolean));
  } catch {
    return new Set();
  }
}
