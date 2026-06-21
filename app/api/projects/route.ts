import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const CLOUD = !!process.env.HOPPING_CLOUD;

function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "project"
  );
}

export async function GET() {
  if (CLOUD) {
    const { cloudGetState } = await import("@/lib/cloud");
    const s = await cloudGetState<{ projects?: unknown[] }>();
    return NextResponse.json({ projects: s?.projects ?? [] });
  }
  const { listProjectRows } = await import("@/lib/db");
  return NextResponse.json({ projects: listProjectRows() });
}

// Add a project, or reorder the whole list ({ reorder: [...ids] }).
export async function POST(req: Request) {
  if (CLOUD) {
    return NextResponse.json({ ok: false, error: "editing projects is desktop-only" }, { status: 200 });
  }
  let body: { id?: string; name?: string; path?: string; reorder?: string[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "bad json" }, { status: 400 });
  }

  const { listProjectRows, upsertProject, reorderProjects } = await import("@/lib/db");

  if (Array.isArray(body.reorder)) {
    reorderProjects(body.reorder);
    return NextResponse.json({ ok: true });
  }

  if (!body.name?.trim()) {
    return NextResponse.json({ ok: false, error: "name required" }, { status: 400 });
  }

  const id = (body.id?.trim() || slugify(body.name)).toLowerCase();
  const existing = new Set(listProjectRows().map((p) => p.id));
  let finalId = id;
  let n = 2;
  while (existing.has(finalId)) finalId = `${id}-${n++}`;

  upsertProject({ id: finalId, name: body.name.trim(), path: body.path?.trim() ?? "" });
  return NextResponse.json({ ok: true, id: finalId });
}
