import { useEffect, useRef, useState } from "react";
import {
  X,
  Package,
  ArrowUpLeft,
  BadgePercent,
  Clock,
  ShoppingBag,
  Sparkles,
  Truck,
} from "lucide-react";
import {
  isNewBadgeActive,
  isOrderable,
  productImageIsIllustrative,
  stockLabel,
  type Product,
} from "../../shared/content.ts";
import { availableUnits, isPurchasable } from "../../shared/orders.ts";
import { useContent } from "../content/ContentContext";
import { useCart } from "../cart/CartContext";
import { useDialog } from "../hooks/useDialog";
import { waLink, orderMessage } from "../lib/whatsapp";
import { PriceTag, QuantityStepper } from "./commerce/Bits";
import { ProductImage, WhatsAppIcon } from "./shared";

export default function ProductModal({
  product: p,
  onClose,
  onSelect,
}: {
  product: Product;
  onClose: () => void;
  /** Lets a related product open in place of this one. */
  onSelect?: (product: Product) => void;
}) {
  const { contentStatus, site, products, commerce } = useContent();
  const cart = useCart();
  const ref = useDialog(onClose),
    start = useRef(0);
  const [quantity, setQuantity] = useState(1);
  const [flash, setFlash] = useState("");
  const stock = availableUnits(p);
  const purchasable = cart.ordersEnabled && isPurchasable(p);
  const related = products
    .filter((item) => item.id !== p.id && item.category === p.category)
    .slice(0, 3);

  // A different product in the same dialog starts from a clean state.
  useEffect(() => {
    setQuantity(1);
    setFlash("");
  }, [p.id]);

  return (
    <div
      className="modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        className="product-modal"
        role="dialog"
        aria-modal="true"
        aria-label={p.name}
        tabIndex={-1}
      >
        <div
          className="sheet-handle"
          onPointerDown={(e) => {
            start.current = e.clientY;
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerUp={(e) => {
            if (e.clientY - start.current > 60) onClose();
          }}
        >
          <span />
        </div>
        <button
          className="modal-close icon-button"
          aria-label="إغلاق تفاصيل المنتج"
          onClick={onClose}
        >
          <X />
        </button>
        <div
          className="modal-image"
          style={{
            background: `radial-gradient(ellipse,${p.color}22,${p.color}08)`,
          }}
        >
          {p.img || p.fallback ? (
            <ProductImage src={p.img} webp={p.webp} fallback={p.fallback} alt={p.name} />
          ) : (
            <span className="product-placeholder" aria-hidden="true">
              <Package size={40} />
            </span>
          )}
        </div>
        <div className="modal-copy">
          <span className="pill">{p.category}</span>
          <h2>{p.name}</h2>
          <div className="modal-flags">
            {isNewBadgeActive(p) && (
              <span className="flag flag-new">
                <Sparkles size={13} />
                جديد
              </span>
            )}
            {p.discountPercent > 0 && (
              <span className="flag flag-discount">
                <BadgePercent size={13} />
                خصم {p.discountPercent}%
              </span>
            )}
            {p.badge && <span className="flag flag-custom">{p.badge}</span>}
            {stockLabel(p) && (
              <span
                className={`stock-chip stock-chip--${p.availability}${
                  p.quantity === 0 ? " stock-chip--out" : ""
                }`}
              >
                {p.availability === "made_to_order" ? <Truck size={14} /> : <Clock size={14} />}
                {stockLabel(p)}
              </span>
            )}
          </div>
          <PriceTag
            price={p.price}
            discountPercent={p.discountPercent}
            currency={commerce.currency}
            size="lg"
          />
          {p.size !== "—" && (
            <span className="product-size">
              <Package size={18} />
              {p.size}
            </span>
          )}
          {p.availability === "available" && p.quantity !== null && p.quantity > 0 && (
            <small className="muted">المتاح حاليًا: {p.quantity}</small>
          )}
          <p>{p.longDesc}</p>
          {productImageIsIllustrative(p, contentStatus) && (
            <small className="muted">
              الصورة توضيحية وسيتم تحديثها بصورة المنتج.
            </small>
          )}

          {purchasable && (
            <div className="modal-buy">
              <QuantityStepper
                value={quantity}
                max={stock}
                label={p.name}
                onChange={(next) =>
                  setQuantity(
                    Math.max(1, Math.min(next, stock ?? 99)),
                  )
                }
              />
              <button
                type="button"
                className="primary-button add-to-cart"
                onClick={() => {
                  const result = cart.add(p, quantity);
                  setFlash(result.ok ? "تمت الإضافة إلى السلة" : (result.reason ?? ""));
                  if (result.ok) {
                    onClose();
                    cart.open();
                  }
                }}
              >
                <ShoppingBag size={18} aria-hidden="true" />
                أضف إلى السلة
              </button>
            </div>
          )}
          {flash && (
            <p className="muted small" role="status">
              {flash}
            </p>
          )}

          {isOrderable(p) ? (
            <a
              className="wa-button"
              href={waLink(site.whatsapp, orderMessage(p.name))}
              target="_blank"
              rel="noopener noreferrer"
            >
              <WhatsAppIcon size={21} />
              اطلب عبر واتساب
              <ArrowUpLeft size={18} />
            </a>
          ) : (
            <span className="wa-button wa-button--disabled" aria-disabled="true">
              <Clock size={19} />
              {p.availability === "coming_soon" ? "قريبًا بإذن الله" : "غير متاح حاليًا"}
            </span>
          )}

          {related.length > 0 && onSelect && (
            <section className="related-products" aria-label="منتجات مشابهة">
              <h3>من نفس التصنيف</h3>
              <ul>
                {related.map((item) => (
                  <li key={item.id}>
                    <button type="button" onClick={() => onSelect(item)}>
                      <span className="related-thumb" aria-hidden="true">
                        {item.img || item.fallback ? (
                          <ProductImage
                            src={item.img}
                            webp={item.webp}
                            fallback={item.fallback}
                            alt=""
                          />
                        ) : (
                          <Package size={18} />
                        )}
                      </span>
                      <span className="related-name">{item.name}</span>
                      <PriceTag
                        price={item.price}
                        discountPercent={item.discountPercent}
                        currency={commerce.currency}
                        size="sm"
                      />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <button className="secondary-button" onClick={onClose}>
            إغلاق
          </button>
        </div>
      </div>
    </div>
  );
}
