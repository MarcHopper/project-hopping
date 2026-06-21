import { NextResponse } from "next/server";
import { listProjectRows, upsertProject, reorderProjects } from "@/lib/db";

export const dynamic = "force-dynamic";

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
  return NextResponse.json({ projects: listProjectRows() });
}

// Add a project, or reorder the whole list ({ reorder: [...ids] }).
export async function POST(req: Request) {
  let body: { id?: string; name?: string; path?: string; reorder?: string[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "bad json" }, { status: 400 });
  }

  if (Array.isArray(body.reorder)) {
    reorderProjects(body.reorder);
    return NextResponse.json({ ok: true });
  }

  if (!body.name?.trim()) {
    return NextResponse.json({ ok: false, error: "name required" }, { status: 400 });
  }

  const id = (body.id?.trim() || slugify(body.name)).toLowerCase();
  // avoid colliding with an existing id by suffixing if needed
  const existing = new Set(listProjectRows().map((p) => p.id));
  let finalId = id;
  let n = 2;
  while (existing.has(finalId)) finalId = `${id}-${n++}`;

  upsertProject({ id: finalId, name: body.name.trim(), path: body.path?.trim() ?? "" });
  return NextResponse.json({ ok: true, id: finalId });
}
