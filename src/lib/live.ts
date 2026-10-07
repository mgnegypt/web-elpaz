// Server-sent events: the public site subscribes once and re-reads content when
// the dashboard publishes something. Reconnects quietly; no polling loop.
type Listener = () => void;

const listeners = new Set<Listener>();
let source: EventSource | null = null;
let retry = 0;
let timer: number | undefined;

const emit = () => {
  for (const listener of listeners) listener();
};

const connect = () => {
  if (source || listeners.size === 0) return;
  source = new EventSource("/api/stream", { withCredentials: true });
  source.addEventListener("open", () => {
    retry = 0;
    emit();
  });
  source.addEventListener("message", (event) => {
    try {
      const data = JSON.parse((event as MessageEvent).data) as { type?: string };
      if (data.type && data.type !== "hello") emit();
    } catch {
      /* ignore malformed frames */
    }
  });
  source.addEventListener("error", () => {
    source?.close();
    source = null;
    if (listeners.size === 0) return;
    retry += 1;
    timer = window.setTimeout(connect, Math.min(20_000, 1000 * 2 ** Math.min(retry, 4)));
  });
};

/** Subscribes to content changes; returns the unsubscribe function. */
export function subscribeContentStream(listener: Listener): () => void {
  listeners.add(listener);
  if (timer) {
    window.clearTimeout(timer);
    timer = undefined;
  }
  connect();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      source?.close();
      source = null;
    }
  };
}
