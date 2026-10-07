// Landing screen: personalised greeting, Egypt dates (Gregorian + Hijri), clock,
// live status and quick numbers pulled from the same data the site uses.
import { useEffect, useMemo, useState } from "react";
import { AVAILABILITY_LABELS, type ContentDoc } from "../../shared/content.ts";
import { adminApi, type AdminSession, type RequestsPage, type SiteEvent } from "./api";
import { clockTime, gregorianDate, hijriDate, shortDateTime } from "./dates";
import { Icons } from "./icons";
import { Badge, Button, Card, EmptyState, Grid, Skeleton, StatusDot } from "./ui";
import { StatPill } from "./ProductsPanel";

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
  const [events, setEvents] = useState<SiteEvent[] | null>(null);
  const [requests, setRequests] = useState<RequestsPage | null>(null);

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const result = await adminApi.events();
        if (live) setEvents(result.items);
      } catch {
        if (live) setEvents([]);
      }
      try {
        const result = await adminApi.requests({ search: "", status: "all", page: 1 });
        if (live) setRequests(result);
      } catch {
        if (live) setRequests({ items: [], total: 0, page: 1, pageSize: 0, pages: 1 });
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  const productStats = useMemo(() => {
    const products = content.products;
    return {
      total: products.length,
      newOnes: products.filter((product) => product.isNew).length,
      discounted: products.filter((product) => product.discountPercent > 0).length,
      comingSoon: products.filter((product) => product.availability === "coming_soon").length,
      outOfStock: products.filter((product) => product.quantity === 0).length,
    };
  }, [content.products]);

  const activeEvents = (events ?? []).filter((event) => event.active).length;
  const pendingRequests = (requests?.items ?? []).filter((request) => request.status === "new").length;

  return (
    <div className="overview">
      <section className="welcome-card">
        <div className="welcome-main">
          <span className="welcome-eyebrow">
            <Icons.sparkles size={15} />
            لوحة تحكم البان إلباظ
          </span>
          <h1>
            أهلًا بك، <strong>{session.displayName}</strong>
          </h1>
          <p>
            كل تعديل تحفظه هنا يظهر على الموقع مباشرة، بدون تحديث يدوي.
            {session.role === "owner" ? " وأنت تدخل بصلاحية المالك الكاملة." : " ودورك مشرف على المحتوى والطلبات."}
          </p>
          <div className="welcome-meta">
            <span>
              <Icons.calendar size={15} />
              {gregorianDate(now)}
            </span>
            <span>
              <Icons.calendarRange size={15} />
              {hijriDate(now)}
            </span>
            <span className="welcome-clock" dir="ltr">
              <Icons.clock size={15} />
              {clockTime(now)}
            </span>
            <span className="welcome-tz">بتوقيت القاهرة</span>
          </div>
        </div>
        <div className="welcome-side">
          <StatusDot online={online} label={online ? "التحديث الفوري متصل" : "إعادة الاتصال…"} />
          <Badge tone={session.role === "owner" ? "green" : "violet"} icon={<Icons.shield size={14} />}>
            {session.role === "owner" ? "مالك" : "مشرف"}
          </Badge>
          <span className="welcome-user">
            <Icons.user size={15} />
            {session.username}
          </span>
        </div>
      </section>

      <div className="stat-row">
        <StatPill label="المنتجات" value={productStats.total} tone="blue" icon={<Icons.package size={16} />} />
        <StatPill label="منتجات جديدة" value={productStats.newOnes} tone="red" icon={<Icons.sparkles size={16} />} />
        <StatPill label="عليها خصم" value={productStats.discounted} tone="amber" icon={<Icons.badgePercent size={16} />} />
        <StatPill label="مناسبات ظاهرة" value={activeEvents} tone="violet" icon={<Icons.events size={16} />} />
        <StatPill label="طلبات جديدة" value={pendingRequests} tone="green" icon={<Icons.truck size={16} />} />
      </div>

      <Grid columns={2}>
        <Card
          title="إجراءات سريعة"
          description="اختصارات لأكثر المهام تكرارًا."
          icon={<Icons.gauge size={18} />}
        >
          <div className="quick-actions">
            <Button variant="soft" icon={<Icons.plus size={16} />} onClick={() => onNavigate("products")}>
              إضافة منتج
            </Button>
            <Button variant="soft" icon={<Icons.upload size={16} />} onClick={() => onNavigate("products")}>
              رفع صورة منتج
            </Button>
            <Button variant="soft" icon={<Icons.events size={16} />} onClick={() => onNavigate("events")}>
              إنشاء مناسبة
            </Button>
            <Button variant="soft" icon={<Icons.palette size={16} />} onClick={() => onNavigate("content")}>
              تعديل الشعار والنصوص
            </Button>
            <Button variant="soft" icon={<Icons.userCog size={16} />} onClick={() => onNavigate("profile")}>
              الملف الشخصي
            </Button>
            {session.capabilities.manageAdmins && (
              <Button variant="soft" icon={<Icons.users size={16} />} onClick={() => onNavigate("admins")}>
                حسابات المشرفين
              </Button>
            )}
          </div>
        </Card>

        <Card
          title="حالة المنتجات"
          description="لمحة سريعة قبل النشر."
          icon={<Icons.package size={18} />}
          actions={
            <Button variant="ghost" size="sm" icon={<Icons.chevronLeft size={16} />} onClick={() => onNavigate("products")}>
              إدارة المنتجات
            </Button>
          }
        >
          <ul className="mini-list">
            <li>
              <span>قريبًا</span>
              <strong>{productStats.comingSoon}</strong>
            </li>
            <li>
              <span>كمية صفر</span>
              <strong>{productStats.outOfStock}</strong>
            </li>
            <li>
              <span>أنواع التوفر المتاحة</span>
              <strong>{Object.keys(AVAILABILITY_LABELS).length}</strong>
            </li>
          </ul>
        </Card>
      </Grid>

      <Grid columns={2}>
        <Card
          title="أحدث المناسبات"
          icon={<Icons.events size={18} />}
          actions={
            <Button variant="ghost" size="sm" icon={<Icons.chevronLeft size={16} />} onClick={() => onNavigate("events")}>
              الكل
            </Button>
          }
        >
          {events === null ? (
            <div className="skeleton-lines">
              <Skeleton height={40} radius={10} />
              <Skeleton height={40} radius={10} />
            </div>
          ) : events.length === 0 ? (
            <EmptyState icon={<Icons.events size={26} />} title="لا توجد مناسبات" description="أضف عرضًا أو تنبيهًا." />
          ) : (
            <ul className="timeline">
              {events.slice(0, 4).map((event) => (
                <li key={event.id}>
                  <span className={`dot${event.active ? " dot--on" : ""}`} />
                  <div>
                    <strong>{event.title}</strong>
                    <small>
                      {event.active ? "ظاهرة الآن" : "مخفية"} · {shortDateTime(event.updatedAt)}
                    </small>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card
          title="أحدث الطلبات"
          icon={<Icons.truck size={18} />}
          actions={
            <Button variant="ghost" size="sm" icon={<Icons.chevronLeft size={16} />} onClick={() => onNavigate("requests")}>
              الكل
            </Button>
          }
        >
          {requests === null ? (
            <div className="skeleton-lines">
              <Skeleton height={40} radius={10} />
              <Skeleton height={40} radius={10} />
            </div>
          ) : requests.items.length === 0 ? (
            <EmptyState icon={<Icons.truck size={26} />} title="لا توجد طلبات بعد" />
          ) : (
            <ul className="timeline">
              {requests.items.slice(0, 4).map((request) => (
                <li key={request.id}>
                  <span className="dot" />
                  <div>
                    <strong>{request.name}</strong>
                    <small>
                      {request.product} · {request.quantity} {request.unit} · {shortDateTime(request.createdAt)}
                    </small>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </Grid>
    </div>
  );
}
