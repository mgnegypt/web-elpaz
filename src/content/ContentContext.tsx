import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  DEFAULT_CONTENT,
  contentSchema,
  type Content,
  type SiteEvent,
} from "../../shared/content.ts";
import { fetchContent } from "../lib/api";
import { subscribeContentStream } from "../lib/live";
import { readContentCache, writeContentCache } from "./contentCache";

/**
 * Where the document on screen came from.
 *
 * - `server`   — a validated response from this session.
 * - `cache`    — the last validated document this browser saw (localStorage).
 * - `fallback` — the bundled defaults: nothing better has ever been loaded.
 */
export type ContentSource = "server" | "cache" | "fallback";
export type ContentStatus = "loading" | "ready" | "error";

type ContentState = {
  content: Content;
  revision: number;
  /** Events published from the dashboard, newest first. */
  events: SiteEvent[];
  source: ContentSource;
  status: ContentStatus;
  /** True once the first load attempt has settled (success or failure). */
  ready: boolean;
  /** Set when the most recent attempt failed; cleared by a success. */
  error: string;
  /** ISO timestamp of the last successful load in this session. */
  lastLoadedAt: string;
  refresh: () => Promise<void>;
};

const ContentContext = createContext<ContentState | null>(null);

/** A single load attempt must never hang forever behind a dead connection. */
const REQUEST_TIMEOUT_MS = 12_000;
/** Backoff for retries after a failed load: 2s, 4s, 8s, 16s, 30s, 30s… */
const RETRY_DELAYS_MS = [2000, 4000, 8000, 16_000, 30_000];

type Snapshot = {
  content: Content;
  revision: number;
  events: SiteEvent[];
};

/**
 * Validates an API payload before it is allowed anywhere near the screen.
 *
 * A truncated, empty or half-written response must never replace a document
 * the visitor already has, so anything that does not satisfy the shared schema
 * is rejected outright rather than merged.
 */
export function parseContentResponse(payload: unknown): Snapshot | null {
  if (!payload || typeof payload !== "object") return null;
  const raw = payload as Record<string, unknown>;
  const revision = Number(raw.revision);
  if (!Number.isInteger(revision) || revision < 1) return null;
  const parsed = contentSchema.safeParse(raw);
  if (!parsed.success) return null;
  const events = Array.isArray(raw.events) ? (raw.events as SiteEvent[]) : [];
  return { content: parsed.data, revision, events };
}

export function ContentProvider({
  children,
  autoRefresh = true,
}: {
  children: React.ReactNode;
  /** The admin dashboard keeps its own draft state and must not refresh behind the editor. */
  autoRefresh?: boolean;
}) {
  // Start from the last document this browser successfully loaded, so a repeat
  // visitor never sees the bundled demo content flash before the API answers.
  const [state, setState] = useState<Omit<ContentState, "refresh">>(() => {
    const cached = readContentCache();
    return {
      content: cached?.content ?? DEFAULT_CONTENT,
      revision: cached?.revision ?? 0,
      events: cached?.events ?? [],
      source: cached ? "cache" : "fallback",
      status: "loading",
      ready: false,
      error: "",
      lastLoadedAt: "",
    };
  });

  /** Guards against out-of-order responses: only the newest attempt may win. */
  const attemptRef = useRef(0);
  const inFlightRef = useRef<Promise<void> | null>(null);
  const retryRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const mountedRef = useRef(true);
  /** Always points at the current `refresh`, so the retry timer stays stable. */
  const refreshRef = useRef<() => Promise<void>>(async () => {});

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      clearTimeout(retryTimerRef.current);
    };
  }, []);

  const load = useCallback(async () => {
    const attempt = (attemptRef.current += 1);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const payload = await fetchContent(controller.signal);
      const snapshot = parseContentResponse(payload);
      // A newer attempt already finished: drop this (older) answer.
      if (attempt !== attemptRef.current || !mountedRef.current) return;
      if (!snapshot) throw new Error("invalid-content");
      setState((previous) => {
        // Never travel backwards: an older revision arriving late (a stale
        // proxy copy, a slow retry) must not undo what is already on screen.
        if (previous.source !== "fallback" && snapshot.revision < previous.revision) {
          return { ...previous, status: "ready", ready: true, error: "" };
        }
        return {
          content: snapshot.content,
          revision: snapshot.revision,
          events: snapshot.events,
          source: "server",
          status: "ready",
          ready: true,
          error: "",
          lastLoadedAt: new Date().toISOString(),
        };
      });
      writeContentCache(snapshot);
      retryRef.current = 0;
    } catch (error) {
      if (attempt !== attemptRef.current || !mountedRef.current) return;
      // Keep whatever valid document is already on screen. The bundled
      // defaults are only ever shown when nothing better has arrived yet.
      setState((previous) => ({
        ...previous,
        status: "error",
        ready: true,
        error: error instanceof Error ? error.message : "network",
      }));
      // Bounded backoff, not polling: it stops as soon as one attempt works.
      const delay = RETRY_DELAYS_MS[Math.min(retryRef.current, RETRY_DELAYS_MS.length - 1)];
      retryRef.current += 1;
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = setTimeout(() => {
        void refreshRef.current();
      }, delay);
    } finally {
      clearTimeout(timeout);
    }
  }, []);

  /**
   * Single-flight: concurrent triggers (stream frame, tab focus, retry timer)
   * share one request instead of racing each other.
   */
  const refresh = useCallback(async () => {
    if (inFlightRef.current) return inFlightRef.current;
    const run = load().finally(() => {
      inFlightRef.current = null;
    });
    inFlightRef.current = run;
    return run;
  }, [load]);

  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!autoRefresh) return;
    // Publishing in the dashboard reaches the site within a moment: the server
    // pushes a frame and we re-read the document (no polling, no manual reload).
    const stopStream = subscribeContentStream(() => void refresh());
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const onOnline = () => void refresh();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    window.addEventListener("online", onOnline);
    return () => {
      stopStream();
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      window.removeEventListener("online", onOnline);
    };
  }, [autoRefresh, refresh]);

  const value = useMemo<ContentState>(() => ({ ...state, refresh }), [state, refresh]);

  return <ContentContext.Provider value={value}>{children}</ContentContext.Provider>;
}

export function useContentState() {
  const context = useContext(ContentContext);
  if (!context) throw new Error("useContentState must be used inside <ContentProvider>");
  return context;
}

/** The published content document (last known good copy while offline). */
export function useContent(): Content {
  return useContentState().content;
}

/** Events the dashboard marked as visible (the server only sends active ones). */
export function useEvents(): SiteEvent[] {
  return useContentState().events;
}
