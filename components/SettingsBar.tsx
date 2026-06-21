"use client";

import type { TallyMode } from "@/lib/types";

const MODES: { id: TallyMode; label: string }[] = [
  { id: "rolling7d", label: "7-day" },
  { id: "daily", label: "Daily" },
  { id: "weekly", label: "Weekly" },
  { id: "none", label: "All-time" },
];

export default function SettingsBar({
  mode,
  windowLabel,
  hopsInWindow,
  canEdit = true,
  onMode,
  onReset,
  onOpenAlerts,
  onOpenEditor,
}: {
  mode: TallyMode;
  windowLabel: string;
  hopsInWindow: number;
  canEdit?: boolean;
  onMode: (m: TallyMode) => void;
  onReset: () => void;
  onOpenAlerts: () => void;
  onOpenEditor: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="text-muted">
        Tally window:&nbsp;
        <span className="text-foreground">{windowLabel}</span>
      </span>
      <div className="flex overflow-hidden rounded-lg border border-border">
        {MODES.map((m) => (
          <button
            key={m.id}
            onClick={() => onMode(m.id)}
            className={`px-2.5 py-1 ${
              mode === m.id ? "bg-accent text-black" : "bg-surface-2 text-muted hover:text-foreground"
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>
      <span className="text-muted">
        · {hopsInWindow} hop{hopsInWindow === 1 ? "" : "s"} this window
      </span>

      <div className="ml-auto flex items-center gap-2">
        <button
          onClick={onOpenAlerts}
          className="rounded-lg border border-border bg-surface-2 px-2.5 py-1 text-muted hover:text-foreground"
        >
          🔔 Alerts
        </button>
        <button
          onClick={() => {
            if (confirm("Reset all tallies to zero from now? (history is kept)")) onReset();
          }}
          className="rounded-lg border border-border bg-surface-2 px-2.5 py-1 text-muted hover:text-foreground"
        >
          Reset tallies
        </button>
        {canEdit && (
          <button
            onClick={onOpenEditor}
            className="rounded-lg border border-border bg-surface-2 px-2.5 py-1 text-muted hover:text-foreground"
          >
            Edit projects
          </button>
        )}
      </div>
    </div>
  );
}
