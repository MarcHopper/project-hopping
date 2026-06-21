import { NextResponse } from "next/server";
import { renameProject, setArchived, setProjectPath, deleteProject } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  let body: { name?: string; path?: string; archived?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "bad json" }, { status: 400 });
  }

  if (typeof body.archived === "boolean") {
    setArchived(id, body.archived);
  }
  if (typeof body.name === "string") {
    // name (optionally with path) — renameProject handles both atomically
    renameProject(id, body.name.trim(), typeof body.path === "string" ? body.path.trim() : undefined);
  } else if (typeof body.path === "string") {
    setProjectPath(id, body.path.trim());
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  deleteProject(id);
  return NextResponse.json({ ok: true });
}
