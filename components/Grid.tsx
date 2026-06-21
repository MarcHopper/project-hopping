"use client";

import type { Project, ProjectStatus } from "@/lib/types";
import type { Column } from "@/lib/cycles";

const STATUS_META: Record<ProjectStatus, { label: string; dot: string; extra?: string }> = {
  agent_waiting: { label: "waiting on you", dot: "bg-waiting", extra: "waiting-glow" },
  agent_running: { label: "agent running", dot: "bg-running", extra: "running-blink" },
  blocked: { label: "blocked", dot: "bg-blocked" },
  idle: { label: "idle", dot: "bg-muted/40" },
};

function StatusDot({ status }: { status: ProjectStatus }) {
  const m = STATUS_META[status];
  return <span className={`inline-block h-2.5 w-2.5 rounded-full ${m.dot} ${m.extra ?? ""}`} />;
}

export default function Grid({
  rows,
  columns,
  nextId,
  focusedId,
  onCell,
}: {
  rows: Project[];
  columns: Column[];
  nextId: string | null;
  focusedId: string | null;
  onCell: (p: Project) => void;
}) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-border bg-surface">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="text-muted">
            <th className="sticky left-0 z-10 bg-surface px-4 py-2 text-left font-medium">
              Project
            </th>
            {columns.map((c, i) => {
              const live = i === columns.length - 1;
              return (
                <th key={i} className="px-3 py-2 text-center font-medium whitespace-nowrap">
                  {live ? <span className="text-accent">now</span> : `#${i + 1}`}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => {
            const isWaiting = p.status === "agent_waiting";
            const isNext = p.id === nextId;
            return (
              <tr
                key={p.id}
                className={`border-t border-border ${isWaiting ? "bg-waiting/5" : ""}`}
              >
                {/* sticky project header cell — tap to act */}
                <th
                  className={`sticky left-0 z-10 px-4 py-2 text-left align-middle ${
                    isWaiting ? "bg-[#1a1410]" : "bg-surface"
                  }`}
                >
                  <button
                    onClick={() => onCell(p)}
                    className={`group flex w-full items-center gap-2 rounded-lg px-2 py-1 -mx-2 hover:bg-surface-2 ${
                      isNext ? "ring-1 ring-accent/50" : ""
                    }`}
                  >
                    <StatusDot status={p.status} />
                    <span className="flex-1 min-w-0">
                      <span className="flex items-center gap-1.5 truncate font-medium">
                        <span className="truncate">{p.name}</span>
                        {p.id === focusedId && (
                          <span className="shrink-0 rounded bg-running/20 px-1 text-[10px] font-medium text-running">
                            ● here
                          </span>
                        )}
                        {p.uncommitted > 0 && (
                          <span
                            title={`${p.uncommitted} uncommitted change(s)`}
                            className="shrink-0 rounded bg-surface-2 px-1 text-[10px] tabular-nums text-muted"
                          >
                            ●{p.uncommitted}
                          </span>
                        )}
                      </span>
                      <span className="block truncate text-xs text-muted">
                        {p.status === "idle" ? `tally ${p.tally}` : STATUS_META[p.status].label}
                        {p.last_brief
                          ? ` · ${p.last_brief}`
                          : p.last_commit
                            ? ` · ${p.last_commit}`
                            : ""}
                      </span>
                    </span>
                    <span className="rounded-md bg-surface-2 px-1.5 py-0.5 text-xs tabular-nums text-muted">
                      {p.tally}
                    </span>
                  </button>
                </th>

                {columns.map((c, i) => {
                  const live = i === columns.length - 1;
                  const touched = Object.prototype.hasOwnProperty.call(c.cells, p.id);
                  const brief = c.cells[p.id];
                  return (
                    <td
                      key={i}
                      onClick={live ? () => onCell(p) : undefined}
                      title={brief || (touched ? "hopped" : "")}
                      className={`px-3 py-2 text-center align-middle ${
                        live ? "cursor-pointer hover:bg-surface-2" : ""
                      }`}
                    >
                      {touched ? (
                        <span className="text-accent">✓</span>
                      ) : live ? (
                        <span className="text-muted/30">·</span>
                      ) : (
                        ""
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
