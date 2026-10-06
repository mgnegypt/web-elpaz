// Shared helpers: an in-process app with a throwaway database plus a cookie-aware fetch.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { createApp } from "../server/app.ts";

export const OWNER = {
  username: "owner",
  password: "a-very-long-password",
  email: "owner@elpaze.online",
  finalPassword: "owner-final-password-1",
  displayName: "مالك المصنع",
  question: "اسم أول حيوان أليف؟",
  answer: "مشمش",
};

/**
 * Runs the whole first-run flow for an Owner account and returns a client that
 * is logged in with the final credentials (password + security answer).
 *
 * setup (token + password) → complete profile (email/security question) →
 * re-login with the new credentials → answer the security question.
 */
export async function setupOwner(api, client = api, overrides = {}) {
  const owner = { ...OWNER, ...overrides };
  const token = readFileSync(join(api.dataDir, "setup-token"), "utf8").trim();
  const created = await client.json("/api/admin/setup", "POST", {
    token,
    username: owner.username,
    password: owner.password,
  });
  const completed = await client.json(
    "/api/admin/profile/complete",
    "POST",
    {
      displayName: owner.displayName,
      email: owner.email,
      password: owner.finalPassword,
      securityQuestion: owner.question,
      securityAnswer: owner.answer,
    },
    { "x-csrf-token": created.body.csrf },
  );
  const session = await loginWithSecurity(client, owner.email, owner.finalPassword, owner.answer);
  return { owner, created, completed, session };
}

/** Logs in, answering the security question when the account has one. */
export async function loginWithSecurity(client, identifier, password, answer) {
  const login = await client.json("/api/admin/login", "POST", { identifier, password });
  if (login.status !== 200) return login;
  if (login.body.requiresSecurityAnswer) {
    const verified = await client.json("/api/admin/login/security", "POST", { answer });
    return verified;
  }
  return login;
}

export async function startTestServer(options = {}) {
  // `preserve` keeps the data directory on close so a test can reopen the same database.
  const ownsDir = !options.dataDir && !options.preserve;
  const dataDir = options.dataDir ?? mkdtempSync(join(tmpdir(), "elbaz-api-"));
  const { app, db } = createApp({
    dataDir,
    secureCookies: false,
    trustProxyHops: 0,
    relaxRateLimits: true,
    ...options,
  });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;

  /**
   * Builds an HTTP client with its own cookie jar, so a test can act as several
   * accounts at once (owner + admin) without their sessions colliding.
   */
  const createClient = () => {
    const jar = new Map();
    const request = async (path, init = {}) => {
      const { anonymous, ...rest } = init;
      const headers = { ...(rest.headers ?? {}) };
      if (!anonymous && jar.size)
        headers.cookie = [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
      const response = await fetch(base + path, { ...rest, headers, redirect: "manual" });
      const setCookie = anonymous ? [] : (response.headers.getSetCookie?.() ?? []);
      for (const cookie of setCookie) {
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
      return { status: response.status, body, headers: response.headers };
    };

    const json = (path, method, payload, headers = {}) =>
      request(path, {
        method,
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify(payload),
      });

    return { request, json, jar, cookies: () => new Map(jar), clear: () => jar.clear() };
  };

  const primary = createClient();

  return {
    base,
    createClient,
    ...primary,
    dataDir,
    db,
    async close() {
      await new Promise((resolve) => server.close(resolve));
      try {
        db.close();
      } catch {
        /* already closed */
      }
      if (ownsDir) rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

export const readFile = (path) => import("node:fs").then((fs) => fs.readFileSync(path, "utf8"));
