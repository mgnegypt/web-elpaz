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
const trustProxyHops = Number(process.env.TRUST_PROXY_HOPS ?? 1);
const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

const { app, db } = createApp({
  dataDir,
  distDir: existsSync(join(projectRoot, "dist")) ? join(projectRoot, "dist") : null,
  allowedOrigins,
  trustProxyHops,
});

const server = app.listen(port, "0.0.0.0", () => {
  console.log(`[elban-elbaz] API + site listening on http://0.0.0.0:${port}`);
  console.log(`[elban-elbaz] data directory: ${dataDir}`);
  if (db.adminCount() === 0) {
    console.log(
      `[elban-elbaz] first-run setup token file: ${db.setupTokenPath} (open /admin and paste its contents)`,
    );
  }
  if (!existsSync(join(projectRoot, "dist"))) {
    console.log("[elban-elbaz] dist/ not found — run `npm run build` before serving the site in production.");
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
