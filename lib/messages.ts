// Pure extraction of a chat's recent human/assistant messages from transcript
// JSONL lines, for the dashboard's per-chat message view. Dependency-free (the
// hub tail-reads and hands lines here). Tool-use/tool-result noise, sidechains,
// and meta lines (ai-title, system, file-history…) are filtered out.

export interface Message {
  role: "user" | "assistant";
  text: string;
  ts: number;
}

/** Pull the visible text from a user or assistant transcript line. */
function messageText(o: Record<string, unknown>): string {
  const msg = o.message as Record<string, unknown> | undefined;
  const content = msg?.content;
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content
    .filter(
      (b) =>
        b && typeof b === "object" && (b as Record<string, unknown>).type === "text" &&
        typeof (b as Record<string, unknown>).text === "string",
    )
    .map((b) => (b as Record<string, unknown>).text as string)
    .join("\n")
    .trim();
}

function tsOf(o: Record<string, unknown>): number {
  const t = o.timestamp;
  if (typeof t === "number") return t;
  if (typeof t === "string") {
    const ms = Date.parse(t);
    if (!Number.isNaN(ms)) return ms;
  }
  return 0;
}

// A user line that is purely a tool_result carry-back (no human text) — skip it.
function isToolResultOnly(o: Record<string, unknown>): boolean {
  const content = (o.message as Record<string, unknown> | undefined)?.content;
  if (!Array.isArray(content)) return false;
  return content.every(
    (b) => b && typeof b === "object" && (b as Record<string, unknown>).type === "tool_result",
  );
}

/**
 * The last `limit` human/assistant messages, oldest→newest, each capped to
 * `perMessageCap` chars. Skips sidechains, tool-only turns, and meta lines.
 */
export function extractMessages(
  lines: string[],
  { limit = 30, perMessageCap = 2000 } = {},
): Message[] {
  const out: Message[] = [];
  // Walk backward, collecting up to `limit`, then reverse to chronological order.
  for (let i = lines.length - 1; i >= 0 && out.length < limit; i--) {
    const raw = lines[i];
    if (!raw) continue;
    let o: Record<string, unknown>;
    try {
      o = JSON.parse(raw);
    } catch {
      continue;
    }
    if (o.type !== "user" && o.type !== "assistant") continue;
    if (o.isSidechain === true) continue;
    if (o.type === "user" && isToolResultOnly(o)) continue;
    const text = messageText(o);
    if (!text) continue;
    const clipped = text.length > perMessageCap ? text.slice(0, perMessageCap) + "…" : text;
    out.push({ role: o.type, text: clipped, ts: tsOf(o) });
  }
  return out.reverse();
}
