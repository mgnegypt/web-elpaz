// Shared helpers: an in-process app with a throwaway database plus a cookie-aware fetch.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { createApp } from "../server/app.ts";

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
  const jar = new Map();

  // `anonymous` skips the cookie jar entirely (a genuinely unauthenticated request).
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

  return {
    base,
    request,
    json,
    dataDir,
    db,
    cookieJar: jar,
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
