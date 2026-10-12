// Dev helper (not part of the test suites): signs into the local dashboard and
// writes screenshots of every screen at a given viewport/theme to .playwright/.
// Usage: node tests/shots.mjs [width] [height] [theme] [prefix]
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { launchBrowser } from "./browser.mjs";

const base = process.env.TEST_URL || "http://127.0.0.1:5173";
const api = process.env.TEST_API || "http://127.0.0.1:3001";
const width = Number(process.argv[2] || 1440);
const height = Number(process.argv[3] || 960);
const theme = process.argv[4] || "light";
const prefix = process.argv[5] || `${width}-${theme}`;
const out = ".playwright";

const CREDENTIALS = {
  email: "owner@elpaze.online",
  password: "owner-long-password-1",
  answer: "مشمش",
};

await mkdir(out, { recursive: true });

/** Signs in through the API and returns the cookies for the browser context. */
async function ownerCookies() {
  const jar = new Map();
  const call = async (path, body, csrf) => {
    const headers = { "content-type": "application/json" };
    if (jar.size) headers.cookie = [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
    if (csrf) headers["x-csrf-token"] = csrf;
    const response = await fetch(`${api}${path}`, {
      method: "POST",
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    for (const raw of response.headers.getSetCookie?.() ?? []) {
      const [pair] = raw.split(";");
      const index = pair.indexOf("=");
      jar.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim());
    }
    return { status: response.status, body: await response.json().catch(() => ({})) };
  };
  const login = await call("/api/admin/login", {
    identifier: CREDENTIALS.email,
    password: CREDENTIALS.password,
  });
  if (login.status !== 200) throw new Error(`login failed: ${login.status}`);
  if (login.body.requiresSecurityAnswer) {
    const verified = await call(
      "/api/admin/login/security",
      { answer: CREDENTIALS.answer },
      login.body.pendingCsrf,
    );
    if (verified.status !== 200) throw new Error(`security failed: ${verified.status}`);
  }
  return [...jar].map(([name, value]) => ({
    name,
    value,
    domain: "127.0.0.1",
    path: "/",
    httpOnly: name === "elbaz_session",
    sameSite: "Strict",
  }));
}

const browser = await launchBrowser();
const cookies = await ownerCookies();

/* ------------------------------------------------------------ login screen */
{
  const context = await browser.newContext({
    viewport: { width, height },
    hasTouch: width <= 834,
    isMobile: width <= 430,
  });
  await context.route("https://fonts.googleapis.com/**", (route) => route.abort());
  const page = await context.newPage();
  page.on("pageerror", (error) => console.log("PAGEERROR(login)", error.message));
  await page.addInitScript((value) => localStorage.setItem("elbaz-theme", value), theme);
  await page.goto(`${base}/admin`);
  await page.getByRole("heading", { name: "تسجيل الدخول" }).waitFor({ timeout: 25000 });
  await page.waitForTimeout(900);
  await page.screenshot({ path: join(out, `${prefix}-00-login.png`) });
  await context.close();
}

/* --------------------------------------------------------------- dashboard */
const context = await browser.newContext({
  viewport: { width, height },
  hasTouch: width <= 834,
  isMobile: width <= 430,
});
await context.route("https://fonts.googleapis.com/**", (route) => route.abort());
await context.addCookies(cookies);
const page = await context.newPage();
page.on("pageerror", (error) => console.log("PAGEERROR", error.message));
await page.addInitScript((value) => localStorage.setItem("elbaz-theme", value), theme);
await page.goto(`${base}/admin`);
await page.getByRole("heading", { name: /أهلًا بك/ }).waitFor({ timeout: 30000 });
await page.waitForTimeout(900);
await page.screenshot({ path: join(out, `${prefix}-01-overview.png`) });

const sidebarOpen = async () => {
  if (width > 1024) return;
  if (await page.locator(".sidebar--open").count()) return;
  await page.getByRole("button", { name: "فتح القائمة" }).click();
  await page.locator(".sidebar--open").waitFor({ timeout: 10000 });
  await page.waitForTimeout(350);
};

const go = async (label) => {
  await sidebarOpen();
  await page
    .getByRole("navigation", { name: "أقسام اللوحة" })
    .getByRole("button", { name: label, exact: true })
    .click();
  await page.waitForTimeout(700);
};

const screens = [
  ["المنتجات", "02-products"],
  ["المناسبات", "03-events"],
  ["محتوى الموقع", "04-content"],
  ["طلبات الجملة", "05-requests"],
  ["حسابات المشرفين", "06-admins"],
  ["سجل النشاط", "07-audit"],
];
for (const [label, name] of screens) {
  await go(label);
  await page.screenshot({ path: join(out, `${prefix}-${name}.png`) });
}

// Product modal
await go("المنتجات");
await page.getByRole("button", { name: "منتج جديد" }).click();
await page.getByRole("heading", { name: "منتج جديد" }).waitFor({ timeout: 15000 });
await page.waitForTimeout(500);
await page.screenshot({ path: join(out, `${prefix}-08-product-modal.png`) });
await page.keyboard.press("Escape");
await page.waitForTimeout(300);

// Profile
await sidebarOpen();
await page.locator(".sidebar-foot").getByRole("button", { name: "الملف الشخصي" }).first().click();
await page.locator(".drawer").waitFor({ timeout: 15000 });
await page.waitForTimeout(600);
await page.screenshot({ path: join(out, `${prefix}-09-profile.png`) });

// Mobile navigation drawer
if (width <= 1024) {
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  await sidebarOpen();
  await page.screenshot({ path: join(out, `${prefix}-10-nav.png`) });
}

await context.close();
await browser.close();
console.log(`screenshots written to ${out}/${prefix}-*.png`);
