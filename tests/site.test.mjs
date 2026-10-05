import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { launchBrowser } from "./browser.mjs";
let browser;
const base = process.env.TEST_URL || "http://localhost:5173";
before(async () => {
  browser = await launchBrowser();
});
after(async () => {
  await browser?.close();
});
async function setup(width = 1440, height = 900, reduced = false) {
  const page = await browser.newPage({
    viewport: { width, height },
    reducedMotion: reduced ? "reduce" : "no-preference",
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("https://files.catbox.moe/**", (route) => route.abort());
  await page.route("https://fonts.googleapis.com/**", (route) => route.abort());
  await page.goto(base);
  await page.locator(".loader").waitFor({ state: "detached", timeout: 12000 });
  return { page, errors };
}
async function go(page, n, mobile = false) {
  if (mobile) {
    await page
      .getByRole("button", { name: "فتح القائمة", exact: true })
      .click();
    await page.locator(".mobile-menu button").nth(n).click();
  } else await page.locator(".dots-nav button").nth(n).click();
  await page.locator(`.section-${n}.is-active`).waitFor({ state: "visible" });
  await page.waitForTimeout(950);
}
test("desktop: carousel, filters, product dialog focus trap and WhatsApp links", async () => {
  const { page, errors } = await setup();
  assert.equal(await page.locator(".hero-product img").count(), 4);
  await page
    .getByRole("button", { name: "المنتج التالي", exact: true })
    .click();
  await page.waitForTimeout(700);
  assert.match(await page.locator(".hero-copy h1").innerText(), /عسل/);
  await page.keyboard.press("ArrowLeft"); // focused button must not intercept arrow key
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
    await dialog.locator("a").getAttribute("href"),
    /wa.me\/201141322878\?text=/,
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
test("desktop: all sections, gallery lightbox, FAQ, wholesale validation", async () => {
  const { page, errors } = await setup();
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
  await go(page, 5);
  await page.getByRole("button", { name: "رأي العميل 3" }).click();
  assert.equal(
    await page.locator(".review-person div>span").innerText(),
    "عميل",
  );
  await go(page, 6);
  const q = page.getByRole("button", { name: /هل يمكن التعبئة/ });
  await q.click();
  assert.equal(await q.getAttribute("aria-expanded"), "true");
  assert.equal(await page.locator(".faq-item.open").count(), 1);
  await go(page, 7);
  await page.getByRole("button", { name: "أرسل الطلب عبر واتساب" }).click();
  assert.ok(await page.locator("#name-error").isVisible());
  assert.ok(await page.locator("#quantity-error").isVisible());
  await page.locator("#name").fill("أحمد علي");
  await page.locator("#quantity").fill("12");
  await page.locator("#unit").selectOption("كجم");
  await page.locator("#notes").fill("توصيل القاهرة");
  await page.evaluate(() => {
    window.__opened = "";
    window.open = (url) => {
      window.__opened = url;
      return null;
    };
  });
  await page.getByRole("button", { name: "أرسل الطلب عبر واتساب" }).click();
  const url = await page.evaluate(() => window.__opened);
  assert.ok(url.startsWith("https://wa.me/201141322878?text="));
  assert.match(decodeURIComponent(url), /أحمد علي، عايز أطلب 12 كجم/);
  assert.match(decodeURIComponent(url), /توصيل القاهرة/);
  assert.ok(await page.locator(".form-success").isVisible());
  await page.getByRole("button", { name: "العودة للأعلى" }).click();
  await page.locator(".section-0.is-active").waitFor();
  assert.deepEqual(errors, []);
  await page.close();
});
for (const [w, h] of [
  [360, 640],
  [390, 844],
  [768, 1024],
  [1440, 900],
])
  test(`responsive ${w}×${h}: all 8 sections fit viewport without horizontal overflow`, async () => {
    const { page, errors } = await setup(w, h, true);
    for (let i = 0; i < 8; i++) {
      if (i) await go(page, i, w < 640);
      const sizes = await page
        .locator(".is-active")
        .evaluate((el) => ({
          width: el.clientWidth,
          scroll: el.scrollWidth,
          height: el.clientHeight,
          doc: document.documentElement.scrollWidth,
        }));
      assert.equal(sizes.height, h);
      assert.ok(
        sizes.scroll <= sizes.width + 1,
        `section ${i}: ${JSON.stringify(sizes)}`,
      );
      assert.equal(sizes.doc, w);
      if (i === 1 && w < 640) {
        await page
          .getByRole("button", { name: "تفاصيل جبن موزاريلا مبشور" })
          .click();
        const box = await page.locator(".product-modal").boundingBox();
        assert.ok(box.width <= w && box.height <= h * 0.9 + 1);
        await page.getByRole("button", { name: "إغلاق تفاصيل المنتج" }).click();
      }
    }
    assert.deepEqual(errors, []);
    await page.close();
  });
test("scrollable section edge dwell prevents accidental transitions", async () => {
  const { page } = await setup(390, 844, true);
  await go(page, 1, true);
  await page.mouse.move(200, 500);
  await page.mouse.wheel(0, 400);
  await page.waitForTimeout(350);
  assert.ok(await page.locator(".section-1.is-active").isVisible());
  const top = await page.locator(".section-1").evaluate((el) => el.scrollTop);
  assert.ok(top > 0);
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
test("mobile horizontal product swipe changes only product; vertical swipe changes section", async () => {
  const { page } = await setup(390, 844, true);
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
