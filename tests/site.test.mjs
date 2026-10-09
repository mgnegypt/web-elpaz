import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { launchBrowser } from "./browser.mjs";

let browser;
const base = process.env.TEST_URL || "http://127.0.0.1:5173";

before(async () => {
  browser = await launchBrowser();
});
after(async () => {
  await browser?.close();
});

async function setup(
  width = 1440,
  height = 900,
  { reduced = false, colorScheme = "light", storage } = {},
) {
  const page = await browser.newPage({
    viewport: { width, height },
    reducedMotion: reduced ? "reduce" : "no-preference",
    colorScheme,
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("https://files.catbox.moe/**", (route) => route.abort());
  await page.route("https://fonts.googleapis.com/**", (route) => route.abort());
  if (storage) await page.addInitScript(storage);
  await page.goto(base);
  await page.locator(".loader").waitFor({ state: "detached", timeout: 15000 });
  return { page, errors };
}

/** Navigate and wait for the transition lock to clear. */
async function go(page, n, { mobile = false, reduced = true } = {}) {
  if (mobile) {
    await page
      .getByRole("button", { name: "فتح القائمة", exact: true })
      .click();
    await page.locator(".mobile-menu button").nth(n).click();
  } else {
    await page.locator(".dots-nav button").nth(n).click();
  }
  await page.locator(`.section-${n}.is-active`).waitFor({ state: "visible" });
  await page.waitForTimeout(reduced ? 400 : 1700);
}

const VIEWPORTS = [
  [360, 640, "mobile portrait 360x640"],
  [390, 844, "mobile portrait 390x844"],
  [768, 1024, "tablet 768x1024"],
  [1440, 900, "desktop 1440x900"],
  [844, 390, "mobile landscape 844x390"],
];

// ---------------------------------------------------------------------------
// Layout / responsiveness
// ---------------------------------------------------------------------------
for (const [w, h, label] of VIEWPORTS) {
  test(`${label}: all 8 sections fit without horizontal overflow`, async () => {
    const { page, errors } = await setup(w, h, { reduced: true });
    for (let i = 0; i < 8; i++) {
      if (i) await go(page, i, { mobile: w < 640 });
      const sizes = await page.locator(".is-active").evaluate((el) => ({
        width: el.clientWidth,
        scroll: el.scrollWidth,
        height: el.clientHeight,
        doc: document.documentElement.scrollWidth,
        bodyOverflowX: getComputedStyle(document.body).overflowX,
      }));
      assert.equal(
        sizes.height,
        h,
        `section ${i} must fill the viewport height`,
      );
      assert.ok(
        sizes.scroll <= sizes.width + 1,
        `section ${i} overflows horizontally: ${JSON.stringify(sizes)}`,
      );
      assert.equal(
        sizes.doc,
        w,
        `no document-level horizontal overflow on section ${i}`,
      );
      if (i === 1 && w < 640) {
        await page
          .getByRole("button", { name: "تفاصيل جبن موزاريلا مبشور" })
          .click();
        const box = await page.locator(".product-modal").boundingBox();
        assert.ok(
          box.width <= w && box.height <= h * 0.95 + 1,
          "modal fits the phone",
        );
        await page.getByRole("button", { name: "إغلاق تفاصيل المنتج" }).click();
      }
    }
    assert.deepEqual(errors, []);
    await page.close();
  });
}

test("phones reserve a bottom utility area clear of order buttons", async () => {
  const { page } = await setup(390, 844, { reduced: true });
  await go(page, 1, { mobile: true });
  // Scroll to the very bottom: that is where a dock collision would happen.
  await page.locator(".section-1").evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await page.waitForTimeout(300);

  const button = await page
    .locator(".product-card")
    .last()
    .locator(".wa-button")
    .boundingBox();
  const dock = await page.evaluate(() =>
    [".progress-top", ".mobile-section-counter"]
      .map((selector) => document.querySelector(selector))
      .filter(Boolean)
      .map((node) => {
        const rect = node.getBoundingClientRect();
        return {
          top: rect.top,
          left: rect.left,
          right: rect.right,
          bottom: rect.bottom,
        };
      }),
  );
  assert.ok(
    dock.length >= 2,
    "expected the fixed phone controls to be present",
  );
  const overlaps = dock.some(
    (rect) =>
      !(
        button.x + button.width <= rect.left ||
        button.x >= rect.right ||
        button.y + button.height <= rect.top ||
        button.y >= rect.bottom
      ),
  );
  assert.equal(
    overlaps,
    false,
    `order button ${JSON.stringify(button)} overlaps the dock ${JSON.stringify(dock)}`,
  );

  // The reserved area must be at least as tall as the dock itself.
  const { padding, dockHeight } = await page.evaluate(() => {
    const container = document.querySelector(".section-1 .section-container");
    const tops = [".progress-top", ".mobile-section-counter"]
      .map((s) => document.querySelector(s)?.getBoundingClientRect())
      .filter(Boolean)
      .map((r) => window.innerHeight - r.top);
    return {
      padding: parseFloat(getComputedStyle(container).paddingBottom),
      dockHeight: Math.max(...tops),
    };
  });
  assert.ok(
    padding >= dockHeight,
    `reserved padding ${padding}px must cover the ${dockHeight}px dock`,
  );
  await page.close();
});

test("touch targets for small pagination and review controls stay at least 44px", async () => {
  const { page } = await setup(390, 844, { reduced: true });
  const hero = await page
    .locator(".hero-pagination button")
    .first()
    .boundingBox();
  assert.ok(
    hero.width >= 44 && hero.height >= 44,
    `hero pagination ${JSON.stringify(hero)}`,
  );
  await go(page, 5, { mobile: true });
  const review = await page
    .locator(".review-dots button")
    .first()
    .boundingBox();
  assert.ok(
    review.width >= 44 && review.height >= 44,
    `review dots ${JSON.stringify(review)}`,
  );
  await page.close();
});

// ---------------------------------------------------------------------------
// Retained interactions
// ---------------------------------------------------------------------------
test("desktop: carousel, category filter, product dialog focus trap and WhatsApp link", async () => {
  const { page, errors } = await setup(1440, 900, { reduced: true });
  assert.equal(await page.locator(".hero-product img").count(), 4);

  await page
    .getByRole("button", { name: "المنتج التالي", exact: true })
    .click();
  await page.waitForTimeout(700);
  assert.match(await page.locator(".hero-copy h1").innerText(), /عسل/);

  await go(page, 1);
  assert.equal(await page.locator(".is-active .product-card").count(), 9);
  await page.getByRole("button", { name: "زيوت", exact: true }).click();
  assert.equal(await page.locator(".is-active .product-card").count(), 1);

  const trigger = page.getByRole("button", {
    name: "تفاصيل زيت زيتون طبيعي خام",
  });
  await trigger.click();
  const dialog = page.getByRole("dialog");
  await dialog.waitFor();
  assert.match(
    (await dialog.locator("a").first().getAttribute("href")) ?? "",
    /wa\.me\/201141322878\?text=/,
  );
  assert.ok(await page.locator("#site-content").evaluate((el) => el.inert));
  await page.keyboard.press("Tab");
  assert.ok(await dialog.evaluate((el) => el.contains(document.activeElement)));
  await page.mouse.wheel(0, 400);
  await page.waitForTimeout(350);
  assert.ok(
    await page
      .locator(".section-1")
      .evaluate((el) => el.classList.contains("is-active")),
  );
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "detached" });
  assert.ok(await trigger.evaluate((el) => el === document.activeElement));
  assert.deepEqual(errors, []);
  await page.close();
});

test("desktop: gallery lightbox, FAQ accordion and section navigation still work", async () => {
  const { page, errors } = await setup(1440, 900, { reduced: true });
  for (const n of [2, 3, 4]) await go(page, n);

  await page.getByRole("button", { name: "تكبير صورة خط الإنتاج" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.waitFor();
  await page.keyboard.press("ArrowLeft");
  assert.equal(
    await page.locator(".lightbox-caption h2").innerText(),
    "المزرعة",
  );
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "detached" });

  await go(page, 5);
  await page.getByRole("button", { name: "رأي العميل 3" }).click();
  assert.equal(
    await page.locator(".review-person div>span").innerText(),
    "عميل",
  );

  await go(page, 6);
  const question = page.getByRole("button", { name: /هل يمكن التعبئة/ });
  await question.click();
  assert.equal(await question.getAttribute("aria-expanded"), "true");
  assert.equal(await page.locator(".faq-item.open").count(), 1);

  await page.getByRole("button", { name: "العودة للأعلى" }).click();
  await page.locator(".section-0.is-active").waitFor();
  assert.deepEqual(errors, []);
  await page.close();
});

test("scrollable section edge dwell prevents accidental transitions", async () => {
  const { page } = await setup(390, 844, { reduced: true });
  await go(page, 1, { mobile: true });
  await page.mouse.move(200, 500);
  await page.mouse.wheel(0, 400);
  await page.waitForTimeout(350);
  assert.ok(await page.locator(".section-1.is-active").isVisible());
  assert.ok(
    (await page.locator(".section-1").evaluate((el) => el.scrollTop)) > 0,
  );
  await page.locator(".section-1").evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await page.waitForTimeout(50);
  await page.mouse.wheel(0, 100);
  await page.waitForTimeout(100);
  assert.ok(await page.locator(".section-1.is-active").isVisible());
  await page.waitForTimeout(400);
  await page.mouse.wheel(0, 100);
  await page.locator(".section-2.is-active").waitFor();
  await page.close();
});

test("mobile: horizontal product swipe changes only the product, vertical swipe changes section", async () => {
  const { page } = await setup(390, 844, { reduced: true });
  const carousel = page.locator(".hero-carousel");
  await page.mouse.move(280, 400);
  await page.mouse.down();
  await page.mouse.move(100, 405, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(700);
  assert.equal(
    await page.locator(".hero-copy h1").innerText(),
    "عسل أبيض طبيعي",
  );
  assert.ok(await page.locator(".section-0.is-active").isVisible());
  await carousel.evaluate((el) => {
    const start = new Touch({
      identifier: 1,
      target: el,
      clientX: 190,
      clientY: 500,
    });
    el.dispatchEvent(
      new TouchEvent("touchstart", { bubbles: true, touches: [start] }),
    );
    const end = new Touch({
      identifier: 1,
      target: el,
      clientX: 195,
      clientY: 300,
    });
    el.dispatchEvent(
      new TouchEvent("touchend", { bubbles: true, changedTouches: [end] }),
    );
  });
  await page.locator(".section-1.is-active").waitFor();
  await page.close();
});

// ---------------------------------------------------------------------------
// Wholesale form
// ---------------------------------------------------------------------------
test("wholesale form validates, saves to the backend, and keeps WhatsApp separate", async () => {
  const { page, errors } = await setup(1440, 900, { reduced: true });
  await go(page, 7);
  await page.evaluate(() => {
    window.__opened = "";
    window.open = (url) => {
      window.__opened = String(url);
      return null;
    };
  });

  // Submitting empty must surface per-field Arabic errors, not a false success.
  await page.getByRole("button", { name: "إرسال الطلب" }).click();
  assert.ok(await page.locator("#name-error").isVisible());
  assert.ok(await page.locator("#contact-error").isVisible());
  assert.ok(await page.locator("#quantity-error").isVisible());
  assert.equal(await page.locator(".form-success").count(), 0);

  // Missing consent alone must still be rejected.
  await page.locator("#name").fill("أحمد علي");
  await page.locator("#contact").fill("01000000000");
  await page.locator("#quantity").fill("12");
  await page.locator("#unit").selectOption("كجم");
  await page.locator("#notes").fill("توصيل القاهرة");
  await page.getByRole("button", { name: "إرسال الطلب" }).click();
  assert.ok(await page.locator("#consent-error").isVisible());
  assert.equal(await page.locator(".form-success").count(), 0);
  assert.equal(
    await page.evaluate(() => window.__opened),
    "",
    "WhatsApp must not auto-open",
  );

  await page.locator("#storage-consent").check();
  await page.getByRole("button", { name: "إرسال الطلب" }).click();
  await page.locator(".form-success").waitFor({ timeout: 10000 });
  assert.equal(
    await page.evaluate(() => window.__opened),
    "",
    "saving must not claim an order was sent over WhatsApp",
  );

  // WhatsApp stays an explicit, separate option.
  const whatsapp = page.getByRole("link", { name: /فتح واتساب/ });
  const href = await whatsapp.getAttribute("href");
  assert.ok(href.startsWith("https://wa.me/201141322878?text="));
  const decoded = decodeURIComponent(href);
  assert.match(decoded, /أحمد علي، عايز أطلب 12 كجم/);
  assert.match(decoded, /توصيل القاهرة/);

  assert.deepEqual(errors, []);
  await page.close();
});

// ---------------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------------
test("first visit follows the system preference (light and dark)", async () => {
  const light = await setup(1280, 800, { colorScheme: "light" });
  assert.equal(
    await light.page.evaluate(() => document.documentElement.dataset.theme),
    "light",
  );
  const lightBg = await light.page.evaluate(
    () => getComputedStyle(document.documentElement).backgroundColor,
  );
  assert.equal(
    await light.page.evaluate(() => document.documentElement.style.colorScheme),
    "light",
  );
  await light.page.close();

  const dark = await setup(1280, 800, { colorScheme: "dark" });
  assert.equal(
    await dark.page.evaluate(() => document.documentElement.dataset.theme),
    "dark",
  );
  const darkBg = await dark.page.evaluate(
    () => getComputedStyle(document.documentElement).backgroundColor,
  );
  assert.equal(
    await dark.page.evaluate(() => document.documentElement.style.colorScheme),
    "dark",
  );
  assert.notEqual(darkBg, lightBg, "dark mode must actually repaint the page");

  // A card surface must flip too, not just the page background.
  await go(dark.page, 1);
  const cardBg = await dark.page
    .locator(".product-card")
    .first()
    .evaluate((el) => getComputedStyle(el).backgroundColor);
  assert.notEqual(
    cardBg,
    "rgb(255, 255, 255)",
    "cards must not stay white in dark mode",
  );
  await dark.page.close();
});

test("explicit theme choice persists across reloads via elbaz-theme", async () => {
  const { page } = await setup(1280, 800, { colorScheme: "light" });
  assert.equal(
    await page.evaluate(() => document.documentElement.dataset.theme),
    "light",
  );

  await page.locator(".theme-toggle").click();
  await page.waitForFunction(
    () => document.documentElement.dataset.theme === "dark",
    null,
    { timeout: 5000 },
  );
  assert.equal(
    await page.evaluate(() => localStorage.getItem("elbaz-theme")),
    "dark",
  );

  await page.reload();
  await page.locator(".loader").waitFor({ state: "detached", timeout: 15000 });
  assert.equal(
    await page.evaluate(() => document.documentElement.dataset.theme),
    "dark",
    "the stored choice must win over the system preference",
  );

  // And switching back must persist the other way too.
  await page.locator(".theme-toggle").click();
  await page.waitForFunction(
    () => document.documentElement.dataset.theme === "light",
  );
  assert.equal(
    await page.evaluate(() => localStorage.getItem("elbaz-theme")),
    "light",
  );
  await page.close();
});

test("theme works without localStorage (private mode)", async () => {
  const { page } = await setup(1280, 800, {
    colorScheme: "dark",
    storage: () => {
      Object.defineProperty(window, "localStorage", {
        get() {
          throw new DOMException("denied", "SecurityError");
        },
      });
    },
  });
  assert.equal(
    await page.evaluate(() => document.documentElement.dataset.theme),
    "dark",
  );
  // Toggling must still work even though persistence is impossible.
  await page.locator(".theme-toggle").click();
  await page.waitForFunction(
    () => document.documentElement.dataset.theme === "light",
  );
  await page.close();
});

test("no flash of the wrong theme: theme is applied before React boots", async () => {
  const { page } = await setup(1280, 800, { colorScheme: "dark" });
  // The early init script must be a same-origin blocking script in <head>.
  const script = await page.evaluate(() => {
    const nodes = [...document.querySelectorAll("script[src]")];
    const init = nodes.find((n) => n.getAttribute("src") === "/theme-init.js");
    return init
      ? {
          inHead: init.closest("head") !== null,
          defer: init.hasAttribute("defer"),
        }
      : null;
  });
  assert.ok(script, "public/theme-init.js must be loaded");
  assert.equal(script.inHead, true);
  assert.equal(
    script.defer,
    false,
    "it must not be deferred, or the theme will flash",
  );
  await page.close();
});

test("reduced motion switches the theme immediately, without the circular reveal", async () => {
  const { page } = await setup(1280, 800, {
    colorScheme: "light",
    reduced: true,
  });
  const usedViewTransition = await page.evaluate(() => {
    let called = false;
    const original = document.startViewTransition;
    if (typeof original === "function") {
      document.startViewTransition = (...args) => {
        called = true;
        return original.apply(document, args);
      };
    }
    window.__vtCalled = () => called;
    return typeof original === "function";
  });
  await page.locator(".theme-toggle").click();
  const immediately = await page.evaluate(
    () => document.documentElement.dataset.theme,
  );
  assert.equal(
    immediately,
    "dark",
    "the switch must be instant under reduced motion",
  );
  if (usedViewTransition) {
    assert.equal(await page.evaluate(() => window.__vtCalled()), false);
  }
  await page.close();
});

test("theme toggle is at least 44px and replaced the sound control entirely", async () => {
  const { page } = await setup(390, 844, { reduced: true });
  const box = await page.locator(".theme-toggle").boundingBox();
  assert.ok(
    box.width >= 44 && box.height >= 44,
    `touch target ${JSON.stringify(box)}`,
  );
  // No trace of the old sound feature anywhere in the DOM.
  assert.equal(await page.locator(".sound-toggle").count(), 0);
  assert.equal(await page.locator('[aria-label*="الصوت"]').count(), 0);
  assert.equal((await page.locator("[aria-pressed]").count()) >= 1, true);
  await page.close();
});

test("dark mode keeps the brand blue, cream and gold accents", async () => {
  const { page } = await setup(1280, 800, { colorScheme: "dark" });
  // Product photography must not be filtered or recoloured (check while the hero is mounted).
  const filter = await page
    .locator(".hero-product img")
    .first()
    .evaluate((el) => getComputedStyle(el).filter);
  assert.ok(filter === "none" || filter === "", `unexpected filter: ${filter}`);
  await go(page, 3);
  const blueSection = await page
    .locator(".section-3")
    .evaluate((el) => getComputedStyle(el).backgroundColor);
  assert.equal(
    blueSection,
    "rgb(30, 63, 168)",
    "brand blue sections stay blue in dark mode",
  );
  const gold = await page.evaluate(() =>
    getComputedStyle(document.documentElement)
      .getPropertyValue("--brand-gold")
      .trim(),
  );
  assert.equal(gold, "#e9be2e");
  await page.close();
});

// ---------------------------------------------------------------------------
// Milk-wave transition
// ---------------------------------------------------------------------------
async function sampleTransition(page, targetIndex, expectedDirection) {
  // Sampled with a timer (not requestAnimationFrame) so throttling cannot hide frames.
  return page.evaluate(
    ([target, direction]) =>
      new Promise((resolve) => {
        const activeIndex = () => {
          const el = document.querySelector(".section-shell.is-active");
          const match = el?.className.match(/section-(\d)/);
          return match ? Number(match[1]) : -1;
        };
        const covered = () => {
          const wave = document.querySelector(".milk-wave");
          if (!wave) return false;
          for (const sheet of wave.querySelectorAll(".milk-sheet")) {
            const rect = sheet.getBoundingClientRect();
            if (
              rect.top <= 1 &&
              rect.bottom >= window.innerHeight - 1 &&
              rect.width > 0
            )
              return true;
          }
          return false;
        };

        const samples = [];
        let directionOk = false;
        let inertWhileTransitioning = true;
        let sheetCount = 0;
        document.querySelectorAll(".dots-nav button")[target].click();
        const start = performance.now();
        const timer = setInterval(() => {
          const wave = document.querySelector(".milk-wave");
          if (wave) {
            if (wave.classList.contains(direction)) directionOk = true;
            if (!document.querySelector(".dots-nav")?.hasAttribute("inert"))
              inertWhileTransitioning = false;
            sheetCount = Math.max(
              sheetCount,
              wave.querySelectorAll(".milk-sheet").length,
            );
          }
          samples.push([activeIndex(), covered(), Boolean(wave)]);
          if (performance.now() - start > 2200) {
            clearInterval(timer);
            resolve({
              samples,
              directionOk,
              inertWhileTransitioning,
              sheetCount,
            });
          }
        }, 25);
      }),
    [targetIndex, expectedDirection],
  );
}

test("milk wave covers the viewport while the section switches (downward)", async () => {
  const { page } = await setup(1440, 900);
  const result = await sampleTransition(page, 1, "down");
  assert.ok(
    result.samples.some(([index, covered]) => index === 1 && covered),
    "the section must only switch while the opaque milk covers the viewport",
  );
  assert.ok(result.directionOk, "downward navigation must use the .down wave");
  assert.ok(
    result.inertWhileTransitioning,
    "navigation controls must be inert during the wave",
  );
  await page.close();
});

test("milk wave runs cleanly in both directions and is layered", async () => {
  const { page } = await setup(1440, 900);
  const down = await sampleTransition(page, 1, "down");
  assert.ok(down.samples.some(([index, covered]) => index === 1 && covered));
  assert.ok(
    down.sheetCount >= 3,
    `expected layered sheets, got ${down.sheetCount}`,
  );

  const up = await sampleTransition(page, 0, "up");
  assert.ok(
    up.samples.some(([index, covered]) => index === 0 && covered),
    "returning upward must also switch while covered",
  );
  assert.ok(up.directionOk, "backward navigation must use the .up wave");

  // The transition must clean up after itself.
  await page.waitForFunction(
    () => !document.querySelector(".milk-wave"),
    null,
    {
      timeout: 5000,
    },
  );
  assert.equal(await page.locator(".milk-wave").count(), 0);
  assert.equal(
    await page.locator(".dots-nav").evaluate((el) => el.hasAttribute("inert")),
    false,
  );
  await page.close();
});

test("reduced motion uses a short simplified wave", async () => {
  const { page } = await setup(1440, 900, { reduced: true });
  const result = await page.evaluate(async () => {
    const button = document.querySelectorAll(".dots-nav button")[1];
    button.click();
    const start = performance.now();
    let sawWave = false;
    let sawSheet = false;
    while (performance.now() - start < 900) {
      const wave = document.querySelector(".milk-wave");
      if (wave) {
        sawWave = true;
        for (const sheet of wave.querySelectorAll(".milk-sheet")) {
          if (getComputedStyle(sheet).display !== "none") sawSheet = true;
        }
      }
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    return {
      sawWave,
      sawSheet,
      switched: document
        .querySelector(".section-1")
        ?.classList.contains("is-active"),
    };
  });
  assert.ok(result.sawWave, "a simplified wave must still play");
  assert.equal(
    result.sawSheet,
    false,
    "the layered sheets must be hidden under reduced motion",
  );
  assert.ok(result.switched, "the section must still change");
  await page.close();
});

// ---------------------------------------------------------------------------
// Dev-server privacy
// ---------------------------------------------------------------------------
test("the dev server never serves private files", async () => {
  for (const path of [
    "/.data/elbaz.sqlite",
    "/.data/elbaz.sqlite-wal",
    "/.data/setup-token",
    "/.env",
    "/server/app.ts",
    "/server/index.ts",
    "/package-lock.json",
  ]) {
    const response = await fetch(base + path);
    assert.equal(response.status, 404, `${path} must not be reachable in dev`);
  }
});

// ---------------------------------------------------------------------------
// Published content: authority, failure handling and authenticity labels
//
// Regression cover for three production reports:
//   1. the site briefly showed the old/default products, images and logo;
//   2. real products were labelled "الصورة توضيحية";
//   3. real customer reviews were labelled "رأي توضيحي".
// ---------------------------------------------------------------------------

const apiBase = process.env.TEST_API || "http://127.0.0.1:3001";

/** The document the API is really serving right now. */
async function publishedDocument() {
  const response = await fetch(`${apiBase}/api/content`);
  assert.equal(response.status, 200);
  return response.json();
}

/**
 * Serves a crafted document to the browser for /api/content.
 * Returns a handle that can change the document or start failing.
 */
async function serveContent(page, build) {
  const state = { mode: "ok", document: build, calls: 0 };
  await page.route("**/api/content", async (route) => {
    state.calls += 1;
    if (state.mode === "offline") return route.abort("failed");
    if (state.mode === "error")
      return route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "content-unavailable" }),
      });
    if (state.mode === "garbage")
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ revision: 99, products: "not-an-array" }),
      });
    if (state.mode === "empty")
      return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(state.document),
    });
  });
  return state;
}

/** A page that is not loaded yet, so routing can be installed first. */
async function blankPage({ width = 1280, height = 900 } = {}) {
  const page = await browser.newPage({
    viewport: { width, height },
    reducedMotion: "reduce",
  });
  await page.route("https://files.catbox.moe/**", (route) => route.abort());
  await page.route("https://fonts.googleapis.com/**", (route) => route.abort());
  return page;
}

async function openSite(page) {
  await page.goto(base);
  await page.locator(".loader").waitFor({ state: "detached", timeout: 20000 });
}

/** Section 1 is the products grid; section 5 is the reviews carousel. */
async function openSection(page, index) {
  await page.locator(".dots-nav button").nth(index).click();
  await page.locator(`.section-${index}.is-active`).waitFor({ state: "visible" });
  await page.waitForTimeout(400);
}

test("published content is rendered, and the bundled defaults are not", async () => {
  const published = await publishedDocument();
  const page = await blankPage();
  const served = await serveContent(page, {
    ...published,
    copy: { ...published.copy, productsSubtitle: "نص منشور من قاعدة البيانات" },
    products: published.products.map((product, index) =>
      index === 0 ? { ...product, name: "منتج منشور حقيقي" } : product,
    ),
  });
  await openSite(page);
  await openSection(page, 1);

  assert.match(await page.locator(".products-container").innerText(), /منتج منشور حقيقي/);
  assert.match(await page.locator(".products-container").innerText(), /نص منشور من قاعدة البيانات/);
  assert.ok(served.calls >= 1, "the site must read /api/content");
  await page.close();
});

test("a failed refresh keeps the loaded content and offers a retry", async () => {
  const published = await publishedDocument();
  const page = await blankPage();
  const served = await serveContent(page, {
    ...published,
    products: published.products.map((product, index) =>
      index === 0 ? { ...product, name: "منتج يبقى ظاهرًا" } : product,
    ),
  });
  await openSite(page);
  await openSection(page, 1);
  assert.match(await page.locator(".products-container").innerText(), /منتج يبقى ظاهرًا/);

  // The API goes away, and the tab is re-focused (the usual refresh trigger).
  served.mode = "offline";
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await page.locator(".content-notice").waitFor({ timeout: 10000 });

  // The real content is still on screen: no silent fall back to the bundle.
  assert.match(await page.locator(".products-container").innerText(), /منتج يبقى ظاهرًا/);
  const notice = await page.locator(".content-notice").innerText();
  assert.match(notice, /آخر نسخة محفوظة/);
  assert.doesNotMatch(notice, /نسخة مبدئية/);

  // Retrying while the API is healthy again clears the notice.
  served.mode = "ok";
  await page.getByRole("button", { name: "إعادة المحاولة" }).click();
  await page.locator(".content-notice").waitFor({ state: "detached", timeout: 10000 });
  assert.match(await page.locator(".products-container").innerText(), /منتج يبقى ظاهرًا/);
  await page.close();
});

test("invalid, empty or stale responses never replace good content", async () => {
  const published = await publishedDocument();
  const page = await blankPage();
  const served = await serveContent(page, {
    ...published,
    revision: 40,
    products: published.products.map((product, index) =>
      index === 0 ? { ...product, name: "النسخة الصحيحة" } : product,
    ),
  });
  await openSite(page);
  await openSection(page, 1);
  const text = () => page.locator(".products-container").innerText();
  assert.match(await text(), /النسخة الصحيحة/);

  // 1. A 200 with a broken shape.
  served.mode = "garbage";
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await page.waitForTimeout(600);
  assert.match(await text(), /النسخة الصحيحة/);

  // 2. A 200 with an empty object.
  served.mode = "empty";
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await page.waitForTimeout(600);
  assert.match(await text(), /النسخة الصحيحة/);

  // 3. A valid but older revision (a stale copy from a cache or a slow retry).
  served.mode = "ok";
  served.document = {
    ...published,
    revision: 3,
    products: published.products.map((product, index) =>
      index === 0 ? { ...product, name: "نسخة قديمة" } : product,
    ),
  };
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await page.waitForTimeout(800);
  assert.match(await text(), /النسخة الصحيحة/);
  assert.doesNotMatch(await text(), /نسخة قديمة/);
  await page.close();
});

test("a published update reaches the site on the next refresh", async () => {
  const published = await publishedDocument();
  const page = await blankPage();
  const served = await serveContent(page, {
    ...published,
    revision: published.revision,
    products: published.products.map((product, index) =>
      index === 0 ? { ...product, name: "الاسم قبل التعديل" } : product,
    ),
  });
  await openSite(page);
  await openSection(page, 1);
  assert.match(await page.locator(".products-container").innerText(), /الاسم قبل التعديل/);

  // The dashboard publishes: a newer revision with new content.
  served.document = {
    ...published,
    revision: published.revision + 5,
    products: published.products.map((product, index) =>
      index === 0 ? { ...product, name: "الاسم بعد التعديل" } : product,
    ),
  };
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await page.waitForFunction(
    () => document.body.innerText.includes("الاسم بعد التعديل"),
    undefined,
    { timeout: 10000 },
  );
  await page.close();
});

test("a cold load with a dead API reuses the last good content, not the bundle", async () => {
  const published = await publishedDocument();
  const page = await blankPage();
  const served = await serveContent(page, {
    ...published,
    products: published.products.map((product, index) =>
      index === 0 ? { ...product, name: "منتج محفوظ محليًا" } : product,
    ),
  });
  await openSite(page);
  await openSection(page, 1);
  assert.match(await page.locator(".products-container").innerText(), /منتج محفوظ محليًا/);

  // Same browser profile, API now unreachable, full reload.
  served.mode = "offline";
  await openSite(page);
  await openSection(page, 1);
  assert.match(await page.locator(".products-container").innerText(), /منتج محفوظ محليًا/);
  await page.locator(".content-notice").waitFor({ timeout: 10000 });
  assert.match(await page.locator(".content-notice").innerText(), /آخر نسخة محفوظة/);
  await page.close();
});

test("a first visit with no cache and a dead API says so instead of pretending", async () => {
  const page = await blankPage();
  const served = await serveContent(page, {});
  served.mode = "offline";
  await openSite(page);
  await page.locator(".content-notice--bundled").waitFor({ timeout: 10000 });
  const notice = await page.locator(".content-notice").innerText();
  assert.match(notice, /نسخة مبدئية مؤقتة/);
  // The retry control is a real, reachable button.
  const box = await page.getByRole("button", { name: "إعادة المحاولة" }).boundingBox();
  assert.ok(box.height >= 44, `retry target too small: ${JSON.stringify(box)}`);
  assert.ok(
    box.x >= 0 && box.x + box.width <= 1280,
    `retry button escapes the viewport: ${JSON.stringify(box)}`,
  );
  await page.close();
});

test("genuine product photos carry no illustrative disclaimer", async () => {
  const published = await publishedDocument();
  const [first, second, ...rest] = published.products;
  const page = await blankPage();
  await serveContent(page, {
    ...published,
    products: [
      { ...first, name: "منتج بصورة حقيقية", imageAuthenticity: "genuine" },
      { ...second, name: "منتج بصورة مؤقتة", imageAuthenticity: "illustrative" },
      ...rest.map((product) => ({ ...product, imageAuthenticity: "genuine" })),
    ],
    contentStatus: {
      ...published.contentStatus,
      // The legacy list still names the genuine product: the explicit flag wins.
      placeholderProductIds: [first.id, second.id],
    },
  });
  await openSite(page);
  await openSection(page, 1);

  const genuine = page.locator(".product-card", { hasText: "منتج بصورة حقيقية" }).first();
  const sample = page.locator(".product-card", { hasText: "منتج بصورة مؤقتة" }).first();
  assert.equal(await genuine.locator(".sample-image").count(), 0);
  assert.equal(await sample.locator(".sample-image").count(), 1);

  // The product dialog must agree with the card.
  await genuine.click();
  const dialog = page.locator(".product-modal");
  await dialog.waitFor({ timeout: 10000 });
  assert.doesNotMatch(await dialog.innerText(), /الصورة توضيحية/);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);

  await sample.click();
  await dialog.waitFor({ timeout: 10000 });
  assert.match(await dialog.innerText(), /الصورة توضيحية/);
  await page.close();
});

test("genuine reviews stay genuine, including negative ones", async () => {
  const published = await publishedDocument();
  const page = await blankPage();
  await serveContent(page, {
    ...published,
    reviews: [
      {
        name: "سامية محمود",
        role: "صاحبة مطعم",
        rating: 1.5,
        text: "التوصيل تأخر مرتين هذا الشهر.",
        authenticity: "genuine",
      },
      {
        name: "نموذج توضيحي",
        role: "عميل",
        rating: 5,
        text: "نص تجريبي في انتظار آراء حقيقية.",
        authenticity: "illustrative",
      },
      {
        name: "رأي غير مصنّف",
        role: "عميل",
        rating: 4,
        text: "رأي لم يُحدَّد نوعه بعد.",
        authenticity: "unspecified",
      },
    ],
    contentStatus: {
      ...published.contentStatus,
      // Global switch ON: only the undecided review may follow it.
      testimonialsArePlaceholders: true,
    },
  });
  await openSite(page);
  await openSection(page, 5);

  const card = page.locator(".quote-card");
  // 1. The genuine, badly rated review: no disclaimer, rating intact.
  assert.match(await card.innerText(), /التوصيل تأخر مرتين/);
  assert.equal(await card.locator(".review-placeholder").count(), 0);
  assert.match(await card.innerText(), /1\.5 \/ 5/);

  // 2. The sample review keeps its disclaimer.
  await page.locator(".review-dots button").nth(1).click();
  await page.waitForTimeout(400);
  assert.equal(await card.locator(".review-placeholder").count(), 1);
  assert.match(await card.locator(".review-placeholder").innerText(), /رأي توضيحي/);

  // 3. The undecided review follows the global switch (unchanged behaviour).
  await page.locator(".review-dots button").nth(2).click();
  await page.waitForTimeout(400);
  assert.equal(await card.locator(".review-placeholder").count(), 1);
  await page.close();
});

test("legacy documents without authenticity fields keep their old labels", async () => {
  const published = await publishedDocument();
  const legacy = JSON.parse(JSON.stringify(published));
  for (const product of legacy.products) delete product.imageAuthenticity;
  for (const review of legacy.reviews) delete review.authenticity;
  legacy.products = legacy.products.slice(0, 2);
  legacy.products[0].name = "منتج قديم موسوم";
  legacy.products[1].name = "منتج قديم سليم";
  legacy.contentStatus = {
    ...legacy.contentStatus,
    placeholderProductIds: [legacy.products[0].id],
    testimonialsArePlaceholders: true,
  };
  legacy.reviews = [
    { name: "عميل قديم", role: "عميل", rating: 5, text: "رأي محفوظ من قبل." },
  ];

  const page = await blankPage();
  await serveContent(page, legacy);
  await openSite(page);
  await openSection(page, 1);
  const marked = page.locator(".product-card", { hasText: "منتج قديم موسوم" }).first();
  const clean = page.locator(".product-card", { hasText: "منتج قديم سليم" }).first();
  assert.equal(await marked.locator(".sample-image").count(), 1);
  assert.equal(await clean.locator(".sample-image").count(), 0);

  await openSection(page, 5);
  assert.equal(await page.locator(".quote-card .review-placeholder").count(), 1);
  await page.close();
});
