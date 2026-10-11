// Checkout: the only place a customer hands over delivery details, and the
// only page that creates an order. Everything it shows is priced by the
// server before anything is stored — this form never sends a total.
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  CheckCircle2,
  Loader2,
  Lock,
  PencilLine,
  ShoppingBag,
  TriangleAlert,
} from "lucide-react";
import {
  PAYMENT_METHOD_LABELS,
  formatMoney,
  orderDraftSchema,
  type PaymentMethod,
  type PricingProblem,
} from "../../shared/orders.ts";
import { useContent } from "../content/ContentContext";
import { useCart } from "../cart/CartContext";
import { createOrder, newRequestKey } from "../lib/api";
import { rememberOrder } from "../cart/orderStore";
import { navigate, useNoIndex, usePageTitle } from "../lib/route";
import { ProblemList, TotalsTable } from "../components/commerce/Bits";
import { BrandLogo } from "../components/shared";

type Fields = {
  name: string;
  phone: string;
  altPhone: string;
  address: string;
  area: string;
  notes: string;
};

const EMPTY: Fields = {
  name: "",
  phone: "",
  altPhone: "",
  address: "",
  area: "",
  notes: "",
};

const DRAFT_KEY = "elbaz.checkout.v1";

const readDraft = (): Fields => {
  try {
    const stored = JSON.parse(window.localStorage.getItem(DRAFT_KEY) ?? "null");
    if (!stored || typeof stored !== "object") return EMPTY;
    return { ...EMPTY, ...(stored as Partial<Fields>) };
  } catch {
    return EMPTY;
  }
};

export default function CheckoutPage() {
  const { site, commerce } = useContent();
  const cart = useCart();
  const { priced } = cart;
  usePageTitle(`إتمام الطلب | ${site.name}`);
  useNoIndex();

  const [fields, setFields] = useState<Fields>(readDraft);
  const [stage, setStage] = useState<"form" | "review">("form");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState("");
  const [problems, setProblems] = useState<PricingProblem[]>([]);
  const [pending, setPending] = useState(false);
  const [payment, setPayment] = useState<PaymentMethod>(
    commerce.codEnabled ? "cod" : "on_confirmation",
  );
  const honeypot = useRef("");
  // One key per basket attempt: a double tap, a retry after a timeout or a
  // refresh of the review step can never create a second order.
  const requestKey = useRef(newRequestKey());
  const liveRegion = useRef<HTMLParagraphElement | null>(null);

  // Keep the typed details for the next visit (this browser only).
  useEffect(() => {
    try {
      window.localStorage.setItem(DRAFT_KEY, JSON.stringify(fields));
    } catch {
      /* ignore */
    }
  }, [fields]);

  useEffect(() => {
    if (!commerce.codEnabled && payment === "cod") setPayment("on_confirmation");
  }, [commerce.codEnabled, payment]);

  const set = (key: keyof Fields) => (event: { target: { value: string } }) =>
    setFields((current) => ({ ...current, [key]: event.target.value }));

  const draft = useMemo(
    () => ({
      customer: {
        name: fields.name,
        phone: fields.phone,
        altPhone: fields.altPhone,
        address: fields.address,
        area: fields.area,
        notes: fields.notes,
      },
      items: cart.items,
      deliveryZoneId: cart.zoneId,
      paymentMethod: payment,
      requestKey: requestKey.current,
    }),
    [fields, cart.items, cart.zoneId, payment],
  );

  const validate = () => {
    const parsed = orderDraftSchema.safeParse(draft);
    if (parsed.success) {
      setErrors({});
      return true;
    }
    const next: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path.filter((part) => part !== "customer").join(".");
      if (!next[key]) next[key] = issue.message;
    }
    setErrors(next);
    return false;
  };

  const review = (event: React.FormEvent) => {
    event.preventDefault();
    setFormError("");
    if (commerce.deliveryZones.length > 0 && !cart.zoneId) {
      setErrors((current) => ({ ...current, zone: "اختر منطقة التوصيل" }));
      return;
    }
    if (!validate()) {
      liveRegion.current?.focus();
      return;
    }
    setStage("review");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const submit = async () => {
    if (pending) return;
    setPending(true);
    setFormError("");
    setProblems([]);
    try {
      const result = await createOrder({ ...draft, honeypot: honeypot.current });
      rememberOrder({
        reference: result.reference,
        token: result.accessToken ?? "",
        at: result.order.createdAt,
        total: result.order.total,
        currency: result.order.currency,
      });
      cart.clear();
      // A fresh key, so the next basket is a new order.
      requestKey.current = newRequestKey();
      navigate(
        `/order/${encodeURIComponent(result.reference)}?t=${encodeURIComponent(
          result.accessToken ?? "",
        )}&new=1`,
        { replace: true },
      );
    } catch (error) {
      const failure = error as Error & { status?: number; payload?: unknown };
      const payload = (failure.payload ?? {}) as {
        error?: string;
        message?: string;
        problems?: PricingProblem[];
      };
      if (payload.problems?.length) setProblems(payload.problems);
      setFormError(
        payload.message ??
          (failure.status === 429
            ? "محاولات كثيرة في وقت قصير. انتظر دقيقة ثم أعد المحاولة."
            : failure.message === "Failed to fetch"
              ? "تعذّر الاتصال بالخادم. تأكد من الإنترنت وأعد المحاولة — لن يُنشأ طلب مكرر."
              : "تعذّر إنشاء الطلب. حاول مرة أخرى."),
      );
      setStage("form");
      setPending(false);
    }
  };

  const empty = priced.lines.length === 0;

  return (
    <div className="page-shell" dir="rtl">
      <header className="page-head">
        <a className="page-brand" href="/">
          <BrandLogo />
          <span>{site.name}</span>
        </a>
        <a className="link-button" href="/">
          <ArrowRight size={16} aria-hidden="true" />
          العودة للموقع
        </a>
      </header>

      <main className="page-main checkout" id="main-content">
        <h1>إتمام الطلب</h1>

        {!commerce.ordersEnabled ? (
          <div className="notice-card" role="status">
            <TriangleAlert size={20} aria-hidden="true" />
            <div>
              <strong>الطلب أونلاين غير مُفعَّل حاليًا.</strong>
              <p>تواصل معنا على واتساب أو عبر الهاتف لإتمام طلبك.</p>
            </div>
          </div>
        ) : empty ? (
          <div className="empty-state cart-empty">
            <ShoppingBag size={44} aria-hidden="true" />
            <p>سلتك فارغة.</p>
            <a className="primary-button" href="/">
              تصفّح المنتجات
            </a>
          </div>
        ) : (
          <div className="checkout-grid">
            <section className="checkout-form" aria-label="بيانات التوصيل">
              <p
                className="form-error"
                role="alert"
                tabIndex={-1}
                ref={liveRegion}
                hidden={!formError}
              >
                {formError}
              </p>
              <ProblemList problems={problems} onFix={cart.resolveProblems} />

              {stage === "form" ? (
                <form onSubmit={review} noValidate>
                  <div className="field">
                    <label htmlFor="co-name">الاسم بالكامل *</label>
                    <input
                      id="co-name"
                      value={fields.name}
                      onChange={set("name")}
                      autoComplete="name"
                      required
                      aria-invalid={!!errors.name}
                      aria-describedby={errors.name ? "co-name-err" : undefined}
                    />
                    {errors.name && (
                      <small id="co-name-err" className="field-error">
                        {errors.name}
                      </small>
                    )}
                  </div>

                  <div className="field-row">
                    <div className="field">
                      <label htmlFor="co-phone">رقم الموبايل *</label>
                      <input
                        id="co-phone"
                        value={fields.phone}
                        onChange={set("phone")}
                        inputMode="tel"
                        autoComplete="tel"
                        placeholder="01012345678"
                        dir="ltr"
                        required
                        aria-invalid={!!errors.phone}
                        aria-describedby={errors.phone ? "co-phone-err" : undefined}
                      />
                      {errors.phone && (
                        <small id="co-phone-err" className="field-error">
                          {errors.phone}
                        </small>
                      )}
                    </div>
                    <div className="field">
                      <label htmlFor="co-alt">رقم احتياطي (اختياري)</label>
                      <input
                        id="co-alt"
                        value={fields.altPhone}
                        onChange={set("altPhone")}
                        inputMode="tel"
                        dir="ltr"
                        aria-invalid={!!errors.altPhone}
                      />
                      {errors.altPhone && (
                        <small className="field-error">{errors.altPhone}</small>
                      )}
                    </div>
                  </div>

                  {commerce.deliveryZones.length > 0 ? (
                    <div className="field">
                      <label htmlFor="co-zone">منطقة التوصيل *</label>
                      <select
                        id="co-zone"
                        value={cart.zoneId}
                        onChange={(event) => {
                          cart.setZoneId(event.target.value);
                          setErrors((current) => ({ ...current, zone: "" }));
                        }}
                        aria-invalid={!!errors.zone}
                      >
                        <option value="">اختر المنطقة…</option>
                        {commerce.deliveryZones.map((zone) => (
                          <option key={zone.id} value={zone.id}>
                            {zone.name} — {formatMoney(zone.fee, commerce.currency)}
                          </option>
                        ))}
                      </select>
                      {errors.zone && <small className="field-error">{errors.zone}</small>}
                    </div>
                  ) : (
                    <div className="field">
                      <label htmlFor="co-area">المنطقة / المدينة</label>
                      <input id="co-area" value={fields.area} onChange={set("area")} />
                      <small className="muted">
                        لم تُضَف مناطق توصيل بأسعار ثابتة بعد، لذلك يتم الاتفاق على رسوم
                        التوصيل عند تأكيد الطلب بالهاتف.
                      </small>
                    </div>
                  )}

                  <div className="field">
                    <label htmlFor="co-address">العنوان بالتفصيل *</label>
                    <textarea
                      id="co-address"
                      value={fields.address}
                      onChange={set("address")}
                      rows={3}
                      autoComplete="street-address"
                      placeholder="الشارع، رقم العقار، الدور، الشقة، علامة مميزة"
                      required
                      aria-invalid={!!errors.address}
                    />
                    {errors.address && (
                      <small className="field-error">{errors.address}</small>
                    )}
                  </div>

                  <div className="field">
                    <label htmlFor="co-notes">ملاحظات للتوصيل (اختياري)</label>
                    <textarea
                      id="co-notes"
                      value={fields.notes}
                      onChange={set("notes")}
                      rows={2}
                    />
                  </div>

                  <fieldset className="field">
                    <legend>طريقة الدفع</legend>
                    {commerce.codEnabled && (
                      <label className="radio-row">
                        <input
                          type="radio"
                          name="payment"
                          value="cod"
                          checked={payment === "cod"}
                          onChange={() => setPayment("cod")}
                        />
                        <span>{PAYMENT_METHOD_LABELS.cod}</span>
                      </label>
                    )}
                    <label className="radio-row">
                      <input
                        type="radio"
                        name="payment"
                        value="on_confirmation"
                        checked={payment === "on_confirmation"}
                        onChange={() => setPayment("on_confirmation")}
                      />
                      <span>{PAYMENT_METHOD_LABELS.on_confirmation}</span>
                    </label>
                    <small className="muted">
                      لا يوجد دفع إلكتروني على الموقع، ولا تُطلب أي بيانات بطاقات.
                    </small>
                  </fieldset>

                  {/* Hidden from people, irresistible to bots. */}
                  <input
                    type="text"
                    className="hp-field"
                    tabIndex={-1}
                    autoComplete="off"
                    aria-hidden="true"
                    onChange={(event) => {
                      honeypot.current = event.target.value;
                    }}
                  />

                  <button type="submit" className="primary-button">
                    مراجعة الطلب
                  </button>
                </form>
              ) : (
                <div className="checkout-review">
                  <h2>راجع بياناتك قبل الإرسال</h2>
                  <dl className="review-list">
                    <div>
                      <dt>الاسم</dt>
                      <dd>{fields.name}</dd>
                    </div>
                    <div>
                      <dt>الموبايل</dt>
                      <dd dir="ltr">{fields.phone}</dd>
                    </div>
                    {fields.altPhone && (
                      <div>
                        <dt>رقم احتياطي</dt>
                        <dd dir="ltr">{fields.altPhone}</dd>
                      </div>
                    )}
                    <div>
                      <dt>العنوان</dt>
                      <dd>{fields.address}</dd>
                    </div>
                    <div>
                      <dt>المنطقة</dt>
                      <dd>
                        {commerce.deliveryZones.find((zone) => zone.id === cart.zoneId)
                          ?.name ||
                          fields.area ||
                          "—"}
                      </dd>
                    </div>
                    {fields.notes && (
                      <div>
                        <dt>ملاحظات</dt>
                        <dd>{fields.notes}</dd>
                      </div>
                    )}
                    <div>
                      <dt>الدفع</dt>
                      <dd>{PAYMENT_METHOD_LABELS[payment]}</dd>
                    </div>
                  </dl>
                  <div className="review-actions">
                    <button
                      type="button"
                      className="primary-button"
                      onClick={submit}
                      disabled={pending}
                    >
                      {pending ? (
                        <>
                          <Loader2 size={17} className="spin" aria-hidden="true" />
                          جاري إنشاء الطلب…
                        </>
                      ) : (
                        <>
                          <CheckCircle2 size={17} aria-hidden="true" />
                          تأكيد وإرسال الطلب
                        </>
                      )}
                    </button>
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => setStage("form")}
                      disabled={pending}
                    >
                      <PencilLine size={16} aria-hidden="true" />
                      تعديل البيانات
                    </button>
                  </div>
                  <p className="muted small">
                    بالضغط على «تأكيد وإرسال الطلب» يُسجَّل طلبك لدينا ويصلك رقم طلب
                    ورابط لمتابعته. سنتصل بك لتأكيد الطلب ورسوم التوصيل.
                  </p>
                </div>
              )}
            </section>

            <aside className="checkout-summary" aria-label="ملخص الطلب">
              <h2>ملخص الطلب</h2>
              <ul className="summary-lines">
                {priced.lines.map((line) => (
                  <li key={line.productId}>
                    <span>
                      {line.name}
                      <small> × {line.quantity}</small>
                    </span>
                    <b>{formatMoney(line.lineTotal, priced.currency)}</b>
                  </li>
                ))}
              </ul>
              <TotalsTable priced={priced} showItems />
              {priced.shipping === null && (
                <p className="muted small">
                  رسوم التوصيل غير محسوبة في الإجمالي لأنها تُحدَّد عند التأكيد.
                </p>
              )}
              {commerce.checkoutNote && <p className="notice-inline">{commerce.checkoutNote}</p>}
              <p className="muted small secure-note">
                <Lock size={14} aria-hidden="true" />
                بياناتك تُستخدم لتوصيل الطلب فقط.
              </p>
            </aside>
          </div>
        )}
      </main>
    </div>
  );
}
