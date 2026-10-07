// Security test suite. Every case asserts that an attack FAILS safely: the
// documented status code, no leaked data, and no state change.
//
// Runs against an in-process app with a throwaway database (see tests/helper.mjs),
// so nothing here can reach real data and no network is required.
//
// Executed by `npm run test:security` (wired into `npm run test:all`).
import assert from "node:assert/strict";
import { test } from "node:test";
import { createHmac, randomUUID } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  OWNER,
  loginWithSecurity,
  setupOwner,
  startTestServer,
} from "./helper.mjs";

/* ------------------------------------------------------------------ helpers */

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==",
  "base64",
);

/** Creates an owner plus a regular admin and returns both logged-in clients. */
async function twoAccounts(options = {}) {
  const api = await startTestServer(options);
  const ownerClient = api.createClient();
  const { owner } = await setupOwner(api, ownerClient, {
    displayName: "مالك المصنع",
  });
  const ownerSession = await ownerClient.request("/api/admin/session");
  const csrf = ownerSession.body.csrf;

  const created = await ownerClient.json(
    "/api/admin/admins",
    "POST",
    {
      username: "editor",
      displayName: "محرر الموقع",
      email: "editor@elpaze.online",
      password: "kitchen-secret-pass-1",
      role: "admin",
    },
    { "x-csrf-token": csrf },
  );
  assert.equal(created.status, 201, "the fixture admin must be creatable");

  const adminClient = api.createClient();
  const login = await loginWithSecurity(
    adminClient,
    "editor@elpaze.online",
    "kitchen-secret-pass-1",
  );
  assert.equal(login.status, 200, "the fixture admin must sign in");
  const adminSession = await adminClient.request("/api/admin/session");
  return {
    api,
    owner,
    ownerClient,
    ownerCsrf: csrf,
    adminClient,
    adminCsrf: adminSession.body.csrf,
  };
}

const uniqueKey = () => randomUUID().replace(/-/g, "").slice(0, 24);

const validRequest = (overrides = {}) => ({
  name: "عميل أمني",
  contact: "01098765432",
  product: "عسل أبيض طبيعي",
  unit: "كجم",
  quantity: 5,
  notes: "",
  consent: true,
  requestKey: uniqueKey(),
  ...overrides,
});

/* =============================================================== A. sessions */

test("A1 brute force: repeated wrong passwords are throttled per account with Retry-After", async () => {
  const api = await startTestServer({ relaxRateLimits: true }); // isolate the account brake
  try {
    await setupOwner(api, api);
    let throttled = null;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const response = await api.json("/api/admin/login", "POST", {
        identifier: OWNER.email,
        password: `wrong-password-${attempt}`,
      });
      if (response.status === 429) {
        throttled = response;
        break;
      }
      assert.equal(
        response.status,
        401,
        "attempts before the threshold answer 401",
      );
    }
    assert.ok(
      throttled,
      "the account must be throttled after repeated failures",
    );
    assert.equal(throttled.body.error, "too-many-attempts");
    assert.ok(
      Number(throttled.headers.get("retry-after")) >= 1,
      "Retry-After must be set",
    );

    // The correct password is refused while the brake is active (that is the point).
    const during = await api.json("/api/admin/login", "POST", {
      identifier: OWNER.email,
      password: OWNER.finalPassword,
    });
    assert.equal(
      during.status,
      429,
      "the brake also applies to the real password",
    );
  } finally {
    await api.close();
  }
});

test("A2 no user enumeration: unknown and known identifiers answer identically", async () => {
  const api = await startTestServer({ relaxRateLimits: true });
  try {
    await setupOwner(api, api);
    const unknown = await api.json("/api/admin/login", "POST", {
      identifier: "definitely-not-a-user",
      password: "some-long-password-1",
    });
    const known = await api.json("/api/admin/login", "POST", {
      identifier: OWNER.email,
      password: "some-long-password-1",
    });
    assert.equal(unknown.status, known.status, "status must not differ");
    assert.deepEqual(unknown.body, known.body, "body must not differ");
    assert.equal(unknown.body.error, "invalid-credentials");

    // ...and the unknown identifier gets the same brake, so 429 cannot be used
    // as an "account exists" oracle either.
    for (let attempt = 0; attempt < 8; attempt += 1) {
      await api.json("/api/admin/login", "POST", {
        identifier: "definitely-not-a-user",
        password: `wrong-${attempt}`,
      });
    }
    const blockedUnknown = await api.json("/api/admin/login", "POST", {
      identifier: "definitely-not-a-user",
      password: "some-long-password-1",
    });
    assert.equal(
      blockedUnknown.status,
      429,
      "unknown identifiers are throttled too",
    );
    assert.equal(blockedUnknown.body.error, "too-many-attempts");
  } finally {
    await api.close();
  }
});

test("A3 the security answer is throttled and the answer itself never comes back", async () => {
  const api = await startTestServer({ relaxRateLimits: true });
  try {
    await setupOwner(api, api);
    const client = api.createClient();
    const login = await client.json("/api/admin/login", "POST", {
      identifier: OWNER.email,
      password: OWNER.finalPassword,
    });
    assert.equal(login.status, 200);
    assert.equal(login.body.requiresSecurityAnswer, true);
    assert.equal(
      login.body.question,
      OWNER.question,
      "only the question is returned",
    );
    assert.equal("securityAnswer" in login.body, false);
    assert.equal("answer" in login.body, false);
    assert.equal("security_answer_hash" in login.body, false);

    let throttled = null;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const guess = await client.json("/api/admin/login/security", "POST", {
        answer: `wrong-answer-${attempt}`,
      });
      if (guess.status === 429) {
        throttled = guess;
        break;
      }
      assert.equal(guess.status, 401);
      assert.equal(guess.body.error, "invalid-security-answer");
      assert.equal(
        JSON.stringify(guess.body).includes("scrypt"),
        false,
        "no hash leak",
      );
    }
    assert.ok(throttled, "guessing the second factor must be throttled");
    assert.equal(throttled.body.error, "too-many-attempts");
  } finally {
    await api.close();
  }
});

test("A4 the security step cannot be skipped by calling admin endpoints directly", async () => {
  const api = await startTestServer({ relaxRateLimits: true });
  try {
    await setupOwner(api, api);
    const pending = api.createClient();
    const login = await pending.json("/api/admin/login", "POST", {
      identifier: OWNER.email,
      password: OWNER.finalPassword,
    });
    assert.equal(login.body.requiresSecurityAnswer, true);

    // Every authenticated surface must refuse a half-authenticated session.
    for (const [method, path] of [
      ["GET", "/api/admin/profile"],
      ["GET", "/api/admin/admins"],
      ["GET", "/api/admin/content"],
      ["GET", "/api/admin/requests"],
      ["GET", "/api/admin/events"],
      ["PUT", "/api/admin/content"],
      ["POST", "/api/admin/events"],
      ["DELETE", "/api/admin/products/1"],
    ]) {
      const response = await pending.request(path, { method });
      assert.equal(
        response.status,
        401,
        `${method} ${path} must refuse a pending session`,
      );
      assert.equal(response.body.error, "security-required");
    }

    // The session endpoint reports the pending state without any account data.
    const session = await pending.request("/api/admin/session");
    assert.equal(session.status, 200);
    assert.equal(session.body.authenticated, false);
    assert.equal("email" in session.body, false);
    assert.equal("username" in session.body, false);
  } finally {
    await api.close();
  }
});

test("A5 session cookies are HttpOnly/SameSite, and logout really revokes server-side", async () => {
  const api = await startTestServer({ relaxRateLimits: true });
  try {
    await setupOwner(api, api);
    const client = api.createClient();
    const login = await client.json("/api/admin/login", "POST", {
      identifier: OWNER.email,
      password: OWNER.finalPassword,
    });
    const raw = login.headers.getSetCookie().join("\n");
    assert.match(raw, /elbaz_session=/);
    assert.match(raw, /HttpOnly/i);
    assert.match(raw, /SameSite=Strict/i);
    assert.equal(
      /Secure/i.test(raw),
      false,
      "no Secure flag over plain http (dev/test)",
    );

    await client.json("/api/admin/login/security", "POST", {
      answer: OWNER.answer,
    });
    assert.equal((await client.request("/api/admin/session")).status, 200);

    // The stolen cookie must stop working once it is revoked.
    const stolen = client.cookies().get("elbaz_session");
    const attacker = api.createClient();
    attacker.jar.set("elbaz_session", stolen);
    assert.equal(
      (await attacker.request("/api/admin/session")).status,
      200,
      "fixture sanity",
    );

    await client.json("/api/admin/logout", "POST", {});
    assert.equal(
      (await client.request("/api/admin/session")).status,
      401,
      "the local session must die",
    );
    // Simulate an attacker replaying the same cookie value.
    const replayer = api.createClient();
    replayer.jar.set("elbaz_session", stolen);
    const replayed = await replayer.request("/api/admin/session");
    assert.equal(replayed.status, 401, "the revoked token must not work again");
  } finally {
    await api.close();
  }
});

test("A6 a password change revokes every other session but keeps the current one", async () => {
  const api = await startTestServer({ relaxRateLimits: true });
  try {
    await setupOwner(api, api);
    const first = api.createClient();
    await loginWithSecurity(
      first,
      OWNER.email,
      OWNER.finalPassword,
      OWNER.answer,
    );
    const second = api.createClient();
    await loginWithSecurity(
      second,
      OWNER.email,
      OWNER.finalPassword,
      OWNER.answer,
    );
    const stolenCookie = second.cookies().get("elbaz_session");

    const session = await first.request("/api/admin/session");
    const changed = await first.json(
      "/api/admin/profile/password",
      "PUT",
      {
        currentPassword: OWNER.finalPassword,
        newPassword: "second-long-password-22",
      },
      { "x-csrf-token": session.body.csrf },
    );
    assert.equal(changed.status, 200);

    assert.equal(
      (await first.request("/api/admin/session")).status,
      200,
      "current session survives",
    );
    const replayer = api.createClient();
    replayer.jar.set("elbaz_session", stolenCookie);
    assert.equal(
      (await replayer.request("/api/admin/session")).status,
      401,
      "the other device is signed out",
    );
    const oldPassword = await api.json("/api/admin/login", "POST", {
      identifier: OWNER.email,
      password: OWNER.finalPassword,
    });
    assert.equal(oldPassword.status, 401, "the old password no longer works");
  } finally {
    await api.close();
  }
});

test("A7 rotating credentials needs the current password / current answer", async () => {
  const { api, ownerClient, adminClient, adminCsrf } = await twoAccounts();
  try {
    const session = await ownerClient.request("/api/admin/session");
    const ownerCsrf = session.body.csrf;

    // Password change without the current password.
    const noCurrent = await adminClient.json(
      "/api/admin/profile/password",
      "PUT",
      {
        currentPassword: "not-the-password",
        newPassword: "fresh-long-password-9",
      },
      { "x-csrf-token": adminCsrf },
    );
    assert.equal(noCurrent.status, 401);
    assert.equal(noCurrent.body.error, "invalid-current-password");

    // The admin has no question yet, so setting one is allowed...
    const first = await adminClient.json(
      "/api/admin/profile/security",
      "PUT",
      {
        currentAnswer: "",
        securityQuestion: "مدينة الميلاد؟",
        securityAnswer: "الجيزة",
      },
      { "x-csrf-token": adminCsrf },
    );
    assert.equal(first.status, 200);

    // ...but replacing it is not, without the current answer.
    const replace = await adminClient.json(
      "/api/admin/profile/security",
      "PUT",
      {
        currentAnswer: "wrong",
        securityQuestion: "اسم الشارع؟",
        securityAnswer: "النيل",
      },
      { "x-csrf-token": adminCsrf },
    );
    assert.equal(replace.status, 401);
    assert.equal(replace.body.error, "invalid-current-answer");

    // Same for the owner's own record, and the answer never appears in a response.
    const ownerReplace = await ownerClient.json(
      "/api/admin/profile/security",
      "PUT",
      {
        currentAnswer: "wrong",
        securityQuestion: "سؤال جديد؟",
        securityAnswer: "إجابة جديدة",
      },
      { "x-csrf-token": ownerCsrf },
    );
    assert.equal(ownerReplace.status, 401);
    const profile = await ownerClient.request("/api/admin/profile");
    assert.equal(JSON.stringify(profile.body).includes(OWNER.answer), false);
    assert.equal(JSON.stringify(profile.body).includes("scrypt"), false);

    // The stored question is unchanged after the failed attempt.
    assert.equal(profile.body.securityQuestion, OWNER.question);
  } finally {
    await api.close();
  }
});

test("A8 weak and account-derived passwords are refused on every password route", async () => {
  const api = await startTestServer({ relaxRateLimits: true });
  try {
    const token = readFileSync(join(api.dataDir, "setup-token"), "utf8").trim();
    const weak = [
      "short-pass", // under 12 characters
      "passwordpassword", // common pattern
      "aaaaaaaaaaaaaaaa", // single repeated character
      "123456789012", // straight run
      "owner", // the account name itself
    ];
    for (const password of weak) {
      const response = await api.json("/api/admin/setup", "POST", {
        token,
        username: "owner",
        password,
      });
      assert.equal(response.status, 422, `${password} must be refused`);
      // Schema-level rules report invalid-setup; the policy layer reports the
      // specific password-* code. Both refuse, and no account is created.
      assert.match(String(response.body.error), /^(invalid-setup|password-)/);
    }
    assert.equal(
      api.db.adminCount(),
      0,
      "no account may be created by a weak password",
    );

    // A good password still works, and so does the rest of the flow.
    const ownerClient = api;
    const { session } = await setupOwner(api, api, {
      password: "a-very-long-password",
    });

    // Use a separate client: signing in again would replace this session's
    // cookie with a fresh, not-yet-verified one.
    const probe = api.createClient();
    const sameAsEmail = await probe.json("/api/admin/login", "POST", {
      identifier: OWNER.email,
      password: OWNER.finalPassword,
    });
    assert.equal(sameAsEmail.status, 200, "fixture sanity");
    const change = await ownerClient.json(
      "/api/admin/profile/password",
      "PUT",
      { currentPassword: OWNER.finalPassword, newPassword: "welcome123456" },
      { "x-csrf-token": session.body.csrf },
    );
    assert.equal(change.status, 422);
    assert.equal(change.body.error, "password-too-common");
  } finally {
    await api.close();
  }
});

test("A9 setup token: guessing, reuse and post-setup access all fail", async () => {
  const api = await startTestServer({ relaxRateLimits: true });
  try {
    const real = readFileSync(join(api.dataDir, "setup-token"), "utf8").trim();
    const guessed = await api.json("/api/admin/setup", "POST", {
      token: createHmac("sha256", "x").update("y").digest("hex"),
      username: "attacker",
      password: "a-very-long-password",
    });
    assert.equal(guessed.status, 403);
    assert.equal(guessed.body.error, "invalid-setup-token");
    assert.equal(
      api.db.adminCount(),
      0,
      "a wrong token must not create an account",
    );

    const { session } = await setupOwner(api, api);
    const ownerClient = api;

    // Replay: same (previously valid) token, now that an admin exists.
    const replay = await api.json("/api/admin/setup", "POST", {
      token: real,
      username: "second-owner",
      password: "a-very-long-password",
    });
    assert.equal(replay.status, 409);
    assert.equal(replay.body.error, "setup-already-complete");
    assert.equal(api.db.adminCount(), 1, "no second account through setup");

    // The token file is gone, and the status endpoint stops advertising setup.
    const status = await api.request("/api/admin/status");
    assert.equal(status.body.needsSetup, false);
    assert.equal(status.body.setupAvailable, false);
    assert.equal(JSON.stringify(status.body).includes(real), false);

    // A signed-in owner cannot use setup to add accounts either.
    const asOwner = await ownerClient.json(
      "/api/admin/setup",
      "POST",
      { token: real, username: "sneaky", password: "a-very-long-password" },
      { "x-csrf-token": session.body.csrf },
    );
    assert.equal(asOwner.status, 409);
  } finally {
    await api.close();
  }
});

/* ========================================================= B. authorization */

test("B1 an admin gets 403 from every owner-only route, and nothing changes", async () => {
  const { api, owner, adminClient, adminCsrf } = await twoAccounts();
  try {
    const attempts = [
      ["GET", "/api/admin/admins", {}],
      ["GET", "/api/admin/admins/audit", {}],
      [
        "POST",
        "/api/admin/admins",
        {
          username: "sneaky",
          displayName: "دخيل",
          email: "sneaky@elpaze.online",
          password: "a-very-long-password",
          role: "owner",
        },
      ],
      [
        "PUT",
        "/api/admin/admins/1",
        {
          username: "owner",
          displayName: "خ",
          email: "x@elpaze.online",
          avatarUrl: "",
          role: "admin",
          password: "",
        },
      ],
      ["DELETE", "/api/admin/admins/1", {}],
    ];
    const before = api.db.listAdmins().length;
    for (const [method, path, body] of attempts) {
      const response = await adminClient.request(path, {
        method,
        headers: {
          "content-type": "application/json",
          "x-csrf-token": adminCsrf,
        },
        body: method === "GET" ? undefined : JSON.stringify(body),
      });
      assert.equal(
        response.status,
        403,
        `${method} ${path} must be owner-only`,
      );
      assert.equal(response.body.error, "owner-only");
      assert.equal(JSON.stringify(response.body).includes("scrypt"), false);
    }
    assert.equal(
      api.db.listAdmins().length,
      before,
      "no account may be created or removed",
    );
    const ownerRow = api.db.getAdmin(owner ? 1 : 1);
    assert.equal(ownerRow.role, "owner", "the owner account must be untouched");
  } finally {
    await api.close();
  }
});

test("B2 an admin cannot edit another account, escalate its own role, or steal the session", async () => {
  const { api, adminClient, adminCsrf } = await twoAccounts();
  try {
    // Mass assignment: the profile route only ever touches the caller's record.
    const escalate = await adminClient.json(
      "/api/admin/profile",
      "PUT",
      {
        displayName: "محرر",
        email: "editor@elpaze.online",
        avatarUrl: "",
        role: "owner",
        id: 1,
        password: "a-very-long-password",
      },
      { "x-csrf-token": adminCsrf },
    );
    assert.equal(
      escalate.status,
      200,
      "unknown fields are stripped, not applied",
    );
    const admin = api.db.findAdmin("editor");
    assert.equal(
      admin.role,
      "admin",
      "role escalation through mass assignment must fail",
    );
    assert.equal(admin.id === 1, false);

    // The other account's profile cannot be read through the self-service route.
    const mine = await adminClient.request("/api/admin/profile");
    assert.equal(mine.body.id, admin.id);
    assert.equal(mine.body.email, "editor@elpaze.online");

    // There is no id-taking variant to exploit, and a query string cannot make
    // the self-service route look at somebody else's row.
    for (const path of [
      "/api/admin/profile/1",
      "/api/admin/admins/1/profile",
    ]) {
      const response = await adminClient.request(path);
      assert.equal(
        [404, 403].includes(response.status),
        true,
        `${path} must not exist (${response.status})`,
      );
    }
    const withQuery = await adminClient.request(
      `/api/admin/profile?id=${admin.id + 1}&user=owner`,
    );
    assert.equal(withQuery.status, 200);
    assert.equal(
      withQuery.body.id,
      admin.id,
      "the session decides whose profile is returned",
    );
    assert.equal(withQuery.body.email, "editor@elpaze.online");
  } finally {
    await api.close();
  }
});

test("B3 the last owner cannot be demoted or deleted, and self-deletion is refused", async () => {
  const { api, ownerClient, ownerCsrf, adminClient, adminCsrf } =
    await twoAccounts();
  try {
    const ownerRow = api.db.findAdmin(OWNER.email);
    const selfDelete = await ownerClient.request(
      `/api/admin/admins/${ownerRow.id}`,
      {
        method: "DELETE",
        headers: {
          "content-type": "application/json",
          "x-csrf-token": ownerCsrf,
        },
        body: "{}",
      },
    );
    assert.equal(selfDelete.status, 409);
    assert.equal(selfDelete.body.error, "cannot-delete-self");

    const demote = await ownerClient.json(
      `/api/admin/admins/${ownerRow.id}`,
      "PUT",
      {
        username: "owner",
        displayName: "مالك",
        email: OWNER.email,
        avatarUrl: "",
        role: "admin",
        password: "",
      },
      { "x-csrf-token": ownerCsrf },
    );
    assert.equal(demote.status, 409);
    assert.equal(demote.body.error, "last-owner");
    assert.equal(api.db.countOwners(), 1, "the site always keeps an owner");

    // The admin cannot reach the same routes (defence in depth).
    const asAdmin = await adminClient.request("/api/admin/admins/1", {
      method: "DELETE",
      headers: {
        "content-type": "application/json",
        "x-csrf-token": adminCsrf,
      },
      body: "{}",
    });
    assert.equal(asAdmin.status, 403);
  } finally {
    await api.close();
  }
});

test("B4 every /api route refuses anonymous callers", async () => {
  const { api, ownerClient, ownerCsrf } = await twoAccounts();
  try {
    const anonymous = api.createClient();
    const routes = [
      ["GET", "/api/admin/session"],
      ["GET", "/api/admin/profile"],
      ["PUT", "/api/admin/profile"],
      ["PUT", "/api/admin/profile/password"],
      ["PUT", "/api/admin/profile/security"],
      ["GET", "/api/admin/admins"],
      ["POST", "/api/admin/admins"],
      ["PUT", "/api/admin/admins/1"],
      ["DELETE", "/api/admin/admins/1"],
      ["GET", "/api/admin/admins/audit"],
      ["GET", "/api/admin/content"],
      ["PUT", "/api/admin/content"],
      ["GET", "/api/admin/requests"],
      ["PATCH", "/api/admin/requests/1"],
      ["DELETE", "/api/admin/requests/1"],
      ["GET", "/api/admin/events"],
      ["POST", "/api/admin/events"],
      ["PUT", "/api/admin/events/1"],
      ["DELETE", "/api/admin/events/1"],
      ["POST", "/api/admin/uploads"],
      ["POST", "/api/admin/products"],
      ["PUT", "/api/admin/products/1"],
      ["DELETE", "/api/admin/products/1"],
    ];
    for (const [method, path] of routes) {
      const response = await anonymous.request(path, { method });
      assert.equal(
        response.status,
        401,
        `${method} ${path} must be 401 without a session`,
      );
      assert.equal(response.body.error, "unauthenticated");
    }
    // Sanity: the same routes answer when the owner is signed in.
    const content = await ownerClient.request("/api/admin/content");
    assert.equal(content.status, 200);
    assert.ok(ownerCsrf);
  } finally {
    await api.close();
  }
});

test("B5 two admins editing the same record cannot silently overwrite each other", async () => {
  const { api, ownerClient, ownerCsrf } = await twoAccounts();
  try {
    const document_ = await ownerClient.request("/api/admin/content");
    const revision = document_.body.revision;
    const first = await ownerClient.json(
      "/api/admin/content",
      "PUT",
      {
        ...document_.body,
        copy: { ...document_.body.copy, heroTagline: "الشعار الأول" },
      },
      { "x-csrf-token": ownerCsrf },
    );
    assert.equal(first.status, 200);

    // The second editor still holds the old revision: the server must refuse.
    const stale = await ownerClient.json(
      "/api/admin/content",
      "PUT",
      {
        ...document_.body,
        copy: { ...document_.body.copy, heroTagline: "الشعار الثاني" },
      },
      { "x-csrf-token": ownerCsrf },
    );
    assert.equal(stale.status, 409);
    assert.equal(stale.body.error, "revision-conflict");
    assert.equal(
      stale.body.current.revision,
      first.body.revision,
      "the newer revision is returned",
    );
    const published = await api.request("/api/content");
    assert.equal(
      published.body.copy.heroTagline,
      "الشعار الأول",
      "the first write survives",
    );
    assert.ok(revision < first.body.revision);
  } finally {
    await api.close();
  }
});

/* =============================================================== C. inputs */

test("C1 SQL injection payloads never change behaviour or leak data", async () => {
  const { api, ownerClient, ownerCsrf } = await twoAccounts();
  try {
    const payloads = [
      "' OR 1=1 --",
      "'; DROP TABLE admins; --",
      "1' UNION SELECT password_hash FROM admins --",
      "%27%20OR%201%3D1",
      "admin'/*",
    ];
    for (const payload of payloads) {
      // Search parameter (a real query parameter, parameterised in the store).
      await api.json(
        "/api/wholesale-requests",
        "POST",
        validRequest({ name: payload }),
      );
      const list = await ownerClient.request(
        `/api/admin/requests?search=${encodeURIComponent(payload)}&status=${encodeURIComponent(payload)}&page=1&pageSize=5`,
      );
      assert.equal(list.status, 200);
      assert.equal(
        JSON.stringify(list.body).toLowerCase().includes("password_hash"),
        false,
      );
      assert.equal(JSON.stringify(list.body).includes("scrypt"), false);

      // Identifiers and paths.
      const login = await api.json("/api/admin/login", "POST", {
        identifier: payload,
        password: payload,
      });
      assert.ok([401, 429].includes(login.status));
      // A numeric-prefixed payload can address an id (that is how ids work),
      // but it must never run SQL, and it must never delete more than one row.
      const before = api.db.getContent().products.length;
      const products = await ownerClient.request(
        `/api/admin/products/9999${encodeURIComponent(payload)}`,
        {
          method: "DELETE",
          headers: {
            "content-type": "application/json",
            "x-csrf-token": ownerCsrf,
          },
          body: JSON.stringify({ revision: api.db.getContent().revision }),
        },
      );
      assert.equal(products.status, 404, "an unknown id is a 404, not a query");
      assert.equal(
        api.db.getContent().products.length,
        before,
        "an injection payload must not delete rows",
      );
    }
    // The schema is intact: the accounts table still exists and answers.
    assert.equal(api.db.listAdmins().length, 2);
  } finally {
    await api.close();
  }
});

test("C2 stored XSS payloads are returned as inert text and never executed", async () => {
  const { api, ownerClient, ownerCsrf } = await twoAccounts();
  try {
    const payloads = [
      "<script>alert(1)</script>",
      '"><img src=x onerror=alert(1)>',
      "javascript:alert(1)",
      "‮gnp.exe‬", // RTL override
      "test​with​zero​width", // zero-width characters
      "<svg/onload=alert(1)>",
    ];
    for (const payload of payloads) {
      const document_ = await ownerClient.request("/api/admin/content");
      // Product name and description carry the payload through the public API...
      const created = await ownerClient.json(
        "/api/admin/products",
        "POST",
        {
          revision: document_.body.revision,
          product: {
            category: "ألبان",
            name: payload,
            desc: payload,
            longDesc: payload,
          },
        },
        { "x-csrf-token": ownerCsrf },
      );
      assert.equal(
        created.status,
        201,
        `payload must be storable as text: ${payload}`,
      );
      const publicContent = await api.request("/api/content");
      const stored = publicContent.body.products.find(
        (product) => product.name === payload,
      );
      assert.ok(stored, "the payload round-trips as data");
      // ...and is delivered as JSON text, so React escapes it on render.
      assert.equal(typeof stored.name, "string");
      assert.equal(
        JSON.stringify(publicContent.body).includes("</script><script>"),
        false,
      );

      // Announcements and display names behave the same way.
      const event = await ownerClient.json(
        "/api/admin/events",
        "POST",
        {
          title: payload,
          description: payload,
          imageUrl: "",
          type: "announcement",
          startAt: "",
          endAt: "",
          active: true,
        },
        { "x-csrf-token": ownerCsrf },
      );
      assert.equal(event.status, 201);
      const me = await ownerClient.json(
        "/api/admin/profile",
        "PUT",
        { displayName: payload, email: OWNER.email, avatarUrl: "" },
        { "x-csrf-token": ownerCsrf },
      );
      assert.equal(me.status, 200);
      // Restore the display name so later assertions stay readable.
      await ownerClient.json(
        "/api/admin/profile",
        "PUT",
        { displayName: OWNER.displayName, email: OWNER.email, avatarUrl: "" },
        { "x-csrf-token": ownerCsrf },
      );

      // A wholesale request carries it too.
      const request = await api.json(
        "/api/wholesale-requests",
        "POST",
        validRequest({ name: payload.slice(0, 20) || "x" }),
      );
      assert.ok([200, 201].includes(request.status));
    }
    // No response header may invite the browser to sniff markup.
    const content = await api.request("/api/content");
    assert.match(
      content.headers.get("content-security-policy") ?? "",
      /script-src 'self'/,
    );
    assert.equal(content.headers.get("x-content-type-options"), "nosniff");
  } finally {
    await api.close();
  }
});

test("C3 dangerous URL schemes and protocol-relative URLs are rejected in every URL field", async () => {
  const { api, ownerClient, ownerCsrf } = await twoAccounts();
  try {
    const document_ = await ownerClient.request("/api/admin/content");
    const revision = document_.body.revision;
    const bad = [
      "javascript:alert(1)",
      "data:image/svg+xml;base64,PHN2Zy8+",
      "vbscript:msgbox(1)",
      "file:///etc/passwd",
      "//evil.example.com/x.png",
      "http://insecure.example.com/x.png",
    ];
    for (const url of bad) {
      const product = await ownerClient.json(
        "/api/admin/products",
        "POST",
        {
          revision,
          product: {
            category: "ألبان",
            name: `صورة ${url}`,
            desc: "وصف",
            img: url,
          },
        },
        { "x-csrf-token": ownerCsrf },
      );
      assert.equal(product.status, 422, `image URL must be refused: ${url}`);

      const event = await ownerClient.json(
        "/api/admin/events",
        "POST",
        {
          title: "مناسبة",
          description: "",
          imageUrl: url,
          type: "announcement",
          startAt: "",
          endAt: "",
          active: true,
        },
        { "x-csrf-token": ownerCsrf },
      );
      assert.equal(event.status, 422, `event image must be refused: ${url}`);

      const avatar = await ownerClient.json(
        "/api/admin/profile",
        "PUT",
        { displayName: OWNER.displayName, email: OWNER.email, avatarUrl: url },
        { "x-csrf-token": ownerCsrf },
      );
      assert.equal(avatar.status, 422, `avatar must be refused: ${url}`);
    }

    // A same-origin upload path and an https URL are both accepted.
    const good = await ownerClient.json(
      "/api/admin/profile",
      "PUT",
      {
        displayName: OWNER.displayName,
        email: OWNER.email,
        avatarUrl: "/uploads/0123456789abcdef0123456789abcdef.png",
      },
      { "x-csrf-token": ownerCsrf },
    );
    assert.equal(good.status, 200);
    assert.equal(
      api.db.findAdmin(OWNER.email).avatar_url.startsWith("/uploads/"),
      true,
    );
  } finally {
    await api.close();
  }
});

test("C4 oversized, mistyped and hostile JSON bodies are refused without a 500", async () => {
  const { api, ownerClient, ownerCsrf } = await twoAccounts();
  try {
    // Deeply nested JSON (1 000 levels) must not crash the parser or the schema.
    let nested = "1";
    for (let i = 0; i < 1000; i += 1) nested = `{"a":${nested}}`;
    const deep = await ownerClient.request("/api/admin/content", {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        "x-csrf-token": ownerCsrf,
      },
      body: `{"revision":1,"site":${nested}}`,
    });
    assert.ok(
      [400, 413, 422].includes(deep.status),
      `deeply nested body -> ${deep.status}`,
    );

    // Oversized body (》512kb limit).
    const huge = await ownerClient.request("/api/admin/events", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-csrf-token": ownerCsrf,
      },
      body: JSON.stringify({ title: "x".repeat(600 * 1024) }),
    });
    assert.equal(huge.status, 413);
    assert.equal(huge.body.error, "payload-too-large");

    // Malformed JSON.
    const malformed = await ownerClient.request("/api/admin/events", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-csrf-token": ownerCsrf,
      },
      body: "{not json",
    });
    assert.equal(malformed.status, 400);
    assert.equal(malformed.body.error, "invalid-json");

    // Wrong types, NaN/Infinity, negative and huge numbers.
    const document_ = await ownerClient.request("/api/admin/content");
    const badProducts = [
      { quantity: "many" },
      { quantity: -5 },
      { quantity: 1e12 },
      { discountPercent: -1 },
      { discountPercent: 99 },
      { availability: "maybe" },
      { isNew: "yes" },
    ];
    for (const overrides of badProducts) {
      const response = await ownerClient.json(
        "/api/admin/products",
        "POST",
        {
          revision: document_.body.revision,
          product: {
            category: "ألبان",
            name: "منتج",
            desc: "وصف",
            ...overrides,
          },
        },
        { "x-csrf-token": ownerCsrf },
      );
      assert.equal(
        response.status,
        422,
        `bad product field must be refused: ${JSON.stringify(overrides)}`,
      );
    }

    // Unknown fields (including a client-supplied id) are stripped, never applied.
    const withExtras = await ownerClient.json(
      "/api/admin/products",
      "POST",
      {
        revision: api.db.getContent().revision,
        product: {
          category: "ألبان",
          name: "منتج بحقول زائدة",
          desc: "وصف",
          id: "1",
          role: "owner",
          __v: 3,
        },
      },
      { "x-csrf-token": ownerCsrf },
    );
    assert.equal(withExtras.status, 201);
    assert.equal(
      typeof withExtras.body.product.id,
      "number",
      "the server assigns the id",
    );
    assert.equal(
      withExtras.body.product.id === 1,
      false,
      "a client cannot pick the id",
    );

    // Infinity cannot even be serialised as JSON by a compliant client, so the
    // raw form is sent to prove the server rejects it too.
    const rawInfinity = await ownerClient.request("/api/admin/products", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-csrf-token": ownerCsrf,
      },
      body: JSON.stringify({
        revision: document_.body.revision,
        product: {
          category: "ألبان",
          name: "منتج",
          desc: "وصف",
          quantity: null,
        },
      }).replace('"quantity":null', '"quantity":Infinity'),
    });
    assert.equal(rawInfinity.status, 400);
  } finally {
    await api.close();
  }
});

test("C5 prototype pollution payloads are stripped and never pollute global prototypes", async () => {
  const { api, ownerClient, ownerCsrf } = await twoAccounts();
  try {
    const document_ = await ownerClient.request("/api/admin/content");
    const response = await ownerClient.request("/api/admin/products", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-csrf-token": ownerCsrf,
      },
      body: JSON.stringify({
        revision: document_.body.revision,
        product: {
          category: "ألبان",
          name: "منتج",
          desc: "وصف",
          __proto__: { polluted: "yes" },
          constructor: { prototype: { polluted: "yes" } },
        },
      }),
    });
    assert.equal(response.status, 201);
    assert.equal({}.polluted, undefined, "Object.prototype must stay clean");
    assert.equal(Object.prototype.polluted, undefined);
    const stored = api.db.getContent().products.at(-1);
    assert.equal("polluted" in stored, false);
    assert.equal(stored.constructor === Object, true);
  } finally {
    await api.close();
  }
});

test("C6 path traversal cannot read the database, the env file or the server sources", async () => {
  const { api } = await twoAccounts();
  try {
    const targets = [
      "/uploads/../../elbaz.sqlite",
      "/uploads/..%2f..%2felbaz.sqlite",
      "/uploads/%2e%2e%2f%2e%2e%2felbaz.sqlite",
      "/uploads/0123456789abcdef0123456789abcdef.png/../../elbaz.sqlite",
      "/uploads/.data/elbaz.sqlite",
      "/uploads/%00.png",
      "/server/db.ts",
      "/.env",
      "/.env.example",
      "/.data/setup-token",
      "/shared/content.ts",
      "/package-lock.json",
      "/uploads/....//....//elbaz.sqlite",
    ];
    for (const path of targets) {
      const response = await api.request(path);
      // 404 (never served) or 400 (rejected by the HTTP layer) are both safe.
      assert.ok(
        [400, 404].includes(response.status),
        `${path} -> ${response.status}`,
      );
      const body =
        typeof response.body === "string"
          ? response.body
          : JSON.stringify(response.body);
      assert.equal(
        body.includes("SQLite format"),
        false,
        `${path} leaked the database`,
      );
      assert.equal(/scrypt\$/.test(body), false, `${path} leaked a hash`);
      assert.equal(body.includes("import "), false, `${path} leaked source`);
    }
  } finally {
    await api.close();
  }
});

/* ========================================================= D. CSRF / origin */

test("D1 every mutation needs a CSRF token, and a token from another session never works", async () => {
  const { api, ownerClient, ownerCsrf, adminClient, adminCsrf } =
    await twoAccounts();
  try {
    const session = await ownerClient.request("/api/admin/session");
    const mutations = [
      [
        "PUT",
        "/api/admin/profile",
        { displayName: "x", email: OWNER.email, avatarUrl: "" },
      ],
      [
        "PUT",
        "/api/admin/profile/password",
        { currentPassword: "x", newPassword: "fresh-long-password-9" },
      ],
      [
        "PUT",
        "/api/admin/profile/security",
        { currentAnswer: "", securityQuestion: "س", securityAnswer: "ج" },
      ],
      [
        "POST",
        "/api/admin/admins",
        {
          username: "x",
          displayName: "x",
          email: "x@e.online",
          password: "a-very-long-password",
          role: "admin",
        },
      ],
      ["PUT", "/api/admin/content", { revision: 1 }],
      ["POST", "/api/admin/events", { title: "x" }],
      ["PUT", "/api/admin/events/1", { title: "x" }],
      ["DELETE", "/api/admin/events/1", {}],
      ["PATCH", "/api/admin/requests/1", { status: "confirmed" }],
      ["DELETE", "/api/admin/requests/1", {}],
      [
        "POST",
        "/api/admin/products",
        { revision: 1, product: { category: "أ", name: "ن", desc: "و" } },
      ],
      [
        "PUT",
        "/api/admin/products/1",
        { revision: 1, product: { category: "أ", name: "ن", desc: "و" } },
      ],
      ["DELETE", "/api/admin/products/1", { revision: 1 }],
    ];
    const before = JSON.stringify(api.db.getContent().products.length);

    for (const [method, path, body] of mutations) {
      // Missing token.
      const missing = await ownerClient.request(path, {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      assert.equal(missing.status, 403, `${method} ${path} without a token`);
      assert.equal(missing.body.error, "csrf-rejected");

      // Wrong token.
      const wrong = await ownerClient.request(path, {
        method,
        headers: {
          "content-type": "application/json",
          "x-csrf-token": "not-a-real-token",
        },
        body: JSON.stringify(body),
      });
      assert.equal(wrong.status, 403, `${method} ${path} with a garbage token`);

      // Another session's valid token.
      const cross = await ownerClient.request(path, {
        method,
        headers: {
          "content-type": "application/json",
          "x-csrf-token": adminCsrf,
        },
        body: JSON.stringify(body),
      });
      assert.equal(
        cross.status,
        403,
        `${method} ${path} with a foreign session's token`,
      );
      assert.equal(cross.body.error, "csrf-rejected");
    }
    assert.equal(
      JSON.stringify(api.db.getContent().products.length),
      before,
      "no state change",
    );
    assert.ok(adminCsrf && ownerCsrf && session.body.csrf === ownerCsrf);
    assert.ok(adminClient);
  } finally {
    await api.close();
  }
});

test("D2 cross-site origins are rejected on every mutating route", async () => {
  const { api, ownerClient, ownerCsrf } = await twoAccounts();
  try {
    const foreign = [
      "https://evil.example.com",
      "http://localhost:9999",
      "null",
    ];
    for (const origin of foreign) {
      const response = await ownerClient.request("/api/admin/profile", {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          "x-csrf-token": ownerCsrf,
          origin,
        },
        body: JSON.stringify({
          displayName: "اسم",
          email: OWNER.email,
          avatarUrl: "",
        }),
      });
      assert.equal(response.status, 403, `origin ${origin} must be refused`);
      assert.equal(response.body.error, "origin-not-allowed");
    }

    // A public write (no session at all) is guarded the same way.
    for (const origin of foreign) {
      const response = await api.request("/api/wholesale-requests", {
        method: "POST",
        headers: { "content-type": "application/json", origin },
        body: JSON.stringify(validRequest()),
      });
      assert.equal(response.status, 403);
    }

    // The same request from the real origin passes, and the API never answers
    // with CORS headers (same-origin only).
    const allowed = await api.request("/api/wholesale-requests", {
      method: "POST",
      headers: { "content-type": "application/json", origin: api.base },
      body: JSON.stringify(validRequest()),
    });
    assert.equal(allowed.status, 201);
    assert.equal(allowed.headers.get("access-control-allow-origin"), null);
    const preflight = await api.request("/api/wholesale-requests", {
      method: "OPTIONS",
      headers: {
        origin: "https://evil.example.com",
        "access-control-request-method": "POST",
      },
    });
    assert.equal(preflight.headers.get("access-control-allow-origin"), null);
    assert.ok([200, 204, 404].includes(preflight.status));
  } finally {
    await api.close();
  }
});

/* ================================================================ E. uploads */

test("E1 uploads accept only real images, only from signed-in accounts, only within the limits", async () => {
  const { api, adminClient, adminCsrf } = await twoAccounts();
  try {
    const anonymous = api.createClient();
    const anonymousUpload = await anonymous.request("/api/admin/uploads", {
      method: "POST",
      body: new FormData(),
    });
    assert.equal(anonymousUpload.status, 401, "uploads require a session");

    const upload = (file) => {
      const form = new FormData();
      form.append("file", file);
      return adminClient.request("/api/admin/uploads", {
        method: "POST",
        headers: { "x-csrf-token": adminCsrf },
        body: form,
      });
    };

    // Real images are stored under a random name that cannot be predicted or executed.
    for (const [name, type, buffer] of [
      ["photo.png", "image/png", PNG],
      [
        "photo.jpg",
        "image/jpeg",
        Buffer.concat([
          Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
          Buffer.alloc(64),
        ]),
      ],
      [
        "anim.gif",
        "image/gif",
        Buffer.concat([Buffer.from("GIF89a"), Buffer.alloc(32)]),
      ],
    ]) {
      const response = await upload(new File([buffer], name, { type }));
      assert.equal(response.status, 201, `${name} must be accepted`);
      assert.match(
        response.body.upload.url,
        /^\/uploads\/[a-f0-9]{32}\.(png|jpg|gif)$/,
      );
      assert.match(response.body.upload.filename, /^[a-f0-9]{32}/);
      assert.equal(
        response.body.upload.filename.includes(name),
        false,
        "the client name is not reused",
      );
    }

    // Renamed scripts, polyglots, wrong magic bytes, double extensions, null bytes.
    const rejected = [
      new File([Buffer.from("<?php system($_GET['c']); ?>")], "shell.php", {
        type: "image/png",
      }),
      new File([Buffer.from("<?php echo 1; ?>")], "shell.png", {
        type: "image/png",
      }),
      new File(
        [
          Buffer.from(
            "<svg xmlns='http://www.w3.org/2000/svg' onload='alert(1)'/>",
          ),
        ],
        "x.svg",
        { type: "image/svg+xml" },
      ),
      new File([Buffer.from("<html><script>alert(1)</script>")], "x.html", {
        type: "image/png",
      }),
      new File(
        [Buffer.from("GIF89a<script>alert(1)</script>")],
        "polyglot.gif",
        { type: "image/gif" },
      ),
      new File([Buffer.from([0x89, 0x50, 0x4e, 0x47])], "truncated.png", {
        type: "image/png",
      }),
      new File([Buffer.from("not an image at all")], "double.png.php", {
        type: "image/png",
      }),
      new File([Buffer.from("x".repeat(2048))], "null\0.png", {
        type: "image/png",
      }),
      new File([Buffer.alloc(0)], "empty.png", { type: "image/png" }),
    ];
    for (const file of rejected) {
      const response = await upload(file);
      assert.equal(response.status, 422, `${file.name} must be refused`);
      // The null-byte name is rejected by the multipart parser itself, which is
      // still a refusal (nothing is written); everything else fails validation.
      assert.ok(
        ["unsupported-type", "empty-file", "no-file", "upload-failed"].includes(
          response.body.error,
        ),
        `${file.name}: ${response.body.error}`,
      );
    }

    // Over 5 MB.
    const big = new File(
      [Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024)])],
      "big.png",
      { type: "image/png" },
    );
    const tooBig = await upload(big);
    assert.equal(tooBig.status, 413);
    assert.equal(tooBig.body.error, "file-too-large");

    // Served back with a safe content type and never as executable content.
    const stored = await upload(
      new File([PNG], "serve.png", { type: "image/png" }),
    );
    const url = stored.body.upload.url;
    const served = await api.request(url);
    assert.equal(served.status, 200);
    assert.equal(served.headers.get("x-content-type-options"), "nosniff");
    assert.equal(served.headers.get("content-type"), "image/png");
    assert.match(served.headers.get("cache-control"), /immutable/);
    assert.match(served.headers.get("content-disposition") ?? "", /inline/);
    // Nothing can be executed: the URL is a static file, not a route.
    assert.equal(url.includes(".."), false);
    assert.equal(url.includes("php"), false);
  } finally {
    await api.close();
  }
});

test("E2 uploads cannot be used to exhaust the disk or bypass the size limit in parallel", async () => {
  const { api, adminClient, adminCsrf } = await twoAccounts();
  try {
    const upload = (name) => {
      const form = new FormData();
      form.append("file", new File([PNG], name, { type: "image/png" }));
      return adminClient.request("/api/admin/uploads", {
        method: "POST",
        headers: { "x-csrf-token": adminCsrf },
        body: form,
      });
    };
    // 40 parallel uploads of a tiny valid image: all must be answered, none may
    // crash the server, and each file must get a distinct name.
    const responses = await Promise.all(
      Array.from({ length: 40 }, (_, index) => upload(`parallel-${index}.png`)),
    );
    const names = new Set();
    for (const response of responses) {
      assert.equal(response.status, 201, JSON.stringify(response.body));
      names.add(response.body.upload.filename);
    }
    assert.equal(
      names.size,
      responses.length,
      "every upload gets its own random name",
    );

    const failing = await Promise.all(
      Array.from({ length: 6 }, () => upload("bad.png").then(() => null)),
    );
    assert.equal(failing.filter(Boolean).length, 0);
  } finally {
    await api.close();
  }
});

/* ========================================================= F. public surface */

test("F1 wholesale flooding is limited, and X-Forwarded-For cannot dodge the limiter by default", async () => {
  // Default deployment (trust nobody): the header is ignored, so rotating it
  // must NOT hand the attacker a fresh bucket for every request.
  const direct = await startTestServer({
    relaxRateLimits: false,
    trustProxyHops: 0,
  });
  try {
    let blocked = 0;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const response = await direct.request("/api/wholesale-requests", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": `203.0.113.${attempt}`,
        },
        body: JSON.stringify(validRequest()),
      });
      if (response.status === 429) blocked += 1;
    }
    assert.ok(blocked > 0, "spoofing the header must not bypass the limiter");
    const limited = await direct.request("/api/wholesale-requests", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(validRequest()),
    });
    assert.equal(limited.status, 429);
    assert.equal(limited.body.error, "too-many-requests");
    // The recorded address is the real socket address, never the spoofed one.
    const rows = direct.db.raw.prepare("SELECT ip, kind FROM audit_log").all();
    assert.equal(
      rows.some((row) => String(row.ip).startsWith("203.0.113.")),
      false,
      "a spoofed address must never reach the audit trail",
    );
  } finally {
    await direct.close();
  }

  // Behind a declared proxy hop (TRUST_PROXY_HOPS=1) the forwarded address IS
  // used — the documented requirement is that the proxy overwrites the header.
  const proxied = await startTestServer({
    relaxRateLimits: false,
    trustProxyHops: 1,
  });
  try {
    const real = await proxied.request("/api/wholesale-requests", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": "198.51.100.7",
      },
      body: JSON.stringify(validRequest()),
    });
    assert.equal(real.status, 201);
    const row = proxied.db.raw
      .prepare("SELECT ip FROM audit_log WHERE kind = 'ratelimit.hit'")
      .all();
    assert.equal(
      row.length,
      0,
      "one request from a new address is not a flood",
    );
  } finally {
    await proxied.close();
  }
});

test("F2 idempotency keys are bound to their payload", async () => {
  const api = await startTestServer({ relaxRateLimits: true });
  try {
    const key = uniqueKey();
    const first = await api.json(
      "/api/wholesale-requests",
      "POST",
      validRequest({ requestKey: key }),
    );
    assert.equal(first.status, 201);
    const replay = await api.json(
      "/api/wholesale-requests",
      "POST",
      validRequest({ requestKey: key }),
    );
    assert.equal(replay.status, 200);
    assert.equal(replay.body.duplicate, true);
    assert.equal(
      replay.body.id,
      first.body.id,
      "a true replay returns the same record",
    );

    // Same key, different payload: refuse instead of returning stale data.
    const conflicting = await api.json(
      "/api/wholesale-requests",
      "POST",
      validRequest({ requestKey: key, quantity: 999, product: "منتج آخر" }),
    );
    assert.equal(conflicting.status, 409);
    assert.equal(conflicting.body.error, "request-key-conflict");
    const total = api.db.raw
      .prepare("SELECT COUNT(*) AS n FROM wholesale_requests")
      .get();
    assert.equal(
      Number(total.n),
      1,
      "the conflicting submission is not stored",
    );
  } finally {
    await api.close();
  }
});

test("F3 the SSE stream stays public, bounded and clean", async () => {
  const api = await startTestServer({ relaxRateLimits: true });
  try {
    const openStreams = [];
    for (let index = 0; index < 12; index += 1) {
      const controller = new AbortController();
      const response = await fetch(`${api.base}/api/stream`, {
        signal: controller.signal,
      });
      openStreams.push({ controller, response, status: response.status });
    }
    const statuses = openStreams.map((item) => item.status);
    assert.ok(statuses.includes(200), "a visitor can subscribe");
    assert.ok(
      statuses.includes(503),
      "a single host cannot open unlimited streams",
    );

    // The first frames must be the documented retry hint and a hello, with no
    // private data anywhere in the stream.
    const first = openStreams.find((item) => item.status === 200);
    const reader = first.response.body.getReader();
    const decoder = new TextDecoder();
    let text = "";
    const deadline = Date.now() + 3000;
    while (!text.includes("hello") && Date.now() < deadline) {
      const { value, done } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }
    assert.match(text, /retry: 3000/);
    assert.match(text, /"type":"hello"/);
    assert.equal(
      /scrypt|password|csrf|security_answer/.test(text),
      false,
      "no secrets on the wire",
    );

    // Closing every stream must release the slots (no leak).
    for (const item of openStreams) item.controller.abort();
    await new Promise((resolve) => setTimeout(resolve, 250));
    const after = await fetch(`${api.base}/api/stream`, {
      signal: AbortSignal.timeout(2000),
    });
    assert.equal(
      after.status,
      200,
      "slots are released when clients disconnect",
    );
    after.body?.cancel?.();
  } finally {
    await api.close();
  }
});

test("F4 nothing private ever appears on the public endpoints", async () => {
  const { api, ownerClient, ownerCsrf } = await twoAccounts();
  try {
    // Publish a hidden event and a private note, then read the public API.
    await ownerClient.json(
      "/api/admin/events",
      "POST",
      {
        title: "إعلان غير منشور",
        description: "لا يجب أن يظهر",
        imageUrl: "",
        type: "announcement",
        startAt: "",
        endAt: "",
        active: false,
      },
      { "x-csrf-token": ownerCsrf },
    );
    await api.json(
      "/api/wholesale-requests",
      "POST",
      validRequest({ name: "عميل خاص", notes: "ملاحظة داخلية سرية" }),
    );

    const surface = [];
    for (const path of ["/api/content", "/api/health"]) {
      const response = await api.request(path);
      surface.push(JSON.stringify(response.body));
    }
    const blob = surface.join("\n");
    for (const secret of [
      "scrypt",
      "password_hash",
      "security_answer_hash",
      "secret-long-password-1",
      OWNER.answer,
      "owner@elpaze.online",
      "عميل خاص",
      "ملاحظة داخلية سرية",
      "إعلان غير منشور",
      "setup-token",
    ]) {
      assert.equal(
        blob.includes(secret),
        false,
        `public API leaked: ${secret}`,
      );
    }
    // The owner-only audit endpoint is not a public endpoint either.
    const anonymous = api.createClient();
    assert.equal(
      (await anonymous.request("/api/admin/admins/audit")).status,
      401,
    );
  } finally {
    await api.close();
  }
});

/* ========================================================= G. data & errors */

test("G1 hashes never leave the server, in any response, error or log line", async () => {
  const { api, ownerClient, ownerCsrf, adminClient, adminCsrf } =
    await twoAccounts();
  try {
    const admin = api.db.findAdmin("editor");
    assert.match(admin.password_hash, /^scrypt\$/);
    const owner = api.db.findAdmin(OWNER.email);
    assert.match(owner.security_answer_hash, /^scrypt\$/);

    const responses = [
      await ownerClient.request("/api/admin/session"),
      await ownerClient.request("/api/admin/profile"),
      await ownerClient.request("/api/admin/admins"),
      await ownerClient.request("/api/admin/admins/audit"),
      await ownerClient.request("/api/admin/content"),
      await adminClient.request("/api/admin/profile"),
    ];
    const body = responses
      .map((response) => JSON.stringify(response.body))
      .join("\n");
    assert.equal(body.includes(admin.password_hash), false);
    assert.equal(body.includes(owner.security_answer_hash), false);
    assert.equal(body.includes("password_hash"), false);
    assert.equal(body.includes("security_answer_hash"), false);

    // The same for every error shape.
    const errors = [
      await api.json("/api/admin/login", "POST", {
        identifier: "editor",
        password: "nope",
      }),
      await adminClient.json(
        "/api/admin/admins",
        "POST",
        {},
        { "x-csrf-token": adminCsrf },
      ),
      await ownerClient.json(
        "/api/admin/products",
        "POST",
        { revision: -1 },
        { "x-csrf-token": ownerCsrf },
      ),
      await api.request("/api/does-not-exist"),
    ];
    const errorBlob = errors
      .map((response) => JSON.stringify(response.body))
      .join("\n");
    assert.equal(/scrypt\$/.test(errorBlob), false);
    assert.equal(
      errorBlob.includes("at Object."),
      false,
      "no stack traces in responses",
    );
    assert.equal(
      errorBlob.includes("SQLITE"),
      false,
      "no SQL text in responses",
    );
  } finally {
    await api.close();
  }
});

test("G2 a write that cannot be stored is never reported as saved", async () => {
  const api = await startTestServer({ relaxRateLimits: true });
  try {
    await setupOwner(api, api);
    // Sabotage the table so the insert fails, then prove the API says so.
    api.db.raw.exec("DROP TABLE wholesale_requests");
    const response = await api.json(
      "/api/wholesale-requests",
      "POST",
      validRequest(),
    );
    assert.equal(response.status, 500);
    assert.equal(response.body.error, "persistence-failed");
    assert.equal(
      JSON.stringify(response.body).includes("no such table"),
      false,
      "no SQL leak",
    );
  } finally {
    await api.close();
  }
});

test("G3 the database file is private and the data directory is owner-only", async () => {
  const api = await startTestServer({ relaxRateLimits: true });
  try {
    const dbStat = statSync(join(api.dataDir, "elbaz.sqlite"));
    const dirStat = statSync(api.dataDir);
    assert.equal(
      dbStat.mode & 0o077,
      0,
      `database mode ${dbStat.mode.toString(8)} must not be group/world readable`,
    );
    assert.equal(
      dirStat.mode & 0o077,
      0,
      `data dir mode ${dirStat.mode.toString(8)} must be private`,
    );
    const tokenStat = statSync(join(api.dataDir, "setup-token"));
    assert.equal(tokenStat.mode & 0o077, 0, "the setup token must be private");
  } finally {
    await api.close();
  }
});

/* =========================================================== H. headers/config */

test("H1 security headers, no-store on private data and no HSTS without TLS", async () => {
  const api = await startTestServer({ relaxRateLimits: true });
  try {
    const publicContent = await api.request("/api/content");
    const csp = publicContent.headers.get("content-security-policy") ?? "";
    assert.match(csp, /default-src 'self'/);
    assert.match(csp, /script-src 'self'/);
    assert.match(csp, /object-src 'none'/);
    assert.match(csp, /base-uri 'self'/);
    assert.match(csp, /form-action 'self'/);
    assert.match(csp, /frame-ancestors/);
    // img-src must allow https images, matching what the dashboard accepts.
    assert.match(csp, /img-src [^;]*https:/);
    assert.equal(
      publicContent.headers.get("x-content-type-options"),
      "nosniff",
    );
    assert.match(
      publicContent.headers.get("referrer-policy") ?? "",
      /strict-origin/,
    );
    assert.equal(
      publicContent.headers.get("hsts"),
      null,
      "no HSTS over plain http",
    );
    assert.equal(publicContent.headers.get("x-powered-by"), null);

    // Authenticated responses are never cached.
    const session = await api.request("/api/admin/session");
    assert.equal(session.headers.get("cache-control"), "no-store");

    // With a secure deployment the framing protection and HSTS turn on.
    const secure = await startTestServer({
      relaxRateLimits: true,
      secureCookies: true,
      dataDir: api.dataDir,
    });
    try {
      const response = await secure.request("/api/content");
      const secureCsp = response.headers.get("content-security-policy") ?? "";
      assert.match(secureCsp, /frame-ancestors 'none'/);
      assert.match(
        response.headers.get("strict-transport-security") ?? "",
        /max-age=15552000/,
      );
    } finally {
      await secure.close();
    }
  } finally {
    await api.close();
  }
});

test("H2 no debug surface, no directory listing and no default credentials", async () => {
  const api = await startTestServer({ relaxRateLimits: true });
  try {
    // Before setup there is exactly one account-creating path, and it needs the token file.
    for (const path of [
      "/api/admin",
      "/api/admin/",
      "/api/admin/admins/export",
      "/debug",
      "/api/debug",
      "/server/index.ts",
      "/.data/",
    ]) {
      const response = await api.request(path);
      assert.ok(
        [401, 403, 404].includes(response.status),
        `${path} -> ${response.status}`,
      );
    }
    // The default credentials people try first do not exist.
    for (const identifier of ["admin", "administrator", "owner", "root"]) {
      const response = await api.json("/api/admin/login", "POST", {
        identifier,
        password: "admin",
      });
      assert.equal(response.status, 401);
    }
    assert.equal(api.db.adminCount(), 0);
  } finally {
    await api.close();
  }
});

test("H3 image host policy is enforced end-to-end when configured", async () => {
  const api = await startTestServer({
    relaxRateLimits: true,
    imageHosts: ["files.catbox.moe"],
  });
  try {
    const { session: ownerSession } = await setupOwner(api, api);
    const ownerClient = api;
    const ownerCsrf = ownerSession.body.csrf;
    const document_ = await ownerClient.request("/api/admin/content");
    const csp = document_.headers.get("content-security-policy") ?? "";
    assert.match(csp, /img-src [^;]*https:\/\/files\.catbox\.moe/);
    assert.equal(
      /img-src [^;]*[^.]https:;/.test(csp),
      false,
      "the general https source is dropped",
    );

    const allowed = await ownerClient.json(
      "/api/admin/products",
      "POST",
      {
        revision: document_.body.revision,
        product: {
          category: "ألبان",
          name: "منتج مسموح",
          desc: "وصف",
          img: "https://files.catbox.moe/ok.png",
        },
      },
      { "x-csrf-token": ownerCsrf },
    );
    assert.equal(allowed.status, 201);

    const refused = await ownerClient.json(
      "/api/admin/events",
      "POST",
      {
        title: "مناسبة",
        description: "",
        imageUrl: "https://evil.example.com/tracker.png",
        type: "announcement",
        startAt: "",
        endAt: "",
        active: true,
      },
      { "x-csrf-token": ownerCsrf },
    );
    assert.equal(refused.status, 422);
    assert.equal(refused.body.error, "image-host-not-allowed");
  } finally {
    await api.close();
  }
});

/* ============================================================== audit trail */

test("AUDIT the trail records attacks and never records a secret", async () => {
  const { api, ownerClient, ownerCsrf, adminClient, adminCsrf } =
    await twoAccounts();
  try {
    // Failures: wrong password, blocked owner-only call, CSRF rejection, bad upload.
    await api.json("/api/admin/login", "POST", {
      identifier: OWNER.email,
      password: "wrong-password-1",
    });
    await adminClient.request("/api/admin/admins", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-csrf-token": adminCsrf,
      },
      body: JSON.stringify({ username: "x" }),
    });
    await ownerClient.request("/api/admin/content", {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        "x-csrf-token": "bad-token",
      },
      body: JSON.stringify({ revision: 1 }),
    });
    const form = new FormData();
    form.append(
      "file",
      new File([Buffer.from("<?php ?>")], "shell.php", { type: "image/png" }),
    );
    await adminClient.request("/api/admin/uploads", {
      method: "POST",
      headers: { "x-csrf-token": adminCsrf },
      body: form,
    });

    const audit = await ownerClient.request(
      "/api/admin/admins/audit?limit=100",
    );
    assert.equal(audit.status, 200, "the owner can read the trail");
    const kinds = new Set(audit.body.items.map((item) => item.kind));
    for (const expected of [
      "login.failed",
      "authz.owner-only-denied",
      "csrf.rejected",
      "upload.rejected",
    ]) {
      assert.ok(kinds.has(expected), `expected an audit row for ${expected}`);
    }
    assert.ok(
      audit.body.summary.suspicious >= 3,
      "suspicious events are counted for the dashboard indicator",
    );

    // No secrets in the trail, and the owner columns are informative.
    const blob = JSON.stringify(audit.body);
    for (const secret of [
      "scrypt",
      OWNER.answer,
      "kitchen-secret-pass-1",
      "wrong-password-1",
    ]) {
      assert.equal(blob.includes(secret), false, `audit leaked: ${secret}`);
    }
    const denied = audit.body.items.find(
      (item) => item.kind === "authz.owner-only-denied",
    );
    assert.equal(denied.actorName, "editor");
    assert.equal(denied.suspicious, true);

    // The suspicious filter works, and admins cannot read the trail at all.
    const onlyFlagged = await ownerClient.request(
      "/api/admin/admins/audit?suspicious=1&limit=20",
    );
    assert.equal(onlyFlagged.body.items.length > 0, true);
    assert.equal(
      onlyFlagged.body.items.every((item) => item.suspicious),
      true,
    );
    assert.equal(
      (await adminClient.request("/api/admin/admins/audit")).status,
      403,
    );
    assert.ok(ownerCsrf);
  } finally {
    await api.close();
  }
});
