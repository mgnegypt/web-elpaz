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
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
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
import {
  canTransition,
  priceOrder,
  round2,
  type Order,
  type OrderDraft,
  type OrderItem,
  type OrderStats,
  type OrderStatus,
  type PaymentMethod,
  type PaymentStatus,
  type PricingProblem,
} from "../shared/orders.ts";

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
  /**
   * Creates a customer order. Prices, stock and delivery fees are read from
   * the stored catalogue inside one transaction, so nothing the browser sent
   * can change what is charged. Returns the raw access token exactly once —
   * only its hash is stored.
   */
  createOrder: (input: OrderCreateInput) => {
    order: Order;
    created: boolean;
    conflict: boolean;
    accessToken: string | null;
  };
  /** Customer lookup: needs both the reference and the matching token. */
  getOrderByReference: (reference: string, token: string) => Order | null;
  getOrder: (id: number) => Order | null;
  listOrders: (opts: OrderListOptions) => { items: Order[]; total: number };
  setOrderStatus: (
    id: number,
    status: OrderStatus,
    actor: { id: number | null; name: string },
    note?: string,
  ) => Order;
  setOrderPayment: (
    id: number,
    paymentStatus: PaymentStatus,
    actor: { id: number | null; name: string },
  ) => Order;
  orderStats: () => OrderStats;
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

export type OrderCreateInput = OrderDraft & { ip?: string };

export type OrderListOptions = {
  search?: string;
  status?: string;
  limit: number;
  offset: number;
};

/**
 * Why an order could not be created. `problems` carries the per-product
 * detail so the checkout can point at the exact line that went stale.
 */
export class OrderRejected extends Error {
  code:
    | "orders-disabled"
    | "items"
    | "below-minimum"
    | "zone-required"
    | "payment-unavailable"
    | "empty";
  problems: PricingProblem[];
  detail: string;
  constructor(
    code: OrderRejected["code"],
    detail = "",
    problems: PricingProblem[] = [],
  ) {
    super(code);
    this.name = "OrderRejected";
    this.code = code;
    this.detail = detail;
    this.problems = problems;
  }
}

/** Thrown when an administrator asks for a status move the flow forbids. */
export class InvalidStatusTransition extends Error {
  from: OrderStatus;
  to: OrderStatus;
  constructor(from: OrderStatus, to: OrderStatus) {
    super("invalid-transition");
    this.name = "InvalidStatusTransition";
    this.from = from;
    this.to = to;
  }
}

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
    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      reference TEXT NOT NULL UNIQUE,
      /* sha256 of the customer's access token: the raw token only ever lives
         in the link we hand the customer, never in the database. */
      access_hash TEXT NOT NULL,
      request_key TEXT,
      fingerprint TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending',
      customer_name TEXT NOT NULL,
      customer_phone TEXT NOT NULL,
      customer_alt_phone TEXT NOT NULL DEFAULT '',
      address TEXT NOT NULL,
      area TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      delivery_zone_id TEXT NOT NULL DEFAULT '',
      delivery_zone_name TEXT NOT NULL DEFAULT '',
      payment_method TEXT NOT NULL DEFAULT 'on_confirmation',
      payment_status TEXT NOT NULL DEFAULT 'unpaid',
      currency TEXT NOT NULL DEFAULT '',
      subtotal REAL NOT NULL DEFAULT 0,
      discount_total REAL NOT NULL DEFAULT 0,
      /* NULL means the delivery fee is agreed when the order is confirmed. */
      shipping REAL,
      total REAL NOT NULL DEFAULT 0,
      item_count INTEGER NOT NULL DEFAULT 0,
      /* 1 while this order still holds stock; cleared when cancelling returns it. */
      stock_held INTEGER NOT NULL DEFAULT 1,
      ip TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_request_key
      ON orders(request_key) WHERE request_key IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
    CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at DESC);
    CREATE TABLE IF NOT EXISTS order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      size TEXT NOT NULL DEFAULT '',
      unit_price REAL NOT NULL,
      list_unit_price REAL NOT NULL,
      discount_percent REAL NOT NULL DEFAULT 0,
      quantity INTEGER NOT NULL,
      line_total REAL NOT NULL,
      FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
    CREATE TABLE IF NOT EXISTS order_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL,
      status TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      actor_id INTEGER,
      actor_name TEXT NOT NULL DEFAULT '',
      at TEXT NOT NULL,
      FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_order_events_order ON order_events(order_id);
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

  /* ------------------------------------------------------------- orders */

  type OrderRow = {
    id: number;
    reference: string;
    access_hash: string;
    request_key: string | null;
    fingerprint: string;
    status: string;
    customer_name: string;
    customer_phone: string;
    customer_alt_phone: string;
    address: string;
    area: string;
    notes: string;
    delivery_zone_id: string;
    delivery_zone_name: string;
    payment_method: string;
    payment_status: string;
    currency: string;
    subtotal: number;
    discount_total: number;
    shipping: number | null;
    total: number;
    item_count: number;
    stock_held: number;
    ip: string;
    created_at: string;
    updated_at: string;
  };
  type OrderItemRow = {
    order_id: number;
    product_id: number;
    name: string;
    size: string;
    unit_price: number;
    list_unit_price: number;
    discount_percent: number;
    quantity: number;
    line_total: number;
  };
  type OrderEventRow = {
    order_id: number;
    status: string;
    note: string;
    at: string;
  };

  const sha256 = (value: string) =>
    createHash("sha256").update(value).digest("hex");

  /**
   * References are short enough to read over the phone but random enough that
   * they cannot be walked one by one; the access token is what actually
   * authorises a customer to open an order.
   */
  const REF_ALPHABET = "ACDEFGHJKLMNPQRTUVWXY3456789";
  const makeReference = () => {
    const now = new Date();
    const stamp =
      String(now.getUTCFullYear()).slice(2) +
      String(now.getUTCMonth() + 1).padStart(2, "0") +
      String(now.getUTCDate()).padStart(2, "0");
    const bytes = randomBytes(5);
    let tail = "";
    for (const byte of bytes) tail += REF_ALPHABET[byte % REF_ALPHABET.length];
    return `EB-${stamp}-${tail}`;
  };

  const orderItemsOf = (ids: number[]): Map<number, OrderItem[]> => {
    const map = new Map<number, OrderItem[]>();
    if (!ids.length) return map;
    const rows = raw
      .prepare(
        `SELECT * FROM order_items WHERE order_id IN (${ids.map(() => "?").join(",")}) ORDER BY id`,
      )
      .all(...ids) as OrderItemRow[];
    for (const row of rows) {
      const list = map.get(Number(row.order_id)) ?? [];
      list.push({
        productId: Number(row.product_id),
        name: row.name,
        size: row.size ?? "",
        unitPrice: Number(row.unit_price),
        listUnitPrice: Number(row.list_unit_price),
        discountPercent: Number(row.discount_percent),
        quantity: Number(row.quantity),
        lineTotal: Number(row.line_total),
      });
      map.set(Number(row.order_id), list);
    }
    return map;
  };

  const orderHistoryOf = (ids: number[]) => {
    const map = new Map<number, Order["history"]>();
    if (!ids.length) return map;
    const rows = raw
      .prepare(
        `SELECT order_id, status, note, at FROM order_events
          WHERE order_id IN (${ids.map(() => "?").join(",")}) ORDER BY id`,
      )
      .all(...ids) as OrderEventRow[];
    for (const row of rows) {
      const list = map.get(Number(row.order_id)) ?? [];
      list.push({
        status: row.status as OrderStatus,
        at: row.at,
        note: row.note ?? "",
      });
      map.set(Number(row.order_id), list);
    }
    return map;
  };

  const hydrateOrders = (rows: OrderRow[]): Order[] => {
    const ids = rows.map((row) => Number(row.id));
    const items = orderItemsOf(ids);
    const history = orderHistoryOf(ids);
    return rows.map((row) => ({
      id: Number(row.id),
      reference: row.reference,
      status: row.status as OrderStatus,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      customer: {
        name: row.customer_name,
        phone: row.customer_phone,
        altPhone: row.customer_alt_phone ?? "",
        address: row.address,
        area: row.area ?? "",
        notes: row.notes ?? "",
      },
      deliveryZoneId: row.delivery_zone_id ?? "",
      deliveryZoneName: row.delivery_zone_name ?? "",
      paymentMethod: (row.payment_method ?? "on_confirmation") as PaymentMethod,
      paymentStatus: (row.payment_status ?? "unpaid") as PaymentStatus,
      currency: row.currency ?? "",
      subtotal: Number(row.subtotal),
      discountTotal: Number(row.discount_total),
      shipping: row.shipping === null ? null : Number(row.shipping),
      total: Number(row.total),
      itemCount: Number(row.item_count),
      items: items.get(Number(row.id)) ?? [],
      history: history.get(Number(row.id)) ?? [],
    }));
  };

  const orderRow = (id: number) =>
    raw.prepare("SELECT * FROM orders WHERE id = ?").get(id) as
      | OrderRow
      | undefined;

  const hydrateOne = (row: OrderRow | undefined): Order | null =>
    row ? (hydrateOrders([row])[0] ?? null) : null;

  const appendOrderEvent = (
    orderId: number,
    status: OrderStatus,
    actor: { id: number | null; name: string },
    note: string,
    at: string,
  ) => {
    raw
      .prepare(
        `INSERT INTO order_events (order_id, status, note, actor_id, actor_name, at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(orderId, status, note, actor.id, actor.name, at);
  };

  /** Reads and validates the content document inside an open transaction. */
  const contentInTx = () => {
    const row = contentRow();
    if (!row) throw new ContentUnreadable(["content row missing"]);
    const parsed = contentSchema.safeParse(JSON.parse(row.json));
    if (!parsed.success)
      throw new ContentUnreadable(
        parsed.error.issues
          .slice(0, 10)
          .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`),
      );
    return { content: parsed.data, revision: Number(row.revision) };
  };

  /**
   * Writes a stock change back into the content document with the same
   * compare-and-set guard the dashboard uses, so an order and an admin save
   * can never silently overwrite each other.
   */
  const writeStock = (content: Content, expectedRevision: number) => {
    const result = raw
      .prepare(
        "UPDATE content SET json = ?, revision = ?, updated_at = ? WHERE id = 1 AND revision = ?",
      )
      .run(
        JSON.stringify(content),
        expectedRevision + 1,
        nowIso(),
        expectedRevision,
      );
    if (Number(result.changes) === 0) throw new RevisionConflict(getContent());
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
    createOrder(input) {
      // One fingerprint per submission: the same key with different contents
      // is a client bug (or a tampered retry), not a duplicate.
      const fingerprint = sha256(
        JSON.stringify({
          items: [...input.items]
            .sort((a, b) => a.productId - b.productId)
            .map((item) => [item.productId, Math.floor(item.quantity)]),
          customer: input.customer,
          zone: input.deliveryZoneId,
          payment: input.paymentMethod,
        }),
      );
      const byKey = () =>
        input.requestKey
          ? (raw
              .prepare("SELECT * FROM orders WHERE request_key = ?")
              .get(input.requestKey) as OrderRow | undefined)
          : undefined;

      const seen = byKey();
      if (seen)
        return {
          order: hydrateOne(seen)!,
          created: false,
          conflict: seen.fingerprint !== fingerprint,
          accessToken: null,
        };

      raw.exec("BEGIN IMMEDIATE");
      try {
        // Re-check under the write lock: two taps can arrive together.
        const raced = byKey();
        if (raced) {
          raw.exec("COMMIT");
          return {
            order: hydrateOne(raced)!,
            created: false,
            conflict: raced.fingerprint !== fingerprint,
            accessToken: null,
          };
        }

        const { content, revision } = contentInTx();
        const commerce = content.commerce;
        if (!commerce.ordersEnabled) throw new OrderRejected("orders-disabled");

        const priced = priceOrder(
          input.items,
          content.products,
          commerce,
          { deliveryZoneId: input.deliveryZoneId },
        );
        if (priced.problems.length)
          throw new OrderRejected("items", "", priced.problems);
        if (!priced.lines.length) throw new OrderRejected("empty");

        const zone = commerce.deliveryZones.find(
          (candidate) => candidate.id === input.deliveryZoneId,
        );
        if (commerce.deliveryZones.length > 0 && !zone)
          throw new OrderRejected("zone-required");
        if (priced.belowMinimum !== null)
          throw new OrderRejected("below-minimum", String(commerce.minOrderTotal));
        if (input.paymentMethod === "cod" && !commerce.codEnabled)
          throw new OrderRejected("payment-unavailable");

        // Reserve stock for every tracked product, then persist the catalogue
        // under its revision guard. Untracked products (quantity = null) and
        // made-to-order items are left alone.
        const ordered = new Map(
          priced.lines.map((line) => [line.productId, line.quantity]),
        );
        let stockChanged = false;
        const products = content.products.map((product) => {
          const take = ordered.get(product.id);
          if (!take || product.quantity === null) return product;
          stockChanged = true;
          return { ...product, quantity: Math.max(0, product.quantity - take) };
        });
        if (stockChanged) writeStock({ ...content, products }, revision);

        const accessToken = randomBytes(24).toString("base64url");
        let reference = makeReference();
        for (let attempt = 0; attempt < 8; attempt += 1) {
          const clash = raw
            .prepare("SELECT 1 FROM orders WHERE reference = ?")
            .get(reference);
          if (!clash) break;
          reference = makeReference();
        }

        const stamp = nowIso();
        const info = raw
          .prepare(
            `INSERT INTO orders (
               reference, access_hash, request_key, fingerprint, status,
               customer_name, customer_phone, customer_alt_phone, address, area, notes,
               delivery_zone_id, delivery_zone_name, payment_method, payment_status,
               currency, subtotal, discount_total, shipping, total, item_count,
               stock_held, ip, created_at, updated_at)
             VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'unpaid',
                     ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
          )
          .run(
            reference,
            sha256(accessToken),
            input.requestKey ?? null,
            fingerprint,
            input.customer.name,
            input.customer.phone,
            input.customer.altPhone,
            input.customer.address,
            input.customer.area,
            input.customer.notes,
            zone?.id ?? "",
            zone?.name ?? "",
            input.paymentMethod,
            priced.currency,
            priced.subtotal,
            priced.discountTotal,
            priced.shipping,
            priced.total,
            priced.itemCount,
            input.ip ?? "",
            stamp,
            stamp,
          );
        const orderId = Number(info.lastInsertRowid);
        const insertItem = raw.prepare(
          `INSERT INTO order_items
             (order_id, product_id, name, size, unit_price, list_unit_price,
              discount_percent, quantity, line_total)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        );
        for (const line of priced.lines)
          insertItem.run(
            orderId,
            line.productId,
            line.name,
            line.size,
            line.unitPrice,
            line.listUnitPrice,
            line.discountPercent,
            line.quantity,
            line.lineTotal,
          );
        appendOrderEvent(
          orderId,
          "pending",
          { id: null, name: "العميل" },
          "تم استلام الطلب",
          stamp,
        );
        raw.exec("COMMIT");
        return {
          order: hydrateOne(orderRow(orderId))!,
          created: true,
          conflict: false,
          accessToken,
        };
      } catch (error) {
        try {
          raw.exec("ROLLBACK");
        } catch {
          /* already rolled back */
        }
        throw error;
      }
    },
    getOrderByReference(reference, token) {
      const row = raw
        .prepare("SELECT * FROM orders WHERE reference = ?")
        .get(String(reference).trim().toUpperCase()) as OrderRow | undefined;
      if (!row || !token) return null;
      const expected = Buffer.from(row.access_hash, "utf8");
      const given = Buffer.from(sha256(String(token)), "utf8");
      if (expected.length !== given.length) return null;
      if (!timingSafeEqual(expected, given)) return null;
      return hydrateOne(row);
    },
    getOrder(id) {
      return hydrateOne(orderRow(id));
    },
    listOrders({ search = "", status = "", limit, offset }) {
      const clauses: string[] = [];
      const params: (string | number)[] = [];
      if (status) {
        clauses.push("status = ?");
        params.push(status);
      }
      const term = search.trim();
      if (term) {
        clauses.push(
          "(reference LIKE ? OR customer_name LIKE ? OR customer_phone LIKE ?)",
        );
        const like = `%${term.replace(/[%_]/g, (match) => `\\${match}`)}%`;
        params.push(like, like, like);
      }
      const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
      const total = Number(
        (
          raw
            .prepare(`SELECT COUNT(*) AS count FROM orders ${where}`)
            .get(...params) as { count: number }
        ).count,
      );
      const rows = raw
        .prepare(
          `SELECT * FROM orders ${where} ORDER BY id DESC LIMIT ? OFFSET ?`,
        )
        .all(...params, limit, offset) as OrderRow[];
      return { items: hydrateOrders(rows), total };
    },
    setOrderStatus(id, status, actor, note = "") {
      raw.exec("BEGIN IMMEDIATE");
      try {
        const row = orderRow(id);
        if (!row) throw new OrderRejected("items", "order-not-found");
        const from = row.status as OrderStatus;
        if (from === status) {
          raw.exec("COMMIT");
          return hydrateOne(row)!;
        }
        if (!canTransition(from, status))
          throw new InvalidStatusTransition(from, status);

        let stockHeld = Number(row.stock_held);
        // Cancelling returns whatever this order was holding — once.
        if (status === "cancelled" && stockHeld === 1) {
          const { content, revision } = contentInTx();
          const items = raw
            .prepare("SELECT * FROM order_items WHERE order_id = ?")
            .all(id) as OrderItemRow[];
          const back = new Map(
            items.map((item) => [Number(item.product_id), Number(item.quantity)]),
          );
          let changed = false;
          const products = content.products.map((product) => {
            const give = back.get(product.id);
            if (!give || product.quantity === null) return product;
            changed = true;
            return {
              ...product,
              quantity: Math.min(1_000_000, product.quantity + give),
            };
          });
          if (changed) writeStock({ ...content, products }, revision);
          stockHeld = 0;
        }

        const stamp = nowIso();
        raw
          .prepare(
            "UPDATE orders SET status = ?, stock_held = ?, updated_at = ? WHERE id = ?",
          )
          .run(status, stockHeld, stamp, id);
        appendOrderEvent(id, status, actor, note, stamp);
        raw.exec("COMMIT");
        return hydrateOne(orderRow(id))!;
      } catch (error) {
        try {
          raw.exec("ROLLBACK");
        } catch {
          /* already rolled back */
        }
        throw error;
      }
    },
    setOrderPayment(id, paymentStatus, actor) {
      const row = orderRow(id);
      if (!row) throw new OrderRejected("items", "order-not-found");
      const stamp = nowIso();
      raw
        .prepare("UPDATE orders SET payment_status = ?, updated_at = ? WHERE id = ?")
        .run(paymentStatus, stamp, id);
      appendOrderEvent(
        id,
        row.status as OrderStatus,
        actor,
        paymentStatus === "paid" ? "تم تحصيل المبلغ" : "تم وضع علامة غير مدفوع",
        stamp,
      );
      return hydrateOne(orderRow(id))!;
    },
    orderStats() {
      const rows = raw
        .prepare(
          `SELECT status, COUNT(*) AS count, SUM(total) AS sum FROM orders GROUP BY status`,
        )
        .all() as { status: string; count: number; sum: number | null }[];
      const byStatus = {
        pending: 0,
        confirmed: 0,
        preparing: 0,
        out_for_delivery: 0,
        delivered: 0,
        cancelled: 0,
      } as Record<OrderStatus, number>;
      let total = 0;
      let revenue = 0;
      let revenueDelivered = 0;
      for (const row of rows) {
        const status = row.status as OrderStatus;
        if (status in byStatus) byStatus[status] = Number(row.count);
        total += Number(row.count);
        if (status !== "cancelled") revenue += Number(row.sum ?? 0);
        if (status === "delivered") revenueDelivered += Number(row.sum ?? 0);
      }
      const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const last7Days = Number(
        (
          raw
            .prepare("SELECT COUNT(*) AS count FROM orders WHERE created_at >= ?")
            .get(since) as { count: number }
        ).count,
      );
      const bestSellers = (
        raw
          .prepare(
            `SELECT i.product_id AS productId, i.name AS name,
                    SUM(i.quantity) AS quantity, SUM(i.line_total) AS revenue
               FROM order_items i
               JOIN orders o ON o.id = i.order_id
              WHERE o.status <> 'cancelled'
              GROUP BY i.product_id
              ORDER BY quantity DESC
              LIMIT 5`,
          )
          .all() as {
          productId: number;
          name: string;
          quantity: number;
          revenue: number;
        }[]
      ).map((row) => ({
        productId: Number(row.productId),
        name: row.name,
        quantity: Number(row.quantity),
        revenue: round2(Number(row.revenue)),
      }));
      const counted = total - byStatus.cancelled;
      let currency = "";
      try {
        currency = getContent().commerce.currency;
      } catch {
        currency = "";
      }
      return {
        total,
        byStatus,
        revenue: round2(revenue),
        revenueDelivered: round2(revenueDelivered),
        last7Days,
        averageOrder: counted > 0 ? round2(revenue / counted) : 0,
        bestSellers,
        currency,
      };
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
