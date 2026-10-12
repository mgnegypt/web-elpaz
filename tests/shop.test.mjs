// The storefront purchase flow, in a real browser against the real server:
// add to cart → cart survives a reload → checkout → an order that genuinely
// exists in the database → a receipt that matches it.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { launchBrowser } from "./browser.mjs";
import { DASHBOARD_OWNER, OWNER } from "./helper.mjs";

const base = process.env.TEST_URL || "http://127.0.0.1:5173";
const apiBase = process.env.TEST_API || "http://127.0.0.1:3001";
const dataDir = process.env.TEST_DATA_DIR;

let browser;
let admin;
let seeded;
let original;

/** A cookie-aware client for the API server this suite shares with the browser. */
function createClient() {
  const jar = new Map();
  const request = async (path, init = {}) => {
    const headers = { ...(init.headers ?? {}) };
    if (jar.size) headers.cookie = [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
    const response = await fetch(apiBase + path, { ...init, headers, redirect: "manual" });
    for (const cookie of response.headers.getSetCookie?.() ?? []) {
      const [pair] = cookie.split(";");
      const index = pair.indexOf("=");
      const name = pair.slice(0, index).trim();
      const value = pair.slice(index + 1).trim();
      if (value === "" || /Max-Age=0/i.test(cookie)) jar.delete(name);
      else jar.set(name, value);
    }
    const text = await response.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }
    return { status: response.status, body };
  };
  const json = (path, method, payload, headers = {}) =>
    request(path, {
      method,
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(payload),
    });
  return { request, json };
}

/**
 * Signs in as the owner. The suite can run on a fresh database (first-run
 * setup) or after the dashboard suite has already created the account.
 */
async function signIn(client) {
  const status = await client.request("/api/admin/status");
  if (status.body?.needsSetup) {
    const token = readFileSync(join(dataDir, "setup-token"), "utf8").trim();
    const created = await client.json("/api/admin/setup", "POST", {
      token,
      username: OWNER.username,
      password: OWNER.password,
    });
    await client.json(
      "/api/admin/profile/complete",
      "POST",
      {
        displayName: OWNER.displayName,
        email: OWNER.email,
        password: OWNER.finalPassword,
        securityQuestion: OWNER.question,
        securityAnswer: OWNER.answer,
      },
      { "x-csrf-token": created.body.csrf },
    );
    await client.json("/api/admin/login", "POST", {
      identifier: OWNER.email,
      password: OWNER.finalPassword,
    });
    const verified = await client.json("/api/admin/login/security", "POST", {
      answer: OWNER.answer,
    });
    return verified.body.csrf;
  }
  // The dashboard suite already created the owner on this database.
  for (const account of [
    {
      identifier: DASHBOARD_OWNER.email,
      password: DASHBOARD_OWNER.password,
      answer: DASHBOARD_OWNER.answer,
    },
    {
      identifier: OWNER.email,
      password: OWNER.finalPassword,
      answer: OWNER.answer,
    },
  ]) {
    const login = await client.json("/api/admin/login", "POST", {
      identifier: account.identifier,
      password: account.password,
    });
    if (login.status !== 200) continue;
    if (!login.body.requiresSecurityAnswer) return login.body.csrf;
    const verified = await client.json("/api/admin/login/security", "POST", {
      answer: account.answer,
    });
    if (verified.status === 200) return verified.body.csrf;
  }
  throw new Error("could not sign in to publish shop fixtures");
}

/** Publishes real prices and commerce settings, the way the dashboard does. */
async function publishShopFixture(client, csrf) {
  const current = await client.request("/api/admin/content");
  const document = current.body;
  original = document;
  const products = document.products.map((product, index) => {
    if (index === 0)
      return { ...product, price: 120, discountPercent: 0, availability: "available", quantity: 8 };
    if (index === 1)
      return { ...product, price: 80, discountPercent: 25, availability: "available", quantity: 6 };
    if (index === 2)
      return { ...product, price: 60, availability: "available", quantity: 0 };
    return product;
  });
  const saved = await client.json(
    "/api/admin/content",
    "PUT",
    {
      ...document,
      products,
      commerce: {
        ...document.commerce,
        ordersEnabled: true,
        codEnabled: true,
        minOrderTotal: 0,
        deliveryZones: [{ id: "giza", name: "الجيزة", fee: 20, note: "" }],
        freeDeliveryOver: null,
      },
      revision: document.revision,
    },
    { "x-csrf-token": csrf },
  );
  assert.equal(saved.status, 200, "publishing the shop fixture must succeed");
  return {
    inStock: products[0],
    discounted: products[1],
    soldOut: products[2],
  };
}

before(async () => {
  browser = await launchBrowser();
  admin = createClient();
  const csrf = await signIn(admin);
  admin.csrf = csrf;
  seeded = await publishShopFixture(admin, csrf);
});

after(async () => {
  await browser?.close();
  // `npm test` runs every suite against one database, so this suite puts the
  // catalogue back exactly as it found it (no prices, no stock, no zones).
  // Otherwise the sold-out fixture would change what the other suites see.
  if (original && admin?.csrf) {
    const current = await admin.request("/api/admin/content");
    await admin.json(
      "/api/admin/content",
      "PUT",
      { ...original, revision: current.body?.revision ?? original.revision },
      { "x-csrf-token": admin.csrf },
    );
  }
});

async function openShop({ width = 1280, height = 900 } = {}) {
  const page = await browser.newPage({
    viewport: { width, height },
    reducedMotion: "reduce",
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("https://files.catbox.moe/**", (route) => route.abort());
  await page.goto(base);
  await page.locator(".loader").waitFor({ state: "detached", timeout: 20000 });
  return { page, errors };
}

const toProducts = async (page) => {
  await page.locator(".dots-nav button").nth(1).click();
  await page.locator(".section-1.is-active").waitFor({ state: "visible" });
  await page.waitForTimeout(350);
};

test("prices and the add-to-cart button appear only for products that have both a price and stock", async () => {
  const { page, errors } = await openShop();
  await toProducts(page);

  const priced = page.locator(".product-card", { hasText: seeded.inStock.name }).first();
  await priced.locator(".price-tag").first().waitFor();
  assert.match(await priced.locator(".price-tag").first().innerText(), /120/);

  const discounted = page
    .locator(".product-card", { hasText: seeded.discounted.name })
    .first();
  const discountedText = await discounted.locator(".price-tag").first().innerText();
  assert.match(discountedText, /60/, "a 25% discount on 80 must show as 60");
  assert.match(discountedText, /80/, "the original price stays visible");

  const soldOut = page.locator(".product-card", { hasText: seeded.soldOut.name }).first();
  assert.equal(
    await soldOut.getByRole("button", { name: "أضف إلى السلة" }).count(),
    0,
    "a sold-out product must not be addable",
  );
  assert.match(await soldOut.innerText(), /نفدت الكمية/);

  assert.deepEqual(errors, []);
  await page.close();
});

test("the cart adds, updates and survives a reload", async () => {
  const { page, errors } = await openShop();
  await toProducts(page);

  await page
    .locator(".product-card", { hasText: seeded.inStock.name })
    .first()
    .getByRole("button", { name: "أضف إلى السلة" })
    .click();

  const drawer = page.locator(".cart-drawer");
  await drawer.waitFor();
  await drawer
    .getByRole("button", { name: `زيادة كمية ${seeded.inStock.name}` })
    .click();
  await page.waitForTimeout(150);
  assert.match(
    await drawer.locator(".totals-table__total dd").innerText(),
    /240/,
    "2 × 120 must total 240",
  );

  await page.getByRole("button", { name: "إغلاق السلة" }).click();
  await page.reload();
  await page.locator(".loader").waitFor({ state: "detached", timeout: 20000 });
  const badge = page.locator(".cart-badge");
  await badge.waitFor();
  assert.equal((await badge.innerText()).trim(), "2", "the basket survives a reload");

  assert.deepEqual(errors, []);
  await page.close();
});

test("checkout creates a real order and the receipt matches what was stored", async () => {
  const { page, errors } = await openShop();
  await toProducts(page);

  await page
    .locator(".product-card", { hasText: seeded.discounted.name })
    .first()
    .getByRole("button", { name: "أضف إلى السلة" })
    .click();
  await page.locator(".cart-drawer").waitFor();
  await page.getByRole("button", { name: "إتمام الطلب" }).click();
  await page.waitForURL(/\/checkout$/);

  // An empty form must not submit.
  await page.getByRole("button", { name: "مراجعة الطلب" }).click();
  assert.equal(await page.locator(".field-error").count() > 0, true);

  await page.fill("#co-name", "ليلى حسن");
  await page.fill("#co-phone", "0101 234 5678");
  await page.fill("#co-address", "١٢ شارع الجمهورية، الدور الثاني، شقة ٥");
  await page.selectOption("#co-zone", "giza");
  await page.getByRole("button", { name: "مراجعة الطلب" }).click();

  await page.getByRole("button", { name: "تأكيد وإرسال الطلب" }).click();
  await page.waitForURL(/\/order\//, { timeout: 15000 });

  const reference = (await page.locator(".receipt__ref").innerText()).trim();
  assert.match(reference, /^EB-\d{6}-[A-Z0-9]{5}$/);
  const receipt = await page.locator(".receipt").innerText();
  assert.match(receipt, /60/, "line price");
  assert.match(receipt, /20/, "delivery fee from the configured zone");
  assert.match(receipt, /80/, "total = 60 + 20");
  assert.match(receipt, /بانتظار التأكيد/);
  assert.match(receipt, /ليس فاتورة ضريبية رسمية/);

  // The page must never be indexable.
  assert.equal(
    await page.locator('meta[name="robots"][content*="noindex"]').count(),
    1,
  );

  // And the order must really exist, with the server's own totals.
  const stored = await admin.request("/api/admin/orders?limit=5");
  const order = stored.body.items.find((item) => item.reference === reference);
  assert.ok(order, "the dashboard must list the new order");
  assert.equal(order.total, 80);
  assert.equal(order.shipping, 20);
  assert.equal(order.customer.phone, "01012345678");
  assert.equal(order.status, "pending");

  // Reopening the link (back/refresh) still shows the same order.
  await page.reload();
  await page.locator(".receipt__ref").waitFor();
  assert.equal((await page.locator(".receipt__ref").innerText()).trim(), reference);

  assert.deepEqual(errors, []);
  await page.close();
});

test("an order link without its token shows nothing", async () => {
  const stored = await admin.request("/api/admin/orders?limit=1");
  const reference = stored.body.items[0]?.reference;
  assert.ok(reference, "the previous test must have created an order");

  const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
  // A different browser profile: no saved token for this reference.
  await page.goto(`${base}/order/${reference}`);
  await page.locator(".notice-card").waitFor({ timeout: 15000 });
  const text = await page.locator(".notice-card").innerText();
  assert.match(text, /لم نتمكن من فتح هذا الطلب/);
  assert.equal(await page.locator(".receipt").count(), 0);
  await page.close();
});
