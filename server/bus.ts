// Server-Sent Events hub: pushes a ping to every connected browser whenever the
// published content, events or availability change, so the public site updates
// without a manual refresh.
import type { Response } from "express";

export type StreamMessage =
  | { type: "content"; revision: number }
  | { type: "events" }
  | { type: "hello" };

type Client = { id: number; res: Response };

export function createStreamHub() {
  const clients = new Set<Client>();
  let nextId = 1;
  let heartbeat: ReturnType<typeof setInterval> | undefined;

  const write = (client: Client, message: StreamMessage) => {
    try {
      client.res.write(`event: message\ndata: ${JSON.stringify(message)}\n\n`);
    } catch {
      clients.delete(client);
    }
  };

  const broadcast = (message: StreamMessage) => {
    for (const client of clients) write(client, message);
  };

  return {
    size: () => clients.size,
    add(res: Response) {
      const client: Client = { id: nextId++, res };
      clients.add(client);
      res.write(`retry: 3000\n\n`);
      write(client, { type: "hello" });
      if (!heartbeat) {
        // Keeps proxies from closing an idle connection.
        heartbeat = setInterval(() => {
          for (const item of clients) {
            try {
              item.res.write(`: ping\n\n`);
            } catch {
              clients.delete(item);
            }
          }
        }, 25_000);
        heartbeat.unref?.();
      }
      return () => {
        clients.delete(client);
      };
    },
    broadcast,
    closeAll() {
      if (heartbeat) clearInterval(heartbeat);
      heartbeat = undefined;
      for (const client of clients) {
        try {
          client.res.end();
        } catch {
          /* already gone */
        }
      }
      clients.clear();
    },
  };
}

export type StreamHub = ReturnType<typeof createStreamHub>;
