// The whole "Hopping" methodology in one pure function.
//
//   1. Default:  hop to the lowest-tally project (the most neglected).
//   2. Interrupt: any project with an agent "waiting on you" preempts the
//      rotation, regardless of tally (oldest wait goes first).
//
// Pure over the in-memory array (tally already computed), so it is trivially
// testable and reusable by a future phone client.

import type { Project, RankResult } from "./types";

export function rankProjects(projects: Project[]): RankResult {
  const active = projects.filter((p) => !p.archived);

  // Interrupt tier: agents waiting on the human jump the queue. Oldest wait first.
  const waiting = active
    .filter((p) => p.status === "agent_waiting")
    .sort(
      (a, b) =>
        (a.waiting_since ?? Infinity) - (b.waiting_since ?? Infinity) ||
        a.id.localeCompare(b.id),
    );

  // Fair tier: lowest tally wins; tie-break by least-recently-touched
  // (never-touched -> 0 -> sorts first); final deterministic tie-break by id.
  const fair = active
    .filter((p) => p.status !== "agent_waiting")
    .sort(
      (a, b) =>
        a.tally - b.tally ||
        (a.last_touched_at ?? 0) - (b.last_touched_at ?? 0) ||
        a.id.localeCompare(b.id),
    );

  const ordered = [...waiting, ...fair];
  return { next: ordered[0] ?? null, ordered };
}
