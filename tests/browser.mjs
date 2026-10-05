// Portable headless Chromium for CI/sandboxes without a system browser.
import { chromium } from "@playwright/test";
import serverless from "@sparticuz/chromium";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { createRequire } from "node:module";
import { brotliDecompressSync } from "node:zlib";
import { execFileSync } from "node:child_process";
const require = createRequire(import.meta.url);
export async function launchBrowser() {
  let libraryPath = process.env.LD_LIBRARY_PATH || "";
  if (process.platform === "linux" && !process.env.CHROMIUM_PATH) {
    const root = dirname(dirname(require.resolve("@sparticuz/chromium")));
    const dir = await mkdtemp(join(tmpdir(), "elbaz-browser-"));
    const archive = join(dir, "libraries.tar");
    await writeFile(
      archive,
      brotliDecompressSync(await readFile(join(root, "bin/al2023.tar.br"))),
    );
    execFileSync("tar", ["xf", archive, "-C", dir]);
    libraryPath = `${join(dir, "lib")}:${libraryPath}`;
  }
  return chromium.launch({
    executablePath:
      process.env.CHROMIUM_PATH || (await serverless.executablePath()),
    args: serverless.args.filter((a) => a !== "--single-process"),
    env: { ...process.env, LD_LIBRARY_PATH: libraryPath },
    headless: true,
  });
}
