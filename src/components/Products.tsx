import { useState } from "react";
import { ArrowUpLeft, BadgePercent, Clock, PackageSearch, Sparkles, Truck } from "lucide-react";
import {
  AVAILABILITY_LABELS,
  isNewBadgeActive,
  isOrderable,
  productImageIsIllustrative,
  stockLabel,
  type Product,
} from "../../shared/content.ts";
import { useContent } from "../content/ContentContext";
import { orderMessage, waLink } from "../lib/whatsapp";
import { ProductImage, SectionTitle, WhatsAppIcon } from "./shared";
export default function Products({
  onSelect,
}: {
  onSelect: (product: Product) => void;
}) {
  const { products, categories, copy, contentStatus, site } = useContent();
  const [category, setCategory] = useState("الكل");
  const filtered = products.filter(
    (p) => category === "الكل" || p.category === category,
  );
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
      <div
        className="products-grid grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6"
        key={category}
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
          <p>منتجات جديدة قريبًا، تواصل معنا لنعرف طلبك.</p>
        </div>
      )}
      <p className="section-footnote">
        كل ما تحتاجه من خير الطبيعة، في مكان واحد.
      </p>
    </div>
  );
}
