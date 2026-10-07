# Security & QA review — findings report

Scope: the whole application in this repository — the public site (`src/`),
the Express + SQLite API (`server/`), the shared validation layer (`shared/`)
and the owner/admin dashboard (`src/admin/`). Review, hardening and regression
tests were done offline against **local throwaway databases** only; no
production data, credentials or external hosts were touched, and no existing
control was weakened to make a test pass.

Run everything with:

```bash
npm ci
npm run test:all        # 90 tests: api 19 + security 35 + site 23 + layout 6
npm run test:api        # in-process API suite (no servers needed)
npm run test:security   # in-process attack suite  (no servers needed)
npm run test:layout     # starts its own API + Vite on :3001/:5173
```

## Results

| Suite          | Tests  | Result    | Notes                                                          |
| -------------- | ------ | --------- | -------------------------------------------------------------- |
| `api`          | 19     | 19/19     | health, content, requests, idempotency, uploads, limits, roles |
| `security`     | 35     | 35/35     | modules A–H + the audit trail (details in `SECURITY.md`)       |
| `site`         | 23     | 23/23     | public site, theming, milk wave, availability, WhatsApp links  |
| `layout`       | 6      | 6/6       | 13 viewports × 2 themes, site + every dashboard screen         |
| **`test:all`** | **90** | **90/90** | `# pass 90 / # fail 0`, duration ≈ 23 min                      |

The layout suite is _one test per screen group_, and each of those six tests
walks 13 viewports in both themes, so the effective coverage is 26+ full passes
per test (300+ rendered layouts), which is why it dominates the run time.

## Findings

Severity: **critical** = remote compromise without credentials · **high** =
privilege escalation, data loss or credential theft · **medium** = abuse,
information leak or a real availability impact · **low** = hardening / polish.
Status: `fixed` (code changed, regression test added) · `accepted` (documented
risk, no code change) · `decision` (needs the owner's call).

### Security

| ID   | Sev    | File                                    | Impact                                                                                                                                         | Fix / status                                                                                                                                                                                                                  |
| ---- | ------ | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S-01 | high   | `server/app.ts:568`                     | No throttle on password guessing: unlimited offline-speed brute force against the dashboard login.                                             | Per-account exponential backoff (5 failures → 15 s doubling to 15 min, 1 h decay) returning `429` + `Retry-After`; reset on success. **fixed**                                                                                |
| S-02 | high   | `server/app.ts:661`                     | The security answer could be brute-forced just as freely as the password.                                                                      | Same backoff keyed on the pending session; the answer is never echoed back. **fixed**                                                                                                                                         |
| S-03 | medium | `server/app.ts:568`                     | Login responses leaked whether an account exists (different text/status/timing).                                                               | Identical response for unknown and known identifiers plus a memoised dummy hash so the work is the same. **fixed**                                                                                                            |
| S-04 | high   | `server/uploads.ts:59`                  | A valid GIF/JPEG with `<script>`/`<?php`/`onerror=` appended could be stored (polyglot).                                                       | The scanner now reads the whole buffer for markup markers, not just the header, and refuses the file. **fixed** (deeper fix: re-encode with `sharp` — see D-01)                                                               |
| S-05 | high   | `shared/content.ts:44`                  | `//evil.example.com` passed the same-origin path rule, so a logo/link field could point off-site while looking local.                          | Rule is now `^\/(?!\/)[^\s]*$`. **fixed**                                                                                                                                                                                     |
| S-06 | high   | `server/index.ts:33`                    | `TRUST_PROXY_HOPS` defaulted to trusting one proxy hop, so a client-supplied `X-Forwarded-For` could spoof its IP and evade the per-IP limits. | Default `0` with an explicit warning in production when the value is raised. **fixed**                                                                                                                                        |
| S-07 | medium | `server/app.ts` (was `ALLOWED_ORIGINS`) | A configurable CORS allow-list is an easy way to accidentally open the API to another origin.                                                  | Removed entirely: the API is same-origin only (own guard, `origin.rejected` audited). **fixed**                                                                                                                               |
| S-08 | medium | `server/app.ts:406`                     | Idempotency keys were global: reusing a key with a different body silently returned the first record.                                          | Keys are bound to a payload hash; a mismatch is `409 request-key-conflict`. **fixed**                                                                                                                                         |
| S-09 | medium | `shared/passwords.ts:43`                | The password policy accepted weak, repeated and account-derived passwords.                                                                     | ≥12 squashed characters, common-word list, single-repeat/straight-run and doubled-word rules, identifier equality and substring checks on every password write. **fixed**                                                     |
| S-10 | medium | `server/db.ts:244`                      | The data directory and SQLite files were created with the process umask (world-readable on many hosts).                                        | `0700` directory, `0600` for the DB, WAL, SHM and the setup token, re-applied on every open. **fixed**                                                                                                                        |
| S-11 | low    | `server/db.ts:576`                      | `updateAdmin` copied arbitrary patch keys, so an unknown field could reach the SQL layer.                                                      | Explicit `UPDATABLE` allow-list. **fixed**                                                                                                                                                                                    |
| S-12 | medium | `server/app.ts:325`                     | SSE connections were unlimited per client (a cheap way to exhaust sockets/memory).                                                             | Per-IP cap of 6, global cap of 200, 25 s heartbeat, slot released on close/error/finish. **fixed**                                                                                                                            |
| S-13 | low    | `server/app.ts:111`                     | CSP allowed images from _any_ host over http as well as https.                                                                                 | Any `https:` image host (or exactly `ALLOWED_IMAGE_HOSTS` when set), validated on every save; `img-src` and the validator now agree. **fixed**                                                                                |
| S-14 | low    | `server/app.ts`                         | Deep field validation was missing on some save paths (a logo/avatar/event image could carry a bogus URL).                                      | `IMAGE_FIELD`/`imageHostsOk` deep scan on every content, product, event, profile and admin save. **fixed**                                                                                                                    |
| S-15 | medium | `server/app.ts`                         | Errors from the JSON parser, zod and SQLite could surface as HTML/stack traces.                                                                | Single JSON error handler: `413 payload-too-large`, `400 invalid-json`, generic `500` with no internals. **fixed**                                                                                                            |
| S-16 | low    | `server/auth.ts`                        | `safeEqual` returns early when lengths differ.                                                                                                 | Session tokens are fixed-length, so nothing leaks in practice; constant-time comparison for unequal lengths is tracked. **accepted**                                                                                          |
| S-17 | low    | `server/db.ts`                          | No audit trail: role changes, content edits and blocked requests left no trace.                                                                | Append-only `audit_log` (logins, role/admin changes, content and product events, uploads, rate-limit hits, blocked CSRF/origin) with an owner-only view and a suspicious-activity count; secrets are never written. **fixed** |
| S-18 | low    | `server/auth.ts`                        | Expired sessions are only purged when sessions are touched.                                                                                    | No unbounded growth, but a scheduled purge would be tidier. **accepted**                                                                                                                                                      |
| S-19 | low    | `server/uploads.ts:9`                   | Magic bytes validate the header only; junk appended after a real header is stored.                                                             | Stored outside the app tree with a random name, served `nosniff` + image content type, so it cannot execute in a browser. **accepted** (see D-01)                                                                             |
| S-20 | low    | `server/guard.ts` (request keys)        | `newRequestKey` falls back to `Math.random`.                                                                                                   | The main path is `crypto.randomUUID()`; the fallback only matters on runtimes without it. **accepted**                                                                                                                        |
| S-21 | low    | `server/app.ts`                         | Rate limits and backoff counters live in process memory.                                                                                       | Correct for the intended single-process deployment; a shared store is needed only if the app is scaled out. **accepted**                                                                                                      |
| S-22 | low    | `index.html:37`                         | Fonts are loaded from `fonts.googleapis.com`; the CSP allows that origin only.                                                                 | Offline builds fall back to system fonts; self-hosting the two families would remove the third-party request. **decision**                                                                                                    |

### Layout / front-end

| ID   | Sev    | File                                   | Impact                                                                                                                                                    | Fix / status                                                                                                                                                                           |
| ---- | ------ | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| L-01 | medium | `src/admin/admin.css:1639`             | The content panel's image field overflowed its grid track between 1024 px and 1440 px (the "upload from device" button pushed the page 5 px wide).        | The field is now a container-query container that collapses to one column when its own box is narrow, and grid/flex children may shrink (`min-width: 0`, `max-width: 100%`). **fixed** |
| L-02 | low    | `src/admin/admin.css:2652`             | The audit log's الكل / المريبة فقط switch had no styles at all (unstyled native buttons, 24 px tall).                                                     | Styled as a segmented control matching the dashboard filters. **fixed**                                                                                                                |
| L-03 | low    | `src/admin/admin.css`, `src/index.css` | Several controls were below the 44 px touch target (dashboard buttons 43 px, ghost/icon buttons 22×22, segmented filters 31×24, site header brand 43 px). | 44 px minimum for buttons/ghost/segmented/icon controls on phones, ≥32 px on wider touch screens, 44 px tap area for the header brand and nav items. **fixed**                         |
| L-04 | low    | `src/admin/admin.css:317`              | Long display names, e-mails and numbers could widen the top bar instead of ellipsizing.                                                                   | `min-width: 0` + ellipsis on the profile chip, stat pills and top-bar labels. **fixed**                                                                                                |
| L-05 | low    | `src/index.css:658`                    | The decorative hero orbits are wider than a phone screen.                                                                                                 | Clipped by their `overflow: hidden` parent by design; the layout suite treats ancestor-clipped decoration as intentional. **accepted**                                                 |
| L-06 | low    | `src/index.css:451`                    | The WhatsApp tooltip is hover-only, so touch users never see it.                                                                                          | The link keeps a full `aria-label`; the floating button is self-explanatory. **accepted**                                                                                              |
| L-07 | low    | `src/index.css`                        | Fixed pixel sizes and `100vw` remain in a few decorative rules (orbits, lightbox, loader).                                                                | They are viewport-independent decorations, not layout containers; the suite proves they never cause page overflow at any tested size. **accepted**                                     |

## Coverage of the requested audit items

Everything on the checklist was turned into an executable test; nothing was
skipped or summarised away. The mapping below is the index into
`tests/security.test.mjs` (A–H + AUDIT) and `tests/layout.test.mjs`.

_Injection_ → C1 (SQL on every route/field), C2 (stored/reflected XSS, bidi),
C3 (dangerous URL schemes), C4 (oversized/mistyped/nested JSON), C5 (prototype
pollution), C6 (traversal, raw + encoded).
_Access control_ → B1–B5 (owner-only routes, IDOR/mass assignment, last owner,
anonymous `/api`, lost-update).
_Auth/session_ → A1–A9 (brute force, enumeration, answer guessing, step
skipping, fixation, cookie flags, expiry, revocation, rotation, weak passwords,
setup-token guessing/reuse).
_CSRF/CORS/CSP_ → D1–D2 (tokens, cross-session tokens, forged Origin/Referer,
cross-site forms) and H1 (helmet, CSP, nosniff, frame-ancestors,
Referrer-Policy, HSTS gating, `no-store`).
_Uploads_ → E1–E2 (renames, polyglots, magic bytes, double extensions, null
bytes, size, parallel uploads, unauthenticated/wrong-role, names, caching,
execution, content type).
_SSE abuse_ → F3 (per-IP and global caps, heartbeats, cleanup, memory growth)
and F4 (nothing private in the public stream).
_Info leaks_ → G1–G3 (hashes, generic errors, honest write failures, file
permissions) and F4.
_Unsafe defaults / config_ → H1–H3 (headers, no debug surface, no default
credentials, image-host policy) and S-06/S-07 above.
_Races_ → B5 (revisions) and F2 (idempotency).
_`npm audit`_ → 0 vulnerabilities; no secrets in the working tree or in git
history; no `innerHTML`/`eval`; every external link uses `noopener`.
_Front-end fragility_ → the layout suite plus L-01…L-07: fixed px, absolute/
fixed positioning, missing `min-width: 0`, non-wrapping flex rows, `100vw` and
hard-coded padding are all asserted against, at 320×568 through 2560×1440 plus
two landscape phones, in both themes, with long Arabic/English content, empty
states, broken images, 50+ products, large numbers and 200 % zoom.

## Untestable items (and why)

1. **Real TLS / HSTS in production.** The harness runs over plain HTTP. The
   suite asserts HSTS is _absent_ without TLS and that `Secure` gating follows
   `NODE_ENV=production`; the certificate path itself can only be checked on the
   real deployment.
2. **Proxy-level behaviour** (WAF rules, proxy body-size limits, real
   `X-Forwarded-For` chains). Only the app-side consequences are testable
   offline; `TRUST_PROXY_HOPS` is tested at 0 and 1.
3. **Multi-process / distributed rate limiting.** The limiters and backoff are
   in-process by design; a shared store (Redis) would be needed to test a
   multi-replica deployment.
4. **Disk-full (`ENOSPC`) write failures.** Simulated indirectly with a locked
   database and a failing write, which is what the "never report a false save"
   test needs; genuinely filling the test disk is destructive and not offline.
5. **Filesystem ACLs on other operating systems.** Permissions are asserted on
   Linux (`0700`/`0600`); Windows/macOS ACL semantics differ.
6. **Statistical timing side channels.** The suite compares response shapes and
   coarse timing, not sub-millisecond distributions — timing statistics are too
   flaky in a shared sandbox to be a regression test.
7. **Non-Chromium engines.** Only the bundled Chromium is available offline, so
   Firefox/Safari-specific rendering and CSP behaviours are unverified.
8. **Screen-reader and full WCAG auditing.** The suite checks programmatic
   properties (labels, roles, touch target sizes, focus traps, RTL), not real
   assistive-technology output.
9. **Third-party content integrity.** Google Fonts availability and the host of
   a pasted image URL are outside the app; the CSP and validator restrict what
   the page will load, but the remote content itself cannot be verified offline.
10. **The legacy `frontend/` tree.** It is a static prototype that the build and
    the server never use; it is intentionally outside the tested surface (see
    D-02 below).
11. **Load/soak testing at production scale.** The suite exercises hundreds of
    SSE connections and parallel uploads, not hours of production traffic.

## Decisions requested

| ID   | Question                                                                                                                               | Options                                                                                                                                                                                                |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| D-01 | Re-encode every uploaded image with `sharp` (already a dependency) so that no polyglot or junk-after-header can be stored at all?      | **A:** Re-encode (safest; adds CPU and drops EXIF/animation for GIF). **B:** Keep the current magic-byte + markup scan (no behaviour change). Recommendation: **A** once product imagery is finalised. |
| D-02 | The legacy `frontend/` prototype tree is unused by the build.                                                                          | **A:** Delete it in a follow-up commit. **B:** Keep it as a design reference. Recommendation: **A** — dead code is a liability.                                                                        |
| D-03 | Session purge on a timer instead of lazily on access?                                                                                  | **A:** Add a periodic purge (20 lines, no dependency). **B:** Leave as is (no unbounded growth). Recommendation: **A**.                                                                                |
| D-04 | Self-host the two font families instead of loading them from Google Fonts (removes the last third-party request and tightens the CSP)? | **A:** Self-host, drop `fonts.googleapis.com`/`fonts.gstatic.com` from the CSP. **B:** Keep the current external fonts.                                                                                |
