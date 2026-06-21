import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const CLOUD = !!process.env.HOPPING_CLOUD;
const desktopOnly = () =>
  NextResponse.json({ ok: false, error: "editing projects is desktop-only" }, { status: 200 });

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (CLOUD) return desktopOnly();
  const { id } = await params;
  let body: { name?: string; path?: string; archived?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "bad json" }, { status: 400 });
  }

  const { renameProject, setArchived, setProjectPath } = await import("@/lib/db");
  if (typeof body.archived === "boolean") setArchived(id, body.archived);
  if (typeof body.name === "string") {
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
  if (CLOUD) return desktopOnly();
  const { id } = await params;
  const { deleteProject } = await import("@/lib/db");
  deleteProject(id);
  return NextResponse.json({ ok: true });
}
