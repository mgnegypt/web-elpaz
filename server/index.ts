// Production/standalone entry point: serves the built frontend and the JSON API.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "./app.ts";

const here = dirname(fileURLToPath(import.meta.url));
export const projectRoot = resolve(here, "..");

/** Minimal .env loader: real environment variables always win. */
function loadEnvFile(path: string) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i.exec(line);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key] !== undefined) continue;
    process.env[key] = rawValue.replace(/^["']|["']$/g, "");
  }
}

loadEnvFile(join(projectRoot, ".env"));

const port = Number(process.env.PORT ?? 3001);
const dataDir = resolve(projectRoot, process.env.DATA_DIR ?? ".data");

/**
 * Proxy hops in front of the app. Defaults to 0 (trust nobody) so a
 * directly-exposed server can never be fooled by a client-supplied
 * X-Forwarded-For header. Deployments behind nginx/Caddy/Cloudflare must set
 * TRUST_PROXY_HOPS=1 explicitly — see SECURITY.md.
 */
const trustProxyEnv = process.env.TRUST_PROXY_HOPS;
const trustProxyHops =
  trustProxyEnv === undefined ? 0 : Math.max(0, Number(trustProxyEnv) || 0);

/** Optional comma-separated image hosts. Unset = any https host is allowed. */
const imageHosts = (process.env.ALLOWED_IMAGE_HOSTS ?? "")
  .split(",")
  .map((value) => value.trim().toLowerCase())
  .filter(Boolean);

const production = process.env.NODE_ENV === "production";

/**
 * Per-IP budget for GET /api/content in a 15 minute window. Every visitor
 * reads it on every page load, so it deliberately sits far above the generic
 * API budget (see createApp). Behind a proxy that does not forward client IPs
 * the whole site shares one bucket, which is exactly how a busy hour turns
 * into "the site shows the old content again".
 */
const publicReadLimit = Math.max(
  60,
  Number(process.env.PUBLIC_READ_LIMIT) || 3000,
);

const { app, db } = createApp({
  dataDir,
  distDir: existsSync(join(projectRoot, "dist"))
    ? join(projectRoot, "dist")
    : null,
  imageHosts,
  trustProxyHops,
  // The end-to-end suites sign in many times from one address; production keeps
  // the real limits (see createApp in server/app.ts).
  relaxRateLimits: process.env.NODE_ENV === "test",
  publicReadLimit,
});

const server = app.listen(port, "0.0.0.0", () => {
  console.log(`[elban-elbaz] API + site listening on http://0.0.0.0:${port}`);
  console.log(`[elban-elbaz] data directory: ${dataDir}`);
  // Which database is this process actually serving, and did it find content?
  // A deployment that starts in a new release directory, with DATA_DIR unset
  // or pointing somewhere else, silently creates an empty database and seeds
  // the bundled demo content — which looks exactly like "the site reverted to
  // defaults". These three lines make that impossible to miss.
  const { file, provenance } = db;
  const health = db.contentHealth();
  console.log(
    `[elban-elbaz] content database: ${file} (${provenance.createdDatabase ? "created now" : "existing"})`,
  );
  console.log(
    `[elban-elbaz] content revision ${health.revision}` +
      (health.updatedAt ? `, last published ${health.updatedAt}` : "") +
      (health.ok ? "" : ` — UNREADABLE: ${health.issues.join(" | ")}`),
  );
  if (provenance.seededDefaults) {
    console.warn(
      "[elban-elbaz] WARNING: no content row was found, so the bundled demo content was seeded. " +
        "If this server already had published content, it is pointing at the WRONG data directory — " +
        `stop it and set DATA_DIR to the directory holding the real elbaz.sqlite (current: ${dataDir}).`,
    );
  }
  if (!health.ok) {
    console.error(
      "[elban-elbaz] ERROR: the stored content document does not match the schema. " +
        "/api/content answers 503 and visitors keep the last copy they loaded; fix the document and republish.",
    );
  }
  if (db.adminCount() === 0) {
    console.log(
      `[elban-elbaz] first-run setup token file: ${db.setupTokenPath} (open /admin and paste its contents)`,
    );
  }
  if (!existsSync(join(projectRoot, "dist"))) {
    console.log(
      "[elban-elbaz] dist/ not found — run `npm run build` before serving the site in production.",
    );
  }
  // Loud, actionable startup checks. Nothing here changes behaviour; it only makes an unsafe
  // deployment obvious in the logs instead of silently weaker.
  if (production && trustProxyEnv === undefined) {
    console.warn(
      "[elban-elbaz] WARNING: NODE_ENV=production without TRUST_PROXY_HOPS. " +
        "X-Forwarded-For is ignored (rate limits see the proxy IP). " +
        "Set TRUST_PROXY_HOPS=1 when running behind nginx/Caddy/Cloudflare and serve over HTTPS.",
    );
  }
  if (production && trustProxyHops === 0) {
    console.warn(
      "[elban-elbaz] WARNING: TRUST_PROXY_HOPS=0 — if a reverse proxy forwards client IPs, " +
        "every visitor shares one rate-limit bucket.",
    );
  }
  if (production && imageHosts.length > 0) {
    console.log(
      `[elban-elbaz] image hosts restricted to: ${imageHosts.join(", ")}`,
    );
  }
});

const shutdown = () => {
  server.close(() => {
    db.close();
    process.exit(0);
  });
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
