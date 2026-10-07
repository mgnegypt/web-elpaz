import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { DEFAULT_CONTENT, type Content, type SiteEvent } from "../../shared/content.ts";
import { fetchContent, type ContentResponse } from "../lib/api";
import { subscribeContentStream } from "../lib/live";

export type ContentSource = "server" | "fallback";

type ContentState = {
  content: Content;
  revision: number;
  /** Events published from the dashboard, newest first. */
  events: SiteEvent[];
  /** "fallback" means the API was unreachable and the bundled defaults are on screen. */
  source: ContentSource;
  ready: boolean;
  refresh: () => Promise<void>;
};

const ContentContext = createContext<ContentState | null>(null);

export function ContentProvider({
  children,
  autoRefresh = true,
}: {
  children: React.ReactNode;
  /** The admin dashboard keeps its own draft state and must not refresh behind the editor. */
  autoRefresh?: boolean;
}) {
  const [state, setState] = useState<{
    content: Content;
    revision: number;
    source: ContentSource;
    ready: boolean;
    events: SiteEvent[];
  }>({ content: DEFAULT_CONTENT, revision: 0, source: "fallback", ready: false, events: [] });

  const refresh = useCallback(async () => {
    try {
      const document_ = (await fetchContent()) as ContentResponse;
      setState({
        content: document_ as unknown as Content,
        revision: document_.revision,
        events: document_.events ?? [],
        source: "server",
        ready: true,
      });
    } catch {
      // Backend unavailable: keep showing the bundled defaults rather than an empty page.
      setState((previous) => ({ ...previous, ready: true }));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!autoRefresh) return;
    // Publishing in the dashboard reaches the site within a moment: the server
    // pushes a frame and we re-read the document (no manual refresh needed).
    const stopStream = subscribeContentStream(() => void refresh());
    // Belt and braces for older browsers or a dropped stream.
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      stopStream();
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [autoRefresh, refresh]);

  const value = useMemo<ContentState>(
    () => ({ ...state, refresh }),
    [state, refresh],
  );

  return <ContentContext.Provider value={value}>{children}</ContentContext.Provider>;
}

export function useContentState() {
  const context = useContext(ContentContext);
  if (!context) throw new Error("useContentState must be used inside <ContentProvider>");
  return context;
}

/** The published content document, falling back to the bundled defaults when offline. */
export function useContent(): Content {
  return useContentState().content;
}

/** Events the dashboard marked as visible (the server only sends active ones). */
export function useEvents(): SiteEvent[] {
  return useContentState().events;
}
