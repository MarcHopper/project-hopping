"use client";

import { useState } from "react";
import type { Project } from "@/lib/types";

export default function CellModal({
  project,
  onClose,
  onAction,
}: {
  project: Project;
  onClose: () => void;
  onAction: (action: "worked" | "skip", brief?: string) => void;
}) {
  const [working, setWorking] = useState(false);
  const [brief, setBrief] = useState(project.last_brief ?? "");

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-border bg-surface p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-1 text-xs uppercase tracking-wider text-muted">Hop to</div>
        <h2 className="text-xl font-semibold">{project.name}</h2>
        {project.last_brief && !working && (
          <p className="mt-2 rounded-lg bg-surface-2 px-3 py-2 text-sm text-muted">
            <span className="text-foreground/70">where you left off:</span> {project.last_brief}
          </p>
        )}

        {!working ? (
          <div className="mt-5 grid grid-cols-1 gap-2">
            <button
              onClick={() => setWorking(true)}
              className="rounded-xl bg-accent px-4 py-3 font-semibold text-black hover:brightness-110"
            >
              I worked on it
            </button>
            <button
              onClick={() => onAction("skip")}
              className="rounded-xl border border-border bg-surface-2 px-4 py-3 font-medium text-muted hover:text-foreground"
            >
              Nothing here, skip
            </button>
          </div>
        ) : (
          <div className="mt-5">
            <label className="mb-1 block text-sm text-muted">
              Where are you now? <span className="text-muted/60">(one line, optional)</span>
            </label>
            <input
              autoFocus
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") onAction("worked", brief.trim());
              }}
              placeholder="e.g. wired the hub, next: desktop notification"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 outline-none focus:border-accent"
            />
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button
                onClick={() => setWorking(false)}
                className="rounded-xl border border-border bg-surface-2 px-4 py-2.5 text-muted hover:text-foreground"
              >
                Back
              </button>
              <button
                onClick={() => onAction("worked", brief.trim())}
                className="rounded-xl bg-accent px-4 py-2.5 font-semibold text-black hover:brightness-110"
              >
                Log the hop
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
