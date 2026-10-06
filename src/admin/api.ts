import type { Content, ContentDoc, RequestStatus } from "../../shared/content.ts";

export type AdminSession = { authenticated: true; username: string; csrf: string };
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
  const headers: Record<string, string> = {
    accept: "application/json",
    ...((init.headers as Record<string, string>) ?? {}),
  };
  if (init.body) headers["content-type"] = "application/json";
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
  status: () =>
    call<{ needsSetup: boolean; setupAvailable: boolean }>("/api/admin/status"),
  setup: (token: string, username: string, password: string) =>
    call<{ ok: true; username: string; csrf: string }>("/api/admin/setup", {
      method: "POST",
      body: JSON.stringify({ token, username, password }),
    }),
  login: (username: string, password: string) =>
    call<{ ok: true; username: string; csrf: string }>("/api/admin/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    }),
  logout: () => call<{ ok: true }>("/api/admin/logout", { method: "POST" }),
  session: () => call<AdminSession>("/api/admin/session"),

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
  updateProduct: (id: number, product: Record<string, unknown>, revision: number) =>
    call<{ ok: true; revision: number; product: Content["products"][number] }>(
      `/api/admin/products/${id}`,
      { method: "PUT", body: JSON.stringify({ product, revision }) },
    ),
  deleteProduct: (id: number, revision: number) =>
    call<{ ok: true; revision: number }>(`/api/admin/products/${id}`, {
      method: "DELETE",
      body: JSON.stringify({ revision }),
    }),
};

export const conflictRevision = (error: unknown): ContentDoc | null => {
  if (error instanceof ApiFailure && error.status === 409) {
    const current = (error.payload as { current?: ContentDoc } | null)?.current;
    return current ?? null;
  }
  return null;
};
