// Thin fetch wrappers. The browser only ever uses relative /api/... URLs;
// Vite proxies them to Express in dev and Express serves them in production.
import type { SiteEvent } from "../../shared/content.ts";

export type ContentResponse = Record<string, unknown> & {
  revision: number;
  events?: SiteEvent[];
};

async function json<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, {
    credentials: "same-origin",
    headers: { accept: "application/json", ...(init?.headers ?? {}) },
    ...init,
  });
  const text = await response.text();
  let payload: unknown = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }
  if (!response.ok) {
    const error = new Error(
      (payload as { error?: string } | null)?.error ?? `http-${response.status}`,
    ) as Error & { status: number; payload: unknown };
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload as T;
}

export const fetchContent = (signal?: AbortSignal) =>
  json<ContentResponse>("/api/content", { signal });

export const fetchHealth = () => json<{ ok: boolean }>("/api/health");

export type WholesalePayload = {
  name: string;
  contact: string;
  product: string;
  unit: string;
  quantity: number;
  notes?: string;
  consent: true;
  requestKey: string;
  honeypot?: string;
};

export type WholesaleResult = {
  ok: boolean;
  saved: boolean;
  duplicate: boolean;
  id: number;
  status: string;
};

export async function submitWholesaleRequest(payload: WholesalePayload) {
  return json<WholesaleResult>("/api/wholesale-requests", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

/** Stable idempotency key so a double-tap never creates two records. */
export function newRequestKey() {
  try {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  } catch {
    /* fall through */
  }
  return `k${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}
