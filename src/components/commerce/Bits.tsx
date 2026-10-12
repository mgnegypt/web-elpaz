// Small commerce building blocks shared by the catalogue, the cart, checkout
// and the receipt, so a price or a total is rendered the same way everywhere.
import { Minus, Plus, TriangleAlert } from "lucide-react";
import {
  formatMoney,
  type PricedOrder,
  type PricingProblem,
} from "../../../shared/orders.ts";

export function PriceTag({
  price,
  discountPercent = 0,
  currency,
  size = "md",
}: {
  /** null = the owner has not published a price for this product. */
  price: number | null;
  discountPercent?: number;
  currency: string;
  size?: "sm" | "md" | "lg";
}) {
  if (price === null || price <= 0)
    return <span className={`price-tag price-tag--${size} price-tag--ask`}>السعر عند الطلب</span>;
  const net = discountPercent > 0 ? price * (1 - discountPercent / 100) : price;
  return (
    <span className={`price-tag price-tag--${size}`}>
      <b>{formatMoney(Math.round(net * 100) / 100, currency)}</b>
      {discountPercent > 0 && (
        <s aria-label="السعر قبل الخصم">{formatMoney(price, currency)}</s>
      )}
    </span>
  );
}

export function QuantityStepper({
  value,
  min = 1,
  max,
  onChange,
  label,
  compact = false,
}: {
  value: number;
  min?: number;
  max: number | null;
  onChange: (next: number) => void;
  label: string;
  compact?: boolean;
}) {
  const ceiling = max === null ? 99 : Math.max(min, max);
  return (
    <div className={`qty-stepper${compact ? " qty-stepper--compact" : ""}`}>
      <button
        type="button"
        onClick={() => onChange(value - 1)}
        disabled={value <= min}
        aria-label={`إنقاص كمية ${label}`}
      >
        <Minus size={15} />
      </button>
      <input
        type="number"
        inputMode="numeric"
        value={value}
        min={min}
        max={ceiling}
        aria-label={`كمية ${label}`}
        onChange={(event) => {
          const next = Number.parseInt(event.target.value, 10);
          if (Number.isFinite(next)) onChange(next);
        }}
      />
      <button
        type="button"
        onClick={() => onChange(value + 1)}
        disabled={value >= ceiling}
        aria-label={`زيادة كمية ${label}`}
      >
        <Plus size={15} />
      </button>
    </div>
  );
}

const PROBLEM_TEXT: Record<PricingProblem["reason"], (p: PricingProblem) => string> = {
  missing: (p) => `${p.name}: لم يعد موجودًا في الكتالوج.`,
  unpriced: (p) => `${p.name}: لا يوجد سعر منشور، اطلبه عبر واتساب.`,
  unavailable: (p) => `${p.name}: غير متاح حاليًا.`,
  "insufficient-stock": (p) => `${p.name}: المتاح ${p.available ?? 0} فقط.`,
  "invalid-quantity": (p) => `${p.name}: الكمية غير صحيحة.`,
};

export function ProblemList({
  problems,
  onFix,
}: {
  problems: PricingProblem[];
  onFix?: () => void;
}) {
  if (!problems.length) return null;
  return (
    <div className="cart-problems" role="alert">
      <p>
        <TriangleAlert size={16} aria-hidden="true" />
        تغيّرت بعض الأصناف:
      </p>
      <ul>
        {problems.map((problem) => (
          <li key={`${problem.productId}-${problem.reason}`}>
            {PROBLEM_TEXT[problem.reason](problem)}
          </li>
        ))}
      </ul>
      {onFix && (
        <button type="button" className="secondary-button" onClick={onFix}>
          تحديث السلة تلقائيًا
        </button>
      )}
    </div>
  );
}

/** Subtotal → discount → delivery → total. One layout, used in three places. */
export function TotalsTable({
  priced,
  showItems = false,
}: {
  priced: Pick<
    PricedOrder,
    "subtotal" | "discountTotal" | "shipping" | "total" | "currency" | "itemCount"
  >;
  showItems?: boolean;
}) {
  return (
    <dl className="totals-table">
      {showItems && (
        <div>
          <dt>عدد القطع</dt>
          <dd>{priced.itemCount}</dd>
        </div>
      )}
      <div>
        <dt>الإجمالي قبل التوصيل</dt>
        <dd>{formatMoney(priced.subtotal, priced.currency)}</dd>
      </div>
      {priced.discountTotal > 0 && (
        <div className="totals-table__save">
          <dt>وفّرت</dt>
          <dd>{formatMoney(priced.discountTotal, priced.currency)}</dd>
        </div>
      )}
      <div>
        <dt>التوصيل</dt>
        <dd>
          {priced.shipping === null ? (
            <span className="muted">يُحدَّد عند التأكيد</span>
          ) : priced.shipping === 0 ? (
            "مجاني"
          ) : (
            formatMoney(priced.shipping, priced.currency)
          )}
        </dd>
      </div>
      <div className="totals-table__total">
        <dt>الإجمالي</dt>
        <dd>{formatMoney(priced.total, priced.currency)}</dd>
      </div>
    </dl>
  );
}
