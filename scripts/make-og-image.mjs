// Builds the 1200x630 Open Graph card at public/og-image.jpg.
//
// It renders one HTML card with the site's own brand fonts (@fontsource Cairo
// and Lalezar, the same files the site bundles) and the site's own product
// photo, then screenshots it with the portable Chromium used by the tests.
// No new artwork is drawn: the card is the existing packshot plus the existing
// brand name and copy.
//
//   node scripts/make-og-image.mjs
//
// The owner should replace the output with the official banner when it exists.
import { readFile, writeFile, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { launchBrowser } from "../tests/browser.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = join(root, "public/og-image.jpg");

const b64 = async (path) =>
  (await readFile(path)).toString("base64").replace(/\s+/g, "");

const font = async (path, weight) =>
  `@font-face{font-family:"OG";src:url(data:font/woff2;base64,${await b64(
    join(root, "node_modules", path),
  )}) format("woff2");font-weight:${weight};font-display:block}`;

const html = `<!doctype html>
<html lang="ar" dir="rtl">
  <head>
    <meta charset="utf-8" />
    <style>
      ${await font("@fontsource/cairo/files/cairo-arabic-400-normal.woff2", 400)}
      ${await font("@fontsource/cairo/files/cairo-arabic-700-normal.woff2", 700)}
      ${await font("@fontsource/cairo/files/cairo-arabic-800-normal.woff2", 800)}
      ${await font("@fontsource/cairo/files/cairo-latin-700-normal.woff2", "400 900")}
      ${await font("@fontsource/lalezar/files/lalezar-arabic-400-normal.woff2", "400 900")}
      * { box-sizing: border-box; margin: 0; padding: 0; }
      html, body { width: 1200px; height: 630px; overflow: hidden; }
      .card {
        position: relative;
        width: 1200px;
        height: 630px;
        display: flex;
        align-items: center;
        gap: 26px;
        padding: 0 64px 46px;
        direction: rtl;
        font-family: "OG", sans-serif;
        background:
          radial-gradient(760px 420px at 92% -6%, #2f5ad8 0%, #1e3fa8 42%, #142a73 100%);
        color: #fff8ec;
      }
      /* soft brand glow + milk wave, both from the site's palette */
      .glow {
        position: absolute;
        inset: auto -140px -240px auto;
        width: 560px; height: 560px;
        border-radius: 50%;
        background: radial-gradient(circle, rgba(233,190,46,.34) 0%, rgba(233,190,46,0) 68%);
      }
      .wave { position: absolute; inset: auto 0 0 0; width: 1200px; height: 96px; }
      .text { position: relative; flex: 1 1 auto; padding-top: 6px; }
      .eyebrow {
        font-family: "OG", sans-serif;
        font-weight: 700;
        font-size: 19px;
        letter-spacing: 5px;
        color: #ffd86b;
        direction: ltr;
        text-align: right;
      }
      h1 {
        font-family: "OG", sans-serif;
        font-weight: 900;
        font-size: 96px;
        line-height: 1.16;
        margin: 12px 0 6px;
        text-shadow: 0 8px 26px rgba(0, 0, 0, .28);
      }
      .rule { width: 108px; height: 6px; border-radius: 999px; background: #e9be2e; }
      .tagline { font-weight: 800; font-size: 33px; margin: 18px 0 6px; }
      .sub { font-weight: 400; font-size: 24px; color: rgba(255, 248, 236, .88); }
      .chip {
        display: inline-block;
        margin-top: 22px;
        padding: 9px 22px;
        border: 2px solid rgba(255, 216, 107, .75);
        border-radius: 999px;
        font-weight: 700;
        font-size: 21px;
        color: #ffd86b;
      }
      .domain {
        position: absolute;
        left: 64px;
        bottom: 22px;
        font-weight: 700;
        font-size: 21px;
        letter-spacing: 2px;
        color: rgba(255, 248, 236, .82);
        direction: ltr;
      }
      .shot {
        position: relative;
        flex: 0 0 auto;
        width: 342px;
        height: 560px;
        object-fit: cover;
        border-radius: 20px;
        box-shadow: 0 34px 70px rgba(6, 12, 32, .55);
        border: 1px solid rgba(255, 255, 255, .28);
      }
    </style>
  </head>
  <body>
    <div class="card">
      <div class="glow"></div>
      <svg class="wave" viewBox="0 0 1200 96" preserveAspectRatio="none" aria-hidden="true">
        <path d="M0 44 Q75 4 150 44 T300 44 T450 44 T600 44 T750 44 T900 44 T1050 44 T1200 44 V96 H0 Z"
              fill="rgba(255,248,236,.10)" />
        <path d="M0 62 Q75 26 150 62 T300 62 T450 62 T600 62 T750 62 T900 62 T1050 62 T1200 62 V96 H0 Z"
              fill="rgba(255,248,236,.16)" />
      </svg>
      <div class="text">
        <div class="eyebrow">ELBAZ &middot; NATURAL GOODNESS</div>
        <h1>البان إلباظ</h1>
        <div class="rule"></div>
        <div class="tagline">طبيعة نقية. طعم أصيل.</div>
        <div class="sub">ألبان وأجبان وعسل طبيعي وزيت زيتون ومكسرات</div>
        <div class="chip">من المزرعة إلى مائدتك</div>
        <div class="domain">mgneg.online</div>
      </div>
      <img class="shot" alt="" src="data:image/webp;base64,${await b64(
        join(root, "public/images/mozzarella.webp"),
      )}" />
    </div>
  </body>
</html>`;

const dir = await mkdtemp(join(tmpdir(), "elbaz-og-"));
const page_file = join(dir, "card.html");
await writeFile(page_file, html);

const browser = await launchBrowser();
try {
  const page = await browser.newPage({
    viewport: { width: 1200, height: 630 },
    deviceScaleFactor: 1,
  });
  await page.goto(`file://${page_file}`, { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: output, type: "jpeg", quality: 86 });
  const { size } = await stat(output);
  console.log(`[og] wrote ${output} (${Math.round(size / 1024)} KB, 1200x630)`);
} finally {
  await browser.close();
  await rm(dir, { recursive: true, force: true });
}
