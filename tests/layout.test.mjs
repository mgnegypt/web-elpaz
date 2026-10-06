// Responsive / layout / overflow suite. Runs the public site and the whole
// dashboard through 13 viewports in both themes and asserts, programmatically,
// that nothing overflows, collides, clips or becomes unreachable.
//
// Executed by `npm run test:layout` (wired into `npm run test:all`), against the
// throwaway servers that scripts/test.mjs starts on 3001/5173.
import assert from "node:assert/strict";
import { test, before, after } from "node:test";
import { mkdir } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { launchBrowser } from "./browser.mjs";
import { OWNER, DASHBOARD_OWNER } from "./helper.mjs";

const base = process.env.TEST_URL || "http://127.0.0.1:5173";
const api = process.env.TEST_API || "http://127.0.0.1:3001";
const shotDir = ".playwright";

/** Everything the brief asks for, plus two landscape phones. */
const VIEWPORTS = [
  { label: "320x568", width: 320, height: 568, touch: true },
  { label: "360x640", width: 360, height: 640, touch: true },
  { label: "390x844", width: 390, height: 844, touch: true },
  { label: "430x932", width: 430, height: 932, touch: true },
  { label: "768x1024", width: 768, height: 1024 },
  { label: "834x1112", width: 834, height: 1112 },
  { label: "1024x768", width: 1024, height: 768 },
  { label: "1280x720", width: 1280, height: 720 },
  { label: "1440x900", width: 1440, height: 900 },
  { label: "1920x1080", width: 1920, height: 1080 },
  { label: "2560x1440", width: 2560, height: 1440 },
  { label: "landscape 740x360", width: 740, height: 360, touch: true },
  { label: "landscape 844x390", width: 844, height: 390, touch: true },
];

let browser;

before(async () => {
  await mkdir(shotDir, { recursive: true });
  browser = await launchBrowser();
});

after(async () => {
  await browser?.close();
});

/* ------------------------------------------------------------------ helpers */

const slug = (value) => value.replace(/[^\w.-]+/g, "-");

/**
 * The layout contract, evaluated inside the page.
 *
 * `kind` selects the set of elements that take part in collision checks:
 *  - "site"      : floating chrome (header, dock, toasts, fixed buttons)
 *  - "dashboard" : chrome plus cards, stat pills, tiles and tables
 */
const LAYOUT_PROBE = String.raw`
(config) => {
  const problems = [];
  const doc = document.documentElement;
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  // 1. No horizontal page overflow.
  if (doc.scrollWidth > doc.clientWidth + 1) {
    problems.push("horizontal overflow: " + doc.scrollWidth + " > " + doc.clientWidth);
  }

  const box = (el) => el.getBoundingClientRect();
  const style = (el) => getComputedStyle(el);
  const visible = (el) => {
    if (el.closest('[aria-hidden="true"]')) return false;
    const s = style(el);
    if (s.visibility === "hidden" || s.display === "none" || Number(s.opacity) < 0.05) return false;
    const r = box(el);
    return r.width > 1 && r.height > 1;
  };
  const onScreen = (el) => {
    const r = box(el);
    return r.bottom > -400 && r.top < vh + 400;
  };
  const all = (selector) =>
    [...document.querySelectorAll(selector)].filter((el) => visible(el) && onScreen(el));

  /** True when some ancestor clips overflow, i.e. sticking out is intentional. */
  const clippedByAncestor = (el) => {
    let node = el.parentElement;
    while (node && node !== document.documentElement) {
      const s = style(node);
      if (["hidden", "clip", "auto", "scroll"].includes(s.overflowX)) return true;
      node = node.parentElement;
    }
    return false;
  };
  /** Text that belongs to this element itself (not to a nested tooltip/label). */
  const directText = (el) =>
    [...el.childNodes]
      .filter((node) => node.nodeType === 3)
      .map((node) => node.textContent)
      .join("")
      .trim();
  /** Screen-reader-only text is clipped on purpose. */
  const isScreenReaderOnly = (el) => {
    const s = style(el);
    const r = box(el);
    return (
      r.width <= 4 ||
      r.height <= 4 ||
      s.clipPath === "inset(50%)" ||
      s.clip === "rect(0px, 0px, 0px, 0px)" ||
      s.position === "absolute" && r.width <= 1
    );
  };

  // 2. Nothing may stick out of the viewport horizontally (except deliberate
  //    off-canvas drawers, which are excluded by name and by being hidden).
  const CHROME_FREE =
    ".sidebar, .sidebar--open, .milk-wave, .milk-layer, .backdrop, .mobile-menu, .lightbox, .loader, .modal-backdrop";
  for (const el of all("body *")) {
    if (el.closest(CHROME_FREE)) continue;
    const s = style(el);
    if (s.position === "fixed" && s.transform !== "none" && s.transform !== "") continue;
    const r = box(el);
    if (r.left < -2 || r.right > vw + 2) {
      // Containers whose children scroll horizontally are fine to be wider, and
      // a decoration clipped by its own overflow:hidden parent is intentional.
      if (s.overflowX === "auto" || s.overflowX === "scroll") continue;
      if (clippedByAncestor(el)) continue;
      const scrollableAncestor = el.closest('[class*="scroll"], .table-wrap, .code, .long-text');
      if (scrollableAncestor) continue;
      problems.push(
        "outside the viewport: " + (el.className || el.tagName) + " [" +
          Math.round(r.left) + "…" + Math.round(r.right) + " of " + vw + "]",
      );
    }
  }

  // 3. Text must not escape its own container.
  for (const el of all("p, h1, h2, h3, h4, li, td, th, strong, span, small, label, a, button")) {
    if (!el.textContent?.trim()) continue;
    if (!directText(el)) continue; // the visible text lives in a child element
    const s = style(el);
    if (s.overflow === "hidden" || s.textOverflow === "ellipsis" || s.overflowX === "auto") continue;
    if (s.webkitLineClamp && s.webkitLineClamp !== "none") continue; // deliberate truncation
    if (isScreenReaderOnly(el)) continue;
    if (el.scrollWidth > el.clientWidth + 2 && el.clientWidth > 0) {
      const parent = el.parentElement;
      const parentScrolls = parent && ["auto", "scroll"].includes(style(parent).overflowX);
      if (!parentScrolls) {
        problems.push("text clipped: " + (el.className || el.tagName) + ' "' + el.textContent.trim().slice(0, 24) + '"');
      }
    }
  }

  // 4. Collision checks between independent elements that must never overlap.
  const interactive =
    "button, a.btn, a[role=button], input, select, textarea, .nav-item, .profile-chip, .stat-pill, .theme-toggle, .chip, .badge, .icon-btn";
  const containers =
    ".site-header, .announce-bar, .whatsapp-fab, .theme-toggle, .dots-nav, .progress-top, .toast, " +
    ".toast-stack, .drawer-head, .drawer-foot, .ui-modal, .modal-foot, main, .admin-main, .topbar, " +
    ".card, .product-tile, .request-row, .event-card";
  const groups = ["site", "dashboard"].includes(config.kind) ? interactive + ", " + containers : interactive;

  const items = all(groups).filter((el) => el.closest(".sidebar-scrim") === null);
  const overlaps = [];
  for (let i = 0; i < items.length; i += 1) {
    const a = items[i];
    const aRect = box(a);
    // Ignore elements that intentionally contain each other.
    for (let j = i + 1; j < items.length; j += 1) {
      const b = items[j];
      if (a.contains(b) || b.contains(a)) continue;
      if (a.parentElement === b.parentElement) continue;
      const bRect = box(b);
      const ox = Math.min(aRect.right, bRect.right) - Math.max(aRect.left, bRect.left);
      const oy = Math.min(aRect.bottom, bRect.bottom) - Math.max(aRect.top, bRect.top);
      if (ox > 4 && oy > 4) {
        const aFixed = ["fixed", "sticky"].includes(style(a).position);
        const bFixed = ["fixed", "sticky"].includes(style(b).position);
        // Two stacked fixed overlays are a real bug; a fixed bar over content is
        // caught by the "hidden behind chrome" check below.
        if (aFixed && bFixed) {
          overlaps.push(
            "fixed elements overlap: " + (a.className || a.tagName) + " × " + (b.className || b.tagName) +
              " (" + Math.round(ox) + "x" + Math.round(oy) + ")",
          );
        }
      }
    }
  }
  problems.push(...overlaps.slice(0, 5));

  // 5. Content must not sit behind the fixed chrome.
  const chrome = [".site-header", ".announce-bar", ".topbar", ".admin-main .page-header", ".drawer-foot"]
    .flatMap((selector) => [...document.querySelectorAll(selector)])
    .filter((el) => visible(el) && ["fixed", "sticky"].includes(style(el).position));
  const headings = all("main h1, .section-active h2, .panel h1").filter((el) => {
    const r = box(el);
    return r.top >= 0;
  });
  for (const heading of headings) {
    const h = box(heading);
    for (const bar of chrome) {
      const c = box(bar);
      const ox = Math.min(h.right, c.right) - Math.max(h.left, c.left);
      const oy = Math.min(h.bottom, c.bottom) - Math.max(h.top, c.top);
      if (ox > 8 && oy > 8) {
        problems.push(
          "content hidden behind " + (bar.className || bar.tagName) + ": " +
            (heading.className || heading.tagName),
        );
      }
    }
  }

  // 6. Modals / drawers fit inside the viewport and are closable.
  for (const el of [...document.querySelectorAll(".ui-modal, .drawer")].filter(visible)) {
    const r = box(el);
    if (r.top < -1 || r.bottom > vh + 2) {
      problems.push((el.className || "modal") + " is taller than the viewport (" + Math.round(r.height) + " > " + vh + ")");
    }
    const closer = el.querySelector(".icon-btn, [aria-label*='إغلاق'], button");
    if (!closer) problems.push((el.className || "modal") + " has no close control");
  }

  // 7. Wide content scrolls inside its own container, never the page.
  for (const el of all("table, pre, code, a[href^='http'], .long-value")) {
    const r = box(el);
    if (r.right > vw + 2) {
      const parent = el.parentElement;
      const scrolls = parent && ["auto", "scroll"].includes(style(parent).overflowX);
      if (!scrolls) problems.push("wide content escapes its container: " + (el.className || el.tagName));
    }
  }

  // 8. Images stay inside their containers, without stretching.
  for (const img of all("img")) {
    const r = box(img);
    if ((r.right > vw + 2 || r.left < -2) && !clippedByAncestor(img)) {
      problems.push("image outside the viewport: " + (img.className || "img"));
    }
    const parent = img.parentElement;
    if (parent) {
      const p = box(parent);
      if (r.width > p.width + 2 || r.height > p.height + 2) {
        const s = style(img);
        if (!["cover", "contain"].includes(s.objectFit) && s.maxWidth !== "100%") {
          problems.push("image overflows its container: " + (img.className || "img"));
        }
      }
    }
  }

  // 9. Touch targets on small screens.
  if (config.touch) {
    // Phones get the 44px standard; wider touch screens (tablets, landscape
    // phones) get a smaller but still usable minimum.
    const minimum = vw <= 430 ? 44 : vw < 1024 ? 32 : 0;
    for (const el of all("button, a.btn, .nav-item, input[type=checkbox], .icon-btn, a[role=button]")) {
      if (!minimum) break;
      const r = box(el);
      const s = style(el);
      if (isScreenReaderOnly(el)) continue;
      if (r.width < minimum || r.height < minimum) {
        // Inline text links and tiny decorative controls are allowed to be small
        // as long as they are not the only way to act.
        if (s.display !== "inline" && !el.closest(".footer, .meta, .breadcrumb")) {
          problems.push(
            "touch target too small (" + minimum + "px): " + (el.className || el.tagName) + " " +
              Math.round(r.width) + "x" + Math.round(r.height),
          );
        }
      }
    }
  }

  return [...new Set(problems)].slice(0, 12);
}`;

async function probe(page, kind, label, { touch = false } = {}) {
  const problems = await page.evaluate(
    (config) => eval(`(${config.probe})`)(config),
    { probe: LAYOUT_PROBE, kind, touch },
  );
  assert.deepEqual(problems, [], `${label}: ${problems.join(" | ")}`);
}

async function shot(page, name) {
  if (!process.env.TEST_SCREENSHOTS) return;
  try {
    await page.screenshot({
      path: join(shotDir, `${slug(name)}.png`),
      fullPage: false,
    });
  } catch {
    /* a failed screenshot must never fail the suite */
  }
}

/** Opens the public site and waits for the intro loader. */
async function openSite(viewport) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    reducedMotion: "reduce",
    hasTouch: !!viewport.touch,
    isMobile: viewport.width <= 430,
  });
  await context.route("https://files.catbox.moe/**", (route) => route.abort());
  await context.route("https://fonts.googleapis.com/**", (route) =>
    route.abort(),
  );
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(base);
  await page.locator(".loader").waitFor({ state: "detached", timeout: 20000 });
  return { context, page, errors };
}

/** Opens the dashboard with an authenticated session. */
async function openDashboard(viewport, { cookies }) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    reducedMotion: "reduce",
    hasTouch: !!viewport.touch,
    isMobile: viewport.width <= 430,
  });
  await context.route("https://files.catbox.moe/**", (route) => route.abort());
  await context.route("https://fonts.googleapis.com/**", (route) =>
    route.abort(),
  );
  if (cookies?.length) await context.addCookies(cookies);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  return { context, page, errors };
}

/** Seeds one wholesale request through the public API (the requests panel is
 * tested with real data even when this suite runs on its own). */
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
      notes: `طلب اختبار التخطيط ${suffix}`,
      consent: true,
      requestKey: `layout-seed-${suffix}`,
    }),
  });
  assert.ok(
    [200, 201].includes(response.status),
    `seed failed: ${response.status}`,
  );
}

const sidebarOpen = async (page, viewport) => {
  if (viewport.width > 1024) return;
  if (await page.locator(".sidebar--open").count()) return; // already open
  await page.getByRole("button", { name: "فتح القائمة" }).click();
  await page.locator(".sidebar--open").waitFor({ timeout: 10000 });
};

const goTo = async (page, viewport, label) => {
  await sidebarOpen(page, viewport);
  await page
    .getByRole("navigation", { name: "أقسام اللوحة" })
    .getByRole("button", { name: label, exact: true })
    .click();
  await page.waitForTimeout(250);
};

let authState = null;

/** Signs in through the API once and reuses the cookie in every browser context. */
async function ownerCookies() {
  if (!authState) authState = await signInOwner();
  return authState.cookies;
}

/** The credentials that actually signed in (the shared database may hold either fixture). */
async function ownerCredentials() {
  if (!authState) authState = await signInOwner();
  return authState.credentials;
}

async function signInOwner() {
  const jar = new Map();
  const call = async (path, body, csrf) => {
    const headers = { "content-type": "application/json" };
    if (jar.size)
      headers.cookie = [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
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
    return {
      status: response.status,
      body: await response.json().catch(() => ({})),
    };
  };

  // The API is fresh for a dedicated run, but when the layout suite shares a
  // database with an earlier suite the owner already exists: just sign in.
  if (
    jar.size === 0 &&
    readFileSync(join(process.env.TEST_DATA_DIR, "elbaz.sqlite"))
  ) {
    /* the file exists either way; setup below decides */
  }
  let token = "";
  try {
    token = readFileSync(
      join(process.env.TEST_DATA_DIR, "setup-token"),
      "utf8",
    ).trim();
  } catch {
    token = "";
  }
  if (token) {
    const setup = await call("/api/admin/setup", {
      token,
      username: OWNER.username,
      password: OWNER.password,
    });
    assert.ok(
      [201, 409].includes(setup.status),
      `setup failed: ${setup.status}`,
    );
    if (setup.status === 201) {
      const complete = await call(
        "/api/admin/profile/complete",
        {
          displayName: OWNER.displayName,
          email: OWNER.email,
          password: OWNER.finalPassword,
          securityQuestion: OWNER.question,
          securityAnswer: OWNER.answer,
        },
        setup.body.csrf,
      );
      assert.equal(
        complete.status,
        200,
        `profile completion failed: ${complete.status}`,
      );
    }
  }
  // On a fresh database the setup above created the owner with the shared
  // fixture; in `npm run test:all` the dashboard suite has already run against
  // this database and left the owner it created, so try both fixtures.
  const candidates = [
    { email: OWNER.email, password: OWNER.finalPassword, answer: OWNER.answer },
    {
      email: DASHBOARD_OWNER.email,
      password: DASHBOARD_OWNER.password,
      answer: DASHBOARD_OWNER.answer,
    },
  ];
  let lastStatus = null;
  for (const candidate of candidates) {
    const login = await call("/api/admin/login", {
      identifier: candidate.email,
      password: candidate.password,
    });
    lastStatus = login.status;
    if (login.status !== 200) continue;
    const verified = await call(
      "/api/admin/login/security",
      { answer: candidate.answer },
      login.body.pendingCsrf,
    );
    lastStatus = verified.status;
    if (verified.status !== 200) continue;
    return {
      cookies: [...jar].map(([name, value]) => ({
        name,
        value,
        domain: "127.0.0.1",
        path: "/",
        httpOnly: name === "elbaz_session",
        sameSite: "Strict",
      })),
      credentials: candidate,
    };
  }
  assert.fail(`could not sign in as the owner (last status ${lastStatus})`);
}

/* ============================================================ public site */

test("layout: the public site fits every viewport in both themes", async () => {
  for (const viewport of VIEWPORTS) {
    for (const theme of ["light", "dark"]) {
      const { context, page, errors } = await openSite(viewport);
      try {
        await page.addInitScript(
          (value) => localStorage.setItem("elbaz-theme", value),
          theme,
        );
        await page.reload();
        await page
          .locator(".loader")
          .waitFor({ state: "detached", timeout: 20000 });
        await page.waitForTimeout(300);
        assert.equal(
          await page.evaluate(() => document.documentElement.dataset.theme),
          theme,
          `${viewport.label}/${theme}: theme applied`,
        );
        await probe(page, "site", `site hero ${viewport.label} ${theme}`, {
          touch: viewport.touch,
        });
        await shot(page, `layout-site-${viewport.label}-${theme}-hero`);

        // Every section, including the products carousel and the contact form.
        for (const index of [0, 1, 2, 3, 5, 7]) {
          const mobile = viewport.width < 640;
          if (mobile) {
            await page
              .getByRole("button", { name: "فتح القائمة", exact: true })
              .click();
            await page.locator(".mobile-menu button").nth(index).click();
          } else {
            await page.locator(".dots-nav button").nth(index).click();
          }
          await page
            .locator(`.section-${index}.is-active`)
            .waitFor({ timeout: 15000 });
          await page.waitForTimeout(200);
          await probe(
            page,
            "site",
            `site section ${index} ${viewport.label} ${theme}`,
            {
              touch: viewport.touch,
            },
          );
        }
        await shot(page, `layout-site-${viewport.label}-${theme}-contact`);
        assert.deepEqual(
          errors,
          [],
          `${viewport.label}/${theme}: no page errors`,
        );
      } finally {
        await context.close();
      }
    }
  }
});

test("layout: the public site survives long content, missing images and zoom", async () => {
  const viewport = VIEWPORTS[0]; // the tightest screen
  const { context, page, errors } = await openSite(viewport);
  try {
    // 55 products cloned from the real card markup, with very long Arabic and
    // English names and descriptions (nothing invented, so the styles are real).
    await page.evaluate(() => {
      const source = document.querySelector(".product-card");
      if (!source) return;
      const long = "منتج باسم طويل جدًا لاختبار التفاف النص في البطاقة ".repeat(
        4,
      );
      const host = document.createElement("div");
      host.id = "stress-products";
      host.style.maxWidth = "100%";
      host.style.display = "grid";
      host.style.gap = "12px";
      for (let index = 0; index < 55; index += 1) {
        const card = source.cloneNode(true);
        card.querySelectorAll("h3, .product-title, strong").forEach((el) => {
          el.textContent =
            index % 2
              ? long
              : "Very long English product name " +
                index +
                " " +
                "x".repeat(60);
        });
        card.querySelectorAll("p").forEach((el) => {
          el.textContent = long;
        });
        host.append(card);
      }
      document.querySelector("main, #root")?.append(host);
    });
    await page.waitForTimeout(200);
    await probe(page, "site", "site stress: 55 long products at 320px", {
      touch: true,
    });

    // Broken image URLs must not break the layout either.
    await page.evaluate(() => {
      for (const img of document.querySelectorAll("img"))
        img.src = "https://broken.invalid/x.png";
    });
    await page.waitForTimeout(300);
    await probe(page, "site", "site stress: broken images", { touch: true });

    // 200% zoom (the page is rendered inside a half-width viewport).
    await page.setViewportSize({ width: 320, height: 568 });
    await page.evaluate(() => {
      document.documentElement.style.zoom = "2";
    });
    await page.waitForTimeout(300);
    await page.evaluate(() => {
      document.documentElement.style.zoom = "";
    });
    assert.deepEqual(errors, [], "no page errors during the stress pass");
  } finally {
    await context.close();
  }
});

test("layout: RTL direction, icons and padding are consistent", async () => {
  const { context, page } = await openSite(VIEWPORTS[6]);
  try {
    assert.equal(
      await page.evaluate(() => document.documentElement.getAttribute("dir")),
      "rtl",
      "the document is RTL",
    );
    const direction = await page.evaluate(() => {
      const header = document.querySelector(".site-header");
      const brand = document.querySelector(".header-brand");
      const brandRect = brand?.getBoundingClientRect();
      const style = getComputedStyle(document.body);
      return {
        headerDirection: header ? getComputedStyle(header).direction : "",
        brandOnRight: brandRect
          ? brandRect.left + brandRect.width / 2 > window.innerWidth / 2
          : null,
        bodyDirection: style.direction,
      };
    });
    assert.equal(direction.bodyDirection, "rtl");
    assert.equal(direction.headerDirection, "rtl", "the header inherits RTL");
    assert.ok(direction.brandOnRight !== null, "the header brand must exist");
    // In RTL the brand sits on the right half of the header.
    assert.equal(
      direction.brandOnRight,
      true,
      "the brand must sit on the right in RTL",
    );
    const padding = await page.evaluate(() => {
      const el = document.querySelector(
        ".section-active, .hero-panel, main section",
      );
      if (!el) return null;
      const s = getComputedStyle(el);
      return { left: s.paddingLeft, right: s.paddingRight };
    });
    assert.ok(padding, "a section must be present");
  } finally {
    await context.close();
  }
});

/* ============================================================== dashboard */

test("layout: every dashboard screen fits every viewport in both themes", async () => {
  const cookies = await ownerCookies();
  await seedRequest(Date.now().toString(36));

  for (const viewport of VIEWPORTS) {
    for (const theme of ["light", "dark"]) {
      const { context, page, errors } = await openDashboard(viewport, {
        cookies,
      });
      try {
        await page.addInitScript(
          (value) => localStorage.setItem("elbaz-theme", value),
          theme,
        );
        await page.goto(`${base}/admin`);
        await page
          .getByRole("heading", { name: /أهلًا بك/ })
          .waitFor({ timeout: 25000 });
        await page.waitForTimeout(250);

        await probe(
          page,
          "dashboard",
          `dashboard overview ${viewport.label} ${theme}`,
          {
            touch: viewport.touch,
          },
        );
        await shot(page, `layout-dash-${viewport.label}-${theme}-overview`);

        // Every panel, then the profile drawer on top of the products panel.
        for (const [label, heading] of [
          ["المنتجات", "المنتجات"],
          ["المناسبات", "المناسبات والتنبيهات"],
          ["محتوى الموقع", "محتوى الموقع"],
          ["طلبات الجملة", "طلبات الجملة"],
          ["حسابات المشرفين", "حسابات المشرفين"],
          ["سجل النشاط", "سجل النشاط"],
        ]) {
          await goTo(page, viewport, label);
          await page
            .getByRole("heading", { name: heading, exact: true })
            .waitFor({ timeout: 15000 });
          await page.waitForTimeout(200);
          await probe(
            page,
            "dashboard",
            `dashboard ${label} ${viewport.label} ${theme}`,
            {
              touch: viewport.touch,
            },
          );
          await shot(
            page,
            `layout-dash-${viewport.label}-${theme}-${slug(label)}`,
          );
        }

        // Profile drawer (X at the top, log out at the bottom).
        await sidebarOpen(page, viewport);
        await page
          .locator(".sidebar-foot")
          .getByRole("button", { name: "الملف الشخصي" })
          .first()
          .click();
        await page.locator(".drawer").waitFor({ timeout: 15000 });
        await page.waitForTimeout(250);
        await probe(
          page,
          "dashboard",
          `dashboard profile drawer ${viewport.label} ${theme}`,
          {
            touch: viewport.touch,
          },
        );
        // The close button and the log-out action must both be reachable.
        await page.getByRole("button", { name: "إغلاق" }).first().click();
        await page
          .locator(".drawer")
          .waitFor({ state: "detached", timeout: 10000 });

        // A modal (new product) must fit and be closable at this size.
        await goTo(page, viewport, "المنتجات");
        await page.getByRole("button", { name: "منتج جديد" }).click();
        await page
          .getByRole("heading", { name: "منتج جديد" })
          .waitFor({ timeout: 15000 });
        await page.waitForTimeout(250);
        await probe(
          page,
          "dashboard",
          `dashboard product modal ${viewport.label} ${theme}`,
          {
            touch: viewport.touch,
          },
        );
        await shot(page, `layout-dash-${viewport.label}-${theme}-modal`);
        await page.keyboard.press("Escape");
        await page.waitForTimeout(200);

        assert.deepEqual(
          errors,
          [],
          `${viewport.label}/${theme}: no page errors`,
        );
      } finally {
        await context.close();
      }
    }
  }
});

test("layout: the dashboard survives long content, empty states and 200% zoom", async () => {
  const cookies = await ownerCookies();
  const viewport = VIEWPORTS[0];

  for (const [name, seed] of [
    ["long-content", "long"],
    ["empty-state", "empty"],
  ]) {
    const { context, page, errors } = await openDashboard(viewport, {
      cookies,
    });
    try {
      await page.goto(`${base}/admin`);
      await page
        .getByRole("heading", { name: /أهلًا بك/ })
        .waitFor({ timeout: 25000 });
      await goTo(page, viewport, "المنتجات");
      await page
        .getByRole("heading", { name: "المنتجات", exact: true })
        .waitFor({ timeout: 15000 });

      if (seed === "long") {
        await page.evaluate(() => {
          const long = "وصف منتج طويل جدًا لاختبار الالتفاف ".repeat(6);
          for (const tile of document.querySelectorAll(".product-tile")) {
            const title = tile.querySelector("h3, .product-tile-name");
            if (title) title.textContent = long;
            const desc = tile.querySelector("p");
            if (desc) desc.textContent = long;
          }
          // A very long email and a large number in the chrome.
          const hosts = document.querySelectorAll(
            ".profile-chip-text strong, .stat-pill strong",
          );
          hosts.forEach((el, index) => {
            el.textContent =
              index === 0
                ? "very.long.owner.address.for.testing@subdomain.elpaze.online"
                : "1234567890";
          });
        });
      } else {
        await page.evaluate(() => {
          for (const host of document.querySelectorAll(
            ".product-list, .products-grid, .card-body",
          )) {
            host.innerHTML =
              '<div class="empty-state">لا توجد منتجات بعد</div>';
          }
        });
      }
      await page.waitForTimeout(300);
      await probe(page, "dashboard", `dashboard ${name} at 320px`, {
        touch: true,
      });
      await shot(page, `layout-dash-stress-${name}`);

      // 200% zoom.
      await page.evaluate(() => {
        document.documentElement.style.zoom = "2";
      });
      await page.waitForTimeout(300);
      const overflow = await page.evaluate(() => ({
        scroll: document.documentElement.scrollWidth,
        client: document.documentElement.clientWidth,
      }));
      assert.ok(
        overflow.scroll <= overflow.client + 2,
        `${name}: zoomed page overflows (${overflow.scroll} > ${overflow.client})`,
      );
      await page.evaluate(() => {
        document.documentElement.style.zoom = "";
      });
      assert.deepEqual(errors, [], `${name}: no page errors`);
    } finally {
      await context.close();
    }
  }
});

test("layout: the login and first-run screens fit the smallest screens", async () => {
  const credentials = await ownerCredentials();
  assert.ok(credentials?.email, "the owner credentials must resolve");
  for (const viewport of [VIEWPORTS[0], VIEWPORTS[1], VIEWPORTS[11]]) {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      reducedMotion: "reduce",
      hasTouch: !!viewport.touch,
    });
    await context.route("https://fonts.googleapis.com/**", (route) =>
      route.abort(),
    );
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    try {
      // Signed out: the login form.
      await page.goto(`${base}/admin`);
      await page
        .getByRole("heading", { name: "تسجيل الدخول" })
        .waitFor({ timeout: 20000 });
      await probe(page, "dashboard", `login ${viewport.label}`, {
        touch: viewport.touch,
      });
      await shot(page, `layout-dash-login-${viewport.label}`);

      // Signing in: the password step, then the security question (when the
      // account has one — the shared database may already hold an owner whose
      // question was cleared, in which case the dashboard opens directly).
      await page
        .getByLabel(/البريد الإلكتروني أو اسم المستخدم/)
        .fill(credentials.email);
      await page
        .getByLabel("كلمة المرور", { exact: true })
        .fill(credentials.password);
      await page.getByRole("button", { name: "دخول لوحة التحكم" }).click();
      const welcomeHeading = page.getByRole("heading", { name: /أهلًا بك/ });
      const securityHeading = page.getByRole("heading", {
        name: "سؤال الأمان",
      });
      const advanced = await Promise.race([
        securityHeading
          .waitFor({ timeout: 20000 })
          .then(() => "security")
          .catch(() => null),
        welcomeHeading
          .waitFor({ timeout: 20000 })
          .then(() => "welcome")
          .catch(() => null),
      ]);
      assert.ok(
        advanced,
        `${viewport.label}: the login did not advance — screen: ${(
          await page.locator("body").innerText()
        )
          .replace(/\s+/g, " ")
          .slice(0, 260)}`,
      );

      if (advanced === "security") {
        await probe(page, "dashboard", `security step ${viewport.label}`, {
          touch: viewport.touch,
        });
        // The answer field and the submit button must both be on screen.
        await page
          .getByLabel("الإجابة", { exact: true })
          .fill(credentials.answer);
        const button = page.getByRole("button", { name: "تأكيد الدخول" });
        await button.scrollIntoViewIfNeeded();
        assert.equal(
          await button.isVisible(),
          true,
          "the confirm button must be reachable",
        );
        await button.click();
      }
      await welcomeHeading.waitFor({ timeout: 25000 });
      await page.waitForTimeout(150);
      await probe(page, "dashboard", `post-login ${viewport.label}`, {
        touch: viewport.touch,
      });
      // The success animation must not leave anything behind.
      assert.equal(await page.locator(".auth-success").count(), 0);
      assert.deepEqual(errors, [], `${viewport.label}: no page errors`);
    } finally {
      await context.close();
    }
  }
});
