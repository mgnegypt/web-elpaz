// Cart state for the storefront.
//
// Honest about what this is: the basket lives in this browser's localStorage.
// It is a convenience, not a record — it is not shared between devices, it is
// not a reservation, and nothing in it is trusted. Every amount shown here is
// recomputed from the published catalogue with the same `priceOrder()` the
// server runs when the order is actually created.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  MAX_UNITS_PER_LINE,
  availableUnits,
  isPurchasable,
  priceOrder,
  type CartLineInput,
  type PricedOrder,
} from "../../shared/orders.ts";
import type { Product } from "../../shared/content.ts";
import { useContent } from "../content/ContentContext";

const STORAGE_KEY = "elbaz.cart.v1";

type StoredCart = { items: CartLineInput[]; zoneId: string };

const EMPTY: StoredCart = { items: [], zoneId: "" };

/** Reads the saved basket defensively: anything odd is dropped, never thrown. */
function readStored(): StoredCart {
  if (typeof window === "undefined") return EMPTY;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as Partial<StoredCart> | null;
    if (!parsed || !Array.isArray(parsed.items)) return EMPTY;
    const items: CartLineInput[] = [];
    for (const entry of parsed.items.slice(0, 40)) {
      const productId = Number((entry as CartLineInput)?.productId);
      const quantity = Math.floor(Number((entry as CartLineInput)?.quantity));
      if (!Number.isInteger(productId) || productId <= 0) continue;
      if (!Number.isFinite(quantity) || quantity < 1) continue;
      if (items.some((item) => item.productId === productId)) continue;
      items.push({
        productId,
        quantity: Math.min(MAX_UNITS_PER_LINE, quantity),
      });
    }
    return {
      items,
      zoneId: typeof parsed.zoneId === "string" ? parsed.zoneId.slice(0, 40) : "",
    };
  } catch {
    return EMPTY;
  }
}

type CartApi = {
  items: CartLineInput[];
  /** Live pricing against the published catalogue. */
  priced: PricedOrder;
  count: number;
  zoneId: string;
  setZoneId: (id: string) => void;
  /** Can the storefront sell at all right now? */
  canShop: boolean;
  ordersEnabled: boolean;
  isOpen: boolean;
  open: () => void;
  close: () => void;
  add: (product: Product, quantity?: number) => { ok: boolean; reason?: string };
  setQuantity: (productId: number, quantity: number) => void;
  remove: (productId: number) => void;
  clear: () => void;
  /** Drops every line the catalogue can no longer honour. */
  resolveProblems: () => void;
  quantityOf: (productId: number) => number;
};

const CartContext = createContext<CartApi | null>(null);

export function CartProvider({ children }: { children: ReactNode }) {
  const content = useContent();
  const [state, setState] = useState<StoredCart>(() => readStored());
  const [isOpen, setOpen] = useState(false);

  // Persist on every change, and follow changes made in another tab so two
  // open tabs do not fight over the same basket.
  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* private mode or a full quota: the cart simply will not survive a reload */
    }
  }, [state]);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key && event.key !== STORAGE_KEY) return;
      setState(readStored());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const priced = useMemo(
    () =>
      priceOrder(state.items, content.products, content.commerce, {
        deliveryZoneId: state.zoneId,
      }),
    [state.items, state.zoneId, content.products, content.commerce],
  );

  const add = useCallback<CartApi["add"]>(
    (product, quantity = 1) => {
      if (!content.commerce.ordersEnabled)
        return { ok: false, reason: "الطلب أونلاين غير مُفعَّل حاليًا." };
      if (!isPurchasable(product))
        return { ok: false, reason: "هذا المنتج غير متاح للشراء أونلاين." };
      const stock = availableUnits(product);
      let outcome: { ok: boolean; reason?: string } = { ok: true };
      setState((current) => {
        const existing = current.items.find(
          (item) => item.productId === product.id,
        );
        const wanted = (existing?.quantity ?? 0) + Math.max(1, Math.floor(quantity));
        const capped = Math.min(
          MAX_UNITS_PER_LINE,
          stock === null ? wanted : Math.min(wanted, stock),
        );
        if (existing && capped === existing.quantity) {
          outcome = {
            ok: false,
            reason:
              stock !== null
                ? `أقصى كمية متاحة: ${stock}`
                : `أقصى كمية للطلب: ${MAX_UNITS_PER_LINE}`,
          };
          return current;
        }
        const items = existing
          ? current.items.map((item) =>
              item.productId === product.id ? { ...item, quantity: capped } : item,
            )
          : [...current.items, { productId: product.id, quantity: capped }];
        return { ...current, items };
      });
      return outcome;
    },
    [content.commerce.ordersEnabled],
  );

  const setQuantity = useCallback<CartApi["setQuantity"]>(
    (productId, quantity) => {
      setState((current) => {
        const product = content.products.find((item) => item.id === productId);
        const stock = product ? availableUnits(product) : null;
        const next = Math.floor(quantity);
        if (!Number.isFinite(next) || next < 1)
          return {
            ...current,
            items: current.items.filter((item) => item.productId !== productId),
          };
        const capped = Math.min(
          MAX_UNITS_PER_LINE,
          stock === null ? next : Math.min(next, stock),
        );
        return {
          ...current,
          items: current.items.map((item) =>
            item.productId === productId
              ? { ...item, quantity: Math.max(1, capped) }
              : item,
          ),
        };
      });
    },
    [content.products],
  );

  const remove = useCallback<CartApi["remove"]>((productId) => {
    setState((current) => ({
      ...current,
      items: current.items.filter((item) => item.productId !== productId),
    }));
  }, []);

  const clear = useCallback(() => setState({ items: [], zoneId: "" }), []);

  const resolveProblems = useCallback(() => {
    setState((current) => {
      const next: CartLineInput[] = [];
      for (const item of current.items) {
        const problem = priced.problems.find(
          (candidate) => candidate.productId === item.productId,
        );
        if (!problem) {
          next.push(item);
          continue;
        }
        // A short stock problem keeps the line at whatever is still available.
        if (problem.reason === "insufficient-stock" && (problem.available ?? 0) > 0)
          next.push({ productId: item.productId, quantity: problem.available! });
      }
      return { ...current, items: next };
    });
  }, [priced.problems]);

  const setZoneId = useCallback((zoneId: string) => {
    setState((current) => ({ ...current, zoneId }));
  }, []);

  const value = useMemo<CartApi>(() => {
    const hasPriced = content.products.some((product) => isPurchasable(product));
    return {
      items: state.items,
      priced,
      count: priced.itemCount,
      zoneId: state.zoneId,
      setZoneId,
      ordersEnabled: content.commerce.ordersEnabled,
      canShop: content.commerce.ordersEnabled && hasPriced,
      isOpen,
      open: () => setOpen(true),
      close: () => setOpen(false),
      add,
      setQuantity,
      remove,
      clear,
      resolveProblems,
      quantityOf: (productId: number) =>
        state.items.find((item) => item.productId === productId)?.quantity ?? 0,
    };
  }, [
    state.items,
    state.zoneId,
    priced,
    isOpen,
    content.products,
    content.commerce.ordersEnabled,
    add,
    setQuantity,
    remove,
    clear,
    resolveProblems,
    setZoneId,
  ]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartApi {
  const value = useContext(CartContext);
  if (!value) throw new Error("useCart must be used inside <CartProvider>");
  return value;
}
