// End-to-end dashboard tests: first-run security, roles, products, events,
// uploads, live updates, theming and layout at real screen sizes.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { launchBrowser } from "./browser.mjs";
import { DASHBOARD_OWNER } from "./helper.mjs";
import {
  productImageIsIllustrative,
  reviewIsIllustrative,
} from "../shared/content.ts";

const base = process.env.TEST_URL || "http://127.0.0.1:5173";
const api = process.env.TEST_API || "http://127.0.0.1:3001";
const dataDir = process.env.TEST_DATA_DIR || ".data";
const SHOTS = process.env.TEST_SCREENSHOTS === "1";
const shotDir = ".playwright";

const OWNER = DASHBOARD_OWNER;

let browser;

before(async () => {
  browser = await launchBrowser();
  if (SHOTS) mkdirSync(shotDir, { recursive: true });
});
after(async () => {
  await browser?.close();
});

const SETUP_TOKEN = () =>
  readFileSync(join(dataDir, "setup-token"), "utf8").trim();

async function openAdmin(options = {}) {
  const page = await browser.newPage({
    viewport: options.viewport ?? { width: 1440, height: 1000 },
    reducedMotion: options.reducedMotion ?? "reduce",
    colorScheme: options.colorScheme ?? "light",
    isMobile: options.isMobile ?? false,
    hasTouch: options.hasTouch ?? false,
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("https://files.catbox.moe/**", (route) => route.abort());
  await page.route("https://fonts.googleapis.com/**", (route) => route.abort());
  await page.goto(`${base}/admin`);
  return { page, errors };
}

async function shot(page, name) {
  if (!SHOTS) return;
  await page.screenshot({ path: join(shotDir, `${name}.png`), fullPage: true });
}

/** The dashboard sidebar (the quick actions reuse the same labels). */
const nav = (page) => page.getByRole("navigation", { name: "أقسام اللوحة" });
const goTo = (page, label) =>
  nav(page).getByRole("button", { name: label, exact: true }).click();
const openProfile = (page) =>
  page
    .locator(".sidebar-foot")
    .getByRole("button", { name: "الملف الشخصي" })
    .first()
    .click();

/** Opens the public site and waits for the intro loader to finish. */
async function openSite(viewport = { width: 1280, height: 900 }) {
  const page = await browser.newPage({ viewport, reducedMotion: "reduce" });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("https://files.catbox.moe/**", (route) => route.abort());
  await page.route("https://fonts.googleapis.com/**", (route) => route.abort());
  await page.goto(base);
  await page.locator(".loader").waitFor({ state: "detached", timeout: 20000 });
  return { page, errors };
}

/** Navigates the public site to the products section. */
async function siteGo(page, index) {
  await page.locator(".dots-nav button").nth(index).click();
  await page
    .locator(`.section-${index}.is-active`)
    .waitFor({ state: "visible", timeout: 15000 });
  await page.waitForTimeout(400);
}

/** Signs in through the UI: password first, then the security question. */
async function signIn(page, email, password, answer) {
  await page.getByLabel(/البريد الإلكتروني أو اسم المستخدم/).fill(email);
  await page.getByLabel("كلمة المرور", { exact: true }).fill(password);
  await page.getByRole("button", { name: "دخول لوحة التحكم" }).click();
  await page
    .getByRole("heading", { name: "سؤال الأمان" })
    .waitFor({ timeout: 15000 });
  await page.getByLabel("الإجابة", { exact: true }).fill(answer);
  await page.getByRole("button", { name: "تأكيد الدخول" }).click();
  await page
    .getByRole("heading", { name: "تم تسجيل الدخول بنجاح" })
    .waitFor({ timeout: 15000 });
  await page
    .getByRole("heading", { name: /أهلًا بك/ })
    .waitFor({ timeout: 20000 });
}

/** Creates a wholesale request through the public API so the dashboard has data. */
async function seedRequest(suffix) {
  const response = await fetch(`${api}/api/wholesale-requests`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: `عميل ${suffix}`,
      contact: "01098765432",
      product: "عسل أبيض طبيعي",
      unit: "كجم",
      quantity: 25,
      notes: `طلب ${suffix}`,
      consent: true,
      requestKey: `admin-seed-${suffix}`,
    }),
  });
  assert.ok(
    [200, 201].includes(response.status),
    `seed failed: ${response.status}`,
  );
  return (await response.json()).id;
}

/** Layout guard: nothing may overflow the viewport or collide with its peers. */
async function assertLayoutSane(page, label) {
  const problems = await page.evaluate(() => {
    const found = [];
    const root = document.documentElement;
    if (root.scrollWidth > window.innerWidth + 1) {
      found.push(
        `document overflows horizontally: ${root.scrollWidth} > ${window.innerWidth}`,
      );
    }
    const visible = (element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return (
        rect.width > 1 &&
        rect.height > 1 &&
        style.visibility !== "hidden" &&
        style.display !== "none" &&
        Number(style.opacity) > 0.05
      );
    };
    const boxes = (selector) =>
      [...document.querySelectorAll(selector)]
        .filter(visible)
        .map((element) => ({
          element,
          rect: element.getBoundingClientRect(),
        }));

    // Interactive controls must stay inside the viewport horizontally.
    for (const { element, rect } of boxes(
      ".btn, .icon-btn, input, select, textarea, .nav-item, .profile-chip, .stat-pill, .badge",
    )) {
      if (rect.left < -2 || rect.right > window.innerWidth + 2) {
        found.push(
          `${element.className || element.tagName} is outside the viewport (${Math.round(rect.left)}…${Math.round(rect.right)})`,
        );
      }
    }

    // Sibling action buttons inside a card must never overlap each other.
    const groups = boxes(
      ".product-tile-actions, .row-actions, .card-actions, .event-actions, .page-actions",
    );
    for (const group of groups) {
      const items = [
        ...group.element.querySelectorAll(".btn, .icon-btn, a.btn"),
      ].filter(visible);
      for (let i = 0; i < items.length; i += 1) {
        for (let j = i + 1; j < items.length; j += 1) {
          const a = items[i].getBoundingClientRect();
          const b = items[j].getBoundingClientRect();
          const overlapX =
            Math.min(a.right, b.right) - Math.max(a.left, b.left);
          const overlapY =
            Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
          if (overlapX > 2 && overlapY > 2) {
            found.push(
              `buttons overlap: "${items[i].textContent?.trim()}" × "${items[j].textContent?.trim()}"`,
            );
          }
        }
      }
    }

    // At the top of the page the sticky header must sit above the panel, never on top of it.
    const topbar = document.querySelector(".topbar");
    const heading = document.querySelector(".admin-main h1");
    if (topbar && heading) {
      window.scrollTo(0, 0);
      const bar = topbar.getBoundingClientRect();
      const title = heading.getBoundingClientRect();
      if (
        getComputedStyle(topbar).position === "sticky" &&
        title.top < bar.bottom - 12
      ) {
        found.push(
          `the top bar covers the panel heading by ${Math.round(bar.bottom - title.top)}px`,
        );
      }
    }

    // Modals and drawers have to fit inside the viewport.
    const modal = document.querySelector(".ui-modal, .drawer");
    if (modal) {
      const rect = modal.getBoundingClientRect();
      if (rect.top < -1 || rect.bottom > window.innerHeight + 1) {
        found.push(
          `${modal.className} is taller than the viewport (${Math.round(rect.height)} > ${window.innerHeight})`,
        );
      }
    }
    return [...new Set(found)];
  });
  assert.deepEqual(problems, [], `${label}: ${problems.join(" | ")}`);
}

/* -------------------------------------------------------------- first run */

test("first run: one-time token, permanent credentials, security answer, success animation", async () => {
  const requestId = await seedRequest("one");
  const { page, errors } = await openAdmin();

  // --- first run shows the setup form, not the login form ---
  await page
    .getByRole("heading", { name: "الإعداد الأول" })
    .waitFor({ timeout: 20000 });
  await shot(page, "admin-01-setup");

  await page.getByLabel(/رمز الإعداد/).fill("0".repeat(64));
  await page.getByLabel(/كلمة مرور المالك/).fill("a-very-long-password");
  await page.getByRole("button", { name: "إنشاء الحساب" }).click();
  await page
    .getByText("رمز الإعداد غير صحيح. راجعه من ملف الإعداد على السيرفر.")
    .waitFor();
  assert.ok(
    existsSync(join(dataDir, "setup-token")),
    "a failed setup keeps the token",
  );

  await page.getByLabel(/رمز الإعداد/).fill(SETUP_TOKEN());
  await page.getByRole("button", { name: "إنشاء الحساب" }).click();
  await page
    .getByRole("heading", { name: "بيانات حسابك" })
    .waitFor({ timeout: 20000 });
  assert.equal(
    existsSync(join(dataDir, "setup-token")),
    false,
    "the token is deleted after setup",
  );
  await shot(page, "admin-02-complete");

  // --- the Owner picks their permanent email, password and security question ---
  await page.getByLabel("الاسم الظاهر").fill(OWNER.displayName);
  await page.getByLabel("البريد الإلكتروني").fill(OWNER.email);
  await page.getByLabel("كلمة المرور الجديدة").fill(OWNER.password);
  await page.getByLabel("سؤال الأمان", { exact: true }).fill(OWNER.question);
  await page.getByLabel("إجابة سؤال الأمان").fill(OWNER.answer);
  await page.getByRole("button", { name: "حفظ ومتابعة" }).click();

  // Saving logs the current session out and returns to the login screen.
  await page
    .getByRole("heading", { name: "تسجيل الدخول" })
    .waitFor({ timeout: 20000 });
  await shot(page, "admin-03-login");

  // --- wrong password is refused ---
  await page.getByLabel(/البريد الإلكتروني أو اسم المستخدم/).fill(OWNER.email);
  await page
    .getByLabel("كلمة المرور", { exact: true })
    .fill("not-the-password");
  await page.getByRole("button", { name: "دخول لوحة التحكم" }).click();
  await page
    .getByText("البريد الإلكتروني أو كلمة المرور غير صحيحة.")
    .waitFor({ timeout: 15000 });

  // --- correct password → the security question is the second factor ---
  await page.getByLabel("كلمة المرور", { exact: true }).fill(OWNER.password);
  await page.getByRole("button", { name: "دخول لوحة التحكم" }).click();
  await page
    .getByRole("heading", { name: "سؤال الأمان" })
    .waitFor({ timeout: 15000 });
  assert.match(
    await page.locator(".auth-question").innerText(),
    /اسم أول حيوان أليف؟/,
  );
  // The answer itself is never rendered anywhere.
  assert.equal(
    (await page.locator("body").innerText()).includes(OWNER.answer),
    false,
  );
  await shot(page, "admin-04-security");

  await page.getByLabel("الإجابة", { exact: true }).fill("إجابة خاطئة");
  await page.getByRole("button", { name: "تأكيد الدخول" }).click();
  await page
    .getByText("الإجابة غير صحيحة. حاول مرة أخرى.")
    .waitFor({ timeout: 15000 });

  await page.getByLabel("الإجابة", { exact: true }).fill(OWNER.answer);
  await page.getByRole("button", { name: "تأكيد الدخول" }).click();

  // --- the success animation plays before the dashboard renders ---
  await page
    .getByRole("heading", { name: "تم تسجيل الدخول بنجاح" })
    .waitFor({ timeout: 15000 });
  await shot(page, "admin-05-success");
  await page
    .getByRole("heading", { name: /أهلًا بك/ })
    .waitFor({ timeout: 20000 });

  // --- welcome area: display name, Gregorian + Hijri dates, Cairo clock ---
  const welcome = page.locator(".welcome-card");
  const welcomeText = await welcome.innerText();
  assert.match(welcomeText, new RegExp(OWNER.displayName));
  assert.match(welcomeText, /هـ/, "the Hijri date must be shown");
  assert.match(welcomeText, /بتوقيت القاهرة/);
  const clockBefore = await page.locator(".welcome-clock").innerText();
  await page.waitForTimeout(1500);
  assert.notEqual(
    await page.locator(".welcome-clock").innerText(),
    clockBefore,
    "the clock ticks",
  );
  await shot(page, "admin-06-overview");

  // --- requests: the seeded row is listed, searchable and updatable ---
  await goTo(page, "طلبات الجملة");
  const row = page.getByTestId(`request-row-${requestId}`);
  await row.waitFor({ timeout: 20000 });
  assert.match(await row.innerText(), /عميل one/);
  const statusSelect = row.getByLabel(`حالة الطلب ${requestId}`);
  await statusSelect.selectOption("confirmed");
  await page.waitForTimeout(600);
  assert.equal(await statusSelect.inputValue(), "confirmed");
  const anonymous = await fetch(`${api}/api/admin/requests?page=1`);
  assert.equal(
    anonymous.status,
    401,
    "the API never exposes requests without a session",
  );
  await shot(page, "admin-07-requests");

  assert.deepEqual(errors, [], "no page errors");
  await page.close();
});

/* ------------------------------------------------------- roles and profile */

test("owner: account management is visible, admin accounts can be created and edited", async () => {
  const { page, errors } = await openAdmin();
  await signIn(page, OWNER.email, OWNER.password, OWNER.answer);

  await goTo(page, "حسابات المشرفين");
  await page
    .getByRole("heading", { name: "حسابات المشرفين", exact: true })
    .waitFor({ timeout: 15000 });
  await shot(page, "admin-08-admins");

  await page.getByRole("button", { name: "حساب مشرف جديد" }).click();
  await page.getByLabel("اسم المستخدم").fill("editor");
  await page.getByLabel("الاسم الظاهر").fill("محرر الموقع");
  await page.getByLabel("البريد الإلكتروني").fill("editor@elpaze.online");
  await page
    .getByLabel("كلمة المرور", { exact: true })
    .fill("kitchen-secret-pass-1");
  await page.getByRole("button", { name: "حفظ" }).click();
  await page
    .getByText("تم إنشاء الحساب. يمكنه تسجيل الدخول فورًا.")
    .waitFor({ timeout: 15000 });
  const editorRow = page.locator("tr", { hasText: "editor" }).first();
  assert.match(await editorRow.innerText(), /مشرف/);

  // Edit the account from the table.
  await editorRow.getByRole("button", { name: "تعديل" }).click();
  await page.getByLabel("الاسم الظاهر").fill("محرر أول");
  await page.getByRole("button", { name: "حفظ" }).click();
  await page.getByText("تم حفظ بيانات الحساب.").waitFor({ timeout: 15000 });

  // The owner cannot delete their own account (the control is disabled).
  const ownerRow = page.locator("tr", { hasText: "owner" }).first();
  assert.equal(
    await ownerRow.getByRole("button", { name: "حذف" }).isDisabled(),
    true,
  );

  await assertLayoutSane(page, "admins panel (desktop)");
  assert.deepEqual(errors, []);
  await page.close();
});

test("owner: profile panel closes with X, edits details, and logs out from the bottom", async () => {
  const { page, errors } = await openAdmin();
  await signIn(page, OWNER.email, OWNER.password, OWNER.answer);

  await openProfile(page);
  const drawer = page.locator(".drawer");
  await drawer.waitFor({ timeout: 15000 });
  await page.getByRole("heading", { name: "الملف الشخصي" }).waitFor();
  await shot(page, "admin-09-profile");

  // The panel is split into tabs: session details live in the last one.
  const tab = (name) => drawer.getByRole("tab", { name, exact: true });
  await tab("الجلسة الحالية").click();
  const sessionText = await drawer.innerText();
  assert.match(sessionText, /مدة الجلسة الحالية/);
  assert.match(sessionText, /تنتهي في/);
  assert.equal(sessionText.includes(OWNER.answer), false);
  assert.equal(sessionText.includes(OWNER.password), false);

  // No other account is reachable from here.
  assert.equal(sessionText.includes("editor"), false);

  // Edit the display name and verify the header follows.
  await tab("معلومات الحساب").click();
  await drawer.getByLabel("الاسم الظاهر").fill("محمد نجيب - المالك");
  await drawer.getByRole("button", { name: "حفظ البيانات" }).click();
  await page.getByText("تم حفظ بيانات الحساب.").waitFor({ timeout: 15000 });
  assert.match(
    await page.locator(".profile-chip").innerText(),
    /محمد نجيب - المالك/,
  );

  // Changing the security question requires the current answer first.
  await tab("الأمان").click();
  await drawer.getByLabel("الإجابة الحالية").fill("إجابة غلط");
  await drawer.getByLabel("السؤال").fill("سؤال مختلف؟");
  await drawer.getByLabel("الإجابة الجديدة").fill("إجابة مختلفة");
  await drawer.getByRole("button", { name: "حفظ سؤال الأمان" }).click();
  await page
    .getByText("الإجابة الحالية غير صحيحة.")
    .waitFor({ timeout: 15000 });
  await drawer.getByLabel("الإجابة الحالية").fill(OWNER.answer);
  await drawer.getByRole("button", { name: "حفظ سؤال الأمان" }).click();
  await page.getByText("تم تحديث سؤال الأمان.").waitFor({ timeout: 15000 });

  // Put the question back so the login helper keeps working.
  await drawer.getByLabel("الإجابة الحالية").fill("إجابة مختلفة");
  await drawer.getByLabel("السؤال").fill(OWNER.question);
  await drawer.getByLabel("الإجابة الجديدة").fill(OWNER.answer);
  await drawer.getByRole("button", { name: "حفظ سؤال الأمان" }).click();
  await page.getByText("تم تحديث سؤال الأمان.").waitFor({ timeout: 15000 });

  await assertLayoutSane(page, "profile drawer (desktop)");

  // The X button at the top closes the panel without logging out.
  await drawer.getByRole("button", { name: "إغلاق الملف الشخصي" }).click();
  await drawer.waitFor({ state: "detached", timeout: 10000 });
  await page.getByRole("heading", { name: /أهلًا بك/ }).waitFor();

  // Log out from the bottom of the panel.
  await openProfile(page);
  await drawer.getByRole("button", { name: "تسجيل الخروج" }).click();
  await page
    .getByRole("heading", { name: "تسجيل الدخول" })
    .waitFor({ timeout: 15000 });

  assert.deepEqual(errors, []);
  await page.close();
});

/* -------------------------------------------------- products and live feed */

test("owner: product CRUD with image upload, availability states and live badges", async () => {
  const { page, errors } = await openAdmin();
  await signIn(page, OWNER.email, OWNER.password, OWNER.answer);

  // A public visitor sees the site in another tab, without reloading it.
  const { page: visitor } = await openSite();
  await siteGo(visitor, 1);
  await visitor
    .getByRole("heading", { name: "منتجاتنا" })
    .waitFor({ timeout: 20000 });

  await goTo(page, "المنتجات");
  await page
    .getByRole("heading", { name: "المنتجات", exact: true })
    .waitFor({ timeout: 15000 });
  await page
    .getByRole("heading", { name: "جبن موزاريلا مبشور" })
    .waitFor({ timeout: 15000 });
  await shot(page, "admin-10-products");

  // --- create a product and upload its picture from the device ---
  const name = "منتج اختبار آلي";
  await page.getByRole("button", { name: "منتج جديد" }).click();
  await page.getByLabel("اسم المنتج").fill(name);
  // The panel also has a "تصفية حسب التصنيف" filter, so target the form field.
  await page.getByRole("textbox", { name: "التصنيف", exact: true }).fill("ألبان");
  await page.getByLabel("وصف قصير").fill("وصف تجريبي من الاختبار الآلي");
  // Packaging lives behind the "extra options" disclosure.
  await page.getByRole("button", { name: /خيارات إضافية/ }).click();
  await page.getByLabel("العبوة / الحجم").fill("١ كجم");

  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==",
    "base64",
  );
  await page.locator("#upload-صورة-المنتج").setInputFiles({
    name: "product.png",
    mimeType: "image/png",
    buffer: png,
  });
  await page.getByRole("button", { name: "إضافة ونشر" }).click();
  await page
    .getByText("تمت إضافة المنتج ونشره فورًا.")
    .waitFor({ timeout: 20000 });
  await page.getByRole("heading", { name }).waitFor({ timeout: 15000 });

  // The upload is stored and used by the site and the dashboard alike.
  const published = await (await fetch(`${api}/api/content`)).json();
  const created = published.products.find((product) => product.name === name);
  assert.ok(created, "the new product is published immediately");
  assert.match(created.img, /^\/uploads\/[a-f0-9]{32}\.png$/);
  const imageResponse = await fetch(`${api}${created.img}`);
  assert.equal(imageResponse.status, 200);
  assert.equal(imageResponse.headers.get("content-type"), "image/png");

  // --- the visitor sees it without reloading (live update) ---
  await visitor.getByRole("heading", { name }).waitFor({ timeout: 15000 });

  // --- NEW badge + availability, both pushed live ---
  const card = page.locator(".product-tile", { hasText: name });
  await card.getByRole("button", { name: "تعليم كجديد" }).click();
  await page
    .getByText("تم التحديث على الموقع.")
    .first()
    .waitFor({ timeout: 15000 });
  await visitor
    .locator(".product-card", { hasText: name })
    .getByText("جديد")
    .first()
    .waitFor({ timeout: 15000 });

  await card.getByRole("button", { name: "تعديل" }).click();
  await page.getByRole("radio", { name: /يُصنع حسب الطلب/ }).click();
  await page.getByLabel("نسبة الخصم %").fill("20");
  await page.getByRole("button", { name: "حفظ ونشر" }).click();
  await page.getByText("تم حفظ التعديلات ونشرها.").waitFor({ timeout: 20000 });
  await visitor
    .locator(".product-card", { hasText: name })
    .getByText("يُصنع حسب الطلب")
    .first()
    .waitFor({ timeout: 15000 });
  await visitor
    .locator(".product-card", { hasText: name })
    .getByText("خصم 20%")
    .first()
    .waitFor({ timeout: 15000 });

  // Coming soon replaces the order button on the public card.
  await card.getByRole("button", { name: "قريبًا" }).click();
  await page
    .getByText("تم التحديث على الموقع.")
    .first()
    .waitFor({ timeout: 15000 });
  await visitor
    .locator(".product-card", { hasText: name })
    .getByText("قريبًا")
    .first()
    .waitFor({ timeout: 15000 });
  await visitor
    .locator(".product-card", { hasText: name })
    .getByText("قريبًا بإذن الله")
    .waitFor({ timeout: 15000 });
  await shot(visitor, "admin-11-site-badges");

  // Quantity zero marks the product as out of stock.
  await card.getByRole("button", { name: "إتاحة" }).click();
  await page
    .getByText("تم التحديث على الموقع.")
    .first()
    .waitFor({ timeout: 15000 });
  await card.getByRole("button", { name: "تعديل" }).click();
  await page.getByLabel("الكمية المتاحة").fill("0");
  await page.getByRole("button", { name: "حفظ ونشر" }).click();
  await page.getByText("تم حفظ التعديلات ونشرها.").waitFor({ timeout: 20000 });
  await visitor
    .locator(".product-card", { hasText: name })
    .getByText("نفدت الكمية")
    .first()
    .waitFor({ timeout: 15000 });

  // --- delete ---
  await card.getByRole("button", { name: "حذف" }).click();
  await page.getByRole("button", { name: "حذف نهائي" }).click();
  await page.getByText("تم حذف المنتج من الموقع.").waitFor({ timeout: 20000 });
  await assert.rejects(
    visitor
      .locator(".product-card", { hasText: name })
      .waitFor({ timeout: 6000 }),
    "the deleted product must disappear from the live site",
  );

  await assertLayoutSane(page, "products panel (desktop)");
  assert.deepEqual(errors, []);
  await visitor.close();
  await page.close();
});

test("owner: events publish to the public announcement bar and can be hidden", async () => {
  const { page, errors } = await openAdmin();
  await signIn(page, OWNER.email, OWNER.password, OWNER.answer);

  const { page: visitor } = await openSite();
  await siteGo(visitor, 1);
  await visitor
    .getByRole("heading", { name: "منتجاتنا" })
    .waitFor({ timeout: 20000 });
  assert.equal(
    await visitor.locator(".announce-bar").count(),
    0,
    "no announcements before the first event",
  );

  await goTo(page, "المناسبات");
  await page
    .getByRole("heading", { name: "المناسبات والتنبيهات", exact: true })
    .waitFor({ timeout: 15000 });
  await shot(page, "admin-12-events");
  await page.getByRole("button", { name: "مناسبة جديدة" }).click();
  await page.getByLabel("العنوان").fill("عرض الموسم");
  await page.getByLabel("الوصف").fill("خصم ١٥٪ على كل الأجبان حتى نهاية الشهر");
  await page.getByLabel("النوع").selectOption("discount");
  await page.getByRole("button", { name: "حفظ ونشر" }).click();
  await page
    .getByText("تم حفظ المناسبة ونشرها على الموقع فورًا.")
    .waitFor({ timeout: 20000 });

  // The announcement bar appears for the visitor without a reload.
  const bar = visitor.locator(".announce-bar");
  await bar.waitFor({ timeout: 15000 });
  assert.match(await bar.innerText(), /عرض الموسم/);
  await shot(visitor, "admin-13-site-announcement");
  const collide = await visitor.evaluate(() => {
    const bar = document
      .querySelector(".announce-bar")
      ?.getBoundingClientRect();
    const toggle = document
      .querySelector(".theme-toggle")
      ?.getBoundingClientRect();
    if (!bar || !toggle) return "missing";
    const overlapX =
      Math.min(bar.right, toggle.right) - Math.max(bar.left, toggle.left);
    const overlapY =
      Math.min(bar.bottom, toggle.bottom) - Math.max(bar.top, toggle.top);
    return overlapX > 2 && overlapY > 2
      ? `overlap ${Math.round(overlapX)}x${Math.round(overlapY)}`
      : "";
  });
  assert.equal(
    collide,
    "",
    "the announcement bar must not sit on the theme toggle",
  );
  await visitor.getByRole("button", { name: "إغلاق التنبيه" }).click();
  await bar.waitFor({ state: "detached", timeout: 10000 });

  // Hiding it in the dashboard removes it from the public payload.
  await page.getByRole("button", { name: "إخفاء" }).first().click();
  await page
    .getByText("تم إخفاء المناسبة من الموقع.")
    .waitFor({ timeout: 15000 });
  const published = await (await fetch(`${api}/api/content`)).json();
  assert.equal(
    published.events.length,
    0,
    "hidden events stay out of the public payload",
  );

  // Show it again, then delete it.
  await page.getByRole("button", { name: "إظهار" }).first().click();
  await page
    .getByText("المناسبة ظاهرة الآن على الموقع.")
    .waitFor({ timeout: 15000 });
  await page.getByRole("button", { name: "حذف" }).first().click();
  await page.getByRole("button", { name: "حذف", exact: true }).last().click();
  await page.getByText("تم حذف المناسبة.").waitFor({ timeout: 15000 });
  assert.equal(
    (await (await fetch(`${api}/api/content`)).json()).events.length,
    0,
  );

  await assertLayoutSane(page, "events panel (desktop)");
  assert.deepEqual(errors, []);
  await visitor.close();
  await page.close();
});

/* ------------------------------------------------------------ admin role */

test("admin: no owner-only UI, normal dashboard work still possible, API refuses escalation", async () => {
  // The editor has no security question yet, so this is the plain login path.
  const { page: adminPage, errors: adminErrors } = await openAdmin();
  await adminPage
    .getByLabel(/البريد الإلكتروني أو اسم المستخدم/)
    .fill("editor@elpaze.online");
  await adminPage
    .getByLabel("كلمة المرور", { exact: true })
    .fill("kitchen-secret-pass-1");
  await adminPage.getByRole("button", { name: "دخول لوحة التحكم" }).click();
  await adminPage
    .getByRole("heading", { name: "تم تسجيل الدخول بنجاح" })
    .waitFor({ timeout: 15000 });
  await adminPage
    .getByRole("heading", { name: /أهلًا بك/ })
    .waitFor({ timeout: 20000 });

  // Owner-only navigation must not exist in the interface at all.
  const html = await adminPage.locator("body").innerText();
  assert.equal(
    html.includes("حسابات المشرفين"),
    false,
    "the accounts panel is invisible to admins",
  );
  await adminPage.getByRole("heading", { name: /أهلًا بك/ }).waitFor();
  assert.match(await adminPage.locator(".welcome-side").innerText(), /مشرف/);

  // Normal work is available: products, content, requests.
  await goTo(adminPage, "المنتجات");
  await adminPage
    .getByRole("heading", { name: "جبن موزاريلا مبشور" })
    .waitFor({ timeout: 15000 });
  await goTo(adminPage, "محتوى الموقع");
  await adminPage.getByTestId("site-name").waitFor({ timeout: 15000 });

  // Direct API calls to owner endpoints are refused, not just hidden.
  const session = await adminPage.evaluate(async () => {
    const response = await fetch("/api/admin/session", {
      credentials: "same-origin",
    });
    return response.json();
  });
  assert.equal(session.capabilities.manageAdmins, false);
  assert.equal(session.role, "admin");
  for (const [method, path, body] of [
    ["GET", "/api/admin/admins", null],
    [
      "POST",
      "/api/admin/admins",
      {
        username: "x",
        displayName: "x",
        email: "x@y.com",
        password: "another-long-password",
        role: "owner",
      },
    ],
    ["DELETE", "/api/admin/admins/1", {}],
  ]) {
    const status = await adminPage.evaluate(
      async ([method, path, body]) => {
        const response = await fetch(path, {
          method,
          credentials: "same-origin",
          headers:
            method === "GET"
              ? undefined
              : {
                  "content-type": "application/json",
                  "x-csrf-token": (window.__csrf ??= ""),
                },
          body: method === "GET" ? undefined : JSON.stringify(body),
        });
        return response.status;
      },
      [method, path, body],
    );
    assert.equal(status, 403, `${method} ${path} must be refused for an admin`);
  }

  await assertLayoutSane(adminPage, "admin shell (desktop)");
  assert.deepEqual(adminErrors, []);
  await adminPage.close();
});

/* ------------------------------------------------------- theme + layout */

test("dashboard: dark/light toggle persists, and every breakpoint stays usable", async () => {
  const { page, errors } = await openAdmin();
  await signIn(page, OWNER.email, OWNER.password, OWNER.answer);

  // --- theme ---
  assert.equal(
    await page.evaluate(() => document.documentElement.dataset.theme),
    "light",
  );
  await page.getByRole("button", { name: /الوضع الداكن/ }).click();
  await page.waitForTimeout(700);
  assert.equal(
    await page.evaluate(() => document.documentElement.dataset.theme),
    "dark",
  );
  await page.reload();
  await page
    .getByRole("heading", { name: /أهلًا بك/ })
    .waitFor({ timeout: 25000 });
  assert.equal(
    await page.evaluate(() => document.documentElement.dataset.theme),
    "dark",
    "the theme choice survives a reload",
  );
  await shot(page, "admin-14-dark-overview");
  await assertLayoutSane(page, "overview (dark, desktop)");

  await goTo(page, "المنتجات");
  await page
    .getByRole("heading", { name: "جبن موزاريلا مبشور" })
    .waitFor({ timeout: 15000 });
  await shot(page, "admin-15-dark-products");
  await assertLayoutSane(page, "products (dark, desktop)");

  // --- responsive sweep ---
  const views = [
    { label: "tablet", viewport: { width: 834, height: 1112 } },
    {
      label: "mobile",
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    },
    {
      label: "landscape phone",
      viewport: { width: 740, height: 360 },
      isMobile: true,
      hasTouch: true,
    },
  ];
  for (const view of views) {
    const { page: small, errors: smallErrors } = await openAdmin(view);
    // Every breakpoint gets a fresh session, so it signs in too.
    await signIn(small, OWNER.email, OWNER.password, OWNER.answer);
    await assertLayoutSane(small, `overview (${view.label})`);

    if (view.viewport.width <= 1024) {
      // The sidebar is off-canvas on small screens: open it first.
      await small.getByRole("button", { name: "فتح القائمة" }).click();
      await small.locator(".sidebar--open").waitFor({ timeout: 10000 });
    }
    await goTo(small, "المنتجات");
    await small
      .getByRole("heading", { name: "المنتجات", exact: true })
      .waitFor({ timeout: 15000 });
    await assertLayoutSane(small, `products (${view.label})`);

    // A modal must fit the smallest screens too.
    await small.getByRole("button", { name: "منتج جديد" }).click();
    await small
      .getByRole("heading", { name: "منتج جديد" })
      .waitFor({ timeout: 15000 });
    await assertLayoutSane(small, `product modal (${view.label})`);
    await shot(small, `admin-16-${view.label.replace(/\s+/g, "-")}`);
    await small.keyboard.press("Escape");

    // The profile drawer must not break the layout either.
    if (view.viewport.width <= 1024) {
      await small.getByRole("button", { name: "فتح القائمة" }).click();
      await small.locator(".sidebar--open").waitFor({ timeout: 10000 });
    }
    await openProfile(small);
    await small.locator(".drawer").waitFor({ timeout: 15000 });
    await assertLayoutSane(small, `profile drawer (${view.label})`);
    await shot(small, `admin-17-profile-${view.label.replace(/\s+/g, "-")}`);
    await small.keyboard.press("Escape");

    assert.deepEqual(smallErrors, [], `${view.label}: no page errors`);
    await small.close();
  }

  assert.deepEqual(errors, []);
  await page.close();
});

test("owner: everything waiting for a decision is classified from one screen", async () => {
  const { page, errors } = await openAdmin();
  await signIn(page, OWNER.email, OWNER.password, OWNER.answer);

  await goTo(page, "محتوى الموقع");
  await page
    .getByRole("tab", { name: "حالة المحتوى" })
    .click({ timeout: 15000 });

  const productsCard = page.locator(".card", {
    hasText: "صور المنتجات بانتظار المراجعة",
  });
  const reviewsCard = page.locator(".card", {
    hasText: "آراء بانتظار المراجعة",
  });
  await productsCard.waitFor({ timeout: 15000 });

  // The site starts with legacy items waiting: that is the bug the owner sees.
  const waitingProducts = await productsCard.locator(".classify-list li").count();
  const waitingReviews = await reviewsCard.locator(".classify-list li").count();
  assert.ok(waitingProducts > 0, "the legacy products must be listed, not hidden");
  assert.ok(waitingReviews > 0, "the undecided reviews must be listed");
  await shot(page, "admin-20-content-status");

  // One decision for the whole list — behind an explicit confirmation.
  await productsCard
    .getByRole("button", { name: "كلها صور منتجاتي الحقيقية" })
    .click();
  const confirm = page.locator(".ui-modal");
  await confirm.waitFor({ timeout: 10000 });
  assert.match(await confirm.innerText(), /لن يتغيّر شيء على الموقع قبل الضغط/);
  await page.getByRole("button", { name: "نعم، طبّق على القائمة" }).click();
  await confirm.waitFor({ state: "detached", timeout: 10000 });

  await reviewsCard.getByRole("button", { name: "كلها آراء عملاء حقيقية" }).click();
  await confirm.waitFor({ timeout: 10000 });
  await page.getByRole("button", { name: "نعم، طبّق على القائمة" }).click();
  await confirm.waitFor({ state: "detached", timeout: 10000 });

  // Both queues are empty in the draft, and nothing is live yet.
  await productsCard
    .getByText("لا توجد منتجات بانتظار المراجعة")
    .waitFor({ timeout: 10000 });
  await reviewsCard
    .getByText("لا توجد آراء بانتظار المراجعة")
    .waitFor({ timeout: 10000 });
  const stillLive = await (await fetch(`${api}/api/content`)).json();
  assert.ok(
    stillLive.products.some((product) => product.imageAuthenticity === "unspecified"),
    "a decision must not reach the site before it is published",
  );

  await page
    .locator(".save-bar")
    .getByRole("button", { name: "نشر التعديلات" })
    .click();
  await page.getByText("تم التحديث على الموقع.").waitFor({ timeout: 20000 });

  const publishedDoc = await (await fetch(`${api}/api/content`)).json();

  // Exactly the waiting items were decided — and only them.
  const wasWaiting = stillLive.products
    .filter(
      (product) =>
        product.imageAuthenticity === "unspecified" &&
        stillLive.contentStatus.placeholderProductIds.includes(product.id),
    )
    .map((product) => product.id);
  assert.equal(wasWaiting.length, waitingProducts, "the queue matched the stored document");
  for (const id of wasWaiting) {
    const product = publishedDoc.products.find((item) => item.id === id);
    assert.equal(product.imageAuthenticity, "genuine", `product ${id} is now decided`);
  }
  const untouched = stillLive.products.filter((product) => !wasWaiting.includes(product.id));
  for (const before of untouched) {
    const product = publishedDoc.products.find((item) => item.id === before.id);
    assert.equal(
      product.imageAuthenticity,
      before.imageAuthenticity,
      `product ${before.id} was not in the queue and must keep its own setting`,
    );
  }
  assert.ok(
    publishedDoc.products.every(
      (product) => !productImageIsIllustrative(product, publishedDoc.contentStatus),
    ),
    "no product is shown as illustrative any more",
  );
  assert.ok(
    publishedDoc.reviews.every(
      (review) => !reviewIsIllustrative(review, publishedDoc.contentStatus),
    ),
    "no review is shown as illustrative any more",
  );
  assert.ok(
    publishedDoc.reviews.every((review) => review.authenticity === "genuine"),
    "the owner's reviews are marked genuine",
  );
  // Classification is not editing: texts and ratings are exactly as before.
  assert.deepEqual(
    publishedDoc.reviews.map((review) => review.rating),
    stillLive.reviews.map((review) => review.rating),
    "ratings must not change when authenticity is set",
  );
  assert.deepEqual(
    publishedDoc.products.map((product) => [product.name, product.img]),
    stillLive.products.map((product) => [product.name, product.img]),
    "names and image URLs must not change when authenticity is set",
  );

  // And the visitor finally sees the site without the disclaimers.
  const { page: visitor } = await openSite();
  await siteGo(visitor, 1);
  assert.equal(
    await visitor.locator(".sample-image").count(),
    0,
    "no product keeps the illustrative label after the decision",
  );
  await siteGo(visitor, 5);
  assert.equal(
    await visitor.locator(".review-placeholder").count(),
    0,
    "no review keeps the illustrative label after the decision",
  );
  await shot(visitor, "admin-21-site-after-classification");

  await assertLayoutSane(page, "content status (desktop)");
  assert.deepEqual(errors, []);
  await visitor.close();
  await page.close();
});
