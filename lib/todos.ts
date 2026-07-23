// Pure extraction of a Claude Code chat's current TodoWrite list from its
// transcript JSONL lines. Dependency-free (no fs, no DB) so it stays unit-
// testable and portable — the hub does the tail-reading and hands lines here.
//
// TodoWrite state is NOT stored anywhere on disk except inside the transcript:
// each call appears as an `assistant` line whose message.content[] holds a
// `tool_use` block `{name:"TodoWrite", input:{todos:[...]}}`. We want the LAST
// such block from the MAIN thread (subagent/sidechain todos are excluded).

export type TodoStatus = "pending" | "in_progress" | "completed";

export interface TodoItem {
  content: string;
  status: TodoStatus;
  activeForm: string;
}

const VALID_STATUS = new Set<TodoStatus>(["pending", "in_progress", "completed"]);
const MAX_ITEMS = 30;
const MAX_CHARS = 200;

/** Coerce arbitrary parsed todos into the safe stored shape (caps size + whitelists status). */
export function sanitizeTodos(raw: unknown): TodoItem[] {
  if (!Array.isArray(raw)) return [];
  const out: TodoItem[] = [];
  for (const t of raw) {
    if (!t || typeof t !== "object") continue;
    const o = t as Record<string, unknown>;
    const content = typeof o.content === "string" ? o.content.slice(0, MAX_CHARS) : "";
    if (!content) continue;
    const status = (typeof o.status === "string" && VALID_STATUS.has(o.status as TodoStatus)
      ? o.status
      : "pending") as TodoStatus;
    const activeForm =
      typeof o.activeForm === "string" ? o.activeForm.slice(0, MAX_CHARS) : content;
    out.push({ content, status, activeForm });
    if (out.length >= MAX_ITEMS) break;
  }
  return out;
}

/** True if a parsed transcript line is a main-thread assistant TodoWrite call. */
function todosFromLine(o: unknown): unknown | null {
  if (!o || typeof o !== "object") return null;
  const line = o as Record<string, unknown>;
  if (line.type !== "assistant") return null;
  if (line.isSidechain === true) return null; // subagent todos never count as the chat's
  const content = (line.message as Record<string, unknown> | undefined)?.content;
  if (!Array.isArray(content)) return null;
  // Walk this turn's tool_use blocks; a turn has at most one TodoWrite.
  for (const block of content) {
    if (
      block &&
      typeof block === "object" &&
      (block as Record<string, unknown>).type === "tool_use" &&
      (block as Record<string, unknown>).name === "TodoWrite"
    ) {
      const input = (block as Record<string, unknown>).input as
        | Record<string, unknown>
        | undefined;
      if (input && Array.isArray(input.todos)) return input.todos;
    }
  }
  return null;
}

/**
 * Given transcript lines (oldest→newest, as the file stores them), return the
 * most-recent main-thread TodoWrite list and the timestamp of the line it came
 * from. Returns null when the chat has never called TodoWrite. Unparseable lines
 * (including a partial first line from a tail-chunk split) are skipped.
 */
export function extractLatestTodos(
  lines: string[],
): { todos: TodoItem[]; at: number } | null {
  for (let i = lines.length - 1; i >= 0; i--) {
    const raw = lines[i];
    if (!raw) continue;
    let o: unknown;
    try {
      o = JSON.parse(raw);
    } catch {
      continue; // malformed / partial line
    }
    const todos = todosFromLine(o);
    if (todos !== null) {
      const ts = tsOf(o);
      return { todos: sanitizeTodos(todos), at: ts };
    }
  }
  return null;
}

function tsOf(o: unknown): number {
  const t = (o as Record<string, unknown>)?.timestamp;
  if (typeof t === "number") return t;
  if (typeof t === "string") {
    const ms = Date.parse(t);
    if (!Number.isNaN(ms)) return ms;
  }
  return 0;
}
