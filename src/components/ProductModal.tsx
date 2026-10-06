import { useRef } from "react";
import { X, Package, ArrowUpLeft } from "lucide-react";
import type { Product } from "../../shared/content.ts";
import { useContent } from "../content/ContentContext";
import { useDialog } from "../hooks/useDialog";
import { waLink, orderMessage } from "../lib/whatsapp";
import { ProductImage, WhatsAppIcon } from "./shared";
export default function ProductModal({
  product: p,
  onClose,
}: {
  product: Product;
  onClose: () => void;
}) {
  const { contentStatus, site } = useContent();
  const ref = useDialog(onClose),
    start = useRef(0);
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
          <ProductImage
            src={p.img}
            webp={p.webp}
            fallback={p.fallback}
            alt={p.name}
          />
        </div>
        <div className="modal-copy">
          <span className="pill">{p.category}</span>
          <h2>{p.name}</h2>
          {p.size !== "—" && (
            <span className="product-size">
              <Package size={18} />
              {p.size}
            </span>
          )}
          <p>{p.longDesc}</p>
          {contentStatus.placeholderProductIds.includes(p.id) && (
            <small className="muted">
              الصورة توضيحية وسيتم تحديثها بصورة المنتج.
            </small>
          )}
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
          <button className="secondary-button" onClick={onClose}>
            إغلاق
          </button>
        </div>
      </div>
    </div>
  );
}
