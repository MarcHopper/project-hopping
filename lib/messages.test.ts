import { describe, it, expect } from "vitest";
import { extractMessages } from "./messages";

const user = (text: string, ts = "2026-07-23T10:00:00.000Z", sidechain = false) =>
  JSON.stringify({ type: "user", timestamp: ts, isSidechain: sidechain, message: { role: "user", content: text } });

const asst = (text: string, ts = "2026-07-23T10:00:01.000Z") =>
  JSON.stringify({
    type: "assistant",
    timestamp: ts,
    message: { role: "assistant", content: [{ type: "text", text }] },
  });

const toolResultUser = () =>
  JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "x", content: "ok" }] } });

const meta = () => JSON.stringify({ type: "ai-title", aiTitle: "Some Title" });

describe("extractMessages", () => {
  it("returns user+assistant text in chronological order", () => {
    const msgs = extractMessages([user("hello"), asst("hi there"), user("do X"), asst("done")]);
    expect(msgs.map((m) => [m.role, m.text])).toEqual([
      ["user", "hello"],
      ["assistant", "hi there"],
      ["user", "do X"],
      ["assistant", "done"],
    ]);
  });

  it("skips sidechains, tool-result-only user turns, and meta lines", () => {
    const msgs = extractMessages([user("real"), toolResultUser(), meta(), asst("reply", "2026-07-23T10:00:02.000Z"), user("sub", "2026-07-23T10:00:03.000Z", true)]);
    expect(msgs.map((m) => m.text)).toEqual(["real", "reply"]);
  });

  it("handles array-form user content (text blocks)", () => {
    const line = JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "text", text: "block text" }] } });
    expect(extractMessages([line])[0].text).toBe("block text");
  });

  it("respects the limit (keeps the most recent N)", () => {
    const lines = Array.from({ length: 50 }, (_, i) => asst(`m${i}`, `2026-07-23T10:${String(i).padStart(2, "0")}:00.000Z`));
    const msgs = extractMessages(lines, { limit: 10 });
    expect(msgs).toHaveLength(10);
    expect(msgs[0].text).toBe("m40");
    expect(msgs[9].text).toBe("m49");
  });

  it("caps and marks long messages", () => {
    const msgs = extractMessages([asst("y".repeat(3000))], { perMessageCap: 2000 });
    expect(msgs[0].text.length).toBe(2001); // 2000 + ellipsis
    expect(msgs[0].text.endsWith("…")).toBe(true);
  });

  it("skips malformed lines", () => {
    expect(extractMessages(["{bad json", asst("good")]).map((m) => m.text)).toEqual(["good"]);
  });
});
