// Password hashing, server-side sessions and CSRF secrets.
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { Db } from "./db.ts";

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LEN = 64;

export const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours
export const SESSION_COOKIE = "elbaz_session";

/** Salted scrypt; the plaintext password is never stored or logged. */
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const key = scryptSync(password, salt, KEY_LEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
  return [
    "scrypt",
    SCRYPT_N,
    SCRYPT_R,
    SCRYPT_P,
    salt.toString("base64"),
    key.toString("base64"),
  ].join("$");
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, n, r, p, saltB64, keyB64] = parts;
  const salt = Buffer.from(saltB64, "base64");
  const expected = Buffer.from(keyB64, "base64");
  let actual: Buffer;
  try {
    actual = scryptSync(password, salt, expected.length, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
    });
  } catch {
    return false;
  }
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** Constant-time string compare for setup tokens. */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export type SessionRow = {
  token: string;
  admin_id: number;
  csrf: string;
  expires_at: string;
};

export function createSession(db: Db, adminId: number) {
  const token = randomBytes(32).toString("base64url");
  const csrf = randomBytes(32).toString("base64url");
  const now = Date.now();
  db.raw
    .prepare(
      "INSERT INTO sessions (token, admin_id, csrf, created_at, expires_at, revoked) VALUES (?, ?, ?, ?, ?, 0)",
    )
    .run(token, adminId, csrf, new Date(now).toISOString(), new Date(now + SESSION_TTL_MS).toISOString());
  return { token, csrf, expiresAt: new Date(now + SESSION_TTL_MS).toISOString() };
}

/** Returns the session only if it exists, is unrevoked, and has not expired. */
export function readSession(db: Db, token: string | undefined): SessionRow | null {
  if (!token) return null;
  const row = db.raw
    .prepare(
      "SELECT token, admin_id, csrf, expires_at FROM sessions WHERE token = ? AND revoked = 0",
    )
    .get(token) as SessionRow | undefined;
  if (!row) return null;
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    revokeSession(db, token);
    return null;
  }
  return row;
}

export function revokeSession(db: Db, token: string) {
  db.raw.prepare("UPDATE sessions SET revoked = 1 WHERE token = ?").run(token);
}

export function purgeExpiredSessions(db: Db) {
  db.raw
    .prepare("DELETE FROM sessions WHERE expires_at <= ? OR revoked = 1")
    .run(new Date(Date.now() - SESSION_TTL_MS).toISOString());
}
