import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

/**
 * The dev server must never hand out the database, the setup token, .env, server source or other
 * private files — even if someone guesses the path.
 */
// NOTE: node_modules is deliberately NOT blocked — Vite serves optimised deps from there.
const PRIVATE_SEGMENTS = new Set([
  ".data",
  ".env",
  ".git",
  "server",
  "package-lock.json",
]);
const PRIVATE_EXTENSIONS = /\.(sqlite|sqlite3|sqlite-wal|sqlite-shm|db|db-wal|db-shm|env)$/i;

const blockPrivateFiles = (): Plugin => ({
  name: "elbaz-block-private-files",
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      const path = (req.url ?? "/").split("?")[0];
      const first = path.split("/").filter(Boolean)[0] ?? "";
      if (PRIVATE_SEGMENTS.has(first) || PRIVATE_EXTENSIONS.test(path)) {
        res.statusCode = 404;
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.end("Not found");
        return;
      }
      next();
    });
  },
});

export default defineConfig({
  plugins: [react(), tailwindcss(), blockPrivateFiles()],
  server: {
    host: "0.0.0.0",
    port: 5173,
    strictPort: true,
    allowedHosts: [".e2b.app", "localhost"],
    fs: {
      // Belt and braces: Vite itself refuses to serve these too.
      deny: [".env", ".env.*", "**/.data/**", "**/server/**", "**/*.sqlite*", "**/*.tsbuildinfo"],
    },
    proxy: {
      // The browser only ever talks to relative /api/... URLs; Vite forwards them to Express.
      "/api": {
        target: "http://127.0.0.1:3001",
        changeOrigin: false,
        xfwd: true,
        // Server-Sent Events must stream, not buffer.
        ws: false,
      },
      // Uploaded images live in the private data directory and are served by Express.
      "/uploads": {
        target: "http://127.0.0.1:3001",
        changeOrigin: false,
      },
    },
  },
  build: { target: "es2018" },
});
