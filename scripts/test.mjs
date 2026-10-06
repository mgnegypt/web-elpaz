// Boots an isolated API + Vite pair against a throwaway database, runs the requested suites,
// then tears everything down. Real site data under .data/ is never touched.
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const mode = process.argv[2] ?? "all";

const SUITES = {
  api: ["tests/api.test.mjs"],
  site: ["tests/site.test.mjs"],
  admin: ["tests/admin.test.mjs"],
  all: ["tests/api.test.mjs", "tests/site.test.mjs", "tests/admin.test.mjs"],
};

const files = SUITES[mode];
if (!files) {
  console.error(`[test] unknown suite "${mode}" (expected api|site|admin|all)`);
  process.exit(2);
}

const needsServers = mode !== "api";

/**
 * The suites talk to fixed ports. A leftover server from an earlier run would
 * silently answer for this one (and fail the whole run in confusing ways), so
 * refuse to start instead.
 */
const assertPortsFree = async () => {
  const busy = [];
  for (const port of [3001, 5173]) {
    const taken = await new Promise((resolve) => {
      const socket = connect({ port, host: "127.0.0.1" });
      socket.setTimeout(400);
      socket.once("connect", () => {
        socket.destroy();
        resolve(true);
      });
      socket.once("error", () => resolve(false));
      socket.once("timeout", () => {
        socket.destroy();
        resolve(false);
      });
    });
    if (taken) busy.push(port);
  }
  if (busy.length) {
    throw new Error(
      `port${busy.length > 1 ? "s" : ""} ${busy.join(", ")} already in use — stop the leftover dev server(s) first`,
    );
  }
};

const dataDir = mkdtempSync(join(tmpdir(), "elbaz-test-data-"));
const children = [];

const stop = () => {
  for (const child of children) {
    try {
      child.kill("SIGTERM");
    } catch {
      /* already gone */
    }
  }
};
process.on("SIGINT", () => {
  stop();
  process.exit(130);
});
process.on("SIGTERM", () => {
  stop();
  process.exit(143);
});

const waitFor = async (url, timeoutMs) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
};

let exitCode = 1;
try {
  if (needsServers) {
    await assertPortsFree();
    const api = spawn(process.execPath, ["server/index.ts"], {
      cwd: root,
      env: {
        ...process.env,
        DATA_DIR: dataDir,
        PORT: "3001",
        TRUST_PROXY_HOPS: "1",
        NODE_ENV: "test",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    api.stdout.on("data", (b) => process.stdout.write(`[api] ${b}`));
    api.stderr.on("data", (b) => process.stderr.write(`[api] ${b}`));
    children.push(api);

    const viteBin = join(root, "node_modules/vite/bin/vite.js");
    if (!existsSync(viteBin)) throw new Error("vite is not installed — run npm ci first");
    const vite = spawn(process.execPath, [viteBin, "--host", "0.0.0.0", "--port", "5173"], {
      cwd: root,
      env: { ...process.env, NODE_ENV: "development" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    vite.stdout.on("data", (b) => process.stdout.write(`[vite] ${b}`));
    vite.stderr.on("data", (b) => process.stderr.write(`[vite] ${b}`));
    children.push(vite);

    const apiUp = await waitFor("http://127.0.0.1:3001/api/health", 30000);
    const webUp = await waitFor("http://127.0.0.1:5173/", 60000);
    if (!apiUp || !webUp) throw new Error(`servers failed to start (api=${apiUp} web=${webUp})`);
    console.log("[test] servers ready on :3001 and :5173");
  }

  // TEST_FILTER narrows a run while iterating on one case, e.g.
  // TEST_FILTER="dark/light" npm run test:admin
  const filterArgs = process.env.TEST_FILTER ? [`--test-name-pattern=${process.env.TEST_FILTER}`] : [];

  exitCode = await new Promise((resolveCode) => {
    const runner = spawn(
      process.execPath,
      ["--test", "--test-concurrency=1", ...filterArgs, ...files],
      {
        cwd: root,
        env: { ...process.env, TEST_DATA_DIR: dataDir, TEST_URL: "http://127.0.0.1:5173" },
        stdio: "inherit",
      },
    );
    children.push(runner);
    runner.on("exit", (code) => resolveCode(code ?? 1));
  });
} catch (error) {
  console.error(`[test] ${error instanceof Error ? error.message : String(error)}`);
  exitCode = 1;
} finally {
  stop();
  await new Promise((r) => setTimeout(r, 400));
  try {
    rmSync(dataDir, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
}

process.exit(exitCode);
