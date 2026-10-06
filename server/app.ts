// Express API + production static host.
import express, { type NextFunction, type Request, type Response } from "express";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { existsSync } from "node:fs";
import { join, sep } from "node:path";
import {
  REQUEST_STATUSES,
  adminCreateSchema,
  adminUpdateSchema,
  completeProfileSchema,
  contentSchema,
  eventSchema,
  loginSchema,
  passwordChangeSchema,
  productSchema,
  profileUpdateSchema,
  securityAnswerSchema,
  securityChangeSchema,
  setupSchema,
  wholesaleRequestSchema,
  type RequestStatus,
} from "../shared/content.ts";
import { RevisionConflict, ensureSetupToken, openDb, type AdminRow, type Db } from "./db.ts";
import {
  SESSION_COOKIE,
  createSession,
  hashPassword,
  hashSecret,
  markSecurityVerified,
  normalizeAnswer,
  readSession,
  revokeAllSessions,
  revokeSession,
  safeEqual,
  verifyPassword,
  verifySecret,
} from "./auth.ts";
import { createStreamHub } from "./bus.ts";
import {
  contentTypeFor,
  isSafeUploadName,
  storeUpload,
  uploadMiddleware,
} from "./uploads.ts";

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
  const hub = createStreamHub();

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
      hsts: secureCookies ? { maxAge: 15552000, includeSubDomains: false, preload: false } : false,
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
      // The dashboard expects JSON errors like every other API response.
      handler: (_req: Request, res: Response) => {
        res.status(429).json({ error: "too-many-requests" });
      },
      standardHeaders: "draft-7",
      legacyHeaders: false,
      validate: { trustProxy: false, xForwardedForHeader: false },
      message: { error: "too-many-requests" },
    });

  const apiLimiter = limiter(15 * 60 * 1000, 600);
  const writeLimiter = limiter(10 * 60 * 1000, 30);
  const loginLimiter = limiter(15 * 60 * 1000, 10);
  const uploadLimiter = limiter(15 * 60 * 1000, 60);

  // --- Private paths must never be reachable ---------------------------------
  const PRIVATE = [".data", ".env", ".git", "server", "shared", "node_modules", "package-lock.json"];
  app.use((req, res, next) => {
    const first = req.path.split("/").filter(Boolean)[0] ?? "";
    if (
      PRIVATE.includes(first) ||
      /\.(sqlite|sqlite3|db|db-wal|db-shm|ts|map|env)$/i.test(req.path)
    ) {
      res.status(404).json({ error: "not-found" });
      return;
    }
    next();
  });

  // --- Uploaded images (public, but only ever the generated safe names) -------
  app.get("/uploads/:name", (req, res) => {
    const name = req.params.name;
    if (!isSafeUploadName(name)) {
      res.status(404).json({ error: "not-found" });
      return;
    }
    const file = join(db.uploadsDir, name);
    if (!existsSync(file)) {
      res.status(404).json({ error: "not-found" });
      return;
    }
    res.setHeader("Content-Type", contentTypeFor(name));
    // Uploads are content-addressed by random name and never rewritten.
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    res.setHeader("Content-Disposition", "inline");
    res.sendFile(file);
  });

  // --- Public API ------------------------------------------------------------
  // Long-lived SSE connection. Registered before the rate limiter so a background
  // tab cannot exhaust the request budget, but capped to avoid connection floods.
  const MAX_STREAM_CLIENTS = 200;
  app.get("/api/stream", (req, res) => {
    if (hub.size() >= MAX_STREAM_CLIENTS) {
      res.status(503).json({ error: "too-many-streams" });
      return;
    }
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    const remove = hub.add(res);
    req.on("close", remove);
    req.on("error", remove);
  });

  app.get("/api/health", apiLimiter, (_req, res) => {
    res.json({ ok: true, status: "ok", service: "elban-elbaz", time: new Date().toISOString() });
  });

  app.get("/api/content", apiLimiter, (_req, res) => {
    res.json({ ...db.getContent(), events: db.activeEvents() });
  });

  app.post(
    "/api/wholesale-requests",
    writeLimiter,
    requireSameOrigin,
    (req: Request, res: Response) => {
      const parsed = wholesaleRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        res
          .status(422)
          .json({ error: "invalid-request", details: parsed.error.flatten().fieldErrors });
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
        if (created) hub.broadcast({ type: "events" });
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

  // --- Session helpers -------------------------------------------------------
  type Session = NonNullable<ReturnType<typeof readSession>>;
  type AdminContext = { session: Session; admin: AdminRow };

  const loadAdmin = (req: Request): AdminContext | null => {
    const session = readSession(db, req.cookies?.[SESSION_COOKIE]);
    if (!session) return null;
    const admin = db.getAdmin(session.admin_id);
    if (!admin) return null;
    return { session, admin };
  };

  /**
   * Single whitelisted shape for account records. Password hashes, security
   * answer hashes, session tokens and CSRF tokens never leave the server.
   * `session` is optional: it is only attached for the caller's own account.
   */
  const publicAdmin = (admin: AdminRow, session?: Session) => ({
    id: admin.id,
    username: admin.username,
    email: admin.email ?? "",
    displayName: admin.display_name || admin.username,
    avatarUrl: admin.avatar_url || "",
    role: admin.role === "owner" ? "owner" : "admin",
    hasSecurityQuestion: !!admin.security_question,
    mustCompleteProfile: Number(admin.must_complete_profile) === 1,
    createdAt: admin.created_at,
    updatedAt: admin.updated_at || admin.created_at,
    lastLoginAt: admin.last_login_at || "",
    ...(session
      ? {
          session: {
            createdAt: session.created_at,
            expiresAt: session.expires_at,
            ip: session.ip || "",
            userAgent: session.user_agent || "",
            securityVerified: Number(session.security_verified) === 1,
          },
        }
      : {}),
  });

  // --- Admin auth ------------------------------------------------------------
  const adminRateLimited = [loginLimiter, requireSameOrigin, noStore];

  app.get("/api/admin/status", noStore, (_req, res) => {
    const needsSetup = db.adminCount() === 0;
    res.json({ needsSetup, setupAvailable: needsSetup && !!db.readSetupToken() });
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
    // The first account is always the Owner and must finish its permanent credentials.
    const id = db.createAdmin({
      username: parsed.data.username,
      passwordHash: hashPassword(parsed.data.password),
      role: "owner",
      displayName: parsed.data.username,
      mustCompleteProfile: true,
    });
    db.consumeSetupToken(); // one-time: token is deleted after the first admin is created
    const session = createSession(db, id, {
      securityVerified: true, // the one-time token already proved operator access
      ip: req.ip ?? "",
      userAgent: req.get("user-agent") ?? "",
    });
    db.touchLogin(id);
    setSessionCookie(res, session.token, secureCookies);
    res.status(201).json({
      ok: true,
      username: parsed.data.username,
      role: "owner",
      mustCompleteProfile: true,
      csrf: session.csrf,
    });
  });

  app.post("/api/admin/login", ...adminRateLimited, (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(401).json({ error: "invalid-credentials" });
      return;
    }
    const admin = db.findAdmin(parsed.data.identifier);
    // Always run a verification so a missing user and a wrong password cost the same.
    const ok = admin
      ? verifyPassword(parsed.data.password, admin.password_hash)
      : verifyPassword(parsed.data.password, hashPassword("dummy-comparison-value"));
    if (!admin || !ok) {
      res.status(401).json({ error: "invalid-credentials" });
      return;
    }

    // Accounts with a security question must answer it before the session is usable.
    const needsQuestion = !!admin.security_question;
    const session = createSession(db, admin.id, {
      securityVerified: !needsQuestion,
      ip: req.ip ?? "",
      userAgent: req.get("user-agent") ?? "",
    });
    db.touchLogin(admin.id);
    setSessionCookie(res, session.token, secureCookies);
    if (needsQuestion) {
      // Only the question itself is returned — never the answer or its hash.
      res.json({
        ok: true,
        requiresSecurityAnswer: true,
        question: admin.security_question,
        pendingCsrf: session.csrf,
      });
      return;
    }
    res.json({
      ok: true,
      requiresSecurityAnswer: false,
      username: admin.username,
      displayName: admin.display_name || admin.username,
      role: admin.role === "owner" ? "owner" : "admin",
      csrf: session.csrf,
    });
  });

  /** Second factor: the security answer. Promotes a pending session to a full one. */
  app.post("/api/admin/login/security", ...adminRateLimited, (req, res) => {
    const context = loadAdmin(req);
    if (!context) {
      res.status(401).json({ error: "unauthenticated" });
      return;
    }
    if (Number(context.session.security_verified) === 1) {
      res.json({ ok: true, alreadyVerified: true, csrf: context.session.csrf });
      return;
    }
    if (!context.admin.security_question || !context.admin.security_answer_hash) {
      res.status(409).json({ error: "no-security-question" });
      return;
    }
    const parsed = securityAnswerSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(422).json({ error: "invalid-answer" });
      return;
    }
    if (!verifySecret(normalizeAnswer(parsed.data.answer), context.admin.security_answer_hash)) {
      // Same generic failure as a wrong password, so nothing is leaked.
      res.status(401).json({ error: "invalid-security-answer" });
      return;
    }
    markSecurityVerified(db, context.session.token);
    res.json({
      ok: true,
      username: context.admin.username,
      displayName: context.admin.display_name || context.admin.username,
      role: context.admin.role === "owner" ? "owner" : "admin",
      csrf: context.session.csrf,
    });
  });

  const requireAdmin = (req: Request, res: Response, next: NextFunction) => {
    const context = loadAdmin(req);
    if (!context) {
      res.status(401).json({ error: "unauthenticated" });
      return;
    }
    // A session that has not passed the security question is not a real session.
    if (Number(context.session.security_verified) !== 1) {
      res.status(401).json({ error: "security-required" });
      return;
    }
    res.locals.session = context.session;
    res.locals.admin = context.admin;
    next();
  };

  /** Only the Owner may manage other accounts. Enforced here, not in the UI. */
  const requireOwner = (_req: Request, res: Response, next: NextFunction) => {
    const admin = res.locals.admin as AdminRow;
    if (admin.role !== "owner") {
      res.status(403).json({ error: "owner-only" });
      return;
    }
    next();
  };

  const requireCsrf = (req: Request, res: Response, next: NextFunction) => {
    const session = res.locals.session as Session;
    const provided = req.get("x-csrf-token") ?? "";
    if (!provided || !safeEqual(provided, session.csrf)) {
      res.status(403).json({ error: "csrf-rejected" });
      return;
    }
    next();
  };

  /**
   * The Owner's first-run credentials must be set before mutating anything else.
   * Reads stay open so the dashboard can render the completion screen.
   */
  const requireProfileComplete = (_req: Request, res: Response, next: NextFunction) => {
    const admin = res.locals.admin as AdminRow;
    if (Number(admin.must_complete_profile) === 1) {
      res.status(428).json({ error: "profile-incomplete" });
      return;
    }
    next();
  };

  app.get("/api/admin/session", noStore, (req, res) => {
    const context = loadAdmin(req);
    if (!context) {
      res.status(401).json({ error: "unauthenticated" });
      return;
    }
    const base = publicAdmin(context.admin, context.session);
    if (Number(context.session.security_verified) !== 1) {
      // Still pending the security answer: expose only what that step needs.
      res.json({
        authenticated: false,
        requiresSecurityAnswer: true,
        question: context.admin.security_question,
        csrf: context.session.csrf,
      });
      return;
    }
    res.json({
      authenticated: true,
      ...base,
      capabilities: { manageAdmins: context.admin.role === "owner" },
      csrf: context.session.csrf,
    });
  });

  app.post("/api/admin/logout", noStore, requireSameOrigin, (req, res) => {
    const token = req.cookies?.[SESSION_COOKIE];
    if (token) revokeSession(db, token); // server-side revocation, not just a cleared cookie
    res.setHeader("Set-Cookie", clearSessionCookie(secureCookies));
    res.json({ ok: true });
  });

  // --- Profile (self-service for the logged-in account) ----------------------
  const profileRoutes = express.Router();
  profileRoutes.use(noStore, requireSameOrigin, requireAdmin);

  profileRoutes.get("/", (_req, res) => {
    const admin = res.locals.admin as AdminRow;
    const session = res.locals.session as Session;
    res.json({ ...publicAdmin(admin, session), securityQuestion: admin.security_question });
  });

  /** First-run only: set the permanent email, password and security question. */
  profileRoutes.post("/complete", requireCsrf, (req, res) => {
    const admin = res.locals.admin as AdminRow;
    // This step exists solely to finish a brand-new Owner account.
    if (Number(admin.must_complete_profile) !== 1) {
      res.status(409).json({ error: "profile-already-complete" });
      return;
    }
    const parsed = completeProfileSchema.safeParse(req.body);
    if (!parsed.success) {
      res
        .status(422)
        .json({ error: "invalid-profile", details: parsed.error.flatten().fieldErrors });
      return;
    }
    const clash = db.findAdmin(parsed.data.email);
    if (clash && clash.id !== admin.id) {
      res.status(409).json({ error: "email-taken" });
      return;
    }
    db.updateAdmin(admin.id, {
      email: parsed.data.email.toLowerCase(),
      display_name: parsed.data.displayName,
      password_hash: hashPassword(parsed.data.password),
      security_question: parsed.data.securityQuestion,
      security_answer_hash: hashSecret(normalizeAnswer(parsed.data.securityAnswer)),
      must_complete_profile: 0,
      updated_at: new Date().toISOString(),
    });
    // Every session dies, including this one: the Owner must sign in again with
    // the new email + password and then answer the security question.
    revokeAllSessions(db, admin.id);
    res.setHeader("Set-Cookie", clearSessionCookie(secureCookies));
    res.json({ ok: true, mustRelogin: true });
  });

  profileRoutes.put("/", requireCsrf, requireProfileComplete, (req, res) => {
    const admin = res.locals.admin as AdminRow;
    const parsed = profileUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(422).json({ error: "invalid-profile", details: parsed.error.flatten().fieldErrors });
      return;
    }
    if (parsed.data.email.toLowerCase() !== (admin.email ?? "").toLowerCase()) {
      const clash = db.findAdmin(parsed.data.email);
      if (clash && clash.id !== admin.id) {
        res.status(409).json({ error: "email-taken" });
        return;
      }
    }
    const updated = db.updateAdmin(admin.id, {
      display_name: parsed.data.displayName,
      email: parsed.data.email.toLowerCase(),
      avatar_url: parsed.data.avatarUrl,
      updated_at: new Date().toISOString(),
    });
    res.json({
      ok: true,
      profile: publicAdmin(updated ?? admin, res.locals.session as Session),
    });
  });

  profileRoutes.put("/password", requireCsrf, requireProfileComplete, (req, res) => {
    const admin = res.locals.admin as AdminRow;
    const parsed = passwordChangeSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(422).json({ error: "invalid-password", details: parsed.error.flatten().fieldErrors });
      return;
    }
    if (!verifyPassword(parsed.data.currentPassword, admin.password_hash)) {
      res.status(401).json({ error: "invalid-current-password" });
      return;
    }
    db.updateAdmin(admin.id, {
      password_hash: hashPassword(parsed.data.newPassword),
      updated_at: new Date().toISOString(),
    });
    // Any other device is signed out; the current session stays usable.
    revokeAllSessions(db, admin.id, (res.locals.session as Session).token);
    res.json({ ok: true });
  });

  profileRoutes.put("/security", requireCsrf, requireProfileComplete, (req, res) => {
    const admin = res.locals.admin as AdminRow;
    const parsed = securityChangeSchema.safeParse(req.body);
    if (!parsed.success) {
      res
        .status(422)
        .json({ error: "invalid-security", details: parsed.error.flatten().fieldErrors });
      return;
    }
    // Setting a question for the first time is allowed; replacing one requires the answer.
    if (admin.security_question && admin.security_answer_hash) {
      if (!verifySecret(normalizeAnswer(parsed.data.currentAnswer), admin.security_answer_hash)) {
        res.status(401).json({ error: "invalid-current-answer" });
        return;
      }
    }
    const updated = db.updateAdmin(admin.id, {
      security_question: parsed.data.securityQuestion,
      security_answer_hash: hashSecret(normalizeAnswer(parsed.data.securityAnswer)),
      updated_at: new Date().toISOString(),
    });
    // The question comes back so the panel can render it; the answer never does.
    res.json({
      ok: true,
      profile: {
        ...publicAdmin(updated ?? admin, res.locals.session as Session),
        securityQuestion: parsed.data.securityQuestion,
      },
    });
  });

  app.use("/api/admin/profile", profileRoutes);

  // --- Owner-only account management ----------------------------------------
  const ownersRoutes = express.Router();
  ownersRoutes.use(noStore, requireSameOrigin, requireAdmin, requireProfileComplete, requireOwner);

  ownersRoutes.get("/", (_req, res) => {
    res.json({ items: db.listAdmins().map((item) => publicAdmin(item)) });
  });

  ownersRoutes.post("/", requireCsrf, (req, res) => {
    const admin = res.locals.admin as AdminRow;
    const parsed = adminCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(422).json({ error: "invalid-admin", details: parsed.error.flatten().fieldErrors });
      return;
    }
    if (db.findAdmin(parsed.data.username)) {
      res.status(409).json({ error: "username-taken" });
      return;
    }
    if (db.findAdmin(parsed.data.email)) {
      res.status(409).json({ error: "email-taken" });
      return;
    }
    const id = db.createAdmin({
      username: parsed.data.username,
      displayName: parsed.data.displayName,
      email: parsed.data.email.toLowerCase(),
      passwordHash: hashPassword(parsed.data.password),
      role: parsed.data.role,
      createdBy: admin.id,
    });
    const created = db.getAdmin(id);
    res.status(201).json({ ok: true, admin: created ? publicAdmin(created) : null });
  });

  ownersRoutes.put("/:id", requireCsrf, (req, res) => {
    const actor = res.locals.admin as AdminRow;
    const id = Number.parseInt(req.params.id, 10);
    const target = db.getAdmin(id);
    if (!target) {
      res.status(404).json({ error: "not-found" });
      return;
    }
    const parsed = adminUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(422).json({ error: "invalid-admin", details: parsed.error.flatten().fieldErrors });
      return;
    }
    const nameClash = db.findAdmin(parsed.data.username);
    if (nameClash && nameClash.id !== id) {
      res.status(409).json({ error: "username-taken" });
      return;
    }
    const mailClash = db.findAdmin(parsed.data.email);
    if (mailClash && mailClash.id !== id) {
      res.status(409).json({ error: "email-taken" });
      return;
    }
    // Never leave the site without an Owner.
    if (target.role === "owner" && parsed.data.role !== "owner" && db.countOwners() <= 1) {
      res.status(409).json({ error: "last-owner" });
      return;
    }
    const patch: Parameters<Db["updateAdmin"]>[1] = {
      username: parsed.data.username,
      display_name: parsed.data.displayName,
      email: parsed.data.email.toLowerCase(),
      avatar_url: parsed.data.avatarUrl,
      role: parsed.data.role,
      updated_at: new Date().toISOString(),
    };
    if (parsed.data.password) patch.password_hash = hashPassword(parsed.data.password);
    const updated = db.updateAdmin(id, patch);
    if (parsed.data.password) revokeAllSessions(db, id); // force a re-login on password change
    void actor;
    res.json({ ok: true, admin: updated ? publicAdmin(updated) : null });
  });

  ownersRoutes.delete("/:id", requireCsrf, (req, res) => {
    const actor = res.locals.admin as AdminRow;
    const id = Number.parseInt(req.params.id, 10);
    if (id === actor.id) {
      res.status(409).json({ error: "cannot-delete-self" });
      return;
    }
    const target = db.getAdmin(id);
    if (!target) {
      res.status(404).json({ error: "not-found" });
      return;
    }
    if (target.role === "owner" && db.countOwners() <= 1) {
      res.status(409).json({ error: "last-owner" });
      return;
    }
    db.deleteAdmin(id);
    revokeAllSessions(db, id);
    res.json({ ok: true, deleted: id });
  });

  app.use("/api/admin/admins", ownersRoutes);

  // --- Shared authenticated surface -----------------------------------------
  const admin = express.Router();
  admin.use(noStore, requireSameOrigin, requireAdmin);

  // --- Uploads ---------------------------------------------------------------
  admin.post("/uploads", uploadLimiter, requireCsrf, requireProfileComplete, (req, res) => {
    uploadMiddleware(req, res, (error: unknown) => {
      if (error) {
        const code =
          error instanceof Error && "code" in error && error.code === "LIMIT_FILE_SIZE"
            ? "file-too-large"
            : "upload-failed";
        res.status(code === "file-too-large" ? 413 : 422).json({ error: code });
        return;
      }
      const file = (req as Request & { file?: { buffer: Buffer; originalname?: string } }).file;
      if (!file) {
        res.status(422).json({ error: "no-file" });
        return;
      }
      const stored = storeUpload(db.uploadsDir, file);
      if (!stored.ok) {
        res.status(stored.reason === "too-large" ? 413 : 422).json({ error: stored.reason });
        return;
      }
      res.status(201).json({ ok: true, upload: stored.value });
    });
  });

  // --- Events / announcements -------------------------------------------------
  admin.get("/events", (_req, res) => {
    res.json({ items: db.listEvents() });
  });

  admin.post("/events", requireCsrf, requireProfileComplete, (req, res) => {
    const parsed = eventSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(422).json({ error: "invalid-event", details: parsed.error.flatten().fieldErrors });
      return;
    }
    const created = db.createEvent(parsed.data);
    hub.broadcast({ type: "events" });
    res.status(201).json({ ok: true, event: created });
  });

  admin.put("/events/:id", requireCsrf, requireProfileComplete, (req, res) => {
    const id = Number.parseInt(req.params.id, 10);
    const parsed = eventSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(422).json({ error: "invalid-event", details: parsed.error.flatten().fieldErrors });
      return;
    }
    const updated = db.updateEvent(id, parsed.data);
    if (!updated) {
      res.status(404).json({ error: "not-found" });
      return;
    }
    hub.broadcast({ type: "events" });
    res.json({ ok: true, event: updated });
  });

  admin.delete("/events/:id", requireCsrf, requireProfileComplete, (req, res) => {
    const id = Number.parseInt(req.params.id, 10);
    if (!db.deleteEvent(id)) {
      res.status(404).json({ error: "not-found" });
      return;
    }
    hub.broadcast({ type: "events" });
    res.json({ ok: true, deleted: id });
  });

  // --- Admin: wholesale requests --------------------------------------------
  admin.get("/requests", (req, res) => {
    const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
    const status = typeof req.query.status === "string" ? req.query.status : "";
    const page = Math.max(1, Number.parseInt(String(req.query.page ?? "1"), 10) || 1);
    const pageSize = Math.min(
      100,
      Math.max(5, Number.parseInt(String(req.query.pageSize ?? "20"), 10) || 20),
    );
    const { items, total } = db.listRequests({
      search: search || undefined,
      status: status || undefined,
      limit: pageSize,
      offset: (page - 1) * pageSize,
    });
    res.json({ items, total, page, pageSize, pages: Math.max(1, Math.ceil(total / pageSize)) });
  });

  admin.patch("/requests/:id", requireCsrf, requireProfileComplete, (req, res) => {
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

  admin.delete("/requests/:id", requireCsrf, requireProfileComplete, (req, res) => {
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

  admin.put("/content", requireCsrf, requireProfileComplete, (req, res) => {
    const revision = Number((req.body ?? {}).revision);
    if (!Number.isInteger(revision) || revision < 1) {
      res.status(422).json({ error: "revision-required" });
      return;
    }
    const parsed = contentSchema.safeParse(req.body);
    if (!parsed.success) {
      res
        .status(422)
        .json({ error: "invalid-content", details: parsed.error.flatten().fieldErrors });
      return;
    }
    try {
      const saved = db.saveContent(parsed.data, revision);
      hub.broadcast({ type: "content", revision: saved.revision });
      res.json(saved);
    } catch (error) {
      if (error instanceof RevisionConflict) {
        // Someone else published first — hand back the newer revision instead of overwriting it.
        res.status(409).json({ error: "revision-conflict", current: error.current });
        return;
      }
      res.status(500).json({ error: "save-failed" });
    }
  });

  /**
   * A product being created/edited. The `id` is assigned by the server, so the
   * payload is validated against the product schema without it; every optional
   * field then arrives with its default already applied.
   */
  const productInputSchema = productSchema.omit({ id: true });

  const productBody = (req: Request, res: Response) => {
    const revision = Number((req.body ?? {}).revision);
    if (!Number.isInteger(revision) || revision < 1) {
      res.status(422).json({ error: "revision-required" });
      return null;
    }
    const parsed = productInputSchema.safeParse((req.body ?? {}).product);
    if (!parsed.success) {
      res.status(422).json({ error: "invalid-product", details: parsed.error.flatten().fieldErrors });
      return null;
    }
    return { revision, product: parsed.data };
  };

  const saveProducts = (
    res: Response,
    next: Record<string, unknown>[],
    revision: number,
    product: Record<string, unknown> | null,
    /** 201 only for a genuine creation; edits and deletions are 200. */
    status: 200 | 201 = 200,
  ) => {
    const parsed = contentSchema.safeParse({ ...db.getContent(), products: next });
    if (!parsed.success) {
      res.status(422).json({ error: "invalid-product", details: parsed.error.flatten().fieldErrors });
      return;
    }
    try {
      const saved = db.saveContent(parsed.data, revision);
      hub.broadcast({ type: "content", revision: saved.revision });
      res
        .status(status)
        .json({ ok: true, revision: saved.revision, product, products: saved.products });
    } catch (error) {
      if (error instanceof RevisionConflict) {
        res.status(409).json({ error: "revision-conflict", current: error.current });
        return;
      }
      res.status(500).json({ error: "save-failed" });
    }
  };

  admin.post("/products", requireCsrf, requireProfileComplete, (req, res) => {
    const body = productBody(req, res);
    if (!body) return;
    const current = db.getContent();
    const nextProduct = {
      ...(body.product as Record<string, unknown>),
      id: Math.max(0, ...current.products.map((p) => p.id)) + 1,
    };
    saveProducts(res, [...current.products, nextProduct], body.revision, nextProduct, 201);
  });

  admin.put("/products/:id", requireCsrf, requireProfileComplete, (req, res) => {
    const body = productBody(req, res);
    if (!body) return;
    const id = Number.parseInt(req.params.id, 10);
    const current = db.getContent();
    if (!current.products.some((p) => p.id === id)) {
      res.status(404).json({ error: "not-found" });
      return;
    }
    const products = current.products.map((p) => (p.id === id ? { ...body.product, id } : p));
    saveProducts(res, products, body.revision, { ...body.product, id }, 200);
  });

  admin.delete("/products/:id", requireCsrf, requireProfileComplete, (req, res) => {
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
    saveProducts(
      res,
      current.products.filter((p) => p.id !== id),
      revision,
      null,
    );
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

  return { app, db, hub };
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
  const parts = [`${SESSION_COOKIE}=`, "Path=/", "HttpOnly", "SameSite=Strict", "Max-Age=0"];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}
