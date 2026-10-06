import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { launchBrowser } from "./browser.mjs";

const base = process.env.TEST_URL || "http://127.0.0.1:5173";
const api = process.env.TEST_API || "http://127.0.0.1:3001";
const dataDir = process.env.TEST_DATA_DIR || ".data";

const USERNAME = "elbaz-owner";
const PASSWORD = "a-very-long-password";

let browser;

before(async () => {
  browser = await launchBrowser();
});
after(async () => {
  await browser?.close();
});

async function openAdmin() {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    reducedMotion: "reduce",
    colorScheme: "light",
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("https://files.catbox.moe/**", (route) => route.abort());
  await page.route("https://fonts.googleapis.com/**", (route) => route.abort());
  await page.goto(`${base}/admin`);
  return { page, errors };
}

const SETUP_TOKEN = () => readFileSync(join(dataDir, "setup-token"), "utf8").trim();

/** Creates a wholesale request through the public API so the dashboard has real data. */
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
  assert.ok([200, 201].includes(response.status), `seed failed: ${response.status}`);
  return (await response.json()).id;
}

test("admin: first-run setup, then manage wholesale requests end to end", async () => {
  const requestId = await seedRequest("one");
  const { page, errors } = await openAdmin();

  // --- first run: the setup form is the only way in ---
  await page.getByRole("heading", { name: "إنشاء حساب المدير" }).waitFor();

  // A wrong setup token must be rejected and must not create an account.
  await page.getByLabel(/رمز الإعداد/).fill("0".repeat(64));
  await page.getByLabel("اسم المستخدم").fill(USERNAME);
  await page.getByLabel(/كلمة المرور/).fill(PASSWORD);
  await page.getByRole("button", { name: "إنشاء الحساب" }).click();
  await page.getByText("رمز الإعداد غير صحيح.").waitFor();
  assert.ok(existsSync(join(dataDir, "setup-token")), "a failed setup keeps the token");

  // --- correct token creates the first administrator ---
  await page.getByLabel(/رمز الإعداد/).fill(SETUP_TOKEN());
  await page.getByRole("button", { name: "إنشاء الحساب" }).click();
  await page.getByRole("heading", { name: "طلبات الجملة" }).waitFor({ timeout: 15000 });
  assert.equal(
    existsSync(join(dataDir, "setup-token")),
    false,
    "the one-time token is deleted after setup",
  );

  // --- the seeded request is listed ---
  const row = page.getByTestId(`request-row-${requestId}`);
  await row.waitFor();
  assert.match(await row.innerText(), /عميل one/);
  assert.match(await row.innerText(), /01098765432/);
  assert.match(await row.innerText(), /25/);

  // --- status change ---
  const statusSelect = row.getByLabel(`حالة الطلب ${requestId}`);
  await statusSelect.selectOption("confirmed");
  await page.waitForTimeout(600);
  assert.equal(await statusSelect.inputValue(), "confirmed");
  const persisted = await fetch(`${api}/api/admin/requests?page=1`, {
    headers: { cookie: "" },
  });
  assert.equal(persisted.status, 401, "the API must not expose requests without a session");

  // --- search by name and by phone ---
  await page.getByLabel("ابحث بالاسم أو رقم التواصل").fill("عميل one");
  await page.waitForTimeout(700);
  await row.waitFor();
  await page.getByLabel("ابحث بالاسم أو رقم التواصل").fill("01098765432");
  await page.waitForTimeout(700);
  await row.waitFor();
  await page.getByLabel("ابحث بالاسم أو رقم التواصل").fill("لا-يوجد-هذا");
  await page.getByText("لا توجد طلبات مطابقة حتى الآن.").waitFor({ timeout: 10000 });
  await page.getByLabel("ابحث بالاسم أو رقم التواصل").fill("");
  await row.waitFor({ timeout: 10000 });

  // --- status filter ---
  await page.getByRole("button", { name: "جديد", exact: true }).click();
  await page.waitForTimeout(700);
  assert.equal(await page.getByTestId(`request-row-${requestId}`).count(), 0);
  await page.getByRole("button", { name: "مؤكد", exact: true }).click();
  await row.waitFor({ timeout: 10000 });

  // --- permanent deletion ---
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByLabel(`حذف الطلب ${requestId}`).click();
  await row.waitFor({ state: "detached", timeout: 10000 });

  assert.deepEqual(errors, []);
  await page.close();
});

test("admin: login/logout, product CRUD and content publishing", async () => {
  const { page, errors } = await openAdmin();

  // Setup is finished, so the dashboard asks for credentials instead.
  await page.getByRole("heading", { name: "تسجيل الدخول" }).waitFor({ timeout: 15000 });

  // Wrong password is refused.
  await page.getByLabel("اسم المستخدم").fill(USERNAME);
  await page.getByLabel(/كلمة المرور/).fill("wrong-password-here");
  await page.getByRole("button", { name: "دخول" }).click();
  await page.getByText("اسم المستخدم أو كلمة المرور غير صحيحة.").waitFor();

  await page.getByLabel(/كلمة المرور/).fill(PASSWORD);
  await page.getByRole("button", { name: "دخول" }).click();
  await page.getByRole("heading", { name: "طلبات الجملة" }).waitFor({ timeout: 15000 });

  // --- products: create ---
  await page.getByRole("button", { name: "المنتجات" }).click();
  await page.getByRole("heading", { name: "المنتجات" }).waitFor();
  const productName = "منتج اختبار آلي";
  await page.getByRole("button", { name: "منتج جديد" }).click();
  await page.getByTestId("product-name").fill(productName);
  await page.getByTestId("product-size").fill("2 كجم");
  await page.getByTestId("product-desc").fill("وصف تجريبي");
  await page.getByTestId("product-img").fill("https://example.com/test-product.png");
  await page.getByRole("button", { name: "إضافة", exact: true }).click();
  await page.getByText("تمت إضافة المنتج.").waitFor({ timeout: 15000 });
  await page.getByRole("heading", { name: productName }).waitFor();

  // It is published through the public content endpoint straight away.
  let published = await (await fetch(`${api}/api/content`)).json();
  const created = published.products.find((p) => p.name === productName);
  assert.ok(created, "the new product must be visible in /api/content");

  // --- products: edit ---
  await page.getByTestId(`edit-product-${created.id}`).click();
  const renamed = `${productName} معدّل`;
  await page.getByTestId("product-name").fill(renamed);
  await page.getByRole("button", { name: "حفظ", exact: true }).click();
  await page.getByText("تم تحديث المنتج.").waitFor({ timeout: 15000 });
  published = await (await fetch(`${api}/api/content`)).json();
  assert.ok(
    published.products.some((p) => p.name === renamed),
    "the edit must be published",
  );

  // --- products: delete ---
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByTestId(`delete-product-${created.id}`).click();
  await page.getByText("تم حذف المنتج.").waitFor({ timeout: 15000 });
  published = await (await fetch(`${api}/api/content`)).json();
  assert.equal(
    published.products.some((p) => p.name === renamed),
    false,
    "the deleted product must disappear from published content",
  );

  // --- content: edit and publish ---
  const revisionBefore = published.revision;
  await page.getByRole("button", { name: "محتوى الموقع" }).click();
  await page.getByTestId("site-name").waitFor();
  await page.getByTestId("hero-tagline").fill("شعار محدّث من لوحة التحكم");
  await page.getByRole("button", { name: "نشر التعديلات" }).first().click();
  await page.getByText("تم نشر التعديلات.").waitFor({ timeout: 15000 });
  const afterPublish = await (await fetch(`${api}/api/content`)).json();
  assert.equal(afterPublish.hero.tagline, "شعار محدّث من لوحة التحكم");
  assert.equal(afterPublish.revision, revisionBefore + 1, "publishing bumps the revision");

  // --- logout revokes the session, and protected routes close again ---
  await page.getByRole("button", { name: "خروج" }).click();
  await page.getByRole("heading", { name: "تسجيل الدخول" }).waitFor({ timeout: 15000 });
  await page.reload();
  await page.getByRole("heading", { name: "تسجيل الدخول" }).waitFor({ timeout: 15000 });

  assert.deepEqual(errors, []);
  await page.close();
});
