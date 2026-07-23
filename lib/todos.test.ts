import { describe, it, expect } from "vitest";
import { extractLatestTodos, sanitizeTodos } from "./todos";

// Build an assistant TodoWrite transcript line.
const todoLine = (
  todos: unknown[],
  { ts = "2026-07-23T10:00:00.000Z", sidechain = false } = {},
): string =>
  JSON.stringify({
    type: "assistant",
    timestamp: ts,
    isSidechain: sidechain,
    message: {
      role: "assistant",
      content: [
        { type: "text", text: "working" },
        { type: "tool_use", id: "toolu_x", name: "TodoWrite", input: { todos } },
      ],
    },
  });

const textLine = (t: string): string =>
  JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: t }] } });

const T = (content: string, status = "pending", activeForm = "") => ({
  content,
  status,
  activeForm: activeForm || content,
});

describe("extractLatestTodos", () => {
  it("returns the last main-thread TodoWrite list", () => {
    const lines = [
      todoLine([T("first", "completed")]),
      textLine("hmm"),
      todoLine([T("a", "completed"), T("b", "in_progress"), T("c", "pending")]),
    ];
    const r = extractLatestTodos(lines);
    expect(r).not.toBeNull();
    expect(r!.todos.map((t) => t.status)).toEqual(["completed", "in_progress", "pending"]);
    expect(r!.at).toBe(Date.parse("2026-07-23T10:00:00.000Z"));
  });

  it("excludes subagent (sidechain) TodoWrite calls, using the main-thread one", () => {
    const lines = [
      todoLine([T("main-task", "in_progress")]),
      todoLine([T("subagent-task", "completed")], { sidechain: true }),
    ];
    const r = extractLatestTodos(lines);
    expect(r!.todos).toHaveLength(1);
    expect(r!.todos[0].content).toBe("main-task");
  });

  it("skips malformed / partial first line from a tail-chunk split", () => {
    const lines = [
      '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Todo', // truncated
      todoLine([T("real", "pending")]),
    ];
    const r = extractLatestTodos(lines);
    expect(r!.todos[0].content).toBe("real");
  });

  it("returns null when the chat never called TodoWrite", () => {
    expect(extractLatestTodos([textLine("no todos here"), textLine("still none")])).toBeNull();
  });

  it("handles an empty todos array (a chat that cleared its list)", () => {
    const r = extractLatestTodos([todoLine([])]);
    expect(r).not.toBeNull();
    expect(r!.todos).toEqual([]);
  });
});

describe("sanitizeTodos", () => {
  it("caps at 30 items and 200 chars, whitelists status, defaults activeForm", () => {
    const many = Array.from({ length: 40 }, (_, i) => T(`item ${i}`, "bogus"));
    const out = sanitizeTodos(many);
    expect(out).toHaveLength(30);
    expect(out[0].status).toBe("pending"); // bogus → pending
  });

  it("drops entries without content and clips long strings", () => {
    const out = sanitizeTodos([
      { status: "completed" }, // no content → dropped
      T("x".repeat(500), "completed"),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].content.length).toBe(200);
    expect(out[0].status).toBe("completed");
  });

  it("returns [] for non-array input", () => {
    expect(sanitizeTodos(null)).toEqual([]);
    expect(sanitizeTodos("nope")).toEqual([]);
  });
});
