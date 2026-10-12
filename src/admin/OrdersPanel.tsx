// Customer orders: the operational view. Read them, filter them, move them
// through the workflow and record payment. Every number here comes from the
// stored orders — nothing on this screen is estimated or sampled.
import { useCallback, useEffect, useState } from "react";
import {
  ORDER_STATUSES,
  ORDER_STATUS_LABELS,
  ORDER_STATUS_TRANSITIONS,
  PAYMENT_METHOD_LABELS,
  PAYMENT_STATUS_LABELS,
  formatMoney,
  type Order,
  type OrderStatus,
} from "../../shared/orders.ts";
import type { Content } from "../../shared/content.ts";
import { adminApi, type OrdersPage } from "./api";
import { shortDateTime } from "./dates";
import { Icons } from "./icons";
import {
  Badge,
  Button,
  Card,
  Drawer,
  EmptyState,
  ErrorState,
  Grid,
  PageHeader,
  SearchInput,
  SegmentedControl,
  SkeletonRows,
  StatPill,
  TableWrap,
  Toolbar,
  describeError,
  useToast,
} from "./ui";

const TONE: Record<OrderStatus, "amber" | "blue" | "green" | "neutral" | "red"> = {
  pending: "amber",
  confirmed: "blue",
  preparing: "blue",
  out_for_delivery: "amber",
  delivered: "green",
  cancelled: "red",
};

const PAGE_SIZE = 25;

/** Products the owner tracks that are at or near zero. */
const lowStock = (content: Content | null) =>
  (content?.products ?? [])
    .filter(
      (product) =>
        product.quantity !== null &&
        product.availability === "available" &&
        product.quantity <= 5,
    )
    .sort((a, b) => (a.quantity ?? 0) - (b.quantity ?? 0))
    .slice(0, 6);

export default function OrdersPanel({ content }: { content: Content | null }) {
  const [data, setData] = useState<OrdersPage | null>(null);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<Order | null>(null);
  const [note, setNote] = useState("");
  const toast = useToast();

  const load = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      setData(
        await adminApi.orders({
          search,
          status,
          limit: PAGE_SIZE,
          offset: page * PAGE_SIZE,
        }),
      );
    } catch (failure) {
      setError(describeError(failure));
    } finally {
      setBusy(false);
    }
  }, [search, status, page]);

  useEffect(() => {
    const timer = setTimeout(() => void load(), search ? 300 : 0);
    return () => clearTimeout(timer);
  }, [load, search]);

  const apply = async (
    order: Order,
    patch: { status?: OrderStatus; paymentStatus?: "paid" | "unpaid" },
  ) => {
    setBusy(true);
    try {
      const result = await adminApi.updateOrder(order.id, { ...patch, note });
      setNote("");
      setData((current) =>
        current
          ? {
              ...current,
              items: current.items.map((item) =>
                item.id === order.id ? result.order : item,
              ),
            }
          : current,
      );
      setOpen((current) => (current?.id === order.id ? result.order : current));
      toast.push("success", "تم تحديث الطلب.");
      // Cancelling returns stock, so the figures above change too.
      await load();
    } catch (failure) {
      toast.push("error", describeError(failure));
    } finally {
      setBusy(false);
    }
  };

  const items = data?.items ?? [];
  const stats = data?.stats;
  const currency = stats?.currency || content?.commerce.currency || "";
  const low = lowStock(content);
  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  return (
    <>
      <PageHeader
        title="الطلبات"
        description="طلبات العملاء من المتجر، بحالتها الحالية وسجل تحديثها."
        actions={
          <Button
            variant="secondary"
            icon={<Icons.refresh size={16} />}
            onClick={() => void load()}
            loading={busy && data !== null}
            data-testid="reload-orders"
          >
            تحديث القائمة
          </Button>
        }
      />

      {!content?.commerce.ordersEnabled && (
        <Card
          title="الطلب أونلاين متوقف"
          icon={<Icons.alert size={18} />}
          description="لن يتمكن العملاء من إنشاء طلبات جديدة حتى تفعيل الخيار من «محتوى الموقع ← المتجر»."
        />
      )}

      <div className="stat-row">
        <StatPill
          label="إجمالي الطلبات"
          value={stats?.total ?? 0}
          tone="blue"
          icon={<Icons.inbox size={18} />}
        />
        <StatPill
          label="بانتظار التأكيد"
          value={stats?.byStatus.pending ?? 0}
          tone="amber"
          icon={<Icons.bell size={18} />}
        />
        <StatPill
          label="الإيرادات (عدا الملغي)"
          value={formatMoney(stats?.revenue ?? 0, currency)}
          tone="green"
          icon={<Icons.trend size={18} />}
        />
        <StatPill
          label="طلبات آخر 7 أيام"
          value={stats?.last7Days ?? 0}
          tone="neutral"
          icon={<Icons.calendar size={18} />}
        />
      </div>

      <Grid columns={2}>
        <Card title="الأكثر مبيعًا" icon={<Icons.star size={18} />}>
          {stats?.bestSellers.length ? (
            <ul className="plain-list">
              {stats.bestSellers.map((entry) => (
                <li key={entry.productId}>
                  <span>{entry.name}</span>
                  <strong dir="ltr">
                    {entry.quantity} × — {formatMoney(entry.revenue, currency)}
                  </strong>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted-text">لا توجد مبيعات مسجّلة بعد.</p>
          )}
        </Card>
        <Card
          title="مخزون منخفض"
          icon={<Icons.packageSearch size={18} />}
          description="المنتجات التي تتابع كميتها وأوشكت على النفاد."
        >
          {low.length ? (
            <ul className="plain-list">
              {low.map((product) => (
                <li key={product.id}>
                  <span>{product.name}</span>
                  <strong dir="ltr">{product.quantity}</strong>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted-text">
              لا توجد منتجات بكميات منخفضة، أو لم تُفعَّل متابعة الكميات.
            </p>
          )}
        </Card>
      </Grid>

      <Card
        title="قائمة الطلبات"
        icon={<Icons.clipboard size={18} />}
        description={
          data ? `${data.total} طلب — صفحة ${page + 1} من ${pages}` : undefined
        }
      >
        <Toolbar>
          <SearchInput
            value={search}
            onChange={(value) => {
              setPage(0);
              setSearch(value);
            }}
            label="ابحث برقم الطلب أو اسم العميل أو الهاتف"
            placeholder="ابحث برقم الطلب أو العميل…"
          />
          <SegmentedControl
            label="تصفية الحالة"
            value={status}
            onChange={(value) => {
              setStatus(value);
              setPage(0);
            }}
            options={[
              { value: "", label: "الكل" },
              ...ORDER_STATUSES.map((value) => ({
                value,
                label: ORDER_STATUS_LABELS[value],
              })),
            ]}
          />
        </Toolbar>

        {error ? (
          <ErrorState description={error} onRetry={() => void load()} />
        ) : busy && !data ? (
          <SkeletonRows rows={4} height={56} />
        ) : items.length === 0 ? (
          <EmptyState
            icon={<Icons.inbox size={30} />}
            title={search || status ? "لا توجد طلبات مطابقة" : "لا توجد طلبات بعد"}
            description={
              search || status
                ? "جرّب مسح البحث أو اختيار «الكل»."
                : "ستظهر هنا طلبات العملاء فور إنشائها من المتجر."
            }
          />
        ) : (
          <>
            <TableWrap label="جدول الطلبات">
              <table className="data-table data-table--wide">
                <thead>
                  <tr>
                    <th>رقم الطلب</th>
                    <th>العميل</th>
                    <th>الأصناف</th>
                    <th>الإجمالي</th>
                    <th>الحالة</th>
                    <th>الدفع</th>
                    <th>التاريخ</th>
                    <th>
                      <span className="visually-hidden">إجراءات</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((order) => (
                    <tr key={order.id} data-testid={`order-row-${order.id}`}>
                      <td data-label="رقم الطلب" dir="ltr">
                        {order.reference}
                      </td>
                      <td data-label="العميل">
                        <div className="cell-stack">
                          <strong>{order.customer.name}</strong>
                          <a className="cell-link" href={`tel:${order.customer.phone}`} dir="ltr">
                            {order.customer.phone}
                          </a>
                        </div>
                      </td>
                      <td data-label="الأصناف" dir="ltr">
                        {order.itemCount}
                      </td>
                      <td data-label="الإجمالي">
                        {formatMoney(order.total, order.currency)}
                      </td>
                      <td data-label="الحالة">
                        <Badge tone={TONE[order.status]}>
                          {ORDER_STATUS_LABELS[order.status]}
                        </Badge>
                      </td>
                      <td data-label="الدفع">
                        <span className="muted-text">
                          {PAYMENT_STATUS_LABELS[order.paymentStatus]}
                        </span>
                      </td>
                      <td data-label="التاريخ" dir="ltr">
                        {shortDateTime(order.createdAt)}
                      </td>
                      <td data-label="إجراءات">
                        <Button
                          variant="secondary"
                          onClick={() => {
                            setNote("");
                            setOpen(order);
                          }}
                        >
                          التفاصيل
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>

            {pages > 1 && (
              <div className="pager-row">
                <Button
                  variant="secondary"
                  disabled={page === 0}
                  onClick={() => setPage((value) => Math.max(0, value - 1))}
                >
                  السابق
                </Button>
                <span className="muted-text">
                  صفحة {page + 1} من {pages}
                </span>
                <Button
                  variant="secondary"
                  disabled={page + 1 >= pages}
                  onClick={() => setPage((value) => value + 1)}
                >
                  التالي
                </Button>
              </div>
            )}
          </>
        )}
      </Card>

      <Drawer
        open={open !== null}
        title={open ? `طلب ${open.reference}` : ""}
        onClose={() => setOpen(null)}
      >
        {open && (
          <div className="order-detail">
            <section>
              <h4>العميل</h4>
              <p>{open.customer.name}</p>
              <p dir="ltr">{open.customer.phone}</p>
              {open.customer.altPhone && <p dir="ltr">{open.customer.altPhone}</p>}
              <p>{open.customer.address}</p>
              {(open.deliveryZoneName || open.customer.area) && (
                <p>{open.deliveryZoneName || open.customer.area}</p>
              )}
              {open.customer.notes && (
                <p className="muted-text">ملاحظات العميل: {open.customer.notes}</p>
              )}
            </section>

            <section>
              <h4>الأصناف</h4>
              <ul className="plain-list">
                {open.items.map((item) => (
                  <li key={item.productId}>
                    <span>
                      {item.name} × {item.quantity}
                    </span>
                    <strong>{formatMoney(item.lineTotal, open.currency)}</strong>
                  </li>
                ))}
              </ul>
              <ul className="plain-list">
                <li>
                  <span>الإجمالي قبل التوصيل</span>
                  <strong>{formatMoney(open.subtotal, open.currency)}</strong>
                </li>
                <li>
                  <span>التوصيل</span>
                  <strong>
                    {open.shipping === null
                      ? "يُحدَّد عند التأكيد"
                      : formatMoney(open.shipping, open.currency)}
                  </strong>
                </li>
                <li>
                  <span>الإجمالي</span>
                  <strong>{formatMoney(open.total, open.currency)}</strong>
                </li>
                <li>
                  <span>طريقة الدفع</span>
                  <strong>{PAYMENT_METHOD_LABELS[open.paymentMethod]}</strong>
                </li>
              </ul>
            </section>

            <section>
              <h4>سجل الحالة</h4>
              <ul className="timeline-list">
                {open.history.map((entry, index) => (
                  <li key={`${entry.status}-${index}`}>
                    <strong>{ORDER_STATUS_LABELS[entry.status]}</strong>
                    <span dir="ltr">{shortDateTime(entry.at)}</span>
                    {entry.note && <small>{entry.note}</small>}
                  </li>
                ))}
              </ul>
            </section>

            <section>
              <h4>تحديث الحالة</h4>
              {ORDER_STATUS_TRANSITIONS[open.status].length === 0 ? (
                <p className="muted-text">
                  هذا الطلب في حالة نهائية ولا يمكن تغييرها.
                </p>
              ) : (
                <>
                  <label className="field-label" htmlFor="order-note">
                    ملاحظة داخلية (اختيارية، لا تظهر للعميل)
                  </label>
                  <input
                    id="order-note"
                    className="input"
                    value={note}
                    maxLength={300}
                    onChange={(event) => setNote(event.target.value)}
                  />
                  <div className="row-actions order-actions-row">
                    {ORDER_STATUS_TRANSITIONS[open.status].map((next) => (
                      <Button
                        key={next}
                        variant={next === "cancelled" ? "danger" : "primary"}
                        disabled={busy}
                        onClick={() => void apply(open, { status: next })}
                      >
                        {ORDER_STATUS_LABELS[next]}
                      </Button>
                    ))}
                  </div>
                  {ORDER_STATUS_TRANSITIONS[open.status].includes("cancelled") && (
                    <p className="muted-text">
                      الإلغاء يعيد الكميات المحجوزة إلى المخزون تلقائيًا.
                    </p>
                  )}
                </>
              )}
            </section>

            <section>
              <h4>الدفع</h4>
              <p className="muted-text">
                الحالة الحالية: {PAYMENT_STATUS_LABELS[open.paymentStatus]}
              </p>
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() =>
                  void apply(open, {
                    paymentStatus: open.paymentStatus === "paid" ? "unpaid" : "paid",
                  })
                }
              >
                {open.paymentStatus === "paid"
                  ? "وضع علامة غير مدفوع"
                  : "تسجيل تحصيل المبلغ"}
              </Button>
            </section>
          </div>
        )}
      </Drawer>
    </>
  );
}
