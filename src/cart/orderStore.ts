// Remembers, in this browser only, which orders were placed from it.
//
// This is a convenience so a customer can reopen their receipt without digging
// the link out of their messages. It is not an account and not a source of
// truth: clearing the browser data loses it, and another device never sees it.
// The order itself always lives on the server.
const KEY = "elbaz.orders.v1";
const MAX = 20;

export type SavedOrder = {
  reference: string;
  /** The access token from creation; without it the order cannot be opened. */
  token: string;
  at: string;
  total: number;
  currency: string;
};

export function savedOrders(): SavedOrder[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(KEY) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (entry): entry is SavedOrder =>
          !!entry &&
          typeof entry.reference === "string" &&
          typeof entry.token === "string",
      )
      .slice(0, MAX);
  } catch {
    return [];
  }
}

export function rememberOrder(order: SavedOrder) {
  try {
    const next = [
      order,
      ...savedOrders().filter((entry) => entry.reference !== order.reference),
    ].slice(0, MAX);
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* private mode: the customer still has the link we showed them */
  }
}

export const tokenFor = (reference: string) =>
  savedOrders().find((entry) => entry.reference === reference)?.token ?? "";
