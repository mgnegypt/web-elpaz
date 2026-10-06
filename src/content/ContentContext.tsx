import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { DEFAULT_CONTENT, type Content } from "../../shared/content.ts";
import { fetchContent, type ContentResponse } from "../lib/api";

export type ContentSource = "server" | "fallback";

type ContentState = {
  content: Content;
  revision: number;
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
  }>({ content: DEFAULT_CONTENT, revision: 0, source: "fallback", ready: false });

  const refresh = useCallback(async () => {
    try {
      const document_ = (await fetchContent()) as ContentResponse;
      setState({
        content: document_ as unknown as Content,
        revision: document_.revision,
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
    // Public visitors get fresh content when they come back to the tab.
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
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
