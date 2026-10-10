# البان إلباظ — Elban Elbaz

موقع تعريفي عربي (RTL) لشركة البان إلباظ: تصنيع وتعبئة وتغليف الألبان والأجبان والعسل
الطبيعي وزيت الزيتون والمكسرات — مع لوحة تحكم محمية وخادم يحفظ طلبات الجملة.

Arabic RTL marketing site for Elban Elbaz (dairy, cheese, honey, olive oil, nuts) with a
protected admin dashboard, persistent SQLite storage and a real backend for wholesale
requests.

---

## 1. Requirements

| Requirement | Why |
| --- | --- |
| **Node.js >= 22.13.0** | The database uses the built-in `node:sqlite` module — no native build step, no `better-sqlite3`. |
| npm >= 10 | Lockfile is npm-generated. |
| A **persistent disk** in production | SQLite file + WAL live on disk. |

The server is written in TypeScript and runs directly on Node's built-in type stripping, so
there is no server build step. `npm run build` type-checks everything (`tsc -b`) and produces
the static frontend in `dist/`.

```bash
npm ci
```

---

## 2. Running it

### Development (two servers)

```bash
cp .env.example .env      # optional
npm run dev
```

* **API + backend** — <http://localhost:3001>
* **Vite dev server** — <http://localhost:5173> ← open this one

`npm run dev` starts both (`scripts/dev.mjs`). The browser only ever calls relative
`/api/...` URLs; Vite proxies them to Express, so cookies stay same-origin.

Individual processes: `npm run dev:api` and `npm run dev:web`.

### Production

```bash
npm ci
npm run build
NODE_ENV=production npm start      # serves dist/ and /api on PORT (default 3001)
```

Express serves the built frontend, the SPA fallback (`/` and `/admin`) and the JSON API from
one process. Put it behind HTTPS (nginx, Caddy, Cloudflare, a PaaS router…).

> **Static hosting is not enough.** This app needs a long-running Node process and a
> writable disk. Netlify/Vercel static deploys, GitHub Pages and plain shared hosting cannot
> serve this backend or keep the database.

---

## 3. Environment variables

See `.env.example`.

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `3001` | Port the Express server listens on. |
| `DATA_DIR` | `.data` | Directory holding `elbaz.sqlite` and the one-time `setup-token`. **Private.** |
| `TRUST_PROXY_HOPS` | `1` | Number of reverse proxies in front of the app. Keep at `1` behind one proxy; set `0` when directly exposed, otherwise per-IP rate limits can be spoofed via `X-Forwarded-For`. |
| `ALLOWED_ORIGINS` | *(empty)* | Extra comma-separated origins allowed to make mutating requests. Same-origin is always allowed, so a single-domain deploy needs nothing here. |

`.env` is git-ignored and must never be committed. Real environment variables always win over
the file.

---

## 4. First admin setup

There is **no default username or password**, and no seeded account.

1. Start the server. On first run it creates `.data/setup-token` — a random **64-character**
   one-time token written with `0600` permissions.
2. Read it on the server:
   ```bash
   cat .data/setup-token
   ```
3. Open `/admin` and fill in the token, a username and a password (**minimum 12 characters**).
4. The token file is **deleted immediately** after the first administrator is created, and
   setup is permanently disabled.

The token is never exposed over HTTP, never logged and never sent to the browser except when
the operator types it into the setup form. If you lose it, restore the file before an admin
exists; afterwards, setup cannot be repeated — create additional admins directly in SQLite if
you ever need to.

**No email password recovery, no multi-role system.** Keep the password somewhere safe.

---

## 5. Admin dashboard (`/admin`)

Arabic RTL, protected, themed with the same light/dark toggle as the site.

**Wholesale Requests** — search by name / phone / product, filter by status
(`جديد`, `تم التواصل`, `مؤكد`, `مؤرشف`), paginate, change status, delete permanently.

**Products** — add, edit, delete; category, description (short + long), weight/size,
accent colour, image URL, WebP URL and fallback URL. **No uploads:** use a hosted HTTPS URL
or a file under `public/images/`.

**Site Content** — business and contact details, logo, WhatsApp number, hero slides
(add / reorder / remove), all copy strings, about chips, categories, order units, product
catalogue, section labels, statistics, gallery, reviews, FAQs, "why us" cards, SEO title and
description, and the content-status flags.

Every save is revision-checked: if another admin published first, the dashboard shows a
conflict banner with the newer revision instead of silently overwriting it. Collection editing
supports add, reorder (up/down) and remove.

---

## 6. Content model

* `src/data.ts` is the **owner-editable seed**. It is compiled into `DEFAULT_CONTENT`
  (`shared/content.ts`) and inserted **once**, when the database is created.
* After that, **the database is the source of truth**. Editing `src/data.ts` later does *not*
  overwrite published content — it only affects brand-new databases.
* Public content is served from `GET /api/content` (with a `revision` field).
* `GET /api/health` returns a liveness probe.
* The public site loads content on boot and refreshes when the visitor returns to a visible
  tab. The admin dashboard deliberately does **not** auto-refresh, so an editor's draft is
  never replaced under them.
* **Published content always wins.** The last document the browser loaded successfully is
  kept in `localStorage` (`src/content/contentCache.ts`) and rendered again on the next
  visit, so a repeat visitor never sees the bundled demo content flash. The bundled
  defaults are only ever shown to a browser that has never loaded the site before *and*
  cannot reach the API — and in that case the site says so.
* **A failed refresh never downgrades the page.** An error, a timeout
  (`REQUEST_TIMEOUT_MS`, 12 s), a 429, a truncated body, an empty document or an older
  `revision` are all rejected: the current content stays on screen, a small notice appears
  with a *إعادة المحاولة* button, and a bounded backoff (`RETRY_DELAYS_MS` — 2 s, 4 s, 8 s,
  16 s, then 30 s, stopping on the first success) retries in the background. Refreshes are
  single-flight, so the boot request, a tab focus and a retry share one call.
* If storage is unreadable the API answers `503 content-unavailable` (never the bundled
  defaults), so a damaged database can be repaired without visitors seeing demo data.

### Authenticity of photos and reviews

Products carry `imageAuthenticity` and reviews carry `authenticity`, each one of
`unspecified` / `genuine` / `illustrative` (`shared/content.ts`). The admin sets them in
plain Arabic from **المنتجات** (صورة المنتج → *هل الصورة حقيقية؟*) and from **المحتوى →
الآراء والأسئلة** (*نوع الرأي*).

* `genuine` → no disclaimer. `illustrative` → the disclaimer is shown.
* `unspecified` (every document written before this field existed) falls back to the old
  global switches — `contentStatus.placeholderProductIds` and
  `contentStatus.testimonialsArePlaceholders` — so existing content keeps rendering exactly
  as it did. Nothing is bulk-marked genuine, and a rating never affects authenticity: a
  genuine 1.5/5 complaint stays genuine.

---

## 7. Wholesale requests

The public form submits to `POST /api/wholesale-requests` and is validated on **both** the
client (Zod via `shared/content.ts`) and the server.

Required: valid name, a valid contact number, a positive quantity, a selected product/unit,
and explicit consent to store the data. Rejected: invalid quantity, missing consent, filled
honeypot, malformed payload, oversized body.

* **Idempotency** — each submission carries a `requestKey` (`uuid`). Re-sending the same key
  returns the existing record instead of creating a duplicate.
* **Rate limiting** — per-IP limits on writes and on login.
* **Honest failure** — if persistence fails, the visitor sees an error. The site never
  pretends an order was saved.
* **WhatsApp stays separate** — it is an explicit button next to the form. Opening it neither
  sends a message automatically nor claims the order was confirmed. No payment processing.

---

## 8. Theme (light / dark)

* First visit follows the system preference (`prefers-color-scheme`).
* An explicit choice is stored in `localStorage` under **`elbaz-theme`**.
* `public/theme-init.js` is a same-origin, non-deferred `<head>` script that sets
  `document.documentElement.dataset.theme` and `style.colorScheme` **before the first paint** —
  no flash of the wrong theme.
* If `localStorage` is unavailable (private mode, blocked storage), everything still works;
  only persistence is lost.
* The toggle prefers the **View Transitions API**, with a circular reveal originating from the
  toggle button. Browsers without it fall back to a short colour transition. Under
  `prefers-reduced-motion: reduce` the switch is instant, and repeat clicks are ignored while a
  transition is running.
* Surfaces, text, borders, cards, inputs, menus, dialogs and admin UI all read from semantic
  tokens, so both themes share one code path.
* **Brand identity is preserved in dark mode** — blue, cream and gold accents stay, and product
  photography keeps its original colours (no filters).

---

## 9. Milk-wave section transition

The site's single-page section navigation is unchanged (`useSectionNav` owns the current
section). The transition overlay (`src/components/MilkWave.tsx`) is pure **CSS + SVG** — no
Three.js, no GSAP.

* Three offset milk sheets with different phases, broad curved leading edges, a trailing
  highlight band, rounded shoulders and merging droplets.
* Directional: the overlay is rotated for upward navigation, so the curved edge always leads.
* Section content only swaps while the opaque part of the milk covers the viewport.
* Navigation goes `inert` for the duration, and conflicting section changes are dropped.
* The overlay clears completely in both directions.
* `prefers-reduced-motion` drops the sheets for a short simplified fade.

Design inspiration for layered motion and restrained lighting came from
[blendi-remade/dioramas](https://github.com/blendi-remade/dioramas). **No code, assets or
implementation were copied, and no 3D/WebGL layer was added.**

---

## 10. Security

* Helmet security headers + a strict Content-Security-Policy.
* Rate limits on API reads, writes and login.
* Zod schemas on every mutating endpoint.
* Parameterised SQL everywhere (no string-built queries).
* **scrypt** password hashing with a per-user salt; passwords are never stored or logged in
  plaintext.
* Timing-safe comparisons for the setup token and CSRF tokens.
* `HttpOnly`, `SameSite=Strict` session cookies, `Secure` in production, **8-hour** expiry,
  server-side session storage and server-side revocation on logout.
* CSRF token required on every admin mutation, plus an origin check that rejects unlisted
  `Origin` headers on writes.
* Safe URL validation: only `http(s)`, protocol-relative and same-origin absolute paths —
  `javascript:` and `data:` URLs are rejected.
* `.data/`, `.env`, `server/`, `shared/`, `package-lock.json` and `*.sqlite*` are blocked by
  both the Express app and the Vite dev server. They are never served.
* In production the page cannot be framed (`frame-ancestors 'none'` + `X-Frame-Options: DENY`);
  outside production framing is allowed so hosted previews keep working.

**HTTPS is required in production** — session cookies are marked `Secure`, so login silently
fails over plain HTTP. Terminate TLS at your proxy or platform.

---

## 11. Data, backups and retention

Everything persistent lives in `DATA_DIR`:

```
.data/
├── elbaz.sqlite        # content, admins, sessions, wholesale requests
├── elbaz.sqlite-wal    # write-ahead log
├── elbaz.sqlite-shm
└── setup-token         # exists only before the first admin is created
```

* **Back up** the whole directory, or use `sqlite3 .data/elbaz.sqlite ".backup backup.sqlite"`.
  Copying only the `.sqlite` file while the server is running can miss committed WAL data.
* **Never commit** `.data/`, SQLite files, `.env` or real customer records. They are all in
  `.gitignore`.
* Wholesale requests contain personal data (name, phone). Keep the disk private, restrict
  access, and delete records you no longer need from the dashboard. Data is stored only to
  contact the customer about their order — the form says so, and consent is required and
  enforced server-side.

---

## 12. Tests

All suites use temporary databases in the OS temp directory. **Real site data is never
touched.** The browser suites need the API on `:3001` and the dev server on `:5173`; the
runner starts both for you.

```bash
npm run build        # type-check + production build
npm run test:api     # backend + security (no browser needed)
npm test             # browser / layout / theme / transition
npm run test:admin   # admin dashboard integration
npm run test:all     # everything
npm run test:capture # optional: screenshots into .playwright/ (needs a running dev server)
```

Coverage highlights:

* **API** — content + health, private-file blocking, persistence, idempotency, payload
  rejection, cross-origin rejection, first-run setup (wrong token, short password, token
  deletion, no repeat, hashed password), session protection, CSRF, revoked sessions, URL-scheme
  rejection, seed-once semantics, revision conflicts, headers.
* **Content availability** — the public read is revalidated (`no-cache, must-revalidate`)
  and never served stale, a restart on an existing database re-seeds nothing, unreadable
  storage answers `503` instead of demo content, documents written before the authenticity
  fields existed still load, and the public read keeps its own rate-limit budget.
* **Authenticity** — explicit flags win over the legacy lists, a recycled product id cannot
  inherit a deleted product's "illustrative" label, genuine photos and genuine reviews
  (including a 1.5/5 one) carry no disclaimer, and legacy documents keep their old labels.
* **Browser** — five viewports (360×640, 390×844, 768×1024, 1440×900, 844×390 landscape), no
  horizontal overflow, bottom utility dock, 44px touch targets, carousel, filtering, gallery,
  FAQ, dialogs, focus trap, section navigation, the wholesale form, light/dark theming
  (system preference, persistence, private mode, no-flash, reduced motion, hit size, brand
  preservation), the milk wave in both directions, and dev-server privacy.
* **Admin** — first-run setup, login/logout, protected endpoints, request search, status change,
  deletion, product create/edit/delete, content publishing, revision conflicts.

---

## 13. Project structure

```
index.html               # early /theme-init.js + SEO metadata
public/                  # theme-init.js, favicon, apple-touch-icon, robots.txt, sitemap.xml, images/
shared/content.ts        # Zod schemas, DEFAULT_CONTENT seed, shared types
server/
  index.ts               # entry point (env, listen, shutdown)
  app.ts                 # Express app: API, security, static hosting
  db.ts                  # node:sqlite schema, content + requests + admins
  auth.ts                # scrypt hashing, sessions, CSRF secrets
scripts/
  dev.mjs                # API + Vite together
  test.mjs               # isolated test runner
src/
  data.ts                # OWNER-EDITABLE SEED CONTENT
  theme/theme.ts         # theme state, persistence, View Transitions
  content/ContentContext.tsx
  lib/api.ts             # /api client
  components/            # public site (Hero, Products, MilkWave, ThemeToggle, Contact…)
  admin/                 # AdminApp, RequestsPanel, ProductsPanel, ContentPanel, admin.css
tests/                   # api, site, admin, browser launcher, capture
```

---

## 14. SEO / metadata

`index.html` carries the title, description, canonical, Open Graph tags, JSON-LD `Organization`
data, favicon and Apple touch icon. `public/robots.txt` and `public/sitemap.xml` are in place.
The SEO title and description are also editable from the dashboard and are applied to the live
document.

---

## 15. Owner TODO placeholders

These are **not** verified production content. Replace them before launch:

* `YOUR-DOMAIN` in `index.html` (canonical + `og:url`), `src/data.ts` (`SITE.domain`),
  `public/robots.txt`, `public/sitemap.xml`.
* Official logo (`LOGO_URL` is empty, so the built-in text mark is used) and a real 1200×630
  Open Graph image (currently a Catbox URL).
* Company address and map link (`ADDRESS_TEXT` / `MAPS_URL` are empty and stay hidden).
* The second phone number still repeats the first.
* Products **5–9** reuse other products' photos. Local `.webp` packaging shots in
  `public/images/` are AI-generated illustrations, not official photography. Some product
  images are hosted on Catbox (`files.catbox.moe`).
* Statistics, reviews and gallery images are placeholders. The on-screen "illustrative"
  notices stay visible until each product photo and each review is classified in the
  dashboard (or the old global switches are turned off). Items the owner has not classified
  yet are listed in **المحتوى → حالة المحتوى**, so nothing is silently presented as genuine.
* All FAQs, policies, quality claims, delivery and payment terms need owner confirmation.

---

Powered by [mgn eg](https://www.facebook.com/mgndigital).
