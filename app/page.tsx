"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Project, TallyMode } from "@/lib/types";
import type { Column } from "@/lib/cycles";
import HopBanner from "@/components/HopBanner";
import Grid from "@/components/Grid";
import CellModal from "@/components/CellModal";
import SettingsBar from "@/components/SettingsBar";
import ProjectEditor from "@/components/ProjectEditor";

interface StateResponse {
  projects: Project[];
  ordered: Project[];
  next: Project | null;
  columns: Column[];
  settings: { tally_mode: TallyMode; tally_reset_at: number; windowLabel: string };
  generatedAt: number;
}

async function post(url: string, body?: unknown, method = "POST") {
  await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
}

export default function Page() {
  const [state, setState] = useState<StateResponse | null>(null);
  const [online, setOnline] = useState(true);
  const [modal, setModal] = useState<Project | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const failures = useRef(0);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/state", { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as StateResponse;
      setState(data); // only overwrite on success — keeps last-good state offline
      failures.current = 0;
      setOnline(true);
    } catch {
      failures.current += 1;
      if (failures.current >= 2) setOnline(false);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 3000);
    return () => clearInterval(id);
  }, [load]);

  async function doAction(action: "worked" | "skip", brief?: string) {
    if (!modal) return;
    const target = modal;
    setModal(null);
    await post("/api/action", { projectId: target.id, action, brief });
    await load();
  }

  async function setMode(m: TallyMode) {
    await post("/api/settings", { tally_mode: m }, "PATCH");
    await load();
  }

  async function resetTallies() {
    await post("/api/settings");
    await load();
  }

  const rows = state?.ordered ?? [];
  const waitingCount = rows.filter((p) => p.status === "agent_waiting").length;
  const hopsInWindow = (state?.projects ?? []).reduce((s, p) => s + p.tally, 0);

  return (
    <main className="mx-auto min-h-dvh max-w-5xl px-4 py-6">
      <header className="mb-4 flex items-baseline justify-between">
        <h1 className="text-2xl font-bold tracking-tight">
          Hopping<span className="text-accent">.</span>
        </h1>
        <span className={`text-xs ${online ? "text-muted" : "text-waiting"}`}>
          {online ? "live" : "offline — showing last view"}
        </span>
      </header>

      <div className="mb-4">
        <HopBanner next={state?.next ?? null} waitingCount={waitingCount} onPick={setModal} />
      </div>

      <div className="mb-3">
        <SettingsBar
          mode={state?.settings.tally_mode ?? "rolling7d"}
          windowLabel={state?.settings.windowLabel ?? ""}
          hopsInWindow={hopsInWindow}
          onMode={setMode}
          onReset={resetTallies}
          onOpenEditor={() => setEditorOpen(true)}
        />
      </div>

      {state ? (
        <Grid rows={rows} columns={state.columns} nextId={state.next?.id ?? null} onCell={setModal} />
      ) : (
        <div className="rounded-2xl border border-border bg-surface px-5 py-10 text-center text-muted">
          Loading the hop grid…
        </div>
      )}

      <p className="mt-4 text-center text-xs text-muted/70">
        Lowest tally = most neglected. An agent waiting on you jumps the queue.
      </p>

      {modal && (
        <CellModal project={modal} onClose={() => setModal(null)} onAction={doAction} />
      )}
      {editorOpen && state && (
        <ProjectEditor
          projects={state.projects}
          onClose={() => setEditorOpen(false)}
          onChanged={load}
        />
      )}
    </main>
  );
}
