import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { startTestServer } from "./helper.mjs";
import { DEFAULT_CONTENT } from "../shared/content.ts";

let api;

before(async () => {
  api = await startTestServer();
});

after(async () => {
  await api?.close();
});

const validRequest = (overrides = {}) => ({
  name: "أحمد علي",
  contact: "01000000000",
  product: "عسل أبيض طبيعي",
  unit: "كجم",
  quantity: 12,
  notes: "توصيل القاهرة",
  consent: true,
  requestKey: "key-0001",
  ...overrides,
});

test("health and public content endpoints respond with the seeded document", async () => {
  const health = await api.request("/api/health");
  assert.equal(health.status, 200);
  assert.equal(health.body.ok, true);

  const content = await api.request("/api/content");
  assert.equal(content.status, 200);
  assert.equal(content.body.revision, 1);
  assert.equal(content.body.products.length, DEFAULT_CONTENT.products.length);
  assert.equal(content.body.hero.slides.length, DEFAULT_CONTENT.hero.slides.length);
  assert.equal(content.body.sectionNames.length, 8);
  // The owner's Arabic copy must survive untouched.
  assert.equal(content.body.site.whatsapp, "201141322878");
  assert.equal(content.body.products[0].name, "جبن موزاريلا مبشور");
});

test("dev/API surface never exposes private files", async () => {
  for (const path of [
    "/.data/elbaz.sqlite",
    "/.data/setup-token",
    "/.env",
    "/server/app.ts",
    "/shared/content.ts",
    "/package-lock.json",
  ]) {
    const response = await api.request(path);
    assert.equal(response.status, 404, `${path} must not be served`);
  }
});

test("wholesale requests persist and a repeated requestKey is idempotent", async () => {
  const first = await api.json("/api/wholesale-requests", "POST", validRequest());
  assert.equal(first.status, 201);
  assert.equal(first.body.saved, true);
  assert.equal(first.body.duplicate, false);

  const second = await api.json("/api/wholesale-requests", "POST", validRequest());
  assert.equal(second.status, 200);
  assert.equal(second.body.duplicate, true);
  assert.equal(second.body.id, first.body.id, "duplicate must reuse the same record");

  const rows = api.db.listRequests({ limit: 50, offset: 0 });
  assert.equal(rows.total, 1, "only one row may exist for one requestKey");
});

test("invalid wholesale payloads are rejected", async () => {
  const cases = [
    ["zero quantity", validRequest({ requestKey: "bad-qty-0", quantity: 0 })],
    ["negative quantity", validRequest({ requestKey: "bad-qty-1", quantity: -5 })],
    ["missing consent", validRequest({ requestKey: "bad-consent", consent: false })],
    ["honeypot filled", validRequest({ requestKey: "bad-bot", honeypot: "http://spam" })],
    ["malformed name", validRequest({ requestKey: "bad-name", name: "x" })],
    ["malformed contact", validRequest({ requestKey: "bad-contact", contact: "not-a-number" })],
    ["oversized quantity", validRequest({ requestKey: "bad-big", quantity: 9e9 })],
  ];
  for (const [label, payload] of cases) {
    const response = await api.json("/api/wholesale-requests", "POST", payload);
    assert.equal(response.status, 422, `${label} must be rejected`);
  }
  const after = api.db.listRequests({ limit: 50, offset: 0 });
  assert.equal(after.total, 1, "rejected payloads must not be stored");
});

test("malformed JSON bodies are rejected without a 500", async () => {
  const response = await api.request("/api/wholesale-requests", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{ this is not json",
  });
  assert.ok([400, 422].includes(response.status), `got ${response.status}`);
});

test("cross-origin mutations are rejected", async () => {
  const response = await api.json(
    "/api/wholesale-requests",
    "POST",
    validRequest({ requestKey: "cors-key-01" }),
    { origin: "https://evil.example" },
  );
  assert.equal(response.status, 403);
  assert.equal(response.body.error, "origin-not-allowed");
});

test("first-run setup requires the exact one-time token and cannot be repeated", async () => {
  const tokenPath = join(api.dataDir, "setup-token");
  assert.ok(existsSync(tokenPath), "a setup token file must be created on first run");
  const token = readFileSync(tokenPath, "utf8").trim();
  assert.equal(token.length, 64, "the setup token must be 64 characters");

  // The token is never handed out over HTTP.
  const status = await api.request("/api/admin/status");
  assert.equal(status.body.needsSetup, true);
  assert.equal(JSON.stringify(status.body).includes(token), false);

  const wrong = await api.json("/api/admin/setup", "POST", {
    token: "0".repeat(64),
    username: "owner",
    password: "a-very-long-password",
  });
  assert.equal(wrong.status, 403);
  assert.equal(wrong.body.error, "invalid-setup-token");

  const shortPassword = await api.json("/api/admin/setup", "POST", {
    token,
    username: "owner",
    password: "short",
  });
  assert.equal(shortPassword.status, 422);

  const created = await api.json("/api/admin/setup", "POST", {
    token,
    username: "owner",
    password: "a-very-long-password",
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.username, "owner");
  assert.ok(created.body.csrf, "a CSRF token must be issued");

  // The one-time token is deleted and setup is permanently closed.
  assert.equal(existsSync(tokenPath), false, "setup token must be deleted after setup");
  const repeated = await api.json("/api/admin/setup", "POST", {
    token,
    username: "intruder",
    password: "another-long-password",
  });
  assert.equal(repeated.status, 409);
  assert.equal(repeated.body.error, "setup-already-complete");

  // The password is stored as a salted scrypt hash, never as plaintext.
  const row = api.db.raw
    .prepare("SELECT username, password_hash FROM admins WHERE username = ?")
    .get("owner");
  assert.ok(row.password_hash.startsWith("scrypt$"));
  assert.equal(row.password_hash.includes("a-very-long-password"), false);
});

test("admin endpoints are protected and CSRF is enforced", async () => {
  const fresh = await startTestServer();
  try {
    const token = readFileSync(join(fresh.dataDir, "setup-token"), "utf8").trim();
    const created = await fresh.json("/api/admin/setup", "POST", {
      token,
      username: "owner",
      password: "a-very-long-password",
    });
    const csrf = created.body.csrf;

    // Unauthenticated access to a protected endpoint (cookie jar deliberately bypassed).
    const anonymous = await fresh.request("/api/admin/requests", { anonymous: true });
    assert.equal(anonymous.status, 401);
    const anonymousContent = await fresh.request("/api/admin/content", { anonymous: true });
    assert.equal(anonymousContent.status, 401);

    // Authenticated but missing the CSRF header.
    const missingCsrf = await fresh.json("/api/admin/requests/1", "PATCH", { status: "contacted" });
    assert.equal(missingCsrf.status, 403);
    assert.equal(missingCsrf.body.error, "csrf-rejected");

    // Wrong CSRF token.
    const wrongCsrf = await fresh.json(
      "/api/admin/requests/1",
      "PATCH",
      { status: "contacted" },
      { "x-csrf-token": "not-the-token" },
    );
    assert.equal(wrongCsrf.status, 403);

    // Reading is allowed; the session is valid and cookie-backed.
    const session = await fresh.request("/api/admin/session");
    assert.equal(session.status, 200);
    assert.equal(session.body.authenticated, true);
    assert.equal(session.body.csrf, csrf);

    // Logout revokes the session server-side.
    const logout = await fresh.request("/api/admin/logout", { method: "POST" });
    assert.equal(logout.status, 200);
    const afterLogout = await fresh.request("/api/admin/session");
    assert.equal(afterLogout.status, 401);
    const revokedWrite = await fresh.json(
      "/api/admin/requests/1",
      "PATCH",
      { status: "confirmed" },
      csrf,
    );
    assert.equal(revokedWrite.status, 401, "a revoked session must not be usable");
  } finally {
    await fresh.close();
  }
});

test("invalid URL schemes are rejected when saving products", async () => {
  const fresh = await startTestServer();
  try {
    const token = readFileSync(join(fresh.dataDir, "setup-token"), "utf8").trim();
    const created = await fresh.json("/api/admin/setup", "POST", {
      token,
      username: "owner",
      password: "a-very-long-password",
    });
    const csrf = { "x-csrf-token": created.body.csrf };
    const revision = (await fresh.request("/api/admin/content")).body.revision;
    const base = {
      category: "أجبان",
      name: "منتج اختبار",
      desc: "وصف",
      longDesc: "وصف",
      size: "1 كجم",
      color: "#1E3FA8",
      fallback: "",
      webp: "",
    };

    for (const img of [
      "javascript:alert(1)",
      "data:text/html;base64,PHNjcmlwdD4=",
      "vbscript:msgbox(1)",
      "file:///etc/passwd",
    ]) {
      const response = await fresh.json(
        "/api/admin/products",
        "POST",
        { revision, product: { ...base, img } },
        csrf,
      );
      assert.equal(response.status, 422, `${img} must be rejected`);
    }

    const okay = await fresh.json(
      "/api/admin/products",
      "POST",
      { revision, product: { ...base, img: "https://example.com/p.png" } },
      csrf,
    );
    assert.equal(okay.status, 201);
  } finally {
    await fresh.close();
  }
});

test("content is seeded once and the database stays the source of truth", async () => {
  const fresh = await startTestServer({ preserve: true });
  const dataDir = fresh.dataDir;
  try {
    const token = readFileSync(join(dataDir, "setup-token"), "utf8").trim();
    const created = await fresh.json("/api/admin/setup", "POST", {
      token,
      username: "owner",
      password: "a-very-long-password",
    });
    const csrf = { "x-csrf-token": created.body.csrf };
    const current = (await fresh.request("/api/admin/content")).body;

    const saved = await fresh.json(
      "/api/admin/content",
      "PUT",
      {
        ...current,
        revision: current.revision,
        copy: { ...current.copy, productsSubtitle: "نص من لوحة التحكم" },
      },
      csrf,
    );
    assert.equal(saved.status, 200);
    assert.equal(saved.body.revision, current.revision + 1);
    assert.notEqual(
      saved.body.copy.productsSubtitle,
      DEFAULT_CONTENT.copy.productsSubtitle,
    );
  } finally {
    await fresh.close(); // releases the file handle before reopening the same directory
  }

  // Re-opening the same data directory must not re-seed over the published edit.
  const reopened = await startTestServer({ dataDir });
  try {
    const publicContent = (await reopened.request("/api/content")).body;
    assert.equal(publicContent.copy.productsSubtitle, "نص من لوحة التحكم");
    assert.equal(publicContent.revision, 2);
  } finally {
    await reopened.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("a stale revision cannot overwrite newer content", async () => {
  const fresh = await startTestServer();
  try {
    const token = readFileSync(join(fresh.dataDir, "setup-token"), "utf8").trim();
    const created = await fresh.json("/api/admin/setup", "POST", {
      token,
      username: "owner",
      password: "a-very-long-password",
    });
    const csrf = { "x-csrf-token": created.body.csrf };
    const current = (await fresh.request("/api/admin/content")).body;

    const first = await fresh.json(
      "/api/admin/content",
      "PUT",
      { ...current, revision: current.revision },
      csrf,
    );
    assert.equal(first.status, 200);

    const stale = await fresh.json(
      "/api/admin/content",
      "PUT",
      { ...current, revision: current.revision, copy: { ...current.copy, heroTagline: "قديم" } },
      csrf,
    );
    assert.equal(stale.status, 409);
    assert.equal(stale.body.error, "revision-conflict");
    assert.equal(stale.body.current.revision, current.revision + 1);
  } finally {
    await fresh.close();
  }
});

test("security headers and no-store caching are present", async () => {
  const response = await api.request("/api/health");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.ok(response.headers.get("content-security-policy"));
  const session = await api.request("/api/admin/status");
  assert.equal(session.headers.get("cache-control"), "no-store");
});
