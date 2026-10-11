// Order contract shared by the Express backend, the storefront and the dashboard.
//
// Every number a customer sees — line totals, discounts, delivery, the amount
// due — is produced by `priceOrder()` in this file. The browser uses it to show
// a cart, and the server uses the very same function to price the order it
// stores, so the two can never disagree. The client's own prices are never
// trusted: `priceOrder` always reads the product catalogue it is handed.
import { z } from "zod";
import type { Commerce, Product } from "./content.ts";

/* ----------------------------------------------------------------- status */

export const ORDER_STATUSES = [
  "pending",
  "confirmed",
  "preparing",
  "out_for_delivery",
  "delivered",
  "cancelled",
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  pending: "بانتظار التأكيد",
  confirmed: "تم التأكيد",
  preparing: "جاري التجهيز",
  out_for_delivery: "خرج للتوصيل",
  delivered: "تم التسليم",
  cancelled: "ملغي",
};

/** What the customer reads under each step of the timeline. */
export const ORDER_STATUS_HINTS: Record<OrderStatus, string> = {
  pending: "استلمنا طلبك وسنتصل بك لتأكيده.",
  confirmed: "تم تأكيد الطلب وسيدخل التجهيز.",
  preparing: "جاري تجهيز طلبك من المصنع.",
  out_for_delivery: "الطلب مع المندوب في الطريق إليك.",
  delivered: "تم تسليم الطلب. شكرًا لثقتك.",
  cancelled: "تم إلغاء هذا الطلب.",
};

/** The happy path, in order — used to draw the customer's progress timeline. */
export const ORDER_STATUS_FLOW: OrderStatus[] = [
  "pending",
  "confirmed",
  "preparing",
  "out_for_delivery",
  "delivered",
];

/**
 * Which moves an administrator may make. Deliberately one-way: an order never
 * walks backwards, and a delivered or cancelled order is final. Keeping this
 * here (not in the panel) means the server enforces exactly what the UI offers.
 */
export const ORDER_STATUS_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  pending: ["confirmed", "cancelled"],
  confirmed: ["preparing", "cancelled"],
  preparing: ["out_for_delivery", "cancelled"],
  out_for_delivery: ["delivered", "cancelled"],
  delivered: [],
  cancelled: [],
};

export const canTransition = (from: OrderStatus, to: OrderStatus) =>
  ORDER_STATUS_TRANSITIONS[from]?.includes(to) ?? false;

/** Statuses that still hold stock reserved; cancelling one returns the stock. */
export const HOLDS_STOCK: OrderStatus[] = [
  "pending",
  "confirmed",
  "preparing",
  "out_for_delivery",
  "delivered",
];

/* ---------------------------------------------------------------- payment */

export const PAYMENT_METHODS = ["cod", "on_confirmation"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cod: "الدفع عند الاستلام",
  on_confirmation: "يُتفق عليه عند تأكيد الطلب",
};

export const PAYMENT_STATUS_LABELS = {
  unpaid: "لم يُدفع بعد",
  paid: "مدفوع",
} as const;
export type PaymentStatus = keyof typeof PAYMENT_STATUS_LABELS;

/* ------------------------------------------------------------------ money */

/** Money is kept to two decimals everywhere: one rounding rule, one result. */
export const round2 = (value: number) => Math.round(value * 100) / 100;

/**
 * Money, written the way the rest of the site writes numbers: Arabic text with
 * Latin digits (`1,250 ج.م`). Mixing Arabic-Indic digits into prices next to
 * Latin quantities and phone numbers makes totals harder to scan, so one digit
 * system is used everywhere.
 */
export const formatMoney = (value: number, currency = "ج.م") =>
  `${new Intl.NumberFormat("ar-EG-u-nu-latn", {
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(value)} ${currency}`;

/** A product can be bought online only once the owner has given it a price. */
export const isPurchasable = (
  product: Pick<Product, "price" | "availability" | "quantity">,
) =>
  product.price !== null &&
  product.price > 0 &&
  product.availability !== "coming_soon" &&
  product.quantity !== 0;

/** The price actually charged after the product's own discount percentage. */
export const unitPriceOf = (
  product: Pick<Product, "price" | "discountPercent">,
) => {
  const base = product.price ?? 0;
  if (!product.discountPercent) return round2(base);
  return round2(base * (1 - product.discountPercent / 100));
};

/** How many units of a product a customer may still add. null = untracked. */
export const availableUnits = (
  product: Pick<Product, "availability" | "quantity">,
): number | null => {
  if (product.availability === "coming_soon") return 0;
  if (product.availability === "unlimited") return null;
  if (product.availability === "made_to_order") return null;
  return product.quantity === null ? null : Math.floor(product.quantity);
};

export const MAX_UNITS_PER_LINE = 99;

export type CartLineInput = { productId: number; quantity: number };

export type PricedLine = {
  productId: number;
  name: string;
  size: string;
  image: string;
  /** List price before the product's discount. */
  listUnitPrice: number;
  /** What this order actually charges per unit. */
  unitPrice: number;
  discountPercent: number;
  quantity: number;
  lineTotal: number;
  /** Money saved on this line thanks to the discount. */
  lineDiscount: number;
};

export type PricingProblem = {
  productId: number;
  name: string;
  reason:
    | "missing"
    | "unpriced"
    | "unavailable"
    | "insufficient-stock"
    | "invalid-quantity";
  available?: number;
};

export type PricedOrder = {
  lines: PricedLine[];
  problems: PricingProblem[];
  itemCount: number;
  subtotal: number;
  discountTotal: number;
  /** null = the fee is agreed when the order is confirmed (not configured). */
  shipping: number | null;
  shippingNote: string;
  total: number;
  currency: string;
  /** Set when the cart is below the configured minimum order value. */
  belowMinimum: number | null;
};

const EMPTY_SHIPPING_NOTE = "رسوم التوصيل تُحدَّد عند تأكيد الطلب.";

/**
 * Prices a basket against the real catalogue.
 *
 * `products` must come from the stored content document — never from the
 * browser. Anything the catalogue cannot honour is reported in `problems`
 * instead of being silently dropped, so the UI can explain it and the server
 * can refuse the order.
 */
export function priceOrder(
  items: CartLineInput[],
  products: Product[],
  commerce: Commerce,
  options: { deliveryZoneId?: string } = {},
): PricedOrder {
  const byId = new Map(products.map((product) => [product.id, product]));
  const lines: PricedLine[] = [];
  const problems: PricingProblem[] = [];

  for (const item of items) {
    const product = byId.get(item.productId);
    if (!product) {
      problems.push({
        productId: item.productId,
        name: `منتج #${item.productId}`,
        reason: "missing",
      });
      continue;
    }
    const quantity = Math.floor(item.quantity);
    if (!Number.isFinite(quantity) || quantity < 1 || quantity > MAX_UNITS_PER_LINE) {
      problems.push({
        productId: product.id,
        name: product.name,
        reason: "invalid-quantity",
      });
      continue;
    }
    if (product.price === null || product.price <= 0) {
      problems.push({
        productId: product.id,
        name: product.name,
        reason: "unpriced",
      });
      continue;
    }
    if (product.availability === "coming_soon" || product.quantity === 0) {
      problems.push({
        productId: product.id,
        name: product.name,
        reason: "unavailable",
        available: 0,
      });
      continue;
    }
    const stock = availableUnits(product);
    if (stock !== null && quantity > stock) {
      problems.push({
        productId: product.id,
        name: product.name,
        reason: "insufficient-stock",
        available: stock,
      });
      continue;
    }

    const unitPrice = unitPriceOf(product);
    const listUnitPrice = round2(product.price);
    lines.push({
      productId: product.id,
      name: product.name,
      size: product.size,
      image: product.webp || product.img || product.fallback,
      listUnitPrice,
      unitPrice,
      discountPercent: product.discountPercent,
      quantity,
      lineTotal: round2(unitPrice * quantity),
      lineDiscount: round2((listUnitPrice - unitPrice) * quantity),
    });
  }

  const subtotal = round2(lines.reduce((sum, line) => sum + line.lineTotal, 0));
  const discountTotal = round2(
    lines.reduce((sum, line) => sum + line.lineDiscount, 0),
  );
  const itemCount = lines.reduce((sum, line) => sum + line.quantity, 0);

  // Delivery: only ever a fee the owner configured for a zone they serve.
  let shipping: number | null = null;
  let shippingNote = EMPTY_SHIPPING_NOTE;
  const zone = commerce.deliveryZones.find(
    (candidate) => candidate.id === options.deliveryZoneId,
  );
  if (zone) {
    shipping = round2(zone.fee);
    shippingNote = zone.name;
    if (
      commerce.freeDeliveryOver !== null &&
      subtotal >= commerce.freeDeliveryOver &&
      lines.length > 0
    ) {
      shipping = 0;
      shippingNote = `${zone.name} — توصيل مجاني`;
    }
  } else if (commerce.deliveryZones.length > 0) {
    shippingNote = "اختر منطقة التوصيل";
  }

  const belowMinimum =
    commerce.minOrderTotal > 0 && lines.length > 0 && subtotal < commerce.minOrderTotal
      ? round2(commerce.minOrderTotal - subtotal)
      : null;

  return {
    lines,
    problems,
    itemCount,
    subtotal,
    discountTotal,
    shipping,
    shippingNote,
    total: round2(subtotal + (shipping ?? 0)),
    currency: commerce.currency,
    belowMinimum,
  };
}

/* ------------------------------------------------------- customer payload */

/**
 * Egyptian phone numbers, accepted the way people actually write them:
 * `01012345678`, `+20 101 234 5678`, `0020-10-1234-5678`, or a landline with
 * its area code. Everything is normalised to a local `0…` form for storage.
 */
export function normalisePhone(raw: string): string | null {
  const digits = raw.replace(/[^\d+]/g, "").replace(/^\+/, "");
  let local = digits;
  if (local.startsWith("0020")) local = local.slice(4);
  else if (local.startsWith("20") && local.length >= 11) local = local.slice(2);
  if (!local.startsWith("0")) local = `0${local}`;
  if (/^01[0125]\d{8}$/.test(local)) return local; // mobile
  if (/^0\d{1,2}\d{6,8}$/.test(local) && local.length >= 8 && local.length <= 11)
    return local; // landline with area code
  return null;
}

const phoneField = (label: string) =>
  z
    .string()
    .trim()
    .min(1, { message: `${label} مطلوب` })
    .max(25, { message: `${label} طويل جدًا` })
    .transform((value) => normalisePhone(value) ?? value)
    .refine((value) => normalisePhone(value) !== null, {
      message: "رقم الهاتف غير صحيح. اكتبه مثل 01012345678",
    });

export const orderItemInputSchema = z.object({
  productId: z.number().int().positive(),
  quantity: z
    .number()
    .int({ message: "الكمية يجب أن تكون رقمًا صحيحًا" })
    .min(1, { message: "أقل كمية هي 1" })
    .max(MAX_UNITS_PER_LINE, { message: `أقصى كمية ${MAX_UNITS_PER_LINE}` }),
});

export const orderDraftSchema = z.object({
  customer: z.object({
    name: z
      .string()
      .trim()
      .min(2, { message: "اكتب الاسم بالكامل" })
      .max(80, { message: "الاسم طويل جدًا" }),
    phone: phoneField("رقم الموبايل"),
    altPhone: z
      .string()
      .trim()
      .max(25)
      .default("")
      .transform((value) => (value ? (normalisePhone(value) ?? value) : ""))
      .refine((value) => value === "" || normalisePhone(value) !== null, {
        message: "رقم الاحتياطي غير صحيح",
      }),
    address: z
      .string()
      .trim()
      .min(8, { message: "اكتب العنوان بالتفصيل (الشارع، رقم العقار، الدور)" })
      .max(300, { message: "العنوان طويل جدًا" }),
    area: z.string().trim().max(80).default(""),
    notes: z.string().trim().max(400).default(""),
  }),
  items: z
    .array(orderItemInputSchema)
    .min(1, { message: "السلة فارغة" })
    .max(40, { message: "عدد المنتجات كبير جدًا" }),
  deliveryZoneId: z.string().trim().max(40).default(""),
  paymentMethod: z.enum(PAYMENT_METHODS).default("on_confirmation"),
  /** Stable key so a double tap or a retry never creates a second order. */
  requestKey: z.string().trim().min(8).max(100),
  /** Bots fill hidden fields; humans never see this one. */
  honeypot: z.string().max(0).optional(),
});

export type OrderDraft = z.infer<typeof orderDraftSchema>;

/* ------------------------------------------------------------ stored order */

export type OrderItem = {
  productId: number;
  name: string;
  size: string;
  unitPrice: number;
  listUnitPrice: number;
  discountPercent: number;
  quantity: number;
  lineTotal: number;
};

export type Order = {
  id: number;
  reference: string;
  status: OrderStatus;
  createdAt: string;
  updatedAt: string;
  customer: {
    name: string;
    phone: string;
    altPhone: string;
    address: string;
    area: string;
    notes: string;
  };
  deliveryZoneId: string;
  deliveryZoneName: string;
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  currency: string;
  subtotal: number;
  discountTotal: number;
  shipping: number | null;
  total: number;
  itemCount: number;
  items: OrderItem[];
  history: { status: OrderStatus; at: string; note: string }[];
};

/** What the customer is allowed to see: never internal notes or admin names. */
export type PublicOrder = Omit<Order, "id" | "history"> & {
  history: { status: OrderStatus; at: string }[];
};

/** Dashboard analytics, computed from stored orders only. */
export type OrderStats = {
  total: number;
  byStatus: Record<OrderStatus, number>;
  /**
   * Revenue rule, stated once: the sum of order totals for every order that
   * is **not cancelled**, delivery included. `revenueDelivered` is the subset
   * already handed to the customer.
   */
  revenue: number;
  revenueDelivered: number;
  last7Days: number;
  averageOrder: number;
  bestSellers: {
    productId: number;
    name: string;
    quantity: number;
    revenue: number;
  }[];
  currency: string;
};

/* --------------------------------------------------------------- WhatsApp */

/**
 * A summary the customer can send to the shop. It carries the reference and
 * the amounts, never an address or a phone number: the shop already has those
 * with the order, and the message may pass through a shared phone.
 */
export function orderWhatsAppMessage(
  order: Pick<
    Order,
    "reference" | "items" | "total" | "currency" | "subtotal" | "shipping"
  >,
  siteName: string,
) {
  const lines = order.items.map(
    (item) => `• ${item.name} × ${item.quantity} = ${formatMoney(item.lineTotal, order.currency)}`,
  );
  const shipping =
    order.shipping === null
      ? "التوصيل: يُحدَّد عند التأكيد"
      : `التوصيل: ${formatMoney(order.shipping, order.currency)}`;
  return [
    `السلام عليكم ${siteName}`,
    `طلب رقم: ${order.reference}`,
    ...lines,
    `الإجمالي قبل التوصيل: ${formatMoney(order.subtotal, order.currency)}`,
    shipping,
    `الإجمالي: ${formatMoney(order.total, order.currency)}`,
    "برجاء تأكيد الطلب.",
  ].join("\n");
}
