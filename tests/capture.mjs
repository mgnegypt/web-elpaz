import { launchBrowser } from "./browser.mjs";
import { mkdir } from "node:fs/promises";
await mkdir(".playwright", { recursive: true });
const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on("pageerror", (e) => console.log("ERROR", e.message));
await page.goto("http://localhost:5173");
await page.locator(".loader").waitFor({ state: "detached", timeout: 12000 });
await page.waitForTimeout(1000);
await page.screenshot({ path: ".playwright/hero-desktop.png" });
console.log(
  "images",
  await page
    .locator(".hero-product img")
    .evaluateAll((imgs) =>
      imgs.map((i) => ({
        src: i.src,
        complete: i.complete,
        width: i.naturalWidth,
      })),
    ),
);
await page.setViewportSize({ width: 390, height: 844 });
await page.screenshot({ path: ".playwright/hero-mobile.png" });
await page.getByRole("button", { name: "انتقل إلى المنتجات" }).click();
await page.waitForTimeout(1800);
await page.screenshot({ path: ".playwright/products-mobile.png" });
await browser.close();
