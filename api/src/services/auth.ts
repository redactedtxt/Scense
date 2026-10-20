import bcrypt from "bcryptjs";
import { jwtVerify, SignJWT } from "jose";

// Password hashing and the signed session token. Nothing here touches HTTP or the
// database, so each piece is easy to test on its own.

// bcrypt reads at most 72 bytes of a password and silently ignores the rest, so
// "a 100-character password" would really be a 72-byte one. The signup route rejects
// longer passwords instead of letting that happen quietly.
export const MAX_PASSWORD_BYTES = 72;

export function passwordBytes(password: string): number {
  return new TextEncoder().encode(password).length;
}

export function hashPassword(password: string, cost: number): Promise<string> {
  return bcrypt.hash(password, cost);
}

// Compared against when the email has no account, so a wrong email takes as long as a
// wrong password and the response time doesn't reveal which emails are registered.
// A real hash of a random string, at cost 12; nobody knows the password.
const DUMMY_HASH = "$2b$12$ONID.1PPdU6/TLBkYgbvHOS2OgBZRNnhMcQhFPpSeOlYsmNTm4qEm";

export async function verifyPassword(password: string, hash: string | null): Promise<boolean> {
  const matches = await bcrypt.compare(password, hash ?? DUMMY_HASH);
  return hash !== null && matches;
}

// The token carries only the user id (as `sub`). Name and email are read from the
// database on each /me call, so a changed display name shows up without a new token.
export async function signSession(userId: number, secret: string, days: number): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(String(userId))
    .setIssuedAt()
    .setExpirationTime(`${days}d`)
    .sign(new TextEncoder().encode(secret));
}

// The user id, or null for a missing, forged, expired, or malformed token. Only HS256
// is accepted, so a token that claims "alg: none" is rejected.
export async function readSession(token: string | undefined, secret: string): Promise<number | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), { algorithms: ["HS256"] });
    const id = Number(payload.sub);
    return Number.isInteger(id) && id > 0 ? id : null;
  } catch {
    return null;
  }
}
