// Raw-server-rendered HTML: metadata that crawlers, link unfurlers and the
// "view source" audience see *before* any JavaScript runs.
//
// Regression cover for the placeholder domain: the canonical, og:url,
// og:image, robots.txt and sitemap.xml must all point at the production host,
// and none of them may still carry the YOUR-DOMAIN placeholder.
//
// No browser is launched here — these are plain HTTP reads of the served
// files, which is exactly what a crawler that does not execute JS sees.
import { test } from "node:test";
import assert from "node:assert/strict";

const base = (process.env.TEST_URL || "http://127.0.0.1:5173").replace(
  /\/$/,
  "",
);

/** The production host, kept in one place. */
const SITE_ORIGIN = "https://mgneg.online";

const get = async (path) => {
  const response = await fetch(base + path);
  assert.equal(response.status, 200, `${path} must be served`);
  return response.text();
};

const attr = (html, pattern) => {
  const match = html.match(pattern);
  return match ? match[1] : null;
};

test("the served HTML carries no placeholder domain", async () => {
  const html = await get("/");
  for (const placeholder of ["YOUR-DOMAIN", "yourdomain", "example.com"]) {
    assert.ok(
      !html.includes(placeholder),
      `the served HTML still contains the placeholder "${placeholder}"`,
    );
  }
});

test("canonical and og:url are the absolute production URL", async () => {
  const html = await get("/");
  const canonical = attr(html, /<link rel="canonical" href="([^"]+)"/);
  const ogUrl = attr(html, /<meta property="og:url" content="([^"]+)"/);
  assert.equal(canonical, `${SITE_ORIGIN}/`);
  assert.equal(ogUrl, `${SITE_ORIGIN}/`);
});

test("og:image is a real same-domain card with declared dimensions", async () => {
  const html = await get("/");
  const image = attr(html, /<meta property="og:image" content="([^"]+)"/);
  assert.equal(image, `${SITE_ORIGIN}/og-image.jpg`);
  assert.equal(
    attr(html, /<meta property="og:image:width" content="([^"]+)"/),
    "1200",
  );
  assert.equal(
    attr(html, /<meta property="og:image:height" content="([^"]+)"/),
    "630",
  );
  assert.equal(
    attr(html, /<meta name="twitter:image" content="([^"]+)"/),
    `${SITE_ORIGIN}/og-image.jpg`,
  );

  // The file the tags point at must actually be published by this server, not 404.
  const response = await fetch(base + new URL(image).pathname);
  assert.equal(response.status, 200, `${image} must be reachable`);
  assert.match(response.headers.get("content-type") ?? "", /^image\//);
});

test("robots.txt and sitemap.xml use the production host", async () => {
  const robots = await get("/robots.txt");
  assert.ok(
    !robots.includes("YOUR-DOMAIN"),
    "robots.txt still has the placeholder",
  );
  assert.match(robots, /Sitemap: https:\/\/mgneg\.online\/sitemap\.xml/);
  // Private pages stay out of the index.
  for (const path of ["/admin", "/checkout", "/order"])
    assert.match(robots, new RegExp(`Disallow: ${path}`));

  const sitemap = await get("/sitemap.xml");
  assert.ok(
    !sitemap.includes("YOUR-DOMAIN"),
    "sitemap.xml still has the placeholder",
  );
  assert.match(sitemap, /<loc>https:\/\/mgneg\.online\/<\/loc>/);
});
