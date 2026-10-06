// Runs the Express API (3001) and the Vite dev server (5173) together.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const envFile = join(root, ".env");

const children = [];
const start = (label, command, args) => {
  const child = spawn(command, args, {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, FORCE_COLOR: "1" },
  });
  child.on("exit", (code) => {
    if (code !== 0 && code !== null) console.error(`[dev] ${label} exited with code ${code}`);
    stop();
  });
  children.push(child);
  return child;
};

let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill("SIGTERM");
  setTimeout(() => process.exit(0), 300).unref();
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);

const apiArgs = existsSync(envFile)
  ? ["--env-file", envFile, "server/index.ts"]
  : ["server/index.ts"];

console.log("[dev] starting API on :3001 and Vite on :5173");
start("api", process.execPath, apiArgs);
start("vite", process.execPath, ["node_modules/vite/bin/vite.js", "--host", "0.0.0.0"]);
