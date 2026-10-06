// Express API + production static host.
import express, { type NextFunction, type Request, type Response } from "express";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { existsSync } from "node:fs";
import { join, sep } from "node:path";
import {
  REQUEST_STATUSES,
  contentSchema,
  credentialsSchema,
  setupSchema,
  wholesaleRequestSchema,
  type RequestStatus,
} from "../shared/content.ts";
import { RevisionConflict, ensureSetupToken, openDb, type Db } from "./db.ts";
import {
  SESSION_COOKIE,
  createSession,
  hashPassword,
  readSession,
  revokeSession,
  safeEqual,
  verifyPassword,
} from "./auth.ts";

export type AppOptions = {
  dataDir: string;
  distDir?: string | null;
  allowedOrigins?: string[];
  trustProxyHops?: number;
  secureCookies?: boolean;
  /** Disables per-IP throttles so the automated suites can hammer the API. */
  relaxRateLimits?: boolean;
};

const BODY_LIMIT = "512kb";

export function createApp(options: AppOptions) {
  const {
    dataDir,
    distDir = null,
    allowedOrigins = [],
    trustProxyHops = 1,
    secureCookies = process.env.NODE_ENV === "production",
    relaxRateLimits = false,
  } = options;

  const db: Db = openDb(dataDir);
  ensureSetupToken(db);

  const app = express();
  app.disable("x-powered-by");
  if (trustProxyHops > 0) app.set("trust proxy", trustProxyHops);

  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          "default-src": ["'self'"],
          "script-src": ["'self'"],
          "style-src": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
          "font-src": ["'self'", "data:", "https://fonts.gstatic.com"],
          "img-src": ["'self'", "data:", "blob:", "https://files.catbox.moe"],
          "connect-src": ["'self'"],
          "object-src": ["'none'"],
          "base-uri": ["'self'"],
          "form-action": ["'self'"],
          // Production locks the page down completely. Outside production we allow
          // embedding so hosted previews (which frame the app) still render.
          "frame-ancestors": secureCookies ? ["'none'"] : ["*"],
        },
      },
      frameguard: secureCookies ? { action: "deny" } : false,
      crossOriginEmbedderPolicy: false,
      referrerPolicy: { policy: "strict-origin-when-cross-origin" },
      // Only over HTTPS, and never with includeSubDomains: this app is often served from a
      // shared preview domain and must not pin HSTS onto sibling subdomains.
      hsts: secureCookies
        ? { maxAge: 15552000, includeSubDomains: false, preload: false }
        : false,
    }),
  );
  app.use(express.json({ limit: BODY_LIMIT }));
  app.use(cookieParser());

  const noStore = (_req: Request, res: Response, next: NextFunction) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  };

  // --- Origin guard -------------------------------------------------------
  // Browsers always send Origin on cross-origin writes. A present-but-unlisted origin is
  // rejected outright; requests without an Origin (curl, tests, same-origin form posts) pass.
  const originAllowed = (req: Request) => {
    const origin = req.get("origin");
    if (!origin) return true;
    if (allowedOrigins.includes(origin)) return true;
    try {
      const host = req.get("host");
      return !!host && new URL(origin).host === host;
    } catch {
      return false;
    }
  };
  const requireSameOrigin = (req: Request, res: Response, next: NextFunction) => {
    if (!originAllowed(req)) {
      res.status(403).json({ error: "origin-not-allowed" });
      return;
    }
    next();
  };

  const limiter = (windowMs: number, limit: number) =>
    rateLimit({
      windowMs,
      limit: relaxRateLimits ? 100000 : limit,
      standardHeaders: "draft-7",
      legacyHeaders: false,
      validate: { trustProxy: false, xForwardedForHeader: false },
      message: { error: "too-many-requests" },
    });

  const apiLimiter = limiter(15 * 60 * 1000, 600);
  const writeLimiter = limiter(10 * 60 * 1000, 30);
  const loginLimiter = limiter(15 * 60 * 1000, 10);

  // --- Private paths must never be reachable ---------------------------------
  const PRIVATE = [
    ".data",
    ".env",
    ".git",
    "server",
    "shared",
    "node_modules",
    "package-lock.json",
  ];
  app.use((req, res, next) => {
    const first = req.path.split("/").filter(Boolean)[0] ?? "";
    if (PRIVATE.includes(first) || /\.(sqlite|sqlite3|db|db-wal|db-shm|ts|map|env)$/i.test(req.path)) {
      res.status(404).json({ error: "not-found" });
      return;
    }
    next();
  });

  // --- Public API ------------------------------------------------------------
  app.get("/api/health", apiLimiter, (_req, res) => {
    res.json({ ok: true, status: "ok", service: "elban-elbaz", time: new Date().toISOString() });
  });

  app.get("/api/content", apiLimiter, (_req, res) => {
    res.json(db.getContent());
  });

  app.post(
    "/api/wholesale-requests",
    writeLimiter,
    requireSameOrigin,
    (req: Request, res: Response) => {
      const parsed = wholesaleRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(422).json({ error: "invalid-request", details: parsed.error.flatten().fieldErrors });
        return;
      }
      const { name, contact, product, unit, quantity, notes, requestKey } = parsed.data;
      try {
        const { request, created } = db.createRequest({
          requestKey,
          name,
          contact,
          product,
          unit,
          quantity,
          notes,
        });
        res.status(created ? 201 : 200).json({
          ok: true,
          saved: true,
          duplicate: !created,
          id: request.id,
          status: request.status,
        });
      } catch {
        // Never tell the visitor an order was stored when it was not.
        res.status(500).json({ error: "persistence-failed" });
      }
    },
  );

  // --- Admin auth ------------------------------------------------------------
  const adminRateLimited = [loginLimiter, requireSameOrigin, noStore];

  app.get("/api/admin/status", noStore, (_req, res) => {
    res.json({ needsSetup: db.adminCount() === 0, setupAvailable: db.adminCount() === 0 && !!db.readSetupToken() });
  });

  app.post("/api/admin/setup", ...adminRateLimited, (req, res) => {
    // Setup is permanently disabled once an administrator exists.
    if (db.adminCount() > 0) {
      res.status(409).json({ error: "setup-already-complete" });
      return;
    }
    const parsed = setupSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(422).json({ error: "invalid-setup", details: parsed.error.flatten().fieldErrors });
      return;
    }
    const expected = db.readSetupToken();
    if (!expected || !safeEqual(parsed.data.token, expected)) {
      res.status(403).json({ error: "invalid-setup-token" });
      return;
    }
    const id = db.createAdmin(parsed.data.username, hashPassword(parsed.data.password));
    db.consumeSetupToken(); // one-time: token is deleted after the first admin is created
    const session = createSession(db, id);
    setSessionCookie(res, session.token, secureCookies);
    res.status(201).json({ ok: true, username: parsed.data.username, csrf: session.csrf });
  });

  app.post("/api/admin/login", ...adminRateLimited, (req, res) => {
    const parsed = credentialsSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(401).json({ error: "invalid-credentials" });
      return;
    }
    const admin = db.findAdmin(parsed.data.username);
    // Always run a verification so a missing user and a wrong password cost the same.
    const ok = admin
      ? verifyPassword(parsed.data.password, admin.password_hash)
      : verifyPassword(parsed.data.password, hashPassword("dummy-comparison-value"));
    if (!admin || !ok) {
      res.status(401).json({ error: "invalid-credentials" });
      return;
    }
    const session = createSession(db, admin.id);
    setSessionCookie(res, session.token, secureCookies);
    res.json({ ok: true, username: admin.username, csrf: session.csrf });
  });

  const requireAdmin = (req: Request, res: Response, next: NextFunction) => {
    const session = readSession(db, req.cookies?.[SESSION_COOKIE]);
    if (!session) {
      res.status(401).json({ error: "unauthenticated" });
      return;
    }
    res.locals.session = session;
    next();
  };

  const requireCsrf = (req: Request, res: Response, next: NextFunction) => {
    const session = res.locals.session as { csrf: string };
    const provided = req.get("x-csrf-token") ?? "";
    if (!provided || !safeEqual(provided, session.csrf)) {
      res.status(403).json({ error: "csrf-rejected" });
      return;
    }
    next();
  };

  app.get("/api/admin/session", noStore, (req, res) => {
    const session = readSession(db, req.cookies?.[SESSION_COOKIE]);
    if (!session) {
      res.status(401).json({ error: "unauthenticated" });
      return;
    }
    const admin = db.raw
      .prepare("SELECT username FROM admins WHERE id = ?")
      .get(session.admin_id) as { username: string } | undefined;
    res.json({ authenticated: true, username: admin?.username ?? "", csrf: session.csrf });
  });

  app.post("/api/admin/logout", noStore, requireSameOrigin, (req, res) => {
    const token = req.cookies?.[SESSION_COOKIE];
    if (token) revokeSession(db, token); // server-side revocation, not just a cleared cookie
    res.setHeader("Set-Cookie", clearSessionCookie(secureCookies));
    res.json({ ok: true });
  });

  // --- Admin: wholesale requests --------------------------------------------
  const admin = express.Router();
  admin.use(noStore, requireSameOrigin, requireAdmin);

  admin.get("/requests", (req, res) => {
    const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
    const status = typeof req.query.status === "string" ? req.query.status : "";
    const page = Math.max(1, Number.parseInt(String(req.query.page ?? "1"), 10) || 1);
    const pageSize = Math.min(100, Math.max(5, Number.parseInt(String(req.query.pageSize ?? "20"), 10) || 20));
    const { items, total } = db.listRequests({
      search: search || undefined,
      status: status || undefined,
      limit: pageSize,
      offset: (page - 1) * pageSize,
    });
    res.json({ items, total, page, pageSize, pages: Math.max(1, Math.ceil(total / pageSize)) });
  });

  admin.patch("/requests/:id", requireCsrf, (req, res) => {
    const id = Number.parseInt(req.params.id, 10);
    const status = String((req.body ?? {}).status ?? "");
    if (!Number.isInteger(id) || !(REQUEST_STATUSES as readonly string[]).includes(status)) {
      res.status(422).json({ error: "invalid-status" });
      return;
    }
    const updated = db.setRequestStatus(id, status as RequestStatus);
    if (!updated) {
      res.status(404).json({ error: "not-found" });
      return;
    }
    res.json({ ok: true, request: updated });
  });

  admin.delete("/requests/:id", requireCsrf, (req, res) => {
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || !db.deleteRequest(id)) {
      res.status(404).json({ error: "not-found" });
      return;
    }
    res.json({ ok: true, deleted: id });
  });

  // --- Admin: content & products --------------------------------------------
  admin.get("/content", (_req, res) => {
    res.json(db.getContent());
  });

  admin.put("/content", requireCsrf, (req, res) => {
    const revision = Number((req.body ?? {}).revision);
    if (!Number.isInteger(revision) || revision < 1) {
      res.status(422).json({ error: "revision-required" });
      return;
    }
    const parsed = contentSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(422).json({ error: "invalid-content", details: parsed.error.flatten().fieldErrors });
      return;
    }
    try {
      res.json(db.saveContent(parsed.data, revision));
    } catch (error) {
      if (error instanceof RevisionConflict) {
        // Someone else published first — hand back the newer revision instead of overwriting it.
        res.status(409).json({ error: "revision-conflict", current: error.current });
        return;
      }
      res.status(500).json({ error: "save-failed" });
    }
  });

  const productBody = (req: Request, res: Response) => {
    const revision = Number((req.body ?? {}).revision);
    if (!Number.isInteger(revision) || revision < 1) {
      res.status(422).json({ error: "revision-required" });
      return null;
    }
    const product = (req.body ?? {}).product;
    return { revision, product };
  };

  admin.post("/products", requireCsrf, (req, res) => {
    const body = productBody(req, res);
    if (!body) return;
    const current = db.getContent();
    const nextProduct = {
      ...(body.product as Record<string, unknown>),
      id:
        Math.max(0, ...current.products.map((p) => p.id)) + 1,
    };
    const parsed = contentSchema.safeParse({
      ...current,
      revision: undefined,
      products: [...current.products, nextProduct],
    });
    if (!parsed.success) {
      res.status(422).json({ error: "invalid-product", details: parsed.error.flatten().fieldErrors });
      return;
    }
    try {
      const saved = db.saveContent(parsed.data, body.revision);
      res.status(201).json({ ok: true, revision: saved.revision, product: saved.products[saved.products.length - 1] });
    } catch (error) {
      if (error instanceof RevisionConflict) {
        res.status(409).json({ error: "revision-conflict", current: error.current });
        return;
      }
      res.status(500).json({ error: "save-failed" });
    }
  });

  admin.put("/products/:id", requireCsrf, (req, res) => {
    const body = productBody(req, res);
    if (!body) return;
    const id = Number.parseInt(req.params.id, 10);
    const current = db.getContent();
    if (!current.products.some((p) => p.id === id)) {
      res.status(404).json({ error: "not-found" });
      return;
    }
    const products = current.products.map((p) =>
      p.id === id ? { ...(body.product as object), id } : p,
    );
    const parsed = contentSchema.safeParse({ ...current, products });
    if (!parsed.success) {
      res.status(422).json({ error: "invalid-product", details: parsed.error.flatten().fieldErrors });
      return;
    }
    try {
      const saved = db.saveContent(parsed.data, body.revision);
      res.json({ ok: true, revision: saved.revision, product: saved.products.find((p) => p.id === id) });
    } catch (error) {
      if (error instanceof RevisionConflict) {
        res.status(409).json({ error: "revision-conflict", current: error.current });
        return;
      }
      res.status(500).json({ error: "save-failed" });
    }
  });

  admin.delete("/products/:id", requireCsrf, (req, res) => {
    const revision = Number((req.body ?? {}).revision ?? req.query.revision);
    if (!Number.isInteger(revision) || revision < 1) {
      res.status(422).json({ error: "revision-required" });
      return;
    }
    const id = Number.parseInt(req.params.id, 10);
    const current = db.getContent();
    if (!current.products.some((p) => p.id === id)) {
      res.status(404).json({ error: "not-found" });
      return;
    }
    try {
      const saved = db.saveContent(
        { ...current, products: current.products.filter((p) => p.id !== id) },
        revision,
      );
      res.json({ ok: true, revision: saved.revision });
    } catch (error) {
      if (error instanceof RevisionConflict) {
        res.status(409).json({ error: "revision-conflict", current: error.current });
        return;
      }
      res.status(500).json({ error: "save-failed" });
    }
  });

  app.use("/api/admin", admin);

  app.use("/api", (_req, res) => res.status(404).json({ error: "not-found" }));

  // --- Static frontend (production) -----------------------------------------
  if (distDir && existsSync(distDir)) {
    app.use(
      express.static(distDir, {
        index: false,
        setHeaders(res, path) {
          if (path.endsWith("index.html") || path.includes("theme-init.js")) {
            // theme-init.js runs before the first paint, so it must never go stale.
            res.setHeader("Cache-Control", "no-cache");
          } else if (path.includes(`${sep}assets${sep}`)) {
            // Vite hashes these filenames, so they are safe to cache forever.
            res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
          } else {
            // Un-hashed public files the owner may replace (images, favicons).
            res.setHeader("Cache-Control", "public, max-age=3600, must-revalidate");
          }
        },
      }),
    );
    // SPA fallback: the public site and /admin both resolve to index.html.
    app.get("*", (_req, res) => {
      res.sendFile(join(distDir, "index.html"));
    });
  }

  return { app, db };
}

function setSessionCookie(res: Response, token: string, secure: boolean) {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "strict",
    secure,
    path: "/",
    maxAge: 8 * 60 * 60 * 1000,
  });
}

function clearSessionCookie(secure: boolean) {
  const parts = [
    `${SESSION_COOKIE}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    "Max-Age=0",
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}
