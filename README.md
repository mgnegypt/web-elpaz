# البان إلباظ · Elban Elbaz

Arabic-first, RTL single-page website built with React 19, TypeScript, Vite, Tailwind CSS 4 and lucide-react. No backend, animation framework, or third-party form service.

## Run

```sh
npm install
npm run dev     # http://localhost:5173, bound to 0.0.0.0
npm run build   # type checking + production bundle in dist/
npm run preview
```

Vite accepts the Arena `*.e2b.app` preview hosts. All application assets use same-origin URLs. Deploy `dist/` to any static host; there are no server routes or API secrets.

## Owner editing / launch checklist

The business content lives in **`src/data.ts`**, with TODO comments:

- Add the official logo (`LOGO_URL`), address, optional Maps URL, and verify the repeated secondary phone number.
- Replace placeholder products 5–9, sizes, descriptions and reused photos.
- Add actual factory/farm photos to `GALLERY`; blank URLs deliberately render branded placeholder tiles.
- Replace the sample testimonials with real, authorized reviews. Replace/verify the statistics and all product, quality and FAQ claims.
- Update `CONTENT_STATUS` when the corresponding demo content is replaced, to remove its explanatory labels.
- **Images:** the four supplied Catbox PNG URLs are preserved. They were unreachable from the development environment. `public/images/*.webp` are **AI-generated illustrative packaging**, used only as local failure/timeout fallbacks. They are not official company photography. Replace these before launch, or provide reliable local official packshots. Set each `webp` field only to a WebP version of the **same** official photo (not a different picture). PNG remains the fallback for WebP support.
- Set the real domain consistently in `src/data.ts`, `index.html` (canonical and Open Graph URL), `public/robots.txt`, and `public/sitemap.xml`.
- Supply the official favicon, Apple touch icon, and 1200×630 share image. The current favicon is an intentionally temporary typographic mark.

All Arabic text uses zero letter spacing. Cairo and Lalezar are also locally bundled through Fontsource for reliable Arabic typography when Google Fonts is inaccessible.

## Interaction / implementation

- Eight full-height sections with directional two-layer milk-wave transitions; active section and immediate neighbors only.
- Keyboard (arrows, PageUp/PageDown, Space), passive wheel/touch gestures, desktop dots and mobile menu. Native internal scrolling includes a 300 ms edge dwell to avoid momentum jumps.
- Pointer-drag product carousel, category filters and focus-trapped product modal; mobile bottom sheet with swipe-down handle.
- Native horizontal gallery with drag controls and focus-trapped lightbox. Testimonials pause on hover/touch, and respect reduced motion.
- Wholesale form validates locally, then opens an encoded WhatsApp message. **Submitting does not itself send an order**: the visitor confirms it in WhatsApp. No personal information is persisted by the site. A manual link is provided if a popup is blocked.
- Sound module is lazy-imported; audio is created only from a sound-toggle click. The preference is stored safely in localStorage. A new page starts silent, with a saved-preference hint, until the visitor explicitly enables sound again.
- Reduced-motion mode uses a 300 ms fade, final-value counters and no automatic review rotation or infinite motion.
- Loader preloads the four hero images and awaits fonts, with a 1.4 s minimum and 6 s failsafe (plus the exit animation).

## Browser checks

With the dev or preview server running:

```sh
npm test
# Optional:
TEST_URL=http://localhost:4173 npm test
node tests/capture.mjs  # screenshots in ignored .playwright/
```

The Node test suite uses Playwright and a dev-only packaged Chromium, with a Linux shared-library fallback for restricted CI. Set `CHROMIUM_PATH` to use your own browser binary.

Tests cover all eight sections at **360×640, 390×844, 768×1024 and 1440×900**, horizontal overflow, filters, carousel drag, section swipes, modal focus restoration/trapping, locked navigation, gallery/lightbox controls, FAQs, wholesale validation and message encoding, and scroll-edge dwell. Browser tests deliberately fail the remote image requests to exercise the local fallback path.

Production code is split into lazy section/dialog chunks; the Web Audio module is only downloaded on demand. Generated build and test artifacts are ignored by Git.
