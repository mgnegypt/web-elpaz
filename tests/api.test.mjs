import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { OWNER, loginWithSecurity, setupOwner, startTestServer } from "./helper.mjs";
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
    const completed = await fresh.json(
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
    assert.equal(completed.status, 200, "the first-run profile must be completable");
    const relogin = await loginWithSecurity(fresh, OWNER.email, OWNER.finalPassword, OWNER.answer);
    const csrf = { "x-csrf-token": relogin.body.csrf };
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
    const { session } = await setupOwner(fresh);
    const csrf = { "x-csrf-token": session.body.csrf };
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
    const { session } = await setupOwner(fresh);
    const csrf = { "x-csrf-token": session.body.csrf };
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

/* ======================================================================== */
/* Roles, first-run security, uploads, events and the live stream.          */
/* ======================================================================== */

test("owner first run: profile completion, security question, and forced re-login", async () => {
  const fresh = await startTestServer();
  try {
    const token = readFileSync(join(fresh.dataDir, "setup-token"), "utf8").trim();
    const setup = await fresh.json("/api/admin/setup", "POST", {
      token,
      username: "owner",
      password: "a-very-long-password",
    });
    assert.equal(setup.status, 201);
    assert.equal(setup.body.mustCompleteProfile, true);

    const sessionBefore = await fresh.request("/api/admin/session");
    assert.equal(sessionBefore.body.authenticated, true);
    assert.equal(sessionBefore.body.mustCompleteProfile, true);
    assert.equal(sessionBefore.body.capabilities.manageAdmins, true);

    // Writes are blocked until the first-run profile is finished.
    const blocked = await fresh.json(
      "/api/admin/content",
      "PUT",
      { ...(await fresh.request("/api/admin/content")).body, revision: 1 },
      { "x-csrf-token": setup.body.csrf },
    );
    assert.equal(blocked.status, 428);
    assert.equal(blocked.body.error, "profile-incomplete");

    // A weak password is refused by the shared schema.
    const weak = await fresh.json(
      "/api/admin/profile/complete",
      "POST",
      {
        displayName: "المالك",
        email: "owner@elpaze.online",
        password: "short",
        securityQuestion: OWNER.question,
        securityAnswer: OWNER.answer,
      },
      { "x-csrf-token": setup.body.csrf },
    );
    assert.equal(weak.status, 422);

    const done = await fresh.json(
      "/api/admin/profile/complete",
      "POST",
      {
        displayName: OWNER.displayName,
        email: OWNER.email,
        password: OWNER.finalPassword,
        securityQuestion: OWNER.question,
        securityAnswer: OWNER.answer,
      },
      { "x-csrf-token": setup.body.csrf },
    );
    assert.equal(done.status, 200);
    assert.equal(done.body.mustRelogin, true);

    // Completing the profile logs the current session out, as specified.
    assert.equal((await fresh.request("/api/admin/session")).status, 401);

    // The completion step cannot be replayed later.
    const again = await loginWithSecurity(fresh, OWNER.email, OWNER.finalPassword, OWNER.answer);
    const replay = await fresh.json(
      "/api/admin/profile/complete",
      "POST",
      {
        displayName: "x",
        email: "x@y.com",
        password: "another-long-password",
        securityQuestion: "q?",
        securityAnswer: "a",
      },
      { "x-csrf-token": again.body.csrf },
    );
    assert.equal(replay.status, 409);

    // Login is a two-factor flow: password, then the security answer.
    const pending = await fresh.json("/api/admin/login", "POST", {
      identifier: OWNER.email,
      password: OWNER.finalPassword,
    });
    assert.equal(pending.status, 200);
    assert.equal(pending.body.requiresSecurityAnswer, true);
    assert.equal(pending.body.question, OWNER.question);
    // The answer never travels to the client, only the question.
    assert.equal(JSON.stringify(pending.body).includes(OWNER.answer), false);

    // A session that has not answered the question cannot touch the API.
    const pendingSession = await fresh.request("/api/admin/session");
    assert.equal(pendingSession.body.authenticated, false);
    assert.equal(pendingSession.body.requiresSecurityAnswer, true);
    assert.equal((await fresh.request("/api/admin/content")).status, 401);
    assert.equal(
      (
        await fresh.json(
          "/api/admin/products",
          "POST",
          { revision: 1, product: { name: "x", desc: "y", category: "z" } },
          { "x-csrf-token": pending.body.pendingCsrf },
        )
      ).status,
      401,
    );

    const wrongAnswer = await fresh.json("/api/admin/login/security", "POST", { answer: "خطأ" });
    assert.equal(wrongAnswer.status, 401);
    assert.equal(wrongAnswer.body.error, "invalid-security-answer");

    // The answer is normalised (case/space-insensitive) and then accepted.
    const verified = await fresh.json("/api/admin/login/security", "POST", {
      answer: `  ${OWNER.answer.toUpperCase()} `,
    });
    assert.equal(verified.status, 200);
    assert.equal(verified.body.role, "owner");
    assert.equal((await fresh.request("/api/admin/content")).status, 200);

    // The security answer is stored as a hash, never as plain text.
    const row = fresh.db.raw
      .prepare("SELECT security_answer_hash, password_hash FROM admins WHERE role = 'owner'")
      .get();
    assert.ok(row.security_answer_hash.startsWith("scrypt$"));
    assert.equal(row.security_answer_hash.includes(OWNER.answer), false);
    assert.equal(row.password_hash.includes(OWNER.finalPassword), false);
  } finally {
    await fresh.close();
  }
});

test("owner-only account management: admins can never reach it", async () => {
  const fresh = await startTestServer();
  const owner = fresh.createClient();
  const admin = fresh.createClient();
  try {
    const { session } = await setupOwner(fresh, owner);
    const ownerCsrf = { "x-csrf-token": session.body.csrf };

    // --- the Owner creates a regular admin ---
    const created = await owner.json(
      "/api/admin/admins",
      "POST",
      {
        username: "editor",
        displayName: "محرر الموقع",
        email: "editor@elpaze.online",
        password: "editor-long-password-1",
        role: "admin",
      },
      ownerCsrf,
    );
    assert.equal(created.status, 201);
    assert.equal(created.body.admin.role, "admin");
    // Secrets are never serialised back.
    assert.equal("password_hash" in created.body.admin, false);
    assert.equal("security_answer_hash" in created.body.admin, false);

    // Duplicate logins are refused.
    const duplicate = await owner.json(
      "/api/admin/admins",
      "POST",
      {
        username: "editor",
        displayName: "مكرر",
        email: "other@elpaze.online",
        password: "editor-long-password-1",
        role: "admin",
      },
      ownerCsrf,
    );
    assert.equal(duplicate.status, 409);
    assert.equal(duplicate.body.error, "username-taken");

    const listed = await owner.request("/api/admin/admins");
    assert.equal(listed.status, 200);
    assert.equal(listed.body.items.length, 2);
    assert.equal(JSON.stringify(listed.body).includes("scrypt$"), false);

    // --- the admin signs in and is blocked from every owner endpoint ---
    const login = await loginWithSecurity(admin, "editor@elpaze.online", "editor-long-password-1", "");
    assert.equal(login.status, 200);
    assert.equal(login.body.role, "admin");
    const adminCsrf = { "x-csrf-token": login.body.csrf };
    const adminSession = await admin.request("/api/admin/session");
    assert.equal(adminSession.body.capabilities.manageAdmins, false);

    const forbidden = [
      ["GET", "/api/admin/admins", null],
      ["POST", "/api/admin/admins", { username: "hacker", displayName: "h", email: "h@x.com", password: "long-enough-password", role: "owner" }],
      ["PUT", `/api/admin/admins/${created.body.admin.id}`, { username: "hacked", displayName: "h", email: "h@x.com", avatarUrl: "", role: "owner" }],
      ["DELETE", `/api/admin/admins/${created.body.admin.id}`, {}],
    ];
    for (const [method, path, payload] of forbidden) {
      const response =
        method === "GET"
          ? await admin.request(path)
          : await admin.json(path, method, payload, adminCsrf);
      assert.equal(response.status, 403, `${method} ${path} must be owner-only`);
      assert.equal(response.body.error, "owner-only");
    }

    // The admin can still do normal dashboard work.
    assert.equal((await admin.request("/api/admin/requests")).status, 200);
    assert.equal((await admin.request("/api/admin/content")).status, 200);
    const product = await admin.json(
      "/api/admin/products",
      "POST",
      { revision: (await admin.request("/api/admin/content")).body.revision, product: { name: "منتج المشرف", desc: "وصف", category: "أجبان" } },
      adminCsrf,
    );
    assert.equal(product.status, 201);

    // --- owner-only guards ---
    const self = (await owner.request("/api/admin/session")).body.id;
    const selfDelete = await owner.json(`/api/admin/admins/${self}`, "DELETE", {}, ownerCsrf);
    assert.equal(selfDelete.status, 409);
    assert.equal(selfDelete.body.error, "cannot-delete-self");

    const demote = await owner.json(
      `/api/admin/admins/${self}`,
      "PUT",
      { username: "owner", displayName: "المالك", email: OWNER.email, avatarUrl: "", role: "admin" },
      ownerCsrf,
    );
    assert.equal(demote.status, 409);
    assert.equal(demote.body.error, "last-owner");

    // Editing another account works and killing it revokes its sessions.
    const edited = await owner.json(
      `/api/admin/admins/${created.body.admin.id}`,
      "PUT",
      {
        username: "editor2",
        displayName: "محرر ثانٍ",
        email: "editor2@elpaze.online",
        avatarUrl: "",
        role: "admin",
        password: "editor-long-password-2",
      },
      ownerCsrf,
    );
    assert.equal(edited.status, 200);
    assert.equal(edited.body.admin.username, "editor2");
    assert.equal((await admin.request("/api/admin/session")).status, 401, "a password change revokes sessions");

    const removed = await owner.json(`/api/admin/admins/${created.body.admin.id}`, "DELETE", {}, ownerCsrf);
    assert.equal(removed.status, 200);
    assert.equal((await owner.request("/api/admin/admins")).body.items.length, 1);
  } finally {
    await fresh.close();
  }
});

test("profile self-service: details, password change and security question", async () => {
  const fresh = await startTestServer();
  const owner = fresh.createClient();
  const admin = fresh.createClient();
  try {
    const { session } = await setupOwner(fresh, owner);
    const ownerCsrf = { "x-csrf-token": session.body.csrf };
    const created = await owner.json(
      "/api/admin/admins",
      "POST",
      {
        username: "editor",
        displayName: "محرر",
        email: "editor@elpaze.online",
        password: "editor-long-password-1",
        role: "admin",
      },
      ownerCsrf,
    );

    const login = await loginWithSecurity(admin, "editor@elpaze.online", "editor-long-password-1", "");
    const adminCsrf = { "x-csrf-token": login.body.csrf };

    // --- details + avatar ---
    const updated = await admin.json(
      "/api/admin/profile",
      "PUT",
      { displayName: "محرر أول", email: "editor@elpaze.online", avatarUrl: "/uploads/abc.png" },
      adminCsrf,
    );
    assert.equal(updated.status, 200);
    assert.equal(updated.body.profile.displayName, "محرر أول");
    assert.equal(updated.body.profile.avatarUrl, "/uploads/abc.png");
    // Session information is exposed for the owner of the account only.
    assert.ok(updated.body.profile.session.createdAt);
    assert.ok(updated.body.profile.session.expiresAt);

    // Another account's email cannot be taken.
    const clash = await admin.json(
      "/api/admin/profile",
      "PUT",
      { displayName: "محرر", email: OWNER.email, avatarUrl: "" },
      adminCsrf,
    );
    assert.equal(clash.status, 409);
    assert.equal(clash.body.error, "email-taken");

    // --- password ---
    const wrongCurrent = await admin.json(
      "/api/admin/profile/password",
      "PUT",
      { currentPassword: "not-the-password", newPassword: "editor-long-password-2" },
      adminCsrf,
    );
    assert.equal(wrongCurrent.status, 401);
    assert.equal(wrongCurrent.body.error, "invalid-current-password");

    const changed = await admin.json(
      "/api/admin/profile/password",
      "PUT",
      { currentPassword: "editor-long-password-1", newPassword: "editor-long-password-2" },
      adminCsrf,
    );
    assert.equal(changed.status, 200);
    // The current session survives the change, other sessions do not.
    assert.equal((await admin.request("/api/admin/profile")).status, 200);
    const otherDevice = fresh.createClient();
    const oldLogin = await otherDevice.json("/api/admin/login", "POST", {
      identifier: "editor@elpaze.online",
      password: "editor-long-password-1",
    });
    assert.equal(oldLogin.status, 401);

    // --- security question ---
    const setQuestion = await admin.json(
      "/api/admin/profile/security",
      "PUT",
      { securityQuestion: "أول مدرسة؟", securityAnswer: "النهضة", currentAnswer: "" },
      adminCsrf,
    );
    assert.equal(setQuestion.status, 200);
    assert.equal(setQuestion.body.profile.hasSecurityQuestion, true);
    // The question itself is visible to its owner, the answer never is.
    assert.equal((await admin.request("/api/admin/profile")).body.securityQuestion, "أول مدرسة؟");
    assert.equal(
      JSON.stringify((await admin.request("/api/admin/profile")).body).includes("النهضة"),
      false,
    );

    // Replacing it demands the current answer.
    const wrongAnswer = await admin.json(
      "/api/admin/profile/security",
      "PUT",
      { securityQuestion: "سؤال جديد؟", securityAnswer: "إجابة", currentAnswer: "خطأ" },
      adminCsrf,
    );
    assert.equal(wrongAnswer.status, 401);
    assert.equal(wrongAnswer.body.error, "invalid-current-answer");

    const replaced = await admin.json(
      "/api/admin/profile/security",
      "PUT",
      { securityQuestion: "سؤال جديد؟", securityAnswer: "إجابة جديدة", currentAnswer: "النهضة" },
      adminCsrf,
    );
    assert.equal(replaced.status, 200);

    // The next login asks the replacement question.
    const nextLogin = await fresh.json("/api/admin/login", "POST", {
      identifier: "editor@elpaze.online",
      password: "editor-long-password-2",
    });
    assert.equal(nextLogin.body.requiresSecurityAnswer, true);
    assert.equal(nextLogin.body.question, "سؤال جديد؟");

    // An admin can never edit the Owner's account through the owner API.
    const ownerEdit = await admin.json(
      `/api/admin/admins/${(await owner.request("/api/admin/session")).body.id}`,
      "PUT",
      { username: "owner", displayName: "h", email: "h@x.com", avatarUrl: "", role: "owner" },
      adminCsrf,
    );
    assert.equal(ownerEdit.status, 403);
    assert.ok(created.body.admin.id > 0);
  } finally {
    await fresh.close();
  }
});

test("uploads: only real images are stored, with safe names outside the app tree", async () => {
  const fresh = await startTestServer();
  const owner = fresh.createClient();
  const admin = fresh.createClient();
  try {
    const { session } = await setupOwner(fresh, owner);
    const ownerCsrf = { "x-csrf-token": session.body.csrf };

    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==",
      "base64",
    );
    const upload = async (bytes, name, type) => {
      const form = new FormData();
      form.append("file", new Blob([bytes], { type }), name);
      return owner.request("/api/admin/uploads", {
        method: "POST",
        headers: { "x-csrf-token": session.body.csrf },
        body: form,
      });
    };

    const accepted = await upload(png, "شعار.png", "image/png");
    assert.equal(accepted.status, 201);
    assert.match(accepted.body.upload.filename, /^[a-f0-9]{32}\.png$/);
    assert.equal(accepted.body.upload.url, `/uploads/${accepted.body.upload.filename}`);

    // The file is served with a correct type and long-lived caching.
    const served = await fresh.request(accepted.body.upload.url);
    assert.equal(served.status, 200);
    assert.equal(served.headers.get("content-type"), "image/png");
    assert.match(served.headers.get("cache-control"), /immutable/);
    assert.equal(served.headers.get("x-content-type-options"), "nosniff");

    // Rejected: a script renamed to .png, an SVG, an HTML file and an empty file.
    for (const [bytes, name, type] of [
      [Buffer.from("<?php system($_GET['c']); ?>"), "evil.png", "image/png"],
      [Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'></svg>"), "x.svg", "image/svg+xml"],
      [Buffer.from("<!doctype html><script>alert(1)</script>"), "x.png", "image/png"],
      [Buffer.from("MZ\u0090\u0000"), "x.exe", "application/octet-stream"],
    ]) {
      const rejected = await upload(bytes, name, type);
      assert.equal(rejected.status, 422, `${name} must be rejected`);
      assert.equal(rejected.body.error, "unsupported-type");
    }

    // An empty upload is refused with its own reason.
    const empty = await upload(Buffer.from(""), "empty.png", "image/png");
    assert.equal(empty.status, 422);
    assert.equal(empty.body.error, "empty-file");

    // Oversized files are refused by multer with a 413.
    const big = Buffer.concat([png, Buffer.alloc(5 * 1024 * 1024 + 16, 1)]);
    const tooBig = await upload(big, "big.png", "image/png");
    assert.equal(tooBig.status, 413);
    assert.equal(tooBig.body.error, "file-too-large");

    // Path traversal and unexpected names never resolve to a file.
    for (const path of [
      "/uploads/../elbaz.sqlite",
      "/uploads/..%2Fsetup-token",
      "/uploads/abc.png",
      "/uploads/%2e%2e%2f.env",
    ]) {
      assert.equal((await fresh.request(path)).status, 404, `${path} must not be served`);
    }

    // Regular admins may upload images (it is ordinary dashboard work).
    const created = await owner.json(
      "/api/admin/admins",
      "POST",
      {
        username: "editor",
        displayName: "محرر",
        email: "editor@elpaze.online",
        password: "editor-long-password-1",
        role: "admin",
      },
      { "x-csrf-token": (await owner.request("/api/admin/session")).body.csrf },
    );
    assert.equal(created.status, 201);
    const login = await loginWithSecurity(admin, "editor@elpaze.online", "editor-long-password-1", "");
    const form = new FormData();
    form.append("file", new Blob([png], { type: "image/png" }), "a.png");
    const adminUpload = await admin.request("/api/admin/uploads", {
      method: "POST",
      headers: { "x-csrf-token": login.body.csrf },
      body: form,
    });
    assert.equal(adminUpload.status, 201);

    // Uploads need a session and a CSRF token.
    const form2 = new FormData();
    form2.append("file", new Blob([png], { type: "image/png" }), "a.png");
    const anonymous = await fresh.request("/api/admin/uploads", {
      method: "POST",
      body: form2,
      anonymous: true,
    });
    assert.equal(anonymous.status, 401);
  } finally {
    await fresh.close();
  }
});

test("events drive the public announcements, and the live stream pushes changes", async () => {
  const fresh = await startTestServer();
  const owner = fresh.createClient();
  try {
    const { session } = await setupOwner(fresh, owner);
    const csrf = { "x-csrf-token": session.body.csrf };

    assert.equal((await fresh.request("/api/content")).body.events.length, 0);

    const event = await owner.json(
      "/api/admin/events",
      "POST",
      {
        title: "عرض الموسم",
        description: "خصم على كل الأجبان هذا الأسبوع",
        type: "discount",
        imageUrl: "",
        startAt: "",
        endAt: "",
        active: true,
      },
      csrf,
    );
    assert.equal(event.status, 201);
    assert.equal(event.body.event.active, true);

    const publicWithEvent = (await fresh.request("/api/content")).body;
    assert.equal(publicWithEvent.events.length, 1);
    assert.equal(publicWithEvent.events[0].title, "عرض الموسم");

    // Unknown event types and empty titles are rejected.
    const invalid = await owner.json(
      "/api/admin/events",
      "POST",
      { title: "", description: "x", type: "party", imageUrl: "", startAt: "", endAt: "", active: true },
      csrf,
    );
    assert.equal(invalid.status, 422);

    // Hiding an event removes it from the public payload without deleting it.
    const hidden = await owner.json(
      `/api/admin/events/${event.body.event.id}`,
      "PUT",
      { ...event.body.event, active: false },
      csrf,
    );
    assert.equal(hidden.status, 200);
    assert.equal((await fresh.request("/api/content")).body.events.length, 0);
    assert.equal((await owner.request("/api/admin/events")).body.items.length, 1);

    // A dangerous image URL is refused.
    const badUrl = await owner.json(
      "/api/admin/events",
      "POST",
      {
        title: "خطر",
        description: "x",
        type: "other",
        imageUrl: "javascript:alert(1)",
        startAt: "",
        endAt: "",
        active: true,
      },
      csrf,
    );
    assert.equal(badUrl.status, 422);

    // --- live stream ---
    const controller = new AbortController();
    const stream = await fetch(`${fresh.base}/api/stream`, { signal: controller.signal });
    assert.equal(stream.status, 200);
    assert.match(stream.headers.get("content-type"), /text\/event-stream/);
    const frames = [];
    const reader = stream.body.getReader();
    const pump = (async () => {
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          frames.push(new TextDecoder().decode(value));
        }
      } catch {
        /* aborted */
      }
    })();

    await new Promise((resolve) => setTimeout(resolve, 150));
    const shown = await owner.json(
      `/api/admin/events/${event.body.event.id}`,
      "PUT",
      { ...event.body.event, active: true },
      csrf,
    );
    assert.equal(shown.status, 200);
    await owner.json(
      "/api/admin/products",
      "POST",
      {
        revision: (await owner.request("/api/admin/content")).body.revision,
        product: { name: "منتج بث", desc: "وصف", category: "أجبان" },
      },
      csrf,
    );
    await new Promise((resolve) => setTimeout(resolve, 250));
    controller.abort();
    await pump;

    const joined = frames.join("");
    assert.match(joined, /"type":"hello"/);
    assert.match(joined, /"type":"content"/);
    assert.match(joined, /"type":"events"/);
  } finally {
    await fresh.close();
  }
});

test("product availability, quantity and NEW badge round-trip through the public API", async () => {
  const fresh = await startTestServer();
  const owner = fresh.createClient();
  try {
    const { session } = await setupOwner(fresh, owner);
    const csrf = { "x-csrf-token": session.body.csrf };
    const revision = (await owner.request("/api/admin/content")).body.revision;

    const make = async (product) => {
      const response = await owner.json(
        "/api/admin/products",
        "POST",
        { revision: (await owner.request("/api/admin/content")).body.revision, product },
        csrf,
      );
      assert.equal(response.status, 201, JSON.stringify(response.body));
      return response.body.product;
    };

    const unlimited = await make({
      name: "زبدة بلدي",
      desc: "زبدة طبيعية",
      category: "منتجات",
      availability: "unlimited",
      isNew: true,
    });
    assert.equal(unlimited.availability, "unlimited");
    assert.equal(unlimited.quantity, null, "unlimited products are not quantity-tracked");
    assert.equal(unlimited.isNew, true);

    const requestOnly = await make({
      name: "جبن رومي",
      desc: "يُصنع حسب الطلب",
      category: "أجبان",
      availability: "made_to_order",
      newUntil: "2030-01-01",
    });
    assert.equal(requestOnly.availability, "made_to_order");
    assert.equal(requestOnly.newUntil, "2030-01-01");

    const soon = await make({
      name: "لبن بالشوكولاتة",
      desc: "قريبًا",
      category: "ألبان",
      availability: "coming_soon",
      quantity: 0,
      discountPercent: 15,
      badge: "عرض الموسم",
    });
    assert.equal(soon.availability, "coming_soon");
    assert.equal(soon.quantity, 0);
    assert.equal(soon.discountPercent, 15);
    assert.equal(soon.badge, "عرض الموسم");

    // Bad values and out-of-range numbers are refused.
    for (const product of [
      { name: "x", desc: "y", category: "z", availability: "sold_out" },
      { name: "x", desc: "y", category: "z", quantity: -5 },
      { name: "x", desc: "y", category: "z", discountPercent: 200 },
      { name: "x", desc: "y", category: "z", img: "javascript:alert(1)" },
    ]) {
      const response = await owner.json(
        "/api/admin/products",
        "POST",
        { revision: (await owner.request("/api/admin/content")).body.revision, product },
        csrf,
      );
      assert.equal(response.status, 422, `${JSON.stringify(product)} must be rejected`);
    }

    const published = (await fresh.request("/api/content")).body;
    const names = published.products.map((product) => product.name);
    assert.ok(names.includes("زبدة بلدي"));
    assert.ok(names.includes("جبن رومي"));
    assert.ok(names.includes("لبن بالشوكولاتة"));

    // Editing availability and deleting both reach the public payload.
    const edited = await owner.json(
      `/api/admin/products/${soon.id}`,
      "PUT",
      {
        revision: (await owner.request("/api/admin/content")).body.revision,
        product: { ...soon, availability: "available", quantity: 24, isNew: false },
      },
      csrf,
    );
    assert.equal(edited.status, 200);
    assert.equal(edited.body.product.availability, "available");
    assert.equal(edited.body.product.quantity, 24);

    const removed = await owner.json(
      `/api/admin/products/${unlimited.id}`,
      "DELETE",
      { revision: (await owner.request("/api/admin/content")).body.revision },
      csrf,
    );
    assert.equal(removed.status, 200);
    assert.equal(
      (await fresh.request("/api/content")).body.products.some((p) => p.id === unlimited.id),
      false,
    );
    void revision;
  } finally {
    await fresh.close();
  }
});

test("rate limiting still guards the admin login in production settings", async () => {
  const strict = await startTestServer({ relaxRateLimits: false });
  try {
    let blocked = 0;
    for (let attempt = 0; attempt < 14; attempt += 1) {
      const response = await strict.json("/api/admin/login", "POST", {
        identifier: "owner",
        password: "wrong-password",
      });
      if (response.status === 429) {
        blocked += 1;
        assert.equal(response.body.error, "too-many-requests");
      }
    }
    assert.ok(blocked > 0, "repeated login attempts must eventually be rate limited");
  } finally {
    await strict.close();
  }
});
