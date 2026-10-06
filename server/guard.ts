// Account-level brute-force protection.
//
// The per-IP rate limiter (server/app.ts) stops a single host from hammering the
// login form, but an attacker with many addresses can still grind one account —
// and the security question is a second factor worth guessing, so it needs its
// own brake. This tracker adds an exponential backoff keyed by the *identifier*
// being tried (never by whether the account exists, so it cannot be used to
// enumerate accounts).
//
// State is deliberately in memory: it is cheap, it cannot be tampered with
// through the API, and losing it on restart only makes an attacker start over.
// Nothing about the secret itself is stored — identifiers and session tokens are
// hashed before they become keys.

import { createHash } from "node:crypto";

export type BackoffOptions = {
  /** Failures allowed before the first penalty. */
  threshold?: number;
  /** First penalty, doubled after every further failure. */
  baseDelayMs?: number;
  /** Upper bound of the penalty. */
  maxDelayMs?: number;
  /** How long a failure is remembered without new activity. */
  decayMs?: number;
};

type Entry = { failures: number; blockedUntil: number; updatedAt: number };

const keyOf = (value: string) =>
  createHash("sha256").update(value).digest("base64url").slice(0, 22);

export function createBackoff({
  threshold = 5,
  baseDelayMs = 30_000,
  maxDelayMs = 15 * 60 * 1000,
  decayMs = 60 * 60 * 1000,
}: BackoffOptions = {}) {
  const entries = new Map<string, Entry>();

  const prune = (now: number) => {
    if (entries.size < 5000) return;
    for (const [key, entry] of entries) {
      if (entry.blockedUntil <= now && now - entry.updatedAt > decayMs)
        entries.delete(key);
    }
  };

  return {
    /** Milliseconds the caller must wait, or 0 when the attempt may proceed. */
    retryAfterMs(subject: string, now = Date.now()): number {
      const entry = entries.get(keyOf(subject));
      if (!entry) return 0;
      if (entry.blockedUntil <= now) {
        // Served its time: forget the history instead of punishing for ever.
        if (now - entry.updatedAt > decayMs) entries.delete(keyOf(subject));
        else if (entry.blockedUntil !== 0) entries.delete(keyOf(subject));
        return 0;
      }
      return entry.blockedUntil - now;
    },
    /** Records a failed attempt and returns the new penalty in milliseconds. */
    fail(subject: string, now = Date.now()): number {
      prune(now);
      const key = keyOf(subject);
      const entry = entries.get(key) ?? {
        failures: 0,
        blockedUntil: 0,
        updatedAt: now,
      };
      if (now - entry.updatedAt > decayMs) entry.failures = 0;
      entry.failures += 1;
      entry.updatedAt = now;
      const over = entry.failures - threshold;
      entry.blockedUntil =
        over >= 0 ? now + Math.min(maxDelayMs, baseDelayMs * 2 ** over) : 0;
      entries.set(key, entry);
      return entry.blockedUntil > now ? entry.blockedUntil - now : 0;
    },
    /** A successful sign-in clears the history for that account. */
    succeed(subject: string) {
      entries.delete(keyOf(subject));
    },
    size: () => entries.size,
  };
}

export type Backoff = ReturnType<typeof createBackoff>;
