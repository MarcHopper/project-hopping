// A "cycle" is not stored — it is derived. A grid column = one pass where every
// active (non-archived) project has been touched at least once. We replay the
// append-only touch events in order and bin them into columns.
//
// Two rules, stated precisely:
//   (a) Close + open on completion: the instant the current pass contains a
//       touch for EVERY active project, that column closes and a fresh one opens.
//   (b) Close + open on repeat: if a project is touched a SECOND time before the
//       pass completed, that repeat touch is the first cell of the next column
//       (so a project never appears twice in one column).

import type { AppEvent } from "./types";

export interface Column {
  // project id -> the brief left on that touch (or "" if none).
  cells: Record<string, string>;
  complete: boolean; // every active project was touched in this pass
}

interface WorkingColumn {
  touched: Set<string>;
  cells: Record<string, string>;
}

function fresh(): WorkingColumn {
  return { touched: new Set(), cells: {} };
}

/**
 * @param touchEvents events of type "hop", in chronological order
 * @param activeIds   ids of non-archived projects
 * @returns columns left-to-right; the last one is the live (in-progress) pass
 */
export function deriveColumns(touchEvents: AppEvent[], activeIds: string[]): Column[] {
  const activeSet = new Set(activeIds);
  const columns: Column[] = [];
  let current = fresh();

  const close = (complete: boolean) => {
    columns.push({ cells: current.cells, complete });
    current = fresh();
  };

  for (const ev of touchEvents) {
    if (ev.type !== "hop") continue;
    if (!activeSet.has(ev.project_id)) continue; // ignore archived/removed projects

    // Rule (b): a repeat touch within the same pass starts the next column.
    if (current.touched.has(ev.project_id)) {
      close(false);
    }

    const brief = typeof ev.payload?.brief === "string" ? (ev.payload.brief as string) : "";
    current.touched.add(ev.project_id);
    current.cells[ev.project_id] = brief;

    // Rule (a): pass complete the moment every active project has a touch.
    if (activeIds.length > 0 && activeIds.every((id) => current.touched.has(id))) {
      close(true);
    }
  }

  // The live, in-progress column (always present so the grid has a column to fill).
  columns.push({ cells: current.cells, complete: false });
  return columns;
}
