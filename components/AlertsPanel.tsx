"use client";

import type { Settings } from "@/lib/types";

type Patch = Record<string, boolean | number>;

function Switch({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-lg border px-2.5 py-1 text-xs ${
        on
          ? "border-accent/50 bg-accent/15 text-foreground"
          : "border-border bg-surface-2 text-muted hover:text-foreground"
      }`}
    >
      {label}
    </button>
  );
}

const CLASSES: { key: "interrupt" | "nudge" | "neglect"; label: string; desc: string }[] = [
  { key: "interrupt", label: "Waiting on you", desc: "a chat finished" },
  { key: "nudge", label: "Time nudge", desc: "running past its cap" },
  { key: "neglect", label: "Daily standup", desc: "morning digest" },
];

export default function AlertsPanel({
  settings,
  onNotify,
  onClose,
}: {
  settings: Settings;
  onNotify: (patch: Patch) => void;
  onClose: () => void;
}) {
  const s = settings;
  const quietOn = s.quiet_start >= 0 && s.quiet_end >= 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-2xl border border-border bg-surface p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Alerts</h2>
          <button onClick={onClose} className="text-muted hover:text-foreground">Done</button>
        </div>

        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs uppercase tracking-wider text-muted">
              <th className="pb-2 text-left font-medium">Class</th>
              <th className="pb-2 text-center font-medium">On</th>
              <th className="pb-2 text-center font-medium">→ Slack</th>
            </tr>
          </thead>
          <tbody>
            {CLASSES.map((c) => {
              const on = s[`notify_${c.key}` as keyof Settings] as boolean;
              const toSlack = s[`slack_${c.key}` as keyof Settings] as boolean;
              return (
                <tr key={c.key} className="border-t border-border">
                  <td className="py-2">
                    <div>{c.label}</div>
                    <div className="text-xs text-muted">{c.desc}</div>
                  </td>
                  <td className="py-2 text-center">
                    <Switch on={on} label={on ? "on" : "off"} onClick={() => onNotify({ [`notify_${c.key}`]: !on })} />
                  </td>
                  <td className="py-2 text-center">
                    <Switch on={toSlack} label={toSlack ? "yes" : "no"} onClick={() => onNotify({ [`slack_${c.key}`]: !toSlack })} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <div className="mt-5 space-y-3 border-t border-border pt-4">
          <label className="flex items-center justify-between gap-3">
            <span>
              Desktop-only while I&apos;m active
              <span className="block text-xs text-muted">no Slack ping when you&apos;re at the Mac</span>
            </span>
            <Switch
              on={s.active_suppress}
              label={s.active_suppress ? "on" : "off"}
              onClick={() => onNotify({ active_suppress: !s.active_suppress })}
            />
          </label>

          <div className="flex items-center justify-between gap-3">
            <span>
              Quiet hours
              <span className="block text-xs text-muted">no Slack during this window</span>
            </span>
            {quietOn ? (
              <div className="flex items-center gap-1 text-sm">
                <input
                  type="number"
                  min={0}
                  max={23}
                  value={s.quiet_start}
                  onChange={(e) => onNotify({ quiet_start: Math.max(0, Math.min(23, +e.target.value)) })}
                  className="w-14 rounded border border-border bg-background px-2 py-1"
                />
                <span className="text-muted">→</span>
                <input
                  type="number"
                  min={0}
                  max={23}
                  value={s.quiet_end}
                  onChange={(e) => onNotify({ quiet_end: Math.max(0, Math.min(23, +e.target.value)) })}
                  className="w-14 rounded border border-border bg-background px-2 py-1"
                />
                <button onClick={() => onNotify({ quiet_start: -1, quiet_end: -1 })} className="ml-1 text-xs text-muted hover:text-waiting">
                  off
                </button>
              </div>
            ) : (
              <Switch on={false} label="set 22→7" onClick={() => onNotify({ quiet_start: 22, quiet_end: 7 })} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
