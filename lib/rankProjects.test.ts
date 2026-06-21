import { describe, it, expect } from "vitest";
import { rankProjects } from "./rankProjects";
import type { Project } from "./types";

const P = (o: Partial<Project>): Project => ({
  id: "x",
  name: "x",
  path: "",
  status: "idle",
  tally: 0,
  last_brief: "",
  last_touched_at: 0,
  waiting_since: null,
  archived: false,
  sort_order: 0,
  ...o,
});

describe("rankProjects", () => {
  it("lowest tally wins by default", () => {
    const r = rankProjects([P({ id: "a", tally: 3 }), P({ id: "b", tally: 1 }), P({ id: "c", tally: 2 })]);
    expect(r.next!.id).toBe("b");
  });

  it("a waiting agent preempts a lower-tally project (interrupt override)", () => {
    const r = rankProjects([
      P({ id: "a", tally: 0 }),
      P({ id: "b", tally: 9, status: "agent_waiting", waiting_since: 100 }),
    ]);
    expect(r.next!.id).toBe("b");
  });

  it("oldest wait goes first among waiters", () => {
    const r = rankProjects([
      P({ id: "new", status: "agent_waiting", waiting_since: 200 }),
      P({ id: "old", status: "agent_waiting", waiting_since: 100 }),
    ]);
    expect(r.ordered.map((p) => p.id).slice(0, 2)).toEqual(["old", "new"]);
  });

  it("tally tie broken by oldest last_touched_at", () => {
    const r = rankProjects([
      P({ id: "a", tally: 1, last_touched_at: 500 }),
      P({ id: "b", tally: 1, last_touched_at: 100 }),
    ]);
    expect(r.next!.id).toBe("b");
  });

  it("archived projects are excluded", () => {
    const r = rankProjects([P({ id: "a", tally: 0, archived: true }), P({ id: "b", tally: 5 })]);
    expect(r.next!.id).toBe("b");
  });

  it("waiters precede the fair tier even when the fair tier has tally 0", () => {
    const r = rankProjects([
      P({ id: "fair0", tally: 0 }),
      P({ id: "fair1", tally: 1 }),
      P({ id: "wait", tally: 50, status: "agent_waiting", waiting_since: 10 }),
    ]);
    expect(r.ordered.map((p) => p.id)).toEqual(["wait", "fair0", "fair1"]);
  });

  it("empty input returns null next", () => {
    expect(rankProjects([]).next).toBeNull();
  });
});
