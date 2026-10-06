// SQLite persistence using Node's built-in node:sqlite (no native build step).
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, existsSync, readFileSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import {
  DEFAULT_CONTENT,
  REQUEST_STATUSES,
  contentSchema,
  type Content,
  type ContentDoc,
  type RequestStatus,
  type WholesaleRequest,
} from "../shared/content.ts";

export const SETUP_TOKEN_LENGTH = 64;

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
  }) => { request: WholesaleRequest; created: boolean };
  listRequests: (opts: { search?: string; status?: string; limit: number; offset: number }) => {
    items: WholesaleRequest[];
    total: number;
  };
  getRequest: (id: number) => WholesaleRequest | null;
  setRequestStatus: (id: number, status: RequestStatus) => WholesaleRequest | null;
  deleteRequest: (id: number) => boolean;
  adminCount: () => number;
  createAdmin: (username: string, passwordHash: string) => number;
  findAdmin: (username: string) => { id: number; username: string; password_hash: string } | null;
  setupTokenPath: string;
  readSetupToken: () => string | null;
  consumeSetupToken: () => void;
  close: () => void;
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
  mkdirSync(dataDir, { recursive: true });
  const file = join(dataDir, "elbaz.sqlite");
  const raw = new DatabaseSync(file);
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
  `);

  const nowIso = () => new Date().toISOString();
  const setupTokenPath = join(dataDir, "setup-token");

  // Seed exactly once. Existing published content is never overwritten by src/data.ts changes.
  const existing = raw.prepare("SELECT COUNT(*) AS n FROM content").get() as { n: number };
  if (Number(existing.n) === 0) {
    raw
      .prepare("INSERT INTO content (id, json, revision, updated_at) VALUES (1, ?, 1, ?)")
      .run(JSON.stringify(DEFAULT_CONTENT), nowIso());
  }

  const getRequest = (id: number): WholesaleRequest | null => {
    const row = raw.prepare("SELECT * FROM wholesale_requests WHERE id = ?").get(id) as
      | RequestRow
      | undefined;
    return row ? toRequest(row) : null;
  };

  const getContent = (): ContentDoc => {
    const row = raw.prepare("SELECT json, revision FROM content WHERE id = 1").get() as
      | { json: string; revision: number }
      | undefined;
    if (!row) throw new Error("content-row-missing");
    const parsed = contentSchema.parse(JSON.parse(row.json));
    return { ...parsed, revision: Number(row.revision) };
  };

  return {
    raw,
    dataDir,
    setupTokenPath,
    getContent,
    saveContent(content, expectedRevision) {
      const current = getContent();
      if (current.revision !== expectedRevision) throw new RevisionConflict(current);
      const clean = contentSchema.parse(content);
      const next = current.revision + 1;
      // Compare-and-set: the WHERE clause is what actually prevents lost updates.
      const result = raw
        .prepare("UPDATE content SET json = ?, revision = ?, updated_at = ? WHERE id = 1 AND revision = ?")
        .run(JSON.stringify(clean), next, nowIso(), expectedRevision);
      if (Number(result.changes) === 0) throw new RevisionConflict(getContent());
      return { ...clean, revision: next };
    },
    createRequest(input) {
      if (input.requestKey) {
        const found = raw
          .prepare("SELECT * FROM wholesale_requests WHERE request_key = ?")
          .get(input.requestKey) as RequestRow | undefined;
        if (found) return { request: toRequest(found), created: false };
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
      return { request: toRequest(row), created: true };
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
        (raw.prepare(`SELECT COUNT(*) AS n FROM wholesale_requests ${where}`).get(...params) as {
          n: number;
        }).n,
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
        .prepare("UPDATE wholesale_requests SET status = ?, updated_at = ? WHERE id = ?")
        .run(status, nowIso(), id);
      if (Number(info.changes) === 0) return null;
      return getRequest(id);
    },
    deleteRequest(id) {
      const info = raw.prepare("DELETE FROM wholesale_requests WHERE id = ?").run(id);
      return Number(info.changes) > 0;
    },
    adminCount() {
      const row = raw.prepare("SELECT COUNT(*) AS n FROM admins").get() as { n: number };
      return Number(row.n);
    },
    createAdmin(username, passwordHash) {
      const info = raw
        .prepare("INSERT INTO admins (username, password_hash, created_at) VALUES (?, ?, ?)")
        .run(username, passwordHash, nowIso());
      return Number(info.lastInsertRowid);
    },
    findAdmin(username) {
      const row = raw
        .prepare("SELECT id, username, password_hash FROM admins WHERE username = ?")
        .get(username) as { id: number; username: string; password_hash: string } | undefined;
      return row ?? null;
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
