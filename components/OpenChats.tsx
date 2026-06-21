"use client";

import type { Session } from "@/lib/types";

const DOT: Record<string, string> = {
  waiting: "bg-waiting waiting-glow",
  running: "bg-running running-blink",
  ended: "bg-muted/40",
};

function ago(ms: number | null): string {
  if (!ms) return "";
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

export default function OpenChats({ sessions }: { sessions: Session[] }) {
  if (!sessions.length) return null;
  // waiting first, then most-recent activity
  const ordered = [...sessions].sort(
    (a, b) =>
      (a.status === "waiting" ? 0 : 1) - (b.status === "waiting" ? 0 : 1) ||
      (b.last_activity ?? 0) - (a.last_activity ?? 0),
  );
  const waiting = ordered.filter((s) => s.status === "waiting").length;

  return (
    <div className="rounded-2xl border border-border bg-surface">
      <div className="flex items-center justify-between px-4 py-2 text-xs uppercase tracking-wider text-muted">
        <span>Open chats · {ordered.length}</span>
        {waiting > 0 && <span className="text-waiting">{waiting} waiting on you</span>}
      </div>
      <ul className="divide-y divide-border">
        {ordered.map((s) => (
          <li key={s.session_id} className="flex items-start gap-2.5 px-4 py-2">
            <span className={`mt-1.5 inline-block h-2.5 w-2.5 shrink-0 rounded-full ${DOT[s.status] ?? ""}`} />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <span className="truncate text-sm font-medium">
                  {s.project_name ?? s.project_id}
                </span>
                <span className="truncate text-xs text-muted">
                  {s.name || s.session_id.slice(0, 8)}
                </span>
                <span className="ml-auto shrink-0 text-xs text-muted/70">{ago(s.last_activity)}</span>
              </div>
              {s.last_result && (
                <p className="truncate text-xs text-muted">{s.last_result}</p>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
