// Last-known-good content, kept in localStorage.
//
// Why: the first paint happens before /api/content can possibly answer. Without
// a cache the visitor sees the content bundled into the JavaScript — the demo
// products, the old logo — until the request lands, and keeps seeing it for the
// whole visit if the request fails. Re-using the previous validated document
// removes that window entirely and makes an API outage invisible to returning
// visitors, while the background refresh still decides what is current.
import { contentSchema, type Content, type SiteEvent } from "../../shared/content.ts";

const KEY = "elbaz-content-cache";
/** Bumped whenever the cache layout changes, so old entries are ignored. */
const CACHE_VERSION = 1;

export type CachedContent = {
  content: Content;
  revision: number;
  events: SiteEvent[];
  savedAt: string;
};

/**
 * Reads the cached document. Anything unexpected (missing, corrupt, written by
 * an older build, failing the current schema) is discarded rather than shown:
 * a bad cache must never be able to break the site.
 */
export function readContentCache(): CachedContent | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (Number(parsed.version) !== CACHE_VERSION) return null;
    const revision = Number(parsed.revision);
    if (!Number.isInteger(revision) || revision < 1) return null;
    const content = contentSchema.safeParse(parsed.content);
    if (!content.success) return null;
    return {
      content: content.data,
      revision,
      events: Array.isArray(parsed.events) ? (parsed.events as SiteEvent[]) : [],
      savedAt: typeof parsed.savedAt === "string" ? parsed.savedAt : "",
    };
  } catch {
    // Private mode, disabled storage, quota errors: the site works without it.
    return null;
  }
}

/** Stores a validated document; never throws (private mode, quota, SSR). */
export function writeContentCache(snapshot: {
  content: Content;
  revision: number;
  events: SiteEvent[];
}): void {
  try {
    const existing = readContentCache();
    // Only ever move forward, so a late answer cannot downgrade the cache.
    if (existing && existing.revision > snapshot.revision) return;
    localStorage.setItem(
      KEY,
      JSON.stringify({
        version: CACHE_VERSION,
        revision: snapshot.revision,
        content: snapshot.content,
        events: snapshot.events,
        savedAt: new Date().toISOString(),
      }),
    );
  } catch {
    /* storage unavailable — the site still works, it just re-fetches */
  }
}

export function clearContentCache(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
