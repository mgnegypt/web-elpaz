// Visual capture helper: `npm run test:capture` against a running dev server.
// Writes screenshots to .playwright/ (git-ignored).
import { launchBrowser } from "./browser.mjs";
import { mkdir } from "node:fs/promises";

const base = process.env.TEST_URL || "http://127.0.0.1:5173";
await mkdir(".playwright", { recursive: true });

const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on("pageerror", (error) => console.log("PAGEERROR", error.message));
await page.route("https://fonts.googleapis.com/**", (route) => route.abort());
await page.goto(base);
await page.locator(".loader").waitFor({ state: "detached", timeout: 15000 });
await page.waitForTimeout(1200);

const jump = async (index) => {
  const mobile = page.viewportSize().width < 640;
  if (mobile) {
    await page.getByRole("button", { name: "فتح القائمة", exact: true }).click();
    await page.locator(".mobile-menu button").nth(index).click();
  } else {
    await page.locator(".dots-nav button").nth(index).click();
  }
  await page.locator(`.section-${index}.is-active`).waitFor();
  await page.waitForTimeout(1800);
};

const setTheme = async (theme) => {
  await page.evaluate((value) => {
    document.documentElement.dataset.theme = value;
    document.documentElement.style.colorScheme = value;
    window.localStorage.setItem("elbaz-theme", value);
  }, theme);
  await page.waitForTimeout(450);
};

console.log("images", await page.locator(".hero-product img").evaluateAll((imgs) =>
  imgs.map((i) => ({ src: i.currentSrc || i.src, complete: i.complete, width: i.naturalWidth })),
));

for (const theme of ["light", "dark"]) {
  await setTheme(theme);
  await jump(0);
  await page.screenshot({ path: `.playwright/hero-${theme}-desktop.png` });
  await jump(1);
  await page.screenshot({ path: `.playwright/products-${theme}-desktop.png` });
  await jump(3);
  await page.screenshot({ path: `.playwright/about-${theme}-desktop.png` });
  await jump(7);
  await page.screenshot({ path: `.playwright/contact-${theme}-desktop.png` });
}

await page.setViewportSize({ width: 390, height: 844 });
for (const theme of ["light", "dark"]) {
  await setTheme(theme);
  await jump(0);
  await page.screenshot({ path: `.playwright/hero-${theme}-mobile.png` });
  await jump(1);
  await page.screenshot({ path: `.playwright/products-${theme}-mobile.png` });
}

// Admin dashboard (light + dark)
for (const theme of ["light", "dark"]) {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${base}/admin`);
  await page.waitForTimeout(900);
  await setTheme(theme);
  await page.screenshot({ path: `.playwright/admin-${theme}.png` });
}

await browser.close();
console.log("screenshots written to .playwright/");
