import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { verifyToken, SESSION_COOKIE } from "@/lib/auth";

// Gate the app ONLY on the cloud deploy (HOPPING_CLOUD + JWT_SECRET set). Local
// dev stays open so Marc's desktop grid is frictionless.
function isPublic(p: string): boolean {
  return (
    p.startsWith("/login") ||
    p.startsWith("/api/auth") ||
    p.startsWith("/api/slack") || // Slack webhooks authenticate by signature, not cookie
    p === "/manifest.json" ||
    p === "/sw.js" ||
    p.startsWith("/icon") ||
    p.startsWith("/apple-touch") ||
    p === "/favicon.ico"
  );
}

export async function middleware(req: NextRequest) {
  if (!process.env.HOPPING_CLOUD || !process.env.JWT_SECRET) return NextResponse.next();

  const { pathname } = req.nextUrl;
  if (isPublic(pathname)) return NextResponse.next();

  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (token) {
    try {
      await verifyToken(token);
      return NextResponse.next();
    } catch {
      /* fall through to login */
    }
  }

  if (pathname.startsWith("/api")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
