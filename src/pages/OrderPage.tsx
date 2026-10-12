// Order receipt and tracking.
//
// Reachable only with the reference *and* the access token issued when the
// order was created, so an order link cannot be guessed. Everything on the
// page comes from the stored order — nothing is recomputed in the browser.
import { useCallback, useEffect, useState } from "react";
import {
  ArrowRight,
  CheckCircle2,
  Clock,
  Loader2,
  Printer,
  Search,
  TriangleAlert,
} from "lucide-react";
import {
  ORDER_STATUS_FLOW,
  ORDER_STATUS_HINTS,
  ORDER_STATUS_LABELS,
  PAYMENT_METHOD_LABELS,
  PAYMENT_STATUS_LABELS,
  formatMoney,
  orderWhatsAppMessage,
  type PublicOrder,
} from "../../shared/orders.ts";
import { useContent } from "../content/ContentContext";
import { fetchOrder } from "../lib/api";
import { rememberOrder, savedOrders, tokenFor } from "../cart/orderStore";
import { navigate, useNoIndex, usePageTitle, useRoute } from "../lib/route";
import { waLink } from "../lib/whatsapp";
import { BrandLogo, WhatsAppIcon } from "../components/shared";

// Receipts show the shop's clock (Egypt), with Latin digits so the date reads
// the same way as the money and the order reference next to it.
const dateTime = (iso: string) => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  try {
    return new Intl.DateTimeFormat("ar-EG-u-nu-latn", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Africa/Cairo",
    }).format(date);
  } catch {
    return new Intl.DateTimeFormat("ar-EG-u-nu-latn", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(date);
  }
};

export default function OrderPage() {
  const { site, commerce } = useContent();
  const route = useRoute();
  const reference = decodeURIComponent(route.path.replace(/^\/order\/?/, ""));
  const token = route.query.get("t") || tokenFor(reference);
  const isNew = route.query.get("new") === "1";

  const [order, setOrder] = useState<PublicOrder | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "ready" | "missing" | "error">(
    reference ? "loading" : "idle",
  );
  const [lookup, setLookup] = useState("");

  usePageTitle(
    order ? `طلب ${order.reference} | ${site.name}` : `متابعة الطلب | ${site.name}`,
  );
  useNoIndex();

  const load = useCallback(async () => {
    if (!reference || !token) {
      setState(reference ? "missing" : "idle");
      return;
    }
    setState("loading");
    try {
      const result = await fetchOrder(reference, token);
      setOrder(result.order);
      setState("ready");
      // Keep the link usable from this browser even if the URL is lost.
      rememberOrder({
        reference: result.order.reference,
        token,
        at: result.order.createdAt,
        total: result.order.total,
        currency: result.order.currency,
      });
    } catch (error) {
      const failure = error as Error & { status?: number };
      setState(failure.status === 404 ? "missing" : "error");
    }
  }, [reference, token]);

  useEffect(() => {
    void load();
  }, [load]);

  const mine = savedOrders();

  return (
    <div className="page-shell" dir="rtl">
      <header className="page-head no-print">
        <a className="page-brand" href="/">
          <BrandLogo />
          <span>{site.name}</span>
        </a>
        <a className="link-button" href="/">
          <ArrowRight size={16} aria-hidden="true" />
          العودة للموقع
        </a>
      </header>

      <main className="page-main order-page" id="main-content">
        {state === "loading" && (
          <p className="loading-row" role="status">
            <Loader2 size={18} className="spin" aria-hidden="true" />
            جاري تحميل الطلب…
          </p>
        )}

        {state === "error" && (
          <div className="notice-card" role="alert">
            <TriangleAlert size={20} aria-hidden="true" />
            <div>
              <strong>تعذّر تحميل الطلب.</strong>
              <p>تحقق من الاتصال ثم أعد المحاولة.</p>
              <button className="secondary-button" onClick={() => void load()}>
                إعادة المحاولة
              </button>
            </div>
          </div>
        )}

        {state === "missing" && (
          <div className="notice-card" role="alert">
            <TriangleAlert size={20} aria-hidden="true" />
            <div>
              <strong>لم نتمكن من فتح هذا الطلب.</strong>
              <p>
                رابط المتابعة يحتوي على رمز خاص بك. استخدم الرابط كاملًا كما وصلك بعد
                إتمام الطلب، أو تواصل معنا ومعك رقم الطلب.
              </p>
            </div>
          </div>
        )}

        {state === "idle" && (
          <section className="order-lookup">
            <h1>متابعة طلب</h1>
            <p className="muted">
              افتح رابط المتابعة الذي ظهر لك بعد إتمام الطلب. الرابط يحتوي على رمز خاص لا
              يمكن لأحد غيرك فتحه به.
            </p>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                const value = lookup.trim();
                if (!value) return;
                // Accept a pasted full link or a bare reference.
                try {
                  const url = new URL(value, window.location.origin);
                  navigate(`${url.pathname}${url.search}`);
                } catch {
                  navigate(`/order/${encodeURIComponent(value)}`);
                }
              }}
            >
              <div className="field">
                <label htmlFor="order-lookup">رابط المتابعة أو رقم الطلب</label>
                <input
                  id="order-lookup"
                  value={lookup}
                  onChange={(event) => setLookup(event.target.value)}
                  dir="ltr"
                  placeholder="EB-000000-XXXXX"
                />
              </div>
              <button className="primary-button" type="submit">
                <Search size={16} aria-hidden="true" />
                فتح الطلب
              </button>
            </form>

            {mine.length > 0 && (
              <>
                <h2>طلبات من هذا المتصفح</h2>
                <ul className="saved-orders">
                  {mine.map((entry) => (
                    <li key={entry.reference}>
                      <a
                        href={`/order/${encodeURIComponent(entry.reference)}?t=${encodeURIComponent(entry.token)}`}
                      >
                        <b dir="ltr">{entry.reference}</b>
                        <span>{dateTime(entry.at)}</span>
                        <span>{formatMoney(entry.total, entry.currency)}</span>
                      </a>
                    </li>
                  ))}
                </ul>
                <p className="muted small">
                  هذه القائمة محفوظة في هذا المتصفح فقط، وليست سجل حساب.
                </p>
              </>
            )}
          </section>
        )}

        {state === "ready" && order && (
          <>
            {isNew && (
              <div className="success-banner no-print" role="status">
                <CheckCircle2 size={22} aria-hidden="true" />
                <div>
                  <strong>تم استلام طلبك وتسجيله.</strong>
                  <p>
                    احتفظ برابط هذه الصفحة لمتابعة الطلب. سنتصل بك على الرقم المسجّل
                    لتأكيد الطلب.
                  </p>
                </div>
              </div>
            )}

            <article className="receipt" aria-label={`إيصال الطلب ${order.reference}`}>
              <header className="receipt__head">
                <div className="receipt__brand">
                  <BrandLogo />
                  <div>
                    <strong>{site.name}</strong>
                    {site.phone && <small dir="ltr">{site.phone}</small>}
                    {site.address && <small>{site.address}</small>}
                  </div>
                </div>
                <div className="receipt__meta">
                  <span className="receipt__ref" dir="ltr">
                    {order.reference}
                  </span>
                  <small>{dateTime(order.createdAt)}</small>
                  <span className={`order-status order-status--${order.status}`}>
                    {ORDER_STATUS_LABELS[order.status]}
                  </span>
                </div>
              </header>

              <section className="receipt__timeline" aria-label="حالة الطلب">
                {order.status === "cancelled" ? (
                  <p className="order-cancelled">
                    <TriangleAlert size={16} aria-hidden="true" />
                    {ORDER_STATUS_HINTS.cancelled}
                  </p>
                ) : (
                  <ol>
                    {ORDER_STATUS_FLOW.map((status) => {
                      const entry = order.history.find((item) => item.status === status);
                      const reached = ORDER_STATUS_FLOW.indexOf(status) <=
                        ORDER_STATUS_FLOW.indexOf(order.status);
                      return (
                        <li
                          key={status}
                          className={reached ? "is-done" : ""}
                          aria-current={status === order.status ? "step" : undefined}
                        >
                          <span className="dot" aria-hidden="true">
                            {reached ? <CheckCircle2 size={14} /> : <Clock size={14} />}
                          </span>
                          <b>{ORDER_STATUS_LABELS[status]}</b>
                          {entry && <small>{dateTime(entry.at)}</small>}
                        </li>
                      );
                    })}
                  </ol>
                )}
                <p className="muted small">{ORDER_STATUS_HINTS[order.status]}</p>
              </section>

              <section className="receipt__parties">
                <div>
                  <h3>بيانات التوصيل</h3>
                  <p>{order.customer.name}</p>
                  <p dir="ltr">{order.customer.phone}</p>
                  {order.customer.altPhone && <p dir="ltr">{order.customer.altPhone}</p>}
                  <p>{order.customer.address}</p>
                  {(order.deliveryZoneName || order.customer.area) && (
                    <p>{order.deliveryZoneName || order.customer.area}</p>
                  )}
                  {order.customer.notes && <p className="muted">{order.customer.notes}</p>}
                </div>
                <div>
                  <h3>الدفع</h3>
                  <p>{PAYMENT_METHOD_LABELS[order.paymentMethod]}</p>
                  <p className="muted">{PAYMENT_STATUS_LABELS[order.paymentStatus]}</p>
                </div>
              </section>

              <table className="receipt__items">
                <caption className="sr-only">أصناف الطلب</caption>
                <thead>
                  <tr>
                    <th scope="col">الصنف</th>
                    <th scope="col">سعر الوحدة</th>
                    <th scope="col">الكمية</th>
                    <th scope="col">الإجمالي</th>
                  </tr>
                </thead>
                <tbody>
                  {order.items.map((item) => (
                    <tr key={item.productId}>
                      <td>
                        {item.name}
                        {item.size && item.size !== "—" && <small> — {item.size}</small>}
                      </td>
                      <td>
                        {formatMoney(item.unitPrice, order.currency)}
                        {item.discountPercent > 0 && (
                          <small className="muted"> (خصم {item.discountPercent}%)</small>
                        )}
                      </td>
                      <td>{item.quantity}</td>
                      <td>{formatMoney(item.lineTotal, order.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <dl className="totals-table receipt__totals">
                <div>
                  <dt>الإجمالي قبل التوصيل</dt>
                  <dd>{formatMoney(order.subtotal, order.currency)}</dd>
                </div>
                {order.discountTotal > 0 && (
                  <div className="totals-table__save">
                    <dt>إجمالي الخصم</dt>
                    <dd>{formatMoney(order.discountTotal, order.currency)}</dd>
                  </div>
                )}
                <div>
                  <dt>التوصيل</dt>
                  <dd>
                    {order.shipping === null
                      ? "يُحدَّد عند التأكيد"
                      : order.shipping === 0
                        ? "مجاني"
                        : formatMoney(order.shipping, order.currency)}
                  </dd>
                </div>
                <div className="totals-table__total">
                  <dt>الإجمالي</dt>
                  <dd>{formatMoney(order.total, order.currency)}</dd>
                </div>
              </dl>

              <footer className="receipt__foot">
                <p className="muted small">
                  هذا إيصال طلب للمتابعة بين العميل و{site.name}، وليس فاتورة ضريبية
                  رسمية.
                </p>
              </footer>
            </article>

            <div className="order-actions no-print">
              <button className="secondary-button" onClick={() => window.print()}>
                <Printer size={16} aria-hidden="true" />
                طباعة / حفظ PDF
              </button>
              {commerce.whatsappSummary && site.whatsapp && (
                <a
                  className="wa-button"
                  href={waLink(
                    site.whatsapp,
                    orderWhatsAppMessage(
                      { ...order, items: order.items },
                      site.name,
                    ),
                  )}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <WhatsAppIcon size={18} />
                  إرسال ملخص الطلب على واتساب
                </a>
              )}
            </div>
            {commerce.whatsappSummary && site.whatsapp && (
              <p className="muted small no-print">
                الزر يفتح محادثة واتساب بملخص الطلب جاهزًا — الطلب مسجّل لدينا بالفعل،
                وفتح المحادثة ليس شرطًا لتأكيده ولا يُعد إرسالًا تلقائيًا.
              </p>
            )}
          </>
        )}
      </main>
    </div>
  );
}
