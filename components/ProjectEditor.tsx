"use client";

import { useState } from "react";
import type { Project } from "@/lib/types";

async function api(url: string, method: string, body?: unknown) {
  await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
}

export default function ProjectEditor({
  projects,
  onClose,
  onChanged,
}: {
  projects: Project[];
  onClose: () => void;
  onChanged: () => void | Promise<void>;
}) {
  const [newName, setNewName] = useState("");
  const [newPath, setNewPath] = useState("");
  const [busy, setBusy] = useState(false);

  const ordered = [...projects].sort((a, b) => a.sort_order - b.sort_order);

  async function refresh() {
    await onChanged();
  }

  async function add() {
    if (!newName.trim()) return;
    setBusy(true);
    await api("/api/projects", "POST", { name: newName.trim(), path: newPath.trim() });
    setNewName("");
    setNewPath("");
    await refresh();
    setBusy(false);
  }

  async function patch(id: string, body: unknown) {
    await api(`/api/projects/${id}`, "PATCH", body);
    await refresh();
  }

  async function remove(p: Project) {
    if (!confirm(`Delete "${p.name}" and its history? This cannot be undone.`)) return;
    await api(`/api/projects/${p.id}`, "DELETE");
    await refresh();
  }

  async function move(index: number, dir: -1 | 1) {
    const ids = ordered.map((p) => p.id);
    const j = index + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[index], ids[j]] = [ids[j], ids[index]];
    await api("/api/projects", "POST", { reorder: ids });
    await refresh();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="my-6 w-full max-w-2xl rounded-2xl border border-border bg-surface p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Projects</h2>
          <button onClick={onClose} className="text-muted hover:text-foreground">
            Done
          </button>
        </div>

        {/* add new */}
        <div className="mb-4 rounded-xl border border-border bg-surface-2 p-3">
          <div className="grid gap-2 sm:grid-cols-[1fr_1.4fr_auto]">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Project name"
              className="rounded-lg border border-border bg-background px-3 py-2 outline-none focus:border-accent"
            />
            <input
              value={newPath}
              onChange={(e) => setNewPath(e.target.value)}
              placeholder="/Users/hop/folder (optional, used to auto-map agents)"
              className="rounded-lg border border-border bg-background px-3 py-2 outline-none focus:border-accent"
            />
            <button
              onClick={add}
              disabled={busy || !newName.trim()}
              className="rounded-lg bg-accent px-4 py-2 font-semibold text-black disabled:opacity-40"
            >
              Add
            </button>
          </div>
        </div>

        {/* list */}
        <ul className="space-y-2">
          {ordered.map((p, i) => (
            <li
              key={p.id}
              className={`rounded-xl border border-border p-3 ${
                p.archived ? "opacity-50" : "bg-surface-2"
              }`}
            >
              <div className="grid gap-2 sm:grid-cols-[1fr_1.4fr_auto] sm:items-center">
                <input
                  defaultValue={p.name}
                  onBlur={(e) => {
                    const v = e.target.value.trim();
                    if (v && v !== p.name) patch(p.id, { name: v });
                  }}
                  className="rounded-lg border border-border bg-background px-3 py-1.5 outline-none focus:border-accent"
                />
                <input
                  defaultValue={p.path}
                  placeholder="(no folder)"
                  onBlur={(e) => {
                    const v = e.target.value.trim();
                    if (v !== p.path) patch(p.id, { name: p.name, path: v });
                  }}
                  className="rounded-lg border border-border bg-background px-3 py-1.5 font-mono text-xs outline-none focus:border-accent"
                />
                <div className="flex items-center gap-1 justify-end text-muted">
                  <button title="Move up" onClick={() => move(i, -1)} className="px-1.5 hover:text-foreground">
                    ↑
                  </button>
                  <button title="Move down" onClick={() => move(i, 1)} className="px-1.5 hover:text-foreground">
                    ↓
                  </button>
                  <button
                    onClick={() => patch(p.id, { archived: !p.archived })}
                    className="rounded-md border border-border px-2 py-0.5 text-xs hover:text-foreground"
                  >
                    {p.archived ? "Unarchive" : "Archive"}
                  </button>
                  {p.id !== "unmapped" && (
                    <button
                      onClick={() => remove(p)}
                      className="rounded-md border border-border px-2 py-0.5 text-xs hover:text-waiting"
                    >
                      Delete
                    </button>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
