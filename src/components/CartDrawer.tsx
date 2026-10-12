// The basket, as a side sheet over the site. Opening it never leaves the
// current section, so a visitor keeps their place in the page.
import { ShoppingBag, Trash2, X } from "lucide-react";
import { formatMoney } from "../../shared/orders.ts";
import { useContent } from "../content/ContentContext";
import { useCart } from "../cart/CartContext";
import { useDialog } from "../hooks/useDialog";
import { navigate } from "../lib/route";
import { ProblemList, QuantityStepper, TotalsTable } from "./commerce/Bits";
import { ProductImage } from "./shared";

export default function CartDrawer() {
  const { products, commerce } = useContent();
  const cart = useCart();
  const ref = useDialog(cart.close);
  const { priced } = cart;

  const goToCheckout = () => {
    cart.close();
    navigate("/checkout");
  };

  return (
    <div
      className="modal-backdrop cart-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) cart.close();
      }}
    >
      <aside
        ref={ref}
        className="cart-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="سلة المشتريات"
        tabIndex={-1}
      >
        <header className="cart-drawer__head">
          <h2>
            <ShoppingBag size={19} aria-hidden="true" />
            سلة المشتريات
            {priced.itemCount > 0 && <span className="cart-count">{priced.itemCount}</span>}
          </h2>
          <button className="icon-button" onClick={cart.close} aria-label="إغلاق السلة">
            <X />
          </button>
        </header>

        <div className="cart-drawer__body">
          <ProblemList problems={priced.problems} onFix={cart.resolveProblems} />

          {priced.lines.length === 0 && priced.problems.length === 0 ? (
            <div className="empty-state cart-empty">
              <ShoppingBag size={40} aria-hidden="true" />
              <p>سلتك فارغة. اختر من منتجاتنا وأضفها للسلة.</p>
              <button className="secondary-button" onClick={cart.close}>
                تصفّح المنتجات
              </button>
            </div>
          ) : (
            <ul className="cart-lines">
              {priced.lines.map((line) => {
                const product = products.find((item) => item.id === line.productId);
                const max =
                  product && product.quantity !== null && product.availability === "available"
                    ? product.quantity
                    : null;
                return (
                  <li key={line.productId} className="cart-line">
                    <div className="cart-line__image" aria-hidden="true">
                      {product && (product.img || product.fallback) ? (
                        <ProductImage
                          src={product.img}
                          webp={product.webp}
                          fallback={product.fallback}
                          alt=""
                        />
                      ) : (
                        <ShoppingBag size={20} />
                      )}
                    </div>
                    <div className="cart-line__info">
                      <strong>{line.name}</strong>
                      {line.size && line.size !== "—" && <small>{line.size}</small>}
                      <span className="cart-line__unit">
                        {formatMoney(line.unitPrice, priced.currency)} للوحدة
                        {line.discountPercent > 0 && (
                          <em className="cart-line__off">خصم {line.discountPercent}%</em>
                        )}
                      </span>
                    </div>
                    <div className="cart-line__actions">
                      <QuantityStepper
                        value={line.quantity}
                        max={max}
                        label={line.name}
                        compact
                        onChange={(next) => cart.setQuantity(line.productId, next)}
                      />
                      <b>{formatMoney(line.lineTotal, priced.currency)}</b>
                      <button
                        type="button"
                        className="icon-button cart-line__remove"
                        onClick={() => cart.remove(line.productId)}
                        aria-label={`حذف ${line.name} من السلة`}
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {priced.lines.length > 0 && (
          <footer className="cart-drawer__foot">
            <TotalsTable priced={priced} />
            {priced.belowMinimum !== null && (
              <p className="cart-warning" role="status">
                الحد الأدنى للطلب {formatMoney(commerce.minOrderTotal, priced.currency)} — أضف
                بقيمة {formatMoney(priced.belowMinimum, priced.currency)} لإتمام الطلب.
              </p>
            )}
            <button
              type="button"
              className="primary-button"
              onClick={goToCheckout}
              disabled={priced.belowMinimum !== null || priced.problems.length > 0}
            >
              إتمام الطلب
            </button>
            <button type="button" className="link-button" onClick={cart.clear}>
              إفراغ السلة
            </button>
          </footer>
        )}
      </aside>
    </div>
  );
}
