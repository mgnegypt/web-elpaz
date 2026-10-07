import { useRef, useState } from "react";
import {
  ArrowUpLeft,
  CheckCircle2,
  Heart,
  Loader2,
  Mail,
  MapPin,
  Phone,
  Send,
  TriangleAlert,
} from "lucide-react";
import { wholesaleRequestSchema } from "../../shared/content.ts";
import { useContent } from "../content/ContentContext";
import { newRequestKey, submitWholesaleRequest } from "../lib/api";
import { waLink, wholesaleMessage } from "../lib/whatsapp";
import { BrandSocial, SectionTitle, WhatsAppIcon } from "./shared";

type Errors = Record<string, string>;

export default function Contact() {
  const { site, products, units, copy } = useContent();
  const [name, setName] = useState(""),
    [contact, setContact] = useState(""),
    [product, setProduct] = useState(products[0]?.name ?? "أخرى"),
    [quantity, setQuantity] = useState(""),
    [unit, setUnit] = useState(units[0] ?? ""),
    [notes, setNotes] = useState(""),
    [consent, setConsent] = useState(false),
    [honeypot, setHoneypot] = useState("");
  const [errors, setErrors] = useState<Errors>({}),
    [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  // One idempotency key per submission attempt: retrying can never duplicate the record.
  const requestKey = useRef(newRequestKey());
  const nameRef = useRef<HTMLInputElement>(null),
    contactRef = useRef<HTMLInputElement>(null),
    quantityRef = useRef<HTMLInputElement>(null),
    consentRef = useRef<HTMLInputElement>(null);
  const message = wholesaleMessage(name, quantity, unit, product, notes);
  const whatsappHref = waLink(site.whatsapp, message);

  const reset = () => {
    if (status !== "idle") setStatus("idle");
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const payload = {
      name,
      contact,
      product,
      unit,
      quantity,
      notes,
      consent,
      honeypot,
      requestKey: requestKey.current,
    };
    // Same schema the server enforces, so the visitor sees Arabic messages immediately.
    const parsed = wholesaleRequestSchema.safeParse(payload);
    if (!parsed.success) {
      const fieldErrors = parsed.error.flatten().fieldErrors as Record<string, string[]>;
      const next: Errors = {};
      for (const [field, messages] of Object.entries(fieldErrors)) {
        if (messages?.[0]) next[field === "honeypot" ? "consent" : field] = messages[0];
      }
      setErrors(next);
      setStatus("idle");
      if (next.name) nameRef.current?.focus();
      else if (next.contact) contactRef.current?.focus();
      else if (next.quantity) quantityRef.current?.focus();
      else if (next.consent) consentRef.current?.focus();
      return;
    }
    setErrors({});
    setStatus("saving");
    try {
      const result = await submitWholesaleRequest({
        ...parsed.data,
        consent: true,
        notes: parsed.data.notes ?? "",
        requestKey: payload.requestKey,
      });
      if (!result?.saved) throw new Error("not-saved");
      setStatus("saved");
      // A fresh key for the next order.
      requestKey.current = newRequestKey();
    } catch {
      // Never pretend the order was stored when it was not.
      setStatus("error");
    }
  };

  return (
    <div className="section-container contact-container">
      <SectionTitle
        eyebrow="خلينا على تواصل"
        title="تواصل معنا"
        subtitle={copy.contactSubtitle}
      />
      <div className="contact-cards grid sm:grid-cols-3 gap-4">
        {[
          {
            icon: Mail,
            label: "البريد الإلكتروني",
            value: site.email,
            link: `mailto:${site.email}`,
          },
          {
            icon: Phone,
            label: "رقم التواصل",
            value: site.phone,
            link: `tel:${site.phone}`,
          },
          {
            icon: Phone,
            label: "رقم التواصل الثاني",
            value: site.secondPhone,
            link: `tel:${site.secondPhone}`,
          },
        ]
          .filter((card) => card.value)
          .map(({ icon: Icon, label, value, link }) => (
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
      {site.address && (
        <div className="address-card">
          <MapPin size={28} />
          <p>{site.address}</p>
          <a
            href={
              site.mapsUrl ||
              `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(site.address)}`
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
      <form className="wholesale-form" noValidate onSubmit={submit}>
        <div className="form-heading">
          <span className="form-icon">
            <Send size={23} />
          </span>
          <div>
            <h2>طلب كميات الجملة</h2>
            <p>املأ بياناتك ونحفظ طلبك، ونتواصل معك لتأكيد التفاصيل.</p>
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
                reset();
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
            <label htmlFor="contact">
              رقم التواصل <span>*</span>
            </label>
            <input
              id="contact"
              ref={contactRef}
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              dir="ltr"
              placeholder="01xxxxxxxxx"
              value={contact}
              onChange={(e) => {
                setContact(e.target.value);
                reset();
              }}
              required
              aria-invalid={!!errors.contact}
              aria-describedby={errors.contact ? "contact-error" : undefined}
            />
            {errors.contact && (
              <small id="contact-error" role="alert">
                {errors.contact}
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
                reset();
              }}
            >
              {products.map((p) => (
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
                reset();
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
                reset();
              }}
            >
              {units.map((u) => (
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
                reset();
              }}
            />
          </div>
        </div>
        {/* Honeypot: hidden from people, irresistible to bots. */}
        <div className="honeypot" aria-hidden="true">
          <label htmlFor="company-website">الموقع الإلكتروني</label>
          <input
            id="company-website"
            name="company-website"
            tabIndex={-1}
            autoComplete="off"
            value={honeypot}
            onChange={(e) => setHoneypot(e.target.value)}
          />
        </div>
        <label className="consent-row" htmlFor="storage-consent">
          <input
            id="storage-consent"
            ref={consentRef}
            type="checkbox"
            checked={consent}
            onChange={(e) => {
              setConsent(e.target.checked);
              reset();
            }}
            required
            aria-invalid={!!errors.consent}
            aria-describedby={errors.consent ? "consent-error" : undefined}
          />
          <span>
            أوافق على تخزين بياناتي للتواصل معي بخصوص هذا الطلب.{" "}
            <span className="optional">لن تُستخدم في أي غرض آخر.</span>
          </span>
        </label>
        {errors.consent && (
          <small id="consent-error" role="alert" className="consent-error">
            {errors.consent}
          </small>
        )}
        <button type="submit" className="wa-button submit-button" disabled={status === "saving"}>
          {status === "saving" ? (
            <Loader2 className="spin" size={21} />
          ) : (
            <Send size={21} />
          )}
          {status === "saving" ? "جاري الإرسال…" : "إرسال الطلب"}
        </button>
        {status === "saved" && (
          <p className="form-success" role="status">
            <CheckCircle2 size={18} />
            تم استلام طلبك وحفظه. هنتواصل معك في أقرب وقت لتأكيد التفاصيل.
          </p>
        )}
        {status === "error" && (
          <p className="form-error" role="alert">
            <TriangleAlert size={18} />
            تعذّر حفظ الطلب حاليًا، فمن فضلك حاول مرة أخرى بعد قليل.
          </p>
        )}
        <div className="wa-alternative">
          <span>أو كلّمنا على واتساب مباشرة</span>
          <a
            className="wa-button ghost"
            href={whatsappHref}
            target="_blank"
            rel="noopener noreferrer"
          >
            <WhatsAppIcon size={19} />
            فتح واتساب
            <ArrowUpLeft size={18} />
          </a>
        </div>
        <p className="form-privacy">
          بياناتك تُحفظ على سيرفر الموقع للتواصل معك بخصوص الطلب. فتح واتساب لا يعني
          تأكيد الطلب تلقائيًا.
        </p>
      </form>
      <div className="social-section">
        <span>تابع جديدنا… وخليك قريب</span>
        <div className="social-links">
          <a
            href={site.facebook}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="فيسبوك"
          >
            <BrandSocial type="facebook" />
          </a>
          <a
            href={waLink(site.whatsapp)}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="واتساب"
          >
            <WhatsAppIcon />
          </a>
          <a
            href={site.instagram}
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
          href={site.credit}
          target="_blank"
          rel="noopener noreferrer"
          dir="ltr"
        >
          Powered by mgn eg <Heart className="heart" size={13} aria-hidden="true" />
        </a>
      </footer>
    </div>
  );
}
