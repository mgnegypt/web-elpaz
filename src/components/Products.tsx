import { useState } from "react";
import { ArrowUpLeft, PackageSearch } from "lucide-react";
import {
  CATEGORIES,
  CONTENT_STATUS,
  COPY,
  PRODUCTS,
  type Product,
} from "../data";
import { orderMessage, waLink } from "../lib/whatsapp";
import { ProductImage, SectionTitle, WhatsAppIcon } from "./shared";
export default function Products({
  onSelect,
}: {
  onSelect: (product: Product) => void;
}) {
  const [category, setCategory] = useState("الكل");
  const filtered = PRODUCTS.filter(
    (p) => category === "الكل" || p.category === category,
  );
  return (
    <div className="section-container products-container">
      <SectionTitle
        eyebrow="خيرات إلباظ"
        title="منتجاتنا"
        subtitle={COPY.productsSubtitle}
      />
      <div className="category-chips" role="group" aria-label="تصفية المنتجات">
        {CATEGORIES.map((c) => (
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
                <ProductImage
                  src={p.img}
                  fallback={p.fallback}
                  webp={p.webp}
                  alt={p.name}
                />
                {CONTENT_STATUS.placeholderProductIds.includes(p.id) && (
                  <span className="sample-image">صورة توضيحية</span>
                )}
              </div>
              <div className="product-copy">
                <h2>{p.name}</h2>
                <p>{p.desc}</p>
              </div>
            </button>
            <a
              className="wa-button"
              href={waLink(orderMessage(p.name))}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
            >
              <WhatsAppIcon size={19} />
              اطلب الآن
              <ArrowUpLeft size={18} />
            </a>
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
