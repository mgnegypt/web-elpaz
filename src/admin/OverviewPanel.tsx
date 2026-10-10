// Landing screen: personalised greeting, Egypt dates (Gregorian + Hijri),
// clock, live status and real numbers pulled from the same data the site uses.
// Nothing here is invented: every figure comes from the API, and anything the
// site does not have yet shows an empty state instead of a placeholder number.
import { useCallback, useEffect, useMemo, useState } from "react";
import { type ContentDoc } from "../../shared/content.ts";
import {
  adminApi,
  type AdminSession,
  type AuditEntry,
  type RequestsPage,
  type SiteEvent,
} from "./api";
import { clockTime, gregorianDate, hijriDate, shortDateTime } from "./dates";
import { Icons } from "./icons";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Grid,
  SkeletonRows,
  StatPill,
  StatusDot,
} from "./ui";

type Loadable<T> = { state: "loading" | "ready" | "error"; data: T };

export default function OverviewPanel({
  session,
  content,
  online,
  onNavigate,
}: {
  session: AdminSession;
  content: ContentDoc;
  online: boolean;
  onNavigate: (tab: string) => void;
}) {
  const [now, setNow] = useState(() => new Date());
  const [events, setEvents] = useState<Loadable<SiteEvent[]>>({
    state: "loading",
    data: [],
  });
  const [requests, setRequests] = useState<Loadable<RequestsPage | null>>({
    state: "loading",
    data: null,
  });
  const [activity, setActivity] = useState<Loadable<AuditEntry[]>>({
    state: "loading",
    data: [],
  });

  const isOwner = session.capabilities.manageAdmins;

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const load = useCallback(async () => {
    setEvents((current) => ({ ...current, state: "loading" }));
    setRequests((current) => ({ ...current, state: "loading" }));
    try {
      const result = await adminApi.events();
      setEvents({ state: "ready", data: result.items });
    } catch {
      setEvents({ state: "error", data: [] });
    }
    try {
      const result = await adminApi.requests({
        search: "",
        status: "all",
        page: 1,
      });
      setRequests({ state: "ready", data: result });
    } catch {
      setRequests({ state: "error", data: null });
    }
    if (!isOwner) {
      setActivity({ state: "ready", data: [] });
      return;
    }
    try {
      const result = await adminApi.audit({ limit: 6 });
      setActivity({ state: "ready", data: result.items });
    } catch {
      setActivity({ state: "error", data: [] });
    }
  }, [isOwner]);

  useEffect(() => {
    void load();
  }, [load]);

  const productStats = useMemo(() => {
    const products = content.products;
    return {
      total: products.length,
      newOnes: products.filter((product) => product.isNew).length,
      discounted: products.filter((product) => product.discountPercent > 0)
        .length,
      comingSoon: products.filter(
        (product) => product.availability === "coming_soon",
      ).length,
      outOfStock: products.filter((product) => product.quantity === 0).length,
      madeToOrder: products.filter(
        (product) => product.availability === "made_to_order",
      ).length,
    };
  }, [content.products]);

  const activeEvents = events.data.filter((event) => event.active).length;
  const requestItems = requests.data?.items ?? [];
  const pendingRequests = requestItems.filter(
    (request) => request.status === "new",
  ).length;

  const firstName = session.displayName.trim().split(/\s+/)[0] || session.displayName;

  return (
    <div className="overview">
      <section className="welcome-card">
        <div className="welcome-main">
          <span className="welcome-eyebrow">
            <Icons.sparkles size={15} />
            لوحة تحكم البان إلباظ
          </span>
          <h1>
            أهلًا بك، <strong>{firstName}</strong>
          </h1>
          <p>
            كل تعديل تحفظه هنا يظهر على الموقع مباشرة، بدون تحديث يدوي.
            {session.role === "owner"
              ? " وأنت تدخل بصلاحية المالك الكاملة."
              : " ودورك مشرف على المحتوى والطلبات."}
          </p>
          <div className="welcome-meta">
            <span className="welcome-chip">
              <Icons.calendar size={15} />
              {gregorianDate(now)}
            </span>
            <span className="welcome-chip">
              <Icons.calendarRange size={15} />
              {hijriDate(now)}
            </span>
            <span className="welcome-chip welcome-clock" dir="ltr">
              <Icons.clock size={15} />
              {clockTime(now)}
            </span>
            <span className="welcome-tz">بتوقيت القاهرة</span>
          </div>
        </div>

        <div className="welcome-side">
          <div className="welcome-identity">
            {session.avatarUrl ? (
              <img src={session.avatarUrl} alt="" className="welcome-avatar" />
            ) : (
              <span className="welcome-avatar avatar-fallback">
                {session.displayName.trim().charAt(0) || "؟"}
              </span>
            )}
            <span className="welcome-identity-text">
              <strong>{session.displayName}</strong>
              <small dir="ltr">{session.username}</small>
            </span>
          </div>
          <div className="welcome-flags">
            <Badge
              tone={session.role === "owner" ? "green" : "violet"}
              icon={<Icons.shield size={14} />}
            >
              {session.role === "owner" ? "مالك" : "مشرف"}
            </Badge>
            <span className="welcome-events">
              <Icons.bell size={14} />
              {activeEvents > 0
                ? `${activeEvents} مناسبة ظاهرة على الموقع`
                : "لا توجد مناسبات ظاهرة"}
            </span>
            <StatusDot
              online={online}
              label={online ? "التحديث الفوري متصل" : "إعادة الاتصال…"}
            />
          </div>
        </div>
      </section>

      <div className="stat-row">
        <StatPill
          label="إجمالي المنتجات"
          value={productStats.total}
          tone="blue"
          icon={<Icons.package size={18} />}
          onClick={() => onNavigate("products")}
        />
        <StatPill
          label="منتجات جديدة"
          value={productStats.newOnes}
          tone="violet"
          icon={<Icons.sparkles size={18} />}
          onClick={() => onNavigate("products")}
        />
        <StatPill
          label="عليها خصم"
          value={productStats.discounted}
          tone="amber"
          icon={<Icons.badgePercent size={18} />}
          onClick={() => onNavigate("products")}
        />
        <StatPill
          label="مناسبات ظاهرة"
          value={events.state === "loading" ? "…" : activeEvents}
          tone="green"
          icon={<Icons.events size={18} />}
          onClick={() => onNavigate("events")}
        />
        <StatPill
          label="طلبات جملة جديدة"
          value={requests.state === "loading" ? "…" : pendingRequests}
          tone="red"
          icon={<Icons.truck size={18} />}
          onClick={() => onNavigate("requests")}
        />
      </div>

      <Grid columns={2}>
        <Card
          title="إجراءات سريعة"
          description="اختصارات لأكثر المهام تكرارًا."
          icon={<Icons.gauge size={18} />}
        >
          <div className="quick-actions">
            <button
              type="button"
              className="quick-action"
              onClick={() => onNavigate("products")}
            >
              <span className="quick-action-icon">
                <Icons.plus size={18} />
              </span>
              <span className="quick-action-text">
                <strong>إضافة منتج</strong>
                <small>يظهر على الموقع فور النشر</small>
              </span>
              <Icons.chevronLeft size={16} className="quick-action-go" />
            </button>
            <button
              type="button"
              className="quick-action"
              onClick={() => onNavigate("events")}
            >
              <span className="quick-action-icon">
                <Icons.events size={18} />
              </span>
              <span className="quick-action-text">
                <strong>إنشاء مناسبة</strong>
                <small>عرض أو تنبيه في شريط الموقع</small>
              </span>
              <Icons.chevronLeft size={16} className="quick-action-go" />
            </button>
            <button
              type="button"
              className="quick-action"
              onClick={() => onNavigate("content")}
            >
              <span className="quick-action-icon">
                <Icons.palette size={18} />
              </span>
              <span className="quick-action-text">
                <strong>تعديل نصوص الموقع</strong>
                <small>الشعار، الواجهة، التواصل</small>
              </span>
              <Icons.chevronLeft size={16} className="quick-action-go" />
            </button>
            <button
              type="button"
              className="quick-action"
              onClick={() => onNavigate("requests")}
            >
              <span className="quick-action-icon">
                <Icons.inbox size={18} />
              </span>
              <span className="quick-action-text">
                <strong>مراجعة طلبات الجملة</strong>
                <small>
                  {pendingRequests > 0
                    ? `${pendingRequests} طلب بانتظار المراجعة`
                    : "لا توجد طلبات جديدة"}
                </small>
              </span>
              <Icons.chevronLeft size={16} className="quick-action-go" />
            </button>
          </div>
        </Card>

        <Card
          title="حالة المنتجات"
          description="لمحة سريعة على ما يراه الزائر الآن."
          icon={<Icons.package size={18} />}
          actions={
            <Button
              variant="ghost"
              size="sm"
              trailingIcon={<Icons.chevronLeft size={16} />}
              onClick={() => onNavigate("products")}
            >
              إدارة المنتجات
            </Button>
          }
        >
          {productStats.total === 0 ? (
            <EmptyState
              compact
              icon={<Icons.package size={24} />}
              title="لا توجد منتجات بعد"
              description="أضف أول منتج ليظهر في صفحة المنتجات على الموقع."
              action={
                <Button
                  size="sm"
                  icon={<Icons.plus size={16} />}
                  onClick={() => onNavigate("products")}
                >
                  إضافة منتج
                </Button>
              }
            />
          ) : (
            <ul className="mini-list">
              <li>
                <span>متاح الآن</span>
                <strong>
                  {productStats.total -
                    productStats.comingSoon -
                    productStats.madeToOrder}
                </strong>
              </li>
              <li>
                <span>قريبًا</span>
                <strong>{productStats.comingSoon}</strong>
              </li>
              <li>
                <span>يُصنع حسب الطلب</span>
                <strong>{productStats.madeToOrder}</strong>
              </li>
              <li>
                <span>الكمية صفر</span>
                <strong
                  className={productStats.outOfStock > 0 ? "is-warn" : ""}
                >
                  {productStats.outOfStock}
                </strong>
              </li>
            </ul>
          )}
        </Card>
      </Grid>

      <Grid columns={2}>
        <Card
          title="أحدث المناسبات"
          icon={<Icons.events size={18} />}
          actions={
            <Button
              variant="ghost"
              size="sm"
              trailingIcon={<Icons.chevronLeft size={16} />}
              onClick={() => onNavigate("events")}
            >
              عرض الكل
            </Button>
          }
        >
          {events.state === "loading" ? (
            <SkeletonRows rows={3} height={44} />
          ) : events.state === "error" ? (
            <ErrorState
              description="تعذّر تحميل المناسبات."
              onRetry={() => void load()}
            />
          ) : events.data.length === 0 ? (
            <EmptyState
              compact
              icon={<Icons.events size={24} />}
              title="لا توجد مناسبات"
              description="أنشئ مناسبة لعرض تنبيه أو عرض خاص أعلى الموقع."
            />
          ) : (
            <ul className="timeline">
              {events.data.slice(0, 4).map((event) => (
                <li key={event.id}>
                  <span
                    className={`timeline-dot${event.active ? " timeline-dot--on" : ""}`}
                    aria-hidden="true"
                  />
                  <div className="timeline-text">
                    <strong>{event.title}</strong>
                    <small>
                      {event.active ? "ظاهرة الآن" : "مخفية"} ·{" "}
                      {shortDateTime(event.updatedAt)}
                    </small>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card
          title="أحدث طلبات الجملة"
          icon={<Icons.truck size={18} />}
          actions={
            <Button
              variant="ghost"
              size="sm"
              trailingIcon={<Icons.chevronLeft size={16} />}
              onClick={() => onNavigate("requests")}
            >
              عرض الكل
            </Button>
          }
        >
          {requests.state === "loading" ? (
            <SkeletonRows rows={3} height={44} />
          ) : requests.state === "error" ? (
            <ErrorState
              description="تعذّر تحميل الطلبات."
              onRetry={() => void load()}
            />
          ) : requestItems.length === 0 ? (
            <EmptyState
              compact
              icon={<Icons.inbox size={24} />}
              title="لا توجد طلبات بعد"
              description="تظهر هنا طلبات الجملة القادمة من نموذج الموقع."
            />
          ) : (
            <ul className="timeline">
              {requestItems.slice(0, 4).map((request) => (
                <li key={request.id}>
                  <span
                    className={`timeline-dot${request.status === "new" ? " timeline-dot--on" : ""}`}
                    aria-hidden="true"
                  />
                  <div className="timeline-text">
                    <strong>{request.name}</strong>
                    <small>
                      {request.product} · {request.quantity} {request.unit} ·{" "}
                      {shortDateTime(request.createdAt)}
                    </small>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </Grid>

      {isOwner && (
        <Card
          title="آخر النشاط"
          description="أحدث ما جرى على اللوحة."
          icon={<Icons.activity size={18} />}
          actions={
            <Button
              variant="ghost"
              size="sm"
              trailingIcon={<Icons.chevronLeft size={16} />}
              onClick={() => onNavigate("audit")}
            >
              سجل النشاط
            </Button>
          }
        >
          {activity.state === "loading" ? (
            <SkeletonRows rows={3} height={40} />
          ) : activity.state === "error" ? (
            <ErrorState
              description="تعذّر تحميل سجل النشاط."
              onRetry={() => void load()}
            />
          ) : activity.data.length === 0 ? (
            <EmptyState
              compact
              icon={<Icons.activity size={24} />}
              title="لا يوجد نشاط مسجّل بعد"
            />
          ) : (
            <ul className="timeline">
              {activity.data.slice(0, 5).map((entry) => (
                <li key={entry.id}>
                  <span
                    className={`timeline-dot${entry.suspicious ? " timeline-dot--warn" : ""}`}
                    aria-hidden="true"
                  />
                  <div className="timeline-text">
                    <strong>{entry.detail || entry.kind}</strong>
                    <small>
                      {entry.actorName || "غير معروف"} ·{" "}
                      {shortDateTime(entry.at)}
                    </small>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </div>
  );
}
