import { useRef, useState } from "react";
import { ArrowUpLeft, Mail, MapPin, Phone, Send } from "lucide-react";
import {
  ADDRESS_TEXT,
  COPY,
  MAPS_URL,
  PRODUCTS,
  SITE,
  WHOLESALE_UNITS,
} from "../data";
import { waLink, wholesaleMessage } from "../lib/whatsapp";
import { BrandSocial, SectionTitle, WhatsAppIcon } from "./shared";
export default function Contact() {
  const [name, setName] = useState(""),
    [product, setProduct] = useState(PRODUCTS[0].name),
    [quantity, setQuantity] = useState(""),
    [unit, setUnit] = useState(WHOLESALE_UNITS[0]),
    [notes, setNotes] = useState(""),
    [errors, setErrors] = useState<{ name?: string; quantity?: string }>({}),
    [sent, setSent] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null),
    quantityRef = useRef<HTMLInputElement>(null);
  const message = wholesaleMessage(name, quantity, unit, product, notes);
  return (
    <div className="section-container contact-container">
      <SectionTitle
        eyebrow="خلينا على تواصل"
        title="تواصل معنا"
        subtitle={COPY.contactSubtitle}
      />
      <div className="contact-cards grid sm:grid-cols-3 gap-4">
        {[
          {
            icon: Mail,
            label: "البريد الإلكتروني",
            value: SITE.email,
            link: `mailto:${SITE.email}`,
          },
          {
            icon: Phone,
            label: "رقم التواصل",
            value: SITE.phone,
            link: `tel:${SITE.phone}`,
          },
          {
            icon: Phone,
            label: "رقم التواصل الثاني",
            value: SITE.secondPhone,
            link: `tel:${SITE.secondPhone}`,
          },
        ].map(({ icon: Icon, label, value, link }) => (
          <a key={label} href={link} className="contact-card">
            <span className="contact-icon">
              <Icon size={21} />
            </span>
            <span className="contact-label">{label}</span>
            <strong dir="ltr">{value}</strong>
            <ArrowUpLeft className="contact-card-arrow" size={16} />
          </a>
        ))}
      </div>
      {ADDRESS_TEXT && (
        <div className="address-card">
          <MapPin size={28} />
          <p>{ADDRESS_TEXT}</p>
          <a
            href={
              MAPS_URL ||
              `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(ADDRESS_TEXT)}`
            }
            target="_blank"
            rel="noopener noreferrer"
            className="text-link"
          >
            افتح في خرائط جوجل
            <ArrowUpLeft size={18} />
          </a>
        </div>
      )}
      <form
        className="wholesale-form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          const next: { name?: string; quantity?: string } = {};
          if (!name.trim()) next.name = "من فضلك اكتب اسمك.";
          if (
            !quantity ||
            !Number.isFinite(Number(quantity)) ||
            Number(quantity) <= 0
          )
            next.quantity = "من فضلك أدخل كمية أكبر من صفر.";
          setErrors(next);
          setSent(false);
          if (next.name) {
            nameRef.current?.focus();
            return;
          }
          if (next.quantity) {
            quantityRef.current?.focus();
            return;
          }
          window.open(waLink(message), "_blank", "noopener,noreferrer");
          setSent(true);
        }}
      >
        <div className="form-heading">
          <span className="form-icon">
            <Send size={23} />
          </span>
          <div>
            <h2>طلب كميات الجملة</h2>
            <p>املأ بياناتك، ونكمّل تفاصيل طلبك على واتساب.</p>
          </div>
          <span className="form-tag">لشراكة تدوم</span>
        </div>
        <div className="form-grid">
          <div className="field">
            <label htmlFor="name">
              الاسم <span>*</span>
            </label>
            <input
              id="name"
              ref={nameRef}
              autoComplete="name"
              placeholder="اكتب اسمك أو اسم الشركة"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setSent(false);
              }}
              required
              aria-invalid={!!errors.name}
              aria-describedby={errors.name ? "name-error" : undefined}
            />
            {errors.name && (
              <small id="name-error" role="alert">
                {errors.name}
              </small>
            )}
          </div>
          <div className="field">
            <label htmlFor="product">المنتج</label>
            <select
              id="product"
              value={product}
              onChange={(e) => {
                setProduct(e.target.value);
                setSent(false);
              }}
            >
              {PRODUCTS.map((p) => (
                <option key={p.id}>{p.name}</option>
              ))}
              <option>أخرى</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="quantity">
              الكمية <span>*</span>
            </label>
            <input
              id="quantity"
              ref={quantityRef}
              type="number"
              inputMode="decimal"
              min="0.01"
              step="any"
              placeholder="الكمية المطلوبة"
              value={quantity}
              onChange={(e) => {
                setQuantity(e.target.value);
                setSent(false);
              }}
              required
              aria-invalid={!!errors.quantity}
              aria-describedby={errors.quantity ? "quantity-error" : undefined}
            />
            {errors.quantity && (
              <small id="quantity-error" role="alert">
                {errors.quantity}
              </small>
            )}
          </div>
          <div className="field">
            <label htmlFor="unit">الوحدة</label>
            <select
              id="unit"
              value={unit}
              onChange={(e) => {
                setUnit(e.target.value);
                setSent(false);
              }}
            >
              {WHOLESALE_UNITS.map((u) => (
                <option key={u}>{u}</option>
              ))}
            </select>
          </div>
          <div className="field full-width">
            <label htmlFor="notes">
              ملاحظات <span className="optional">(اختياري)</span>
            </label>
            <textarea
              id="notes"
              rows={3}
              placeholder="قولنا أي تفاصيل إضافية عن طلبك…"
              value={notes}
              onChange={(e) => {
                setNotes(e.target.value);
                setSent(false);
              }}
            />
          </div>
        </div>
        <button type="submit" className="wa-button">
          <WhatsAppIcon size={21} />
          أرسل الطلب عبر واتساب
          <ArrowUpLeft size={19} />
        </button>
        <p className="form-privacy">
          بياناتك تُرسل مباشرة إلى واتساب، ولا يتم تخزينها على الموقع.
        </p>
        {sent && (
          <p className="form-success" role="status">
            طلبك جاهز. إذا لم يفتح واتساب،{" "}
            <a href={waLink(message)} target="_blank" rel="noopener noreferrer">
              اضغط هنا لإرسال الطلب
            </a>
            .
          </p>
        )}
      </form>
      <div className="social-section">
        <span>تابع جديدنا… وخليك قريب</span>
        <div className="social-links">
          <a
            href={SITE.facebook}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="فيسبوك"
          >
            <BrandSocial type="facebook" />
          </a>
          <a
            href={waLink()}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="واتساب"
          >
            <WhatsAppIcon />
          </a>
          <a
            href={SITE.instagram}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="إنستجرام"
          >
            <BrandSocial type="instagram" />
          </a>
        </div>
      </div>
      <footer>
        <span className="footer-brand">
          إلباظ<span>خير الطبيعة، لكل بيت.</span>
        </span>
        <a
          href={SITE.credit}
          target="_blank"
          rel="noopener noreferrer"
          dir="ltr"
        >
          Powered by mgn eg <span className="heart">♥</span>
        </a>
      </footer>
    </div>
  );
}
