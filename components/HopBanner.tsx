"use client";

import type { Project } from "@/lib/types";

export default function HopBanner({
  next,
  waitingCount,
  onPick,
}: {
  next: Project | null;
  waitingCount: number;
  onPick: (p: Project) => void;
}) {
  if (!next) {
    return (
      <div className="rounded-2xl border border-border bg-surface px-5 py-4 text-muted">
        No active projects yet — add some below.
      </div>
    );
  }

  const isWaiting = next.status === "agent_waiting";

  return (
    <button
      onClick={() => onPick(next)}
      className={`w-full text-left rounded-2xl px-5 py-4 transition border ${
        isWaiting
          ? "border-waiting bg-waiting/10 waiting-glow"
          : "border-accent/40 bg-accent/5 hover:bg-accent/10"
      }`}
    >
      <div className="flex items-center gap-3">
        <span className="text-2xl">{isWaiting ? "⚡" : "→"}</span>
        <div className="min-w-0">
          <div className="text-xs uppercase tracking-wider text-muted">
            {isWaiting ? "Waiting on you" : "Hop next"}
          </div>
          <div className="text-xl font-semibold truncate">
            {next.name}
            {isWaiting ? (
              <span className="text-waiting"> is waiting on you</span>
            ) : (
              <span className="text-muted font-normal"> · tally {next.tally}</span>
            )}
          </div>
        </div>
      </div>
      {waitingCount > 1 && (
        <div className="mt-1 text-xs text-waiting">
          {waitingCount} projects waiting — clear the oldest first
        </div>
      )}
    </button>
  );
}
