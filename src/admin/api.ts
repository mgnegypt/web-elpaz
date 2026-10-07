// Typed client for the dashboard. Every mutating call carries the per-session
// CSRF token; cookies stay HttpOnly and are never touched from JavaScript.
import type {
  Content,
  ContentDoc,
  RequestStatus,
  Role,
  SiteEvent,
} from "../../shared/content.ts";

export type AdminSessionBase = {
  id: number;
  username: string;
  email: string;
  displayName: string;
  avatarUrl: string;
  role: Role;
  hasSecurityQuestion: boolean;
  mustCompleteProfile: boolean;
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string;
  session: {
    createdAt: string;
    expiresAt: string;
    ip: string;
    userAgent: string;
    securityVerified: boolean;
  };
};

export type AdminSession = AdminSessionBase & {
  authenticated: true;
  capabilities: { manageAdmins: boolean };
  csrf: string;
};

/** The session exists but the security question has not been answered yet. */
export type PendingSession = {
  authenticated: false;
  requiresSecurityAnswer: true;
  question: string;
  csrf: string;
};

export type AdminProfile = AdminSessionBase & { securityQuestion: string };

export type AdminAccount = {
  id: number;
  username: string;
  email: string;
  displayName: string;
  avatarUrl: string;
  role: Role;
  hasSecurityQuestion: boolean;
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string;
};

export type AdminRequest = {
  id: number;
  name: string;
  contact: string;
  product: string;
  unit: string;
  quantity: number;
  notes: string;
  status: RequestStatus;
  createdAt: string;
  updatedAt: string;
};

export type RequestsPage = {
  items: AdminRequest[];
  total: number;
  page: number;
  pageSize: number;
  pages: number;
};

export type AuditEntry = {
  id: number;
  at: string;
  kind: string;
  actorId: number | null;
  actorName: string;
  ip: string;
  detail: string;
  suspicious: boolean;
};

export type AuditSummary = {
  total: number;
  suspicious: number;
  last24h: number;
  kinds: { kind: string; count: number }[];
};

export type StoredUpload = {
  url: string;
  filename: string;
  mime: string;
  size: number;
  originalName: string;
};

export class ApiFailure extends Error {
  status: number;
  payload: unknown;
  constructor(status: number, payload: unknown) {
    super((payload as { error?: string } | null)?.error ?? `http-${status}`);
    this.name = "ApiFailure";
    this.status = status;
    this.payload = payload;
  }
}

let csrfToken = "";

export const setCsrfToken = (token: string) => {
  csrfToken = token;
};

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const method = (init.method ?? "GET").toUpperCase();
  const isForm = init.body instanceof FormData;
  const headers: Record<string, string> = {
    accept: "application/json",
    ...((init.headers as Record<string, string>) ?? {}),
  };
  if (init.body && !isForm) headers["content-type"] = "application/json";
  // Every mutating admin call carries the per-session CSRF token.
  if (method !== "GET" && csrfToken) headers["x-csrf-token"] = csrfToken;
  const response = await fetch(path, {
    credentials: "same-origin",
    ...init,
    method,
    headers,
  });
  const text = await response.text();
  let payload: unknown = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }
  if (!response.ok) throw new ApiFailure(response.status, payload);
  return payload as T;
}

export const adminApi = {
  audit: (
    options: { limit?: number; kind?: string; suspicious?: boolean } = {},
  ) => {
    const params = new URLSearchParams();
    if (options.limit) params.set("limit", String(options.limit));
    if (options.kind) params.set("kind", options.kind);
    if (options.suspicious) params.set("suspicious", "1");
    const query = params.toString();
    return call<{ items: AuditEntry[]; summary: AuditSummary }>(
      `/api/admin/admins/audit${query ? `?${query}` : ""}`,
    );
  },
  status: () =>
    call<{ needsSetup: boolean; setupAvailable: boolean }>("/api/admin/status"),
  setup: (token: string, username: string, password: string) =>
    call<{
      ok: true;
      username: string;
      role: Role;
      mustCompleteProfile: boolean;
      csrf: string;
    }>("/api/admin/setup", {
      method: "POST",
      body: JSON.stringify({ token, username, password }),
    }),
  login: (identifier: string, password: string) =>
    call<
      | {
          ok: true;
          requiresSecurityAnswer: true;
          question: string;
          pendingCsrf: string;
        }
      | (Omit<AdminSession, "capabilities"> & { requiresSecurityAnswer: false })
    >("/api/admin/login", {
      method: "POST",
      body: JSON.stringify({ identifier, password }),
    }),
  loginSecurity: (answer: string) =>
    call<{ ok: true; displayName: string; role: Role; csrf: string }>(
      "/api/admin/login/security",
      { method: "POST", body: JSON.stringify({ answer }) },
    ),
  logout: () => call<{ ok: true }>("/api/admin/logout", { method: "POST" }),
  session: () => call<AdminSession | PendingSession>("/api/admin/session"),

  // ---- own profile -------------------------------------------------------
  profile: () => call<AdminProfile>("/api/admin/profile"),
  completeProfile: (input: {
    displayName: string;
    email: string;
    password: string;
    securityQuestion: string;
    securityAnswer: string;
  }) =>
    call<{ ok: true; mustRelogin: boolean }>("/api/admin/profile/complete", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  updateProfile: (input: {
    displayName: string;
    email: string;
    avatarUrl: string;
  }) =>
    call<{ ok: true; profile: AdminProfile }>("/api/admin/profile", {
      method: "PUT",
      body: JSON.stringify(input),
    }),
  changePassword: (input: { currentPassword: string; newPassword: string }) =>
    call<{ ok: true }>("/api/admin/profile/password", {
      method: "PUT",
      body: JSON.stringify(input),
    }),
  changeSecurity: (input: {
    securityQuestion: string;
    securityAnswer: string;
    currentAnswer: string;
  }) =>
    call<{ ok: true; profile: AdminProfile }>("/api/admin/profile/security", {
      method: "PUT",
      body: JSON.stringify(input),
    }),

  // ---- accounts (Owner only; the server enforces it) ---------------------
  admins: () => call<{ items: AdminAccount[] }>("/api/admin/admins"),
  createAdmin: (input: {
    username: string;
    displayName: string;
    email: string;
    password: string;
    role: Role;
  }) =>
    call<{ ok: true; admin: AdminAccount }>("/api/admin/admins", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  updateAdmin: (
    id: number,
    input: {
      username: string;
      displayName: string;
      email: string;
      avatarUrl: string;
      role: Role;
      password?: string;
    },
  ) =>
    call<{ ok: true; admin: AdminAccount }>(`/api/admin/admins/${id}`, {
      method: "PUT",
      body: JSON.stringify(input),
    }),
  deleteAdmin: (id: number) =>
    call<{ ok: true; deleted: number }>(`/api/admin/admins/${id}`, {
      method: "DELETE",
    }),

  // ---- uploads -----------------------------------------------------------
  upload: (file: File) => {
    const body = new FormData();
    body.append("file", file);
    return call<{ ok: true; upload: StoredUpload }>("/api/admin/uploads", {
      method: "POST",
      body,
    });
  },

  // ---- events ------------------------------------------------------------
  events: () => call<{ items: SiteEvent[] }>("/api/admin/events"),
  createEvent: (input: EventPayload) =>
    call<{ ok: true; event: SiteEvent }>("/api/admin/events", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  updateEvent: (id: number, input: EventPayload) =>
    call<{ ok: true; event: SiteEvent }>(`/api/admin/events/${id}`, {
      method: "PUT",
      body: JSON.stringify(input),
    }),
  deleteEvent: (id: number) =>
    call<{ ok: true; deleted: number }>(`/api/admin/events/${id}`, {
      method: "DELETE",
    }),

  // ---- requests ----------------------------------------------------------
  requests: (params: { search: string; status: string; page: number }) => {
    const query = new URLSearchParams({
      search: params.search,
      status: params.status,
      page: String(params.page),
    });
    return call<RequestsPage>(`/api/admin/requests?${query}`);
  },
  setRequestStatus: (id: number, status: RequestStatus) =>
    call<{ ok: true; request: AdminRequest }>(`/api/admin/requests/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    }),
  deleteRequest: (id: number) =>
    call<{ ok: true; deleted: number }>(`/api/admin/requests/${id}`, {
      method: "DELETE",
    }),

  // ---- content -----------------------------------------------------------
  content: () => call<ContentDoc>("/api/admin/content"),
  saveContent: (content: Content, revision: number) =>
    call<ContentDoc>("/api/admin/content", {
      method: "PUT",
      body: JSON.stringify({ ...content, revision }),
    }),
  createProduct: (product: Record<string, unknown>, revision: number) =>
    call<{ ok: true; revision: number; product: Content["products"][number] }>(
      "/api/admin/products",
      { method: "POST", body: JSON.stringify({ product, revision }) },
    ),
  updateProduct: (
    id: number,
    product: Record<string, unknown>,
    revision: number,
  ) =>
    call<{ ok: true; revision: number; product: Content["products"][number] }>(
      `/api/admin/products/${id}`,
      { method: "PUT", body: JSON.stringify({ product, revision }) },
    ),
  deleteProduct: (id: number, revision: number) =>
    call<{ ok: true; revision: number; products: Content["products"] }>(
      `/api/admin/products/${id}`,
      { method: "DELETE", body: JSON.stringify({ revision }) },
    ),
};

export type { SiteEvent };

export type EventPayload = {
  title: string;
  description: string;
  type: string;
  imageUrl: string;
  startAt: string;
  endAt: string;
  active: boolean;
};

export const conflictRevision = (error: unknown): ContentDoc | null => {
  if (error instanceof ApiFailure && error.status === 409) {
    const current = (error.payload as { current?: ContentDoc } | null)?.current;
    return current ?? null;
  }
  return null;
};

/**
 * Live updates: the server pushes a frame whenever published content, events or
 * requests change, and the caller re-reads what it needs. Reconnects with
 * backoff, and a slow poll keeps the dashboard correct if SSE is unavailable.
 */
export function subscribeLive(
  onEvent: (type: string) => void,
  onStatus?: (online: boolean) => void,
): () => void {
  let closed = false;
  let source: EventSource | null = null;
  let retry = 0;
  let timer: number | undefined;

  const connect = () => {
    if (closed) return;
    source = new EventSource("/api/stream", { withCredentials: true });
    source.addEventListener("open", () => {
      retry = 0;
      onStatus?.(true);
    });
    source.addEventListener("message", (event) => {
      try {
        const data = JSON.parse((event as MessageEvent).data) as {
          type?: string;
        };
        if (data.type && data.type !== "hello") onEvent(data.type);
      } catch {
        /* ignore malformed frames */
      }
    });
    source.addEventListener("error", () => {
      onStatus?.(false);
      source?.close();
      source = null;
      if (closed) return;
      retry += 1;
      // Exponential backoff, capped at 15s, so a restarted server is picked up quickly.
      timer = window.setTimeout(
        connect,
        Math.min(15_000, 1000 * 2 ** Math.min(retry, 4)),
      );
    });
  };

  connect();

  const onVisible = () => {
    if (document.visibilityState === "visible") onEvent("resync");
  };
  document.addEventListener("visibilitychange", onVisible);

  return () => {
    closed = true;
    if (timer) window.clearTimeout(timer);
    document.removeEventListener("visibilitychange", onVisible);
    source?.close();
  };
}
