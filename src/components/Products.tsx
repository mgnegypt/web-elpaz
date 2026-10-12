import { useEffect, useMemo, useState } from "react";
import {
  ArrowUpLeft,
  BadgePercent,
  Clock,
  PackageSearch,
  Search,
  ShoppingBag,
  Sparkles,
  Truck,
} from "lucide-react";
import {
  AVAILABILITY_LABELS,
  isNewBadgeActive,
  isOrderable,
  productImageIsIllustrative,
  stockLabel,
  type Product,
} from "../../shared/content.ts";
import { isPurchasable, unitPriceOf } from "../../shared/orders.ts";
import { useContent } from "../content/ContentContext";
import { useCart } from "../cart/CartContext";
import { orderMessage, waLink } from "../lib/whatsapp";
import { PriceTag } from "./commerce/Bits";
import { ProductImage, SectionTitle, WhatsAppIcon } from "./shared";

type Sort = "default" | "price-asc" | "price-desc" | "name";

const SORTS: { value: Sort; label: string }[] = [
  { value: "default", label: "الترتيب الافتراضي" },
  { value: "price-asc", label: "السعر: من الأقل" },
  { value: "price-desc", label: "السعر: من الأعلى" },
  { value: "name", label: "الاسم (أ–ي)" },
];

/** The chosen category lives in the URL so a filtered view can be shared. */
const categoryFromUrl = () =>
  new URLSearchParams(window.location.search).get("category") ?? "الكل";

export default function Products({
  onSelect,
}: {
  onSelect: (product: Product) => void;
}) {
  const { products, categories, copy, contentStatus, site, commerce } = useContent();
  const cart = useCart();
  const [category, setCategory] = useState(categoryFromUrl);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<Sort>("default");
  const [flash, setFlash] = useState("");

  // Keep the address bar in step, and follow the back button.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (category === "الكل") url.searchParams.delete("category");
    else url.searchParams.set("category", category);
    const next = `${url.pathname}${url.search}${url.hash}`;
    if (next !== `${window.location.pathname}${window.location.search}${window.location.hash}`)
      window.history.replaceState({}, "", next);
  }, [category]);

  useEffect(() => {
    const sync = () => setCategory(categoryFromUrl());
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);

  useEffect(() => {
    if (!flash) return;
    const timer = window.setTimeout(() => setFlash(""), 2600);
    return () => window.clearTimeout(timer);
  }, [flash]);

  const anyPriced = products.some((product) => product.price !== null);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    const list = products.filter((product) => {
      if (category !== "الكل" && product.category !== category) return false;
      if (!term) return true;
      return (
        product.name.toLowerCase().includes(term) ||
        product.desc.toLowerCase().includes(term) ||
        product.category.toLowerCase().includes(term)
      );
    });
    if (sort === "name") return [...list].sort((a, b) => a.name.localeCompare(b.name, "ar"));
    if (sort === "price-asc" || sort === "price-desc") {
      const price = (product: Product) =>
        product.price === null ? Number.POSITIVE_INFINITY : unitPriceOf(product);
      return [...list].sort((a, b) =>
        sort === "price-asc" ? price(a) - price(b) : price(b) - price(a),
      );
    }
    return list;
  }, [products, category, search, sort]);

  const addToCart = (product: Product) => {
    const result = cart.add(product);
    setFlash(result.ok ? `تمت إضافة ${product.name} إلى السلة` : (result.reason ?? ""));
    if (result.ok) cart.open();
  };

  return (
    <div className="section-container products-container">
      <SectionTitle
        eyebrow="خيرات إلباظ"
        title="منتجاتنا"
        subtitle={copy.productsSubtitle}
      />
      <div className="category-chips" role="group" aria-label="تصفية المنتجات">
        {categories.map((c) => (
          <button
            key={c}
            className={category === c ? "active" : ""}
            aria-pressed={category === c}
            onClick={() => setCategory(c)}
          >
            {c}
          </button>
        ))}
      </div>
      <div className="catalog-tools">
        <div className="catalog-search">
          <Search size={16} aria-hidden="true" />
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="ابحث باسم المنتج…"
            aria-label="ابحث في المنتجات"
          />
        </div>
        {anyPriced && (
          <label className="catalog-sort">
            <span className="sr-only">ترتيب المنتجات</span>
            <select value={sort} onChange={(event) => setSort(event.target.value as Sort)}>
              {SORTS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        )}
        <span className="catalog-count" aria-live="polite">
          {filtered.length} منتج
        </span>
      </div>
      <p className="sr-only" aria-live="polite">
        {flash}
      </p>
      {flash && (
        <p className="cart-flash" role="status">
          {flash}
        </p>
      )}
      <div
        className="products-grid grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6"
        key={`${category}-${sort}`}
      >
        {filtered.map((p, i) => (
          <article
            className="product-card enter"
            key={p.id}
            style={{ animationDelay: `${i * 40}ms` }}
          >
            <button
              className="product-details-button"
              onClick={() => onSelect(p)}
              aria-label={`تفاصيل ${p.name}`}
            >
              <div
                className="product-visual"
                style={{
                  background: `radial-gradient(ellipse at 50% 55%, ${p.color}22, ${p.color}07 70%)`,
                }}
              >
                <span className="product-category">{p.category}</span>
                <span className="product-open">
                  <ArrowUpLeft size={18} />
                </span>
                <span className="product-flags">
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
                </span>
                {p.img || p.fallback ? (
                  <ProductImage src={p.img} fallback={p.fallback} webp={p.webp} alt={p.name} />
                ) : (
                  <span className="product-placeholder" aria-hidden="true">
                    <PackageSearch size={38} />
                  </span>
                )}
                {productImageIsIllustrative(p, contentStatus) && (
                  <span className="sample-image">صورة توضيحية</span>
                )}
              </div>
              <div className="product-copy">
                <h2>{p.name}</h2>
                <p>{p.desc}</p>
                {(p.price !== null || anyPriced) && (
                  <PriceTag
                    price={p.price}
                    discountPercent={p.discountPercent}
                    currency={commerce.currency}
                  />
                )}
                {stockLabel(p) && (
                  <span
                    className={`stock-chip stock-chip--${p.availability}${
                      p.quantity === 0 ? " stock-chip--out" : ""
                    }`}
                  >
                    {p.availability === "coming_soon" ? (
                      <Clock size={14} />
                    ) : p.availability === "made_to_order" ? (
                      <Truck size={14} />
                    ) : (
                      <PackageSearch size={14} />
                    )}
                    {stockLabel(p)}
                  </span>
                )}
              </div>
            </button>
            {cart.ordersEnabled && isPurchasable(p) && (
              <button
                type="button"
                className="primary-button add-to-cart"
                onClick={() => addToCart(p)}
              >
                <ShoppingBag size={17} aria-hidden="true" />
                أضف إلى السلة
              </button>
            )}
            {isOrderable(p) ? (
              <a
                className="wa-button"
                href={waLink(site.whatsapp, orderMessage(p.name))}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
              >
                <WhatsAppIcon size={19} />
                اطلب الآن
                <ArrowUpLeft size={18} />
              </a>
            ) : (
              <span className="wa-button wa-button--disabled" aria-disabled="true">
                {p.availability === "coming_soon" ? <Clock size={18} /> : <PackageSearch size={18} />}
                {AVAILABILITY_LABELS[p.availability] === AVAILABILITY_LABELS.coming_soon
                  ? "قريبًا بإذن الله"
                  : "غير متاح حاليًا"}
              </span>
            )}
          </article>
        ))}
      </div>
      {!filtered.length && (
        <div className="empty-state">
          <PackageSearch size={44} />
          <p>
            {search.trim()
              ? `لا توجد نتائج لـ «${search.trim()}». جرّب اسمًا آخر أو تصفّح كل التصنيفات.`
              : "منتجات جديدة قريبًا، تواصل معنا لنعرف طلبك."}
          </p>
        </div>
      )}
      <p className="section-footnote">
        كل ما تحتاجه من خير الطبيعة، في مكان واحد.
      </p>
    </div>
  );
}
