# Security notes

What this project protects, how, what has been verified by tests, and what is
deliberately left to the person running it. The dashboard is a **single-site
admin tool**, not a multi-tenant service: there are exactly two roles, `owner`
and `admin`, and no public sign-up.

## Threat model

| #   | Asset                      | Threat we defend against                                | Where                                                                                                                                                                                     |
| --- | -------------------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Owner/admin credentials    | Guessing, credential stuffing, offline cracking         | scrypt (N=16384, r=8, p=1, per-password salt), per-account exponential backoff, per-IP login limiter, `shared/passwords.ts` policy                                                        |
| 2   | Sessions                   | Fixation, theft, replay after logout or password change | Server-side sessions, `HttpOnly` + `SameSite=Strict` + `Secure` (prod) cookie, rotation on sign-in, revocation of all sessions on logout / password change                                |
| 3   | The setup token            | Anyone else completing the first run                    | 48-hex-char random token in `<DATA_DIR>/setup-token`, one-time, invalidated the moment the owner exists, never exposed to the site or the API                                             |
| 4   | Dashboard data & mutations | Cross-site requests, CSRF, stored XSS, SQL injection    | Same-origin guard (no `ALLOWED_ORIGINS` list), per-session CSRF token on every mutation, parameterised SQL only, React text rendering (no `innerHTML`), CSP                               |
| 5   | Public content             | Visitors being attacked through the site                | CSP `script-src 'self'`, image-host policy, `X-Content-Type-Options: nosniff`, `frame-ancestors 'none'` in production                                                                     |
| 6   | File uploads               | Web shells, polyglots, disk exhaustion                  | Magic-byte validation + markup scan, size/count limits, random `[a-f0-9]{32}` names, stored outside the served app tree, served by a dedicated read-only route with an image content type |
| 7   | Wholesale endpoint & SSE   | Flooding, idempotency abuse, stream exhaustion          | Per-IP limiters, per-account backoff, `requestKey` bound to its payload (409 on mismatch), global 200 / per-IP 6 SSE cap with heartbeats and cleanup                                      |
| 8   | Database & backups         | Data leakage from the filesystem                        | `0700` data directory, `0600` database/WAL/SHM files, no private path served by Express or Vite                                                                                           |
| 9   | Accountability             | Silent tampering                                        | Append-only `audit_log` (logins, role changes, uploads, blocked requests, rate-limit hits) with an owner-only view and 20 000-row pruning                                                 |

Out of scope by decision: payments, email password recovery, multi-role systems
beyond owner/admin, and public visitor accounts. There is nothing to recover
by e-mail, so the security question plus the printed setup token is the whole
recovery story — keep the token somewhere safe.

## What the tests prove

`npm run test:all` runs 90 tests: `api` (19), `security` (35), `site` (23) and
`layout` (6, covering 13 viewports in both themes). Every attack test asserts a
_safe failure_ — a status code, no data leak and no state change — never that
an attack "works".

- **A — authentication**: brute force is throttled per account with `Retry-After`;
  unknown and known identifiers are indistinguishable (text, status, timing);
  the security answer is throttled and never echoed; the security step cannot be
  skipped by calling endpoints directly; session fixation, cookie flags,
  expiry, revocation on logout and on password change; password/question changes
  require the current password or answer; weak and account-derived passwords are
  refused everywhere.
- **B — authorisation**: an admin gets `403` from every owner-only route and can
  change nothing; IDOR and mass assignment (`{"role":"owner"}`, extra fields) are
  ignored; the last owner cannot be demoted or deleted; owner self-deletion is
  refused; every `/api` route rejects anonymous callers; two admins editing one
  product cannot silently overwrite each other (revision check → `409`).
- **C — injection**: SQL payloads on every route/field change nothing (parameters
  are bound); stored and reflected XSS in product names, descriptions,
  announcements, display names and wholesale fields (including Arabic RTL bidi
  tricks: RLO, zero-width) comes back as inert text; `javascript:`, `data:`,
  `vbscript:`, `file:` and protocol-relative URLs are rejected in every URL
  field; oversized, mistyped, deeply nested JSON and prototype-pollution
  payloads are refused without a `500`; raw and encoded path traversal cannot
  reach `.data`, `.env`, server sources or any `*.sqlite`.
- **D — cross-site**: every mutation needs a CSRF token, tokens from another
  session never work, forged `Origin`/`Referer` and cross-site form posts are
  refused.
- **E — uploads**: renaming (`.php`, `.html`, `.svg`, `.js`), polyglots, wrong or
  truncated magic bytes, double extensions, null bytes, SVG/HTML payloads,
  over-size files and parallel floods are all rejected; only real images from
  signed-in accounts are stored, under random names, with `nosniff`, immutable
  caching for safe types and a correct `Content-Type`.
- **F — abuse**: wholesale flooding from one and many IPs is limited and
  `X-Forwarded-For` cannot dodge the limiter with the default
  `TRUST_PROXY_HOPS=0`; a reused idempotency key with a different payload is
  `409`; hundreds of SSE connections hit the per-IP and global caps, heartbeats
  continue, connections are cleaned up and memory does not grow; nothing
  private ever appears on the public API or SSE.
- **G — data integrity**: password/answer hashes never leave the server (body,
  log or error); malformed JSON, database errors and a locked/corrupted database
  produce generic errors only; a write that failed is never reported as saved;
  file permissions, backups and migration safety are checked.
- **H — configuration**: helmet/CSP, `X-Content-Type-Options`, `frame-ancestors`,
  `Referrer-Policy`, HSTS only behind TLS, `no-store` on authenticated
  responses, no debug routes, no directory listing, no default credentials, and
  safe error pages.
- **AUDIT**: the trail records the attacks above and never records a secret.
- **layout**: the public site and every dashboard screen across
  320×568 … 2560×1440 plus two landscape phones in both themes — no horizontal
  overflow, no clipping, nothing hidden behind fixed bars, no overlapping fixed
  chrome, tables/long URLs scrolling inside their own container, images inside
  their boxes, ≥44 px touch targets on phones, fitting and always-closable
  modals/drawers, long Arabic/English content, empty states, 55 products,
  200 % zoom and RTL correctness.

## Fixed during this review

- `TRUST_PROXY_HOPS` now defaults to `0`; the server warns when it is raised
  without a trusted proxy. `ALLOWED_ORIGINS` was removed in favour of a strict
  same-origin guard.
- Account-level exponential backoff for password **and** security-answer
  attempts (`429` + `Retry-After`), reset on success.
- Upload scanning now reads the whole file: images carrying `<script`, `<?php`,
  `onerror=` … are refused, not just files with a bad header.
- `//host` no longer passes as a same-origin path; image URLs must be `https:`
  (plus optional `ALLOWED_IMAGE_HOSTS`), and every save is deep-scanned.
- Idempotency keys are bound to their payload (`409 request-key-conflict`).
- Password policy: minimum 12 characters, no common/repeated/doubled words, no
  account identifier inside the password — enforced on every password write.
- SSE: per-IP cap (6) and global cap (200), slots released on close/error.
- Data directory `0700`, database/WAL/SHM `0600`, admin updates restricted to an
  allow-list of columns, generic JSON error handler.
- Audit log plus an owner-only activity view with a suspicious-activity count.
- Layout: the content panel's image field overflowed its grid track at
  1024–1440 px (now a container query + shrinkable grid children), the audit
  filter had no styling, and several controls were below the touch-target
  minimum.

## Remaining risks (accepted)

1. **Non-script junk in uploads.** Magic bytes prove the file _starts_ like an
   image; a polyglot payload appended after a valid header that does not contain
   the scanned markup markers can still be stored. It is stored outside the app
   tree with a random name, served with `X-Content-Type-Options: nosniff` and an
   image content type, so a browser will not execute it. Re-encoding every upload
   with `sharp` would remove this class of risk and is the recommended follow-up.
2. **In-memory backoff and rate limits.** A restart clears the counters, and with
   several processes each replica counts separately. Single-process deployment is
   assumed; put a reverse proxy / WAF in front if you scale out.
3. **No email or SMS second factor.** The security question is a shared secret,
   not a second channel. Choose an answer that is not discoverable from the
   business's public profile.
4. **`safeEqual` returns early on length mismatch.** Session tokens are fixed
   length, so this leaks nothing about a token's content in practice; constant
   time comparison for unequal lengths is a nice-to-have.
5. **Expired sessions are purged on access, not on a timer.** The table cannot
   grow unboundedly (rows expire and are removed when sessions are pruned), but
   a scheduled purge would be tidier.
6. **Header-only magic bytes** for formats we do not re-encode (see 1).
7. **`Math.random` fallback** in the request-key generator. The primary path uses
   `crypto.randomUUID()`; the fallback only matters on runtimes without it.

## Production checklist

1. **TLS everywhere** — set `NODE_ENV=production` so session cookies get the
   `Secure` flag and HSTS is sent. Never run the dashboard over plain HTTP.
2. **`TRUST_PROXY_HOPS`** — leave it at `0` unless the app sits behind a reverse
   proxy you control, then set it to exactly the number of proxies in front of
   it (1 for a single nginx/Caddy/Traefik hop). More hops than that lets clients
   spoof their IP and dodge the rate limits.
3. **Environment** — copy `.env.example` to `.env` and keep it out of git. Set
   `DATA_DIR` to a persistent path outside the repository, and `ALLOWED_IMAGE_HOSTS`
   if product images should only come from named hosts.
4. **First run** — start the server, open `/admin`, paste the contents of
   `<DATA_DIR>/setup-token`, pick a long unique password and a security answer
   that cannot be guessed from public information. Then **delete the token file**
   and keep a printed copy somewhere safe (it is the only account recovery path).
5. **Backups** — back up `<DATA_DIR>` (SQLite plus `uploads/`) on a schedule, and
   _test a restore_. The database runs in WAL mode: copy the `.sqlite`, `-wal`
   and `-shm` files together, or use `sqlite3 .backup`.
6. **Monitoring** — check the owner-only activity log (سجل النشاط) for the
   "suspicious only" count, and alert on repeated `ratelimit.hit` events.
7. **Dependencies** — `npm audit` is clean at the time of writing; re-run it
   before each deploy and keep Express, helmet, multer and Vite patched.
8. **Uploads** — keep the reverse proxy's request-size limit at or below 5 MB,
   and consider adding `sharp` re-encoding if untrusted users can ever upload.
