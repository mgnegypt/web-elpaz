// A very small router.
//
// The site is a single-screen experience with its own section navigation, so a
// routing library would be weight without benefit. Checkout and order pages do
// need real URLs — back button, refresh, a link a customer can keep — and that
// is exactly what the History API gives us.
import { useEffect, useState } from "react";

export type Route = { path: string; query: URLSearchParams };

const read = (): Route => ({
  path: window.location.pathname.replace(/\/+$/, "") || "/",
  query: new URLSearchParams(window.location.search),
});

export function navigate(to: string, options: { replace?: boolean } = {}) {
  if (options.replace) window.history.replaceState({}, "", to);
  else window.history.pushState({}, "", to);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(read);
  useEffect(() => {
    const sync = () => setRoute(read());
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);
  return route;
}

/** Keeps private pages out of search results, and restores the tag on exit. */
export function useNoIndex(active = true) {
  useEffect(() => {
    if (!active) return;
    const tag = document.createElement("meta");
    tag.name = "robots";
    tag.content = "noindex, nofollow";
    document.head.appendChild(tag);
    return () => {
      tag.remove();
    };
  }, [active]);
}

/** Sets the document title for a page, restoring the previous one on unmount. */
export function usePageTitle(title: string) {
  useEffect(() => {
    const previous = document.title;
    document.title = title;
    return () => {
      document.title = previous;
    };
  }, [title]);
}
