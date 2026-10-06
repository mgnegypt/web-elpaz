// Owner-only activity log. Shows the audit trail the server writes for every
// sensitive action, with a suspicious-activity summary at the top. It is a read
// view: nothing here can change behaviour, and no secret is ever displayed.
import { useCallback, useEffect, useState } from "react";
import { adminApi, type AuditEntry, type AuditSummary } from "./api";
import { Icons } from "./icons";
import {
  Badge,
  Card,
  PageHeader,
  Skeleton,
  describeError,
  useToast,
} from "./ui";
import { StatPill } from "./ProductsPanel";
import { shortDateTime } from "./dates";

const KIND_LABELS: { match: RegExp; label: string }[] = [
  { match: /^login\.success$/, label: "دخول ناجح" },
  { match: /^login\.password-ok$/, label: "كلمة المرور صحيحة" },
  { match: /^login\.failed$/, label: "محاولة دخول فاشلة" },
  { match: /^login\.security-failed$/, label: "إجابة سؤال أمان خاطئة" },
  { match: /^login\.blocked$/, label: "محاولة محظورة مؤقتًا" },
  { match: /^logout$/, label: "تسجيل خروج" },
  { match: /^setup\./, label: "تهيئة النظام" },
  { match: /^profile\./, label: "تعديل الملف الشخصي" },
  { match: /^admin\./, label: "إدارة الحسابات" },
  { match: /^product\./, label: "تعديل منتج" },
  { match: /^content\./, label: "تعديل محتوى" },
  { match: /^event\./, label: "إدارة مناسبة" },
  { match: /^upload\./, label: "رفع صورة" },
  { match: /^(csrf|origin)\./, label: "طلب مرفوض" },
  { match: /^authz\./, label: "صلاحية مرفوضة" },
  { match: /^ratelimit\./, label: "تجاوز حد الطلبات" },
];

const labelFor = (kind: string) =>
  KIND_LABELS.find((entry) => entry.match.test(kind))?.label ?? kind;

export default function AuditPanel() {
  const toast = useToast();
  const [items, setItems] = useState<AuditEntry[] | null>(null);
  const [summary, setSummary] = useState<AuditSummary | null>(null);
  const [filter, setFilter] = useState<"all" | "suspicious">("all");

  const load = useCallback(
    async (onlySuspicious: boolean) => {
      try {
        const data = await adminApi.audit({
          limit: 120,
          suspicious: onlySuspicious,
        });
        setItems(data.items);
        setSummary(data.summary);
      } catch (failure) {
        toast.push("error", describeError(failure));
      }
    },
    [toast],
  );

  useEffect(() => {
    void load(filter === "suspicious");
  }, [filter, load]);

  const suspicious = summary?.suspicious ?? 0;

  return (
    <>
      <PageHeader
        title="سجل النشاط"
        description="كل عملية حساسة تُسجَّل هنا: تسجيل الدخول، الحسابات، المحتوى، الصور والطلبات المرفوضة."
      />

      <div className="stats-row">
        <StatPill
          label="إجمالي الأحداث"
          value={summary?.total ?? 0}
          tone="blue"
          icon={<Icons.activity size={16} />}
        />
        <StatPill
          label="آخر ٢٤ ساعة"
          value={summary?.last24h ?? 0}
          tone="green"
          icon={<Icons.clock size={16} />}
        />
        <StatPill
          label="أحداث مريبة"
          value={suspicious}
          tone={suspicious > 0 ? "red" : "violet"}
          icon={<Icons.alert size={16} />}
        />
      </div>

      {suspicious > 0 && (
        <p className="audit-banner" role="status">
          <Icons.shield size={18} />
          <span>
            هناك {suspicious} حدثًا يحتاج مراجعة: محاولات دخول فاشلة أو طلبات
            مرفوضة. راجعها بالأسفل.
          </span>
        </p>
      )}

      <Card
        title="آخر الأحداث"
        className="audit-card"
        actions={
          <div className="segmented" role="group" aria-label="تصفية السجل">
            <button
              type="button"
              className={`segmented-item${filter === "all" ? " is-active" : ""}`}
              aria-pressed={filter === "all"}
              onClick={() => setFilter("all")}
            >
              الكل
            </button>
            <button
              type="button"
              className={`segmented-item${filter === "suspicious" ? " is-active" : ""}`}
              aria-pressed={filter === "suspicious"}
              onClick={() => setFilter("suspicious")}
            >
              المريبة فقط
            </button>
          </div>
        }
      >
        {items === null ? (
          <div className="audit-skeleton">
            {[0, 1, 2, 3, 4].map((row) => (
              <Skeleton key={row} height={38} />
            ))}
          </div>
        ) : items.length === 0 ? (
          <p className="empty-note">
            <Icons.info size={16} />
            لا توجد أحداث مسجّلة بعد.
          </p>
        ) : (
          <ul className="audit-list">
            {items.map((entry) => (
              <li
                key={entry.id}
                className={`audit-row${entry.suspicious ? " audit-row--flag" : ""}`}
              >
                <span
                  className={`audit-dot${entry.suspicious ? " audit-dot--flag" : ""}`}
                  aria-hidden="true"
                />
                <div className="audit-main">
                  <div className="audit-head">
                    <strong>{labelFor(entry.kind)}</strong>
                    {entry.suspicious && <Badge tone="red">يحتاج مراجعة</Badge>}
                  </div>
                  <p className="audit-detail">
                    {entry.detail || entry.kind}
                    {entry.actorName ? ` — ${entry.actorName}` : ""}
                  </p>
                </div>
                <div className="audit-meta">
                  <span dir="ltr">{entry.ip || "—"}</span>
                  <time>{shortDateTime(entry.at)}</time>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
