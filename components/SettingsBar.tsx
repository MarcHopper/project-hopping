"use client";

import type { TallyMode } from "@/lib/types";

const MODES: { id: TallyMode; label: string }[] = [
  { id: "rolling7d", label: "7-day" },
  { id: "daily", label: "Daily" },
  { id: "weekly", label: "Weekly" },
  { id: "none", label: "All-time" },
];

type NotifyPatch = Partial<{
  notify_interrupt: boolean;
  notify_nudge: boolean;
  notify_neglect: boolean;
}>;

function Toggle({
  on,
  label,
  onClick,
}: {
  on: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      title={`${label} alerts ${on ? "on" : "off"}`}
      className={`rounded-lg border px-2.5 py-1 ${
        on
          ? "border-accent/50 bg-accent/15 text-foreground"
          : "border-border bg-surface-2 text-muted hover:text-foreground"
      }`}
    >
      {on ? "🔔" : "🔕"} {label}
    </button>
  );
}

export default function SettingsBar({
  mode,
  windowLabel,
  hopsInWindow,
  notifyInterrupt,
  notifyNudge,
  notifyNeglect,
  canEdit = true,
  onMode,
  onReset,
  onNotify,
  onOpenEditor,
}: {
  mode: TallyMode;
  windowLabel: string;
  hopsInWindow: number;
  notifyInterrupt: boolean;
  notifyNudge: boolean;
  notifyNeglect: boolean;
  canEdit?: boolean;
  onMode: (m: TallyMode) => void;
  onReset: () => void;
  onNotify: (patch: NotifyPatch) => void;
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

      <span className="ml-1 text-muted">· alerts:</span>
      <Toggle label="waiting" on={notifyInterrupt} onClick={() => onNotify({ notify_interrupt: !notifyInterrupt })} />
      <Toggle label="nudge" on={notifyNudge} onClick={() => onNotify({ notify_nudge: !notifyNudge })} />
      <Toggle label="neglect" on={notifyNeglect} onClick={() => onNotify({ notify_neglect: !notifyNeglect })} />

      <div className="ml-auto flex items-center gap-2">
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
