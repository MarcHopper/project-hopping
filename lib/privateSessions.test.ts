import { describe, it, expect } from "vitest";
import { isPrivateSession, stripPrivateState, stripPrivateTails } from "./privateSessions";

const ids = new Set(["listed-id"]);

describe("private sessions", () => {
  it("matches by name prefix or listed id", () => {
    expect(isPrivateSession({ session_id: "a", name: "Notes: call with K" }, ids)).toBe(true);
    expect(isPrivateSession({ session_id: "listed-id", name: "VME random task" }, ids)).toBe(true);
    expect(isPrivateSession({ session_id: "b", name: "Footnotes cleanup" }, ids)).toBe(false);
    expect(isPrivateSession({ session_id: "c", name: null }, ids)).toBe(false);
  });

  it("drops private sessions from the state snapshot only", () => {
    const state = { projects: [1], sessions: [
      { session_id: "a", name: "notes 9/25" },
      { session_id: "listed-id", name: "x" },
      { session_id: "keep", name: "DezLin social app" },
    ] };
    const out = stripPrivateState(state, ids);
    expect(out.sessions.map((s) => s.session_id)).toEqual(["keep"]);
    expect(out.projects).toEqual([1]);
    expect(state.sessions).toHaveLength(3); // input untouched
  });

  it("drops private tails by id or by remembered name", () => {
    const tails = { sessions: { a: 1, "listed-id": 2, keep: 3 }, generatedAt: 5 };
    const names = new Map([["a", "Notes"], ["keep", "Hopnoso"]]);
    expect(Object.keys(stripPrivateTails(tails, ids, names).sessions)).toEqual(["keep"]);
  });
});
