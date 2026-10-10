// SQLite persistence using Node's built-in node:sqlite (no native build step).
import { DatabaseSync } from "node:sqlite";
import {
  mkdirSync,
  existsSync,
  readFileSync,
  rmSync,
  writeFileSync,
  chmodSync,
} from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import {
  DEFAULT_CONTENT,
  REQUEST_STATUSES,
  contentSchema,
  eventSchema,
  type Content,
  type ContentDoc,
  type EventInput,
  type RequestStatus,
  type Role,
  type SiteEvent,
  type WholesaleRequest,
} from "../shared/content.ts";

export const SETUP_TOKEN_LENGTH = 64;

export type AuditEntry = {
  id: number;
  at: string;
  kind: string;
  actorId: number | null;
  actorName: string;
  ip: string;
  /** Short, non-secret description of what happened. */
  detail: string;
  /** true when the event looks like an attack or a mistake worth flagging. */
  suspicious: boolean;
};

export type AuditInput = {
  kind: string;
  actorId?: number | null;
  actorName?: string;
  ip?: string;
  detail?: string;
  suspicious?: boolean;
};

export type Db = {
  raw: DatabaseSync;
  dataDir: string;
  getContent: () => ContentDoc;
  saveContent: (content: Content, expectedRevision: number) => ContentDoc;
  createRequest: (input: {
    requestKey?: string;
    name: string;
    contact: string;
    product: string;
    unit: string;
    quantity: number;
    notes: string;
  }) => { request: WholesaleRequest; created: boolean; conflict?: boolean };
  listRequests: (opts: {
    search?: string;
    status?: string;
    limit: number;
    offset: number;
  }) => {
    items: WholesaleRequest[];
    total: number;
  };
  getRequest: (id: number) => WholesaleRequest | null;
  setRequestStatus: (
    id: number,
    status: RequestStatus,
  ) => WholesaleRequest | null;
  deleteRequest: (id: number) => boolean;
  adminCount: () => number;
  countOwners: () => number;
  createAdmin: (input: {
    username: string;
    passwordHash: string;
    role: Role;
    displayName?: string;
    email?: string | null;
    mustCompleteProfile?: boolean;
    createdBy?: number | null;
  }) => number;
  findAdmin: (identifier: string) => AdminRow | null;
  listAdmins: () => AdminRow[];
  getAdmin: (id: number) => AdminRow | null;
  updateAdmin: (id: number, patch: Partial<AdminPatch>) => AdminRow | null;
  deleteAdmin: (id: number) => boolean;
  touchLogin: (id: number) => void;
  listEvents: () => SiteEvent[];
  activeEvents: () => SiteEvent[];
  createEvent: (input: EventInput) => SiteEvent;
  updateEvent: (id: number, input: EventInput) => SiteEvent | null;
  deleteEvent: (id: number) => boolean;
  recordAudit: (input: AuditInput) => void;
  listAudit: (opts: {
    limit: number;
    kind?: string;
    suspiciousOnly?: boolean;
  }) => AuditEntry[];
  auditSummary: () => {
    total: number;
    suspicious: number;
    last24h: number;
    kinds: { kind: string; count: number }[];
  };
  uploadsDir: string;
  setupTokenPath: string;
  readSetupToken: () => string | null;
  consumeSetupToken: () => void;
  close: () => void;
  /** Absolute path of the SQLite file actually in use. */
  file: string;
  /**
   * How this process found its content on startup. Deployment accidents (a
   * second data directory, a relative DATA_DIR resolved from another working
   * directory, a fresh volume) all look the same from the outside — the site
   * suddenly shows the bundled demo content again — so the facts are recorded
   * once at boot and reported in the logs and in /api/health.
   */
  provenance: {
    /** The SQLite file did not exist when this process opened it. */
    createdDatabase: boolean;
    /** The content row was empty, so DEFAULT_CONTENT was written. */
    seededDefaults: boolean;
    /** Revision found at startup (1 = untouched seed). */
    revisionAtBoot: number;
    updatedAtBoot: string;
  };
  /** Cheap integrity probe for the content row; never throws. */
  contentHealth: () => {
    ok: boolean;
    revision: number;
    updatedAt: string;
    issues: string[];
  };
};

/** Thrown when the stored document cannot be read as valid content. */
export class ContentUnreadable extends Error {
  issues: string[];
  constructor(issues: string[]) {
    super("content-unreadable");
    this.name = "ContentUnreadable";
    this.issues = issues;
  }
}

export type AdminRow = {
  id: number;
  username: string;
  email: string | null;
  display_name: string;
  avatar_url: string;
  password_hash: string;
  role: string;
  security_question: string;
  security_answer_hash: string;
  must_complete_profile: number;
  created_by: number | null;
  created_at: string;
  updated_at: string;
  last_login_at: string;
  password_set?: number;
};

export type AdminPatch = {
  username: string;
  display_name: string;
  email: string | null;
  avatar_url: string;
  role: Role;
  password_hash: string;
  security_question: string;
  security_answer_hash: string;
  must_complete_profile: number;
  updated_at: string;
};

type EventRow = {
  id: number;
  title: string;
  description: string;
  image_url: string;
  type: string;
  start_at: string;
  end_at: string;
  active: number;
  created_at: string;
  updated_at: string;
};

type AuditRow = {
  id: number;
  at: string;
  kind: string;
  actor_id: number | null;
  actor_name: string;
  ip: string;
  detail: string;
  suspicious: number;
};

type RequestRow = {
  id: number;
  name: string;
  contact: string;
  product: string;
  unit: string;
  quantity: number;
  notes: string;
  status: string;
  created_at: string;
  updated_at: string;
};

const toRequest = (row: RequestRow): WholesaleRequest => ({
  id: Number(row.id),
  name: row.name,
  contact: row.contact,
  product: row.product,
  unit: row.unit,
  quantity: Number(row.quantity),
  notes: row.notes ?? "",
  status: (REQUEST_STATUSES as readonly string[]).includes(row.status)
    ? (row.status as RequestStatus)
    : "new",
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const toAudit = (row: AuditRow): AuditEntry => ({
  id: Number(row.id),
  at: row.at,
  kind: row.kind,
  actorId: row.actor_id === null ? null : Number(row.actor_id),
  actorName: row.actor_name ?? "",
  ip: row.ip ?? "",
  detail: row.detail ?? "",
  suspicious: Number(row.suspicious) === 1,
});

const toEvent = (row: EventRow): SiteEvent => {
  const parsed = eventSchema.parse({
    title: row.title,
    description: row.description ?? "",
    imageUrl: row.image_url ?? "",
    type: (row.type ?? "announcement") as SiteEvent["type"],
    startAt: row.start_at ?? "",
    endAt: row.end_at ?? "",
    active: Number(row.active) === 1,
  });
  return {
    ...parsed,
    id: Number(row.id),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

/** A conflict the API turns into HTTP 409 so one admin cannot clobber newer content. */
export class RevisionConflict extends Error {
  current: ContentDoc;
  constructor(current: ContentDoc) {
    super("revision-conflict");
    this.name = "RevisionConflict";
    this.current = current;
  }
}

export function openDb(dataDir: string): Db {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  // The data directory holds password hashes and session tokens: keep it
  // owner-only where the filesystem supports it.
  try {
    chmodSync(dataDir, 0o700);
  } catch {
    /* not POSIX, or not the owner */
  }
  const file = join(dataDir, "elbaz.sqlite");
  // Recorded before the file is opened: afterwards it always exists.
  const createdDatabase = !existsSync(file);
  const raw = new DatabaseSync(file);
  for (const name of ["elbaz.sqlite", "elbaz.sqlite-wal", "elbaz.sqlite-shm"]) {
    try {
      chmodSync(join(dataDir, name), 0o600);
    } catch {
      /* the -wal/-shm files appear lazily; the next call picks them up */
    }
  }
  raw.exec("PRAGMA journal_mode = WAL");
  raw.exec("PRAGMA foreign_keys = ON");
  raw.exec(`
    CREATE TABLE IF NOT EXISTS content (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      json TEXT NOT NULL,
      revision INTEGER NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS wholesale_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      request_key TEXT,
      name TEXT NOT NULL,
      contact TEXT NOT NULL,
      product TEXT NOT NULL,
      unit TEXT NOT NULL,
      quantity REAL NOT NULL,
      notes TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'new',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_requests_key
      ON wholesale_requests(request_key) WHERE request_key IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_requests_status ON wholesale_requests(status);
    CREATE TABLE IF NOT EXISTS admins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      admin_id INTEGER NOT NULL,
      csrf TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      revoked INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (admin_id) REFERENCES admins(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      image_url TEXT NOT NULL DEFAULT '',
      type TEXT NOT NULL DEFAULT 'announcement',
      start_at TEXT NOT NULL DEFAULT '',
      end_at TEXT NOT NULL DEFAULT '',
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_events_active ON events(active);
    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      at TEXT NOT NULL,
      kind TEXT NOT NULL,
      actor_id INTEGER,
      actor_name TEXT NOT NULL DEFAULT '',
      ip TEXT NOT NULL DEFAULT '',
      detail TEXT NOT NULL DEFAULT '',
      suspicious INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_audit_at ON audit_log(at DESC);
    CREATE INDEX IF NOT EXISTS idx_audit_kind ON audit_log(kind);
  `);

  // --- additive migrations: safe to run against an existing database -----------------
  const columns = (table: string) => {
    const rows = raw.prepare(`PRAGMA table_info(${table})`).all() as {
      name: string;
    }[];
    return new Set(rows.map((row) => row.name));
  };
  const addColumn = (table: string, column: string, definition: string) => {
    if (columns(table).has(column)) return;
    raw.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  };

  addColumn("admins", "role", "TEXT NOT NULL DEFAULT 'admin'");
  addColumn("admins", "email", "TEXT");
  addColumn("admins", "display_name", "TEXT NOT NULL DEFAULT ''");
  addColumn("admins", "avatar_url", "TEXT NOT NULL DEFAULT ''");
  addColumn("admins", "security_question", "TEXT NOT NULL DEFAULT ''");
  addColumn("admins", "security_answer_hash", "TEXT NOT NULL DEFAULT ''");
  addColumn("admins", "must_complete_profile", "INTEGER NOT NULL DEFAULT 0");
  addColumn("admins", "created_by", "INTEGER");
  addColumn("admins", "last_login_at", "TEXT NOT NULL DEFAULT ''");
  addColumn("admins", "updated_at", "TEXT NOT NULL DEFAULT ''");
  addColumn("sessions", "security_verified", "INTEGER NOT NULL DEFAULT 0");
  addColumn("sessions", "ip", "TEXT NOT NULL DEFAULT ''");
  addColumn("sessions", "user_agent", "TEXT NOT NULL DEFAULT ''");
  addColumn("sessions", "last_seen_at", "TEXT NOT NULL DEFAULT ''");
  raw.exec(
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_admins_email ON admins(email) WHERE email IS NOT NULL",
  );

  const nowIso = () => new Date().toISOString();
  const setupTokenPath = join(dataDir, "setup-token");
  // Uploaded images live beside the database, never inside the served app tree.
  const uploadsDir = join(dataDir, "uploads");
  mkdirSync(uploadsDir, { recursive: true });

  // Seed exactly once, and only into a database that has no content row at all.
  //
  // This is the one place that can ever write DEFAULT_CONTENT, and it is
  // guarded by a COUNT so a restart, a redeploy or an additive migration can
  // never reset published content. `INSERT ... WHERE NOT EXISTS` makes the
  // guard atomic as well, so two processes starting at the same moment cannot
  // both decide the table is empty.
  const seeded = raw
    .prepare(
      `INSERT INTO content (id, json, revision, updated_at)
       SELECT 1, ?, 1, ?
       WHERE NOT EXISTS (SELECT 1 FROM content WHERE id = 1)`,
    )
    .run(JSON.stringify(DEFAULT_CONTENT), nowIso());
  const seededDefaults = Number(seeded.changes) > 0;

  const getRequest = (id: number): WholesaleRequest | null => {
    const row = raw
      .prepare("SELECT * FROM wholesale_requests WHERE id = ?")
      .get(id) as RequestRow | undefined;
    return row ? toRequest(row) : null;
  };

  const contentRow = () =>
    raw.prepare("SELECT json, revision, updated_at FROM content WHERE id = 1").get() as
      | { json: string; revision: number; updated_at: string }
      | undefined;

  /**
   * Reads the stored document.
   *
   * Validation stays strict — the site must never render a half-parsed
   * document — but a failure is reported as ContentUnreadable with the exact
   * field paths, so the API can answer 503 (keep your last good copy) instead
   * of a blank 500, and the operator sees what to repair. New schema fields
   * must always carry a `.default(...)` so an older stored document still
   * parses; the api suite guards that.
   */
  const getContent = (): ContentDoc => {
    const row = contentRow();
    if (!row) throw new ContentUnreadable(["content row missing"]);
    let data: unknown;
    try {
      data = JSON.parse(row.json);
    } catch {
      throw new ContentUnreadable(["stored content is not valid JSON"]);
    }
    const parsed = contentSchema.safeParse(data);
    if (!parsed.success) {
      throw new ContentUnreadable(
        parsed.error.issues
          .slice(0, 10)
          .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`),
      );
    }
    return { ...parsed.data, revision: Number(row.revision) };
  };

  const contentHealth = () => {
    const row = contentRow();
    if (!row)
      return { ok: false, revision: 0, updatedAt: "", issues: ["content row missing"] };
    try {
      getContent();
      return {
        ok: true,
        revision: Number(row.revision),
        updatedAt: row.updated_at,
        issues: [] as string[],
      };
    } catch (error) {
      return {
        ok: false,
        revision: Number(row.revision),
        updatedAt: row.updated_at,
        issues: error instanceof ContentUnreadable ? error.issues : ["unknown error"],
      };
    }
  };

  const bootRow = contentRow();

  return {
    raw,
    dataDir,
    file,
    provenance: {
      createdDatabase,
      seededDefaults,
      revisionAtBoot: Number(bootRow?.revision ?? 0),
      updatedAtBoot: bootRow?.updated_at ?? "",
    },
    contentHealth,
    setupTokenPath,
    uploadsDir,
    getContent,
    saveContent(content, expectedRevision) {
      const current = getContent();
      if (current.revision !== expectedRevision)
        throw new RevisionConflict(current);
      const clean = contentSchema.parse(content);
      const next = current.revision + 1;
      // Compare-and-set: the WHERE clause is what actually prevents lost updates.
      const result = raw
        .prepare(
          "UPDATE content SET json = ?, revision = ?, updated_at = ? WHERE id = 1 AND revision = ?",
        )
        .run(JSON.stringify(clean), next, nowIso(), expectedRevision);
      if (Number(result.changes) === 0)
        throw new RevisionConflict(getContent());
      return { ...clean, revision: next };
    },
    createRequest(input) {
      if (input.requestKey) {
        const found = raw
          .prepare("SELECT * FROM wholesale_requests WHERE request_key = ?")
          .get(input.requestKey) as RequestRow | undefined;
        if (found) {
          // The key identifies one submission. If the payload differs, the
          // client is reusing a key for different data: report a conflict
          // instead of silently answering with the old record.
          const same =
            found.name === input.name &&
            found.contact === input.contact &&
            found.product === input.product &&
            found.unit === input.unit &&
            Number(found.quantity) === Number(input.quantity) &&
            (found.notes ?? "") === (input.notes ?? "");
          if (!same)
            return {
              request: toRequest(found),
              created: false,
              conflict: true,
            };
          return { request: toRequest(found), created: false, conflict: false };
        }
      }
      const stamp = nowIso();
      const info = raw
        .prepare(
          `INSERT INTO wholesale_requests
             (request_key, name, contact, product, unit, quantity, notes, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'new', ?, ?)`,
        )
        .run(
          input.requestKey ?? null,
          input.name,
          input.contact,
          input.product,
          input.unit,
          input.quantity,
          input.notes,
          stamp,
          stamp,
        );
      const row = raw
        .prepare("SELECT * FROM wholesale_requests WHERE id = ?")
        .get(Number(info.lastInsertRowid)) as RequestRow;
      return { request: toRequest(row), created: true, conflict: false };
    },
    listRequests({ search, status, limit, offset }) {
      // Parameterised SQL only — never string-interpolated user input.
      const filters: string[] = [];
      const params: (string | number)[] = [];
      if (status && (REQUEST_STATUSES as readonly string[]).includes(status)) {
        filters.push("status = ?");
        params.push(status);
      }
      if (search) {
        filters.push("(name LIKE ? OR contact LIKE ? OR product LIKE ?)");
        const like = `%${search.replace(/[%_]/g, "")}%`;
        params.push(like, like, like);
      }
      const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
      const total = Number(
        (
          raw
            .prepare(`SELECT COUNT(*) AS n FROM wholesale_requests ${where}`)
            .get(...params) as {
            n: number;
          }
        ).n,
      );
      const items = raw
        .prepare(
          `SELECT * FROM wholesale_requests ${where} ORDER BY id DESC LIMIT ? OFFSET ?`,
        )
        .all(...params, limit, offset) as RequestRow[];
      return { items: items.map(toRequest), total };
    },
    getRequest,
    setRequestStatus(id, status) {
      const info = raw
        .prepare(
          "UPDATE wholesale_requests SET status = ?, updated_at = ? WHERE id = ?",
        )
        .run(status, nowIso(), id);
      if (Number(info.changes) === 0) return null;
      return getRequest(id);
    },
    deleteRequest(id) {
      const info = raw
        .prepare("DELETE FROM wholesale_requests WHERE id = ?")
        .run(id);
      return Number(info.changes) > 0;
    },
    adminCount() {
      const row = raw.prepare("SELECT COUNT(*) AS n FROM admins").get() as {
        n: number;
      };
      return Number(row.n);
    },
    countOwners() {
      const row = raw
        .prepare("SELECT COUNT(*) AS n FROM admins WHERE role = 'owner'")
        .get() as {
        n: number;
      };
      return Number(row.n);
    },
    createAdmin(input) {
      const stamp = nowIso();
      const info = raw
        .prepare(
          `INSERT INTO admins
             (username, email, display_name, avatar_url, password_hash, role,
              security_question, security_answer_hash, must_complete_profile, created_by,
              created_at, updated_at, last_login_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          input.username,
          input.email ?? null,
          input.displayName ?? input.username,
          "",
          input.passwordHash,
          input.role,
          "",
          "",
          input.mustCompleteProfile ? 1 : 0,
          input.createdBy ?? null,
          stamp,
          stamp,
          "",
        );
      return Number(info.lastInsertRowid);
    },
    /** Login accepts the username or the email (case-insensitive on email). */
    findAdmin(identifier) {
      const row = raw
        .prepare(
          "SELECT * FROM admins WHERE username = ? OR (email IS NOT NULL AND lower(email) = lower(?)) LIMIT 1",
        )
        .get(identifier, identifier) as AdminRow | undefined;
      return row ?? null;
    },
    listAdmins() {
      return raw
        .prepare(
          `SELECT id, username, email, display_name, avatar_url, '' AS password_hash, role,
                  security_question, '' AS security_answer_hash, must_complete_profile,
                  created_by, created_at, updated_at, last_login_at
           FROM admins ORDER BY (role = 'owner') DESC, id ASC`,
        )
        .all() as AdminRow[];
    },
    getAdmin(id) {
      const row = raw.prepare("SELECT * FROM admins WHERE id = ?").get(id) as
        AdminRow | undefined;
      return row ?? null;
    },
    updateAdmin(id, patch) {
      // Column names come from server code only, and this allow-list keeps it
      // that way even if a future caller forwards a user-supplied key.
      const UPDATABLE = new Set<keyof AdminPatch>([
        "username",
        "display_name",
        "email",
        "avatar_url",
        "role",
        "password_hash",
        "security_question",
        "security_answer_hash",
        "must_complete_profile",
        "updated_at",
      ]);
      const keys = (Object.keys(patch) as (keyof AdminPatch)[]).filter((key) =>
        UPDATABLE.has(key),
      );
      if (!keys.length) return this.getAdmin(id);
      const assignments = keys.map((key) => `${key} = ?`).join(", ");
      raw
        .prepare(`UPDATE admins SET ${assignments} WHERE id = ?`)
        .run(...keys.map((key) => patch[key] as string | number | null), id);
      return this.getAdmin(id);
    },
    deleteAdmin(id) {
      const info = raw.prepare("DELETE FROM admins WHERE id = ?").run(id);
      return Number(info.changes) > 0;
    },
    touchLogin(id) {
      raw
        .prepare("UPDATE admins SET last_login_at = ? WHERE id = ?")
        .run(nowIso(), id);
    },
    listEvents() {
      return (
        raw.prepare("SELECT * FROM events ORDER BY id DESC").all() as EventRow[]
      ).map(toEvent);
    },
    /** Only events that are active *and* inside their optional date window. */
    activeEvents() {
      const now = Date.now();
      return (
        raw
          .prepare("SELECT * FROM events WHERE active = 1 ORDER BY id DESC")
          .all() as EventRow[]
      )
        .map(toEvent)
        .filter((event) => {
          if (event.startAt && Date.parse(event.startAt) > now) return false;
          if (event.endAt && Date.parse(event.endAt) < now) return false;
          return true;
        });
    },
    createEvent(input) {
      const stamp = nowIso();
      const info = raw
        .prepare(
          `INSERT INTO events (title, description, image_url, type, start_at, end_at, active, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          input.title,
          input.description,
          input.imageUrl,
          input.type,
          input.startAt,
          input.endAt,
          input.active ? 1 : 0,
          stamp,
          stamp,
        );
      const row = raw
        .prepare("SELECT * FROM events WHERE id = ?")
        .get(Number(info.lastInsertRowid)) as EventRow;
      return toEvent(row);
    },
    updateEvent(id, input) {
      const info = raw
        .prepare(
          `UPDATE events SET title = ?, description = ?, image_url = ?, type = ?,
                  start_at = ?, end_at = ?, active = ?, updated_at = ? WHERE id = ?`,
        )
        .run(
          input.title,
          input.description,
          input.imageUrl,
          input.type,
          input.startAt,
          input.endAt,
          input.active ? 1 : 0,
          nowIso(),
          id,
        );
      if (Number(info.changes) === 0) return null;
      const row = raw
        .prepare("SELECT * FROM events WHERE id = ?")
        .get(id) as EventRow;
      return toEvent(row);
    },
    deleteEvent(id) {
      const info = raw.prepare("DELETE FROM events WHERE id = ?").run(id);
      return Number(info.changes) > 0;
    },
    /**
     * Append-only audit trail. Never call it with a password, a token or a
     * security answer: only identifiers, kinds and short descriptions.
     */
    recordAudit(input) {
      try {
        raw
          .prepare(
            `INSERT INTO audit_log (at, kind, actor_id, actor_name, ip, detail, suspicious)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            nowIso(),
            String(input.kind).slice(0, 60),
            input.actorId ?? null,
            String(input.actorName ?? "").slice(0, 120),
            String(input.ip ?? "").slice(0, 60),
            String(input.detail ?? "").slice(0, 400),
            input.suspicious ? 1 : 0,
          );
      } catch {
        // Auditing must never break the request it is describing.
      }
      // Keep the table bounded so the database cannot grow without limit.
      try {
        raw.exec(
          "DELETE FROM audit_log WHERE id NOT IN (SELECT id FROM audit_log ORDER BY id DESC LIMIT 20000)",
        );
      } catch {
        /* best effort */
      }
    },
    listAudit({ limit, kind, suspiciousOnly }) {
      const filters: string[] = [];
      const params: (string | number)[] = [];
      if (kind) {
        filters.push("kind = ?");
        params.push(kind);
      }
      if (suspiciousOnly) filters.push("suspicious = 1");
      const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
      return (
        raw
          .prepare(`SELECT * FROM audit_log ${where} ORDER BY id DESC LIMIT ?`)
          .all(...params, Math.min(500, Math.max(1, limit))) as AuditRow[]
      ).map(toAudit);
    },
    auditSummary() {
      const total = Number(
        (
          raw.prepare("SELECT COUNT(*) AS n FROM audit_log").get() as {
            n: number;
          }
        ).n,
      );
      const suspicious = Number(
        (
          raw
            .prepare("SELECT COUNT(*) AS n FROM audit_log WHERE suspicious = 1")
            .get() as { n: number }
        ).n,
      );
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const last24h = Number(
        (
          raw
            .prepare("SELECT COUNT(*) AS n FROM audit_log WHERE at >= ?")
            .get(since) as { n: number }
        ).n,
      );
      const kinds = (
        raw
          .prepare(
            "SELECT kind, COUNT(*) AS n FROM audit_log GROUP BY kind ORDER BY n DESC LIMIT 12",
          )
          .all() as { kind: string; n: number }[]
      ).map((row) => ({ kind: row.kind, count: Number(row.n) }));
      return { total, suspicious, last24h, kinds };
    },
    readSetupToken() {
      if (!existsSync(setupTokenPath)) return null;
      const value = readFileSync(setupTokenPath, "utf8").trim();
      return value.length === SETUP_TOKEN_LENGTH ? value : null;
    },
    consumeSetupToken() {
      try {
        rmSync(setupTokenPath, { force: true });
      } catch {
        /* best effort */
      }
    },
    close() {
      raw.close();
    },
  };
}

/**
 * Creates the one-time first-run setup token. It lives only inside the protected data directory
 * and is never exposed through the public site or the API.
 */
export function ensureSetupToken(db: Db): void {
  if (db.adminCount() > 0) {
    db.consumeSetupToken();
    return;
  }
  if (existsSync(db.setupTokenPath)) return;
  const token = randomBytes(SETUP_TOKEN_LENGTH / 2).toString("hex");
  writeFileSync(db.setupTokenPath, token, { mode: 0o600 });
  try {
    chmodSync(db.setupTokenPath, 0o600);
  } catch {
    /* windows */
  }
}
