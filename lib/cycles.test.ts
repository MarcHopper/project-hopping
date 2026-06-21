import { describe, it, expect } from "vitest";
import { deriveColumns } from "./cycles";
import type { AppEvent } from "./types";

let seq = 0;
const hop = (project_id: string, brief = ""): AppEvent => ({
  id: ++seq,
  project_id,
  type: "hop",
  payload: brief ? { brief } : {},
  created_at: seq,
});

describe("deriveColumns", () => {
  it("touching every active project closes a column and opens a fresh one", () => {
    const cols = deriveColumns([hop("a"), hop("b")], ["a", "b"]);
    // one completed column + one empty live column
    expect(cols).toHaveLength(2);
    expect(cols[0].complete).toBe(true);
    expect(Object.keys(cols[0].cells).sort()).toEqual(["a", "b"]);
    expect(cols[1].cells).toEqual({});
  });

  it("a repeat touch before the pass completes starts the next column", () => {
    const cols = deriveColumns([hop("a"), hop("a")], ["a", "b"]);
    // first column has only a (incomplete), second column has the repeat a
    expect(cols).toHaveLength(2);
    expect(cols[0].complete).toBe(false);
    expect(Object.keys(cols[0].cells)).toEqual(["a"]);
    expect(Object.keys(cols[1].cells)).toEqual(["a"]);
  });

  it("keeps the brief on the cell", () => {
    const cols = deriveColumns([hop("a", "wired up the API")], ["a", "b"]);
    expect(cols[0].cells["a"]).toBe("wired up the API");
  });

  it("ignores touches for archived/removed projects", () => {
    const cols = deriveColumns([hop("a"), hop("gone"), hop("b")], ["a", "b"]);
    expect(cols[0].complete).toBe(true);
    expect(cols[0].cells["gone"]).toBeUndefined();
  });

  it("partial pass yields a single live column", () => {
    const cols = deriveColumns([hop("a")], ["a", "b", "c"]);
    expect(cols).toHaveLength(1);
    expect(cols[0].complete).toBe(false);
  });

  it("empty log yields one empty live column", () => {
    const cols = deriveColumns([], ["a", "b"]);
    expect(cols).toEqual([{ cells: {}, complete: false }]);
  });
});
