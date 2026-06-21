import { NextResponse } from "next/server";
import { verifyToken, signSession, SESSION_COOKIE } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("token");
  if (!token) return NextResponse.redirect(new URL("/login?e=1", req.url));
  try {
    const p = await verifyToken(token);
    if (p.kind !== "magic" || !p.email) throw new Error("bad token");
    const res = NextResponse.redirect(new URL("/", req.url));
    res.cookies.set(SESSION_COOKIE, await signSession(String(p.email)), {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });
    return res;
  } catch {
    return NextResponse.redirect(new URL("/login?e=1", req.url));
  }
}
