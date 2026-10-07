// Password hashing, security answers, server-side sessions and CSRF secrets.
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { Db } from "./db.ts";
import type { Role } from "../shared/content.ts";

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LEN = 64;

export const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours
export const SESSION_COOKIE = "elbaz_session";
/** How long a half-authenticated session may wait for the security answer. */
export const PENDING_TTL_MS = 10 * 60 * 1000;

/** Salted scrypt; the plaintext password is never stored or logged. */
export function hashSecret(secret: string): string {
  const salt = randomBytes(16);
  const key = scryptSync(secret, salt, KEY_LEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });
  return [
    "scrypt",
    SCRYPT_N,
    SCRYPT_R,
    SCRYPT_P,
    salt.toString("base64"),
    key.toString("base64"),
  ].join("$");
}

export function verifySecret(secret: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, n, r, p, saltB64, keyB64] = parts;
  const salt = Buffer.from(saltB64, "base64");
  const expected = Buffer.from(keyB64, "base64");
  let actual: Buffer;
  try {
    actual = scryptSync(secret, salt, expected.length, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
    });
  } catch {
    return false;
  }
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** Answers are compared case- and whitespace-insensitively, then hashed like a password. */
export const normalizeAnswer = (answer: string) =>
  answer.trim().toLowerCase().replace(/\s+/g, " ");

export const hashPassword = hashSecret;
export const verifyPassword = verifySecret;

/**
 * A real scrypt hash used when the identifier does not exist, so a missing
 * account and a wrong password cost exactly the same time. Computed once: the
 * login path should not pay for a fresh hash per failed attempt.
 */
let dummy: string | null = null;
export const dummyPasswordHash = () =>
  (dummy ??= hashSecret("dummy-comparison-value"));

/** Constant-time string compare for setup and CSRF tokens. */
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
  created_at: string;
  security_verified: number;
  ip: string;
  user_agent: string;
};

export function createSession(
  db: Db,
  adminId: number,
  options: {
    securityVerified: boolean;
    ip?: string;
    userAgent?: string;
    ttlMs?: number;
  },
) {
  const token = randomBytes(32).toString("base64url");
  const csrf = randomBytes(32).toString("base64url");
  const now = Date.now();
  const ttl = options.ttlMs ?? SESSION_TTL_MS;
  db.raw
    .prepare(
      `INSERT INTO sessions (token, admin_id, csrf, created_at, expires_at, revoked, security_verified, ip, user_agent, last_seen_at)
       VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`,
    )
    .run(
      token,
      adminId,
      csrf,
      new Date(now).toISOString(),
      new Date(now + ttl).toISOString(),
      options.securityVerified ? 1 : 0,
      options.ip ?? "",
      options.userAgent ?? "",
      new Date(now).toISOString(),
    );
  return { token, csrf, expiresAt: new Date(now + ttl).toISOString() };
}

/** Returns the session only if it exists, is unrevoked, and has not expired. */
export function readSession(
  db: Db,
  token: string | undefined,
): SessionRow | null {
  if (!token) return null;
  const row = db.raw
    .prepare(
      `SELECT token, admin_id, csrf, expires_at, created_at, security_verified, ip, user_agent
       FROM sessions WHERE token = ? AND revoked = 0`,
    )
    .get(token) as SessionRow | undefined;
  if (!row) return null;
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    revokeSession(db, token);
    return null;
  }
  return row;
}

export function markSecurityVerified(db: Db, token: string) {
  db.raw
    .prepare(
      "UPDATE sessions SET security_verified = 1, expires_at = ? WHERE token = ?",
    )
    .run(new Date(Date.now() + SESSION_TTL_MS).toISOString(), token);
}

export function revokeSession(db: Db, token: string) {
  db.raw.prepare("UPDATE sessions SET revoked = 1 WHERE token = ?").run(token);
}

/** Used after a credential change so old sessions cannot outlive it. */
export function revokeAllSessions(
  db: Db,
  adminId: number,
  exceptToken?: string,
) {
  if (exceptToken) {
    db.raw
      .prepare(
        "UPDATE sessions SET revoked = 1 WHERE admin_id = ? AND token <> ?",
      )
      .run(adminId, exceptToken);
    return;
  }
  db.raw
    .prepare("UPDATE sessions SET revoked = 1 WHERE admin_id = ?")
    .run(adminId);
}

export function purgeExpiredSessions(db: Db) {
  db.raw
    .prepare("DELETE FROM sessions WHERE expires_at <= ? OR revoked = 1")
    .run(new Date(Date.now() - SESSION_TTL_MS).toISOString());
}

export const isOwner = (role: string): boolean => role === "owner";
export const asRole = (role: string): Role =>
  role === "owner" ? "owner" : "admin";
