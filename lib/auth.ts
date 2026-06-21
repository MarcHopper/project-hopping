// JWT helpers (jose — works in both the edge middleware and node route handlers).
// Session = a signed cookie; magic-link = a short-lived signed token.

import { SignJWT, jwtVerify, type JWTPayload } from "jose";

export const SESSION_COOKIE = "hopping_session";

function key() {
  return new TextEncoder().encode(process.env.JWT_SECRET || "dev-only-secret-change-me");
}

export async function signSession(sub: string, days = 30): Promise<string> {
  return new SignJWT({ sub })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${days}d`)
    .sign(key());
}

export async function signMagic(email: string): Promise<string> {
  return new SignJWT({ email, kind: "magic" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("15m")
    .sign(key());
}

export async function verifyToken(token: string): Promise<JWTPayload> {
  const { payload } = await jwtVerify(token, key());
  return payload;
}
