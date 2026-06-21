import { NextResponse } from "next/server";
import nodemailer from "nodemailer";
import { signMagic } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const { email } = await req.json().catch(() => ({ email: "" }));
  const allowed = (process.env.MAGIC_EMAIL || "").toLowerCase();

  // Don't reveal whether an address is allowed — always report success.
  if (!email || !allowed || email.toLowerCase() !== allowed) {
    return NextResponse.json({ ok: true });
  }

  const token = await signMagic(email);
  const base = process.env.APP_URL || new URL(req.url).origin;
  const link = `${base}/api/auth/verify?token=${encodeURIComponent(token)}`;

  try {
    const tx = nodemailer.createTransport({
      service: "gmail",
      auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_PASS },
    });
    await tx.sendMail({
      from: `Hopping <${process.env.GMAIL_USER}>`,
      to: email,
      subject: "Your Hopping login link",
      text: `Tap to sign in to Hopping:\n${link}\n\nThis link expires in 15 minutes.`,
      html: `<p><a href="${link}">Tap to sign in to Hopping</a></p><p style="color:#888">This link expires in 15 minutes.</p>`,
    });
  } catch {
    return NextResponse.json({ ok: false, error: "email failed" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
