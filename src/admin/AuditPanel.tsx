// Owner-only activity log. Shows the audit trail the server writes for every
// sensitive action, with a suspicious-activity summary at the top. It is a read
// view: nothing here can change behaviour, and no secret is ever displayed.
import { useCallback, useEffect, useState } from "react";
import { adminApi, type AuditEntry, type AuditSummary } from "./api";
import { Icons } from "./icons";
import {
  Badge,
  Card,
  EmptyState,
  Notice,
  PageHeader,
  SegmentedControl,
  SkeletonRows,
  StatPill,
  describeError,
  useToast,
} from "./ui";
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

/**
 * The server writes short English notes next to each event. Administrators
 * should never have to read them, so the known sentences are translated here
 * (dynamic parts — names, addresses, revisions — are kept as they are).
 */
const DETAILS: Record<string, string> = {
  "wrong or missing setup token": "رمز إعداد خاطئ أو مفقود",
  "owner account created": "تم إنشاء حساب المالك",
  "backoff active for the attempted identifier":
    "تم إيقاف المحاولات مؤقتًا على هذا الحساب",
  "awaiting the security answer": "بانتظار إجابة سؤال الأمان",
  "no security question on file": "لا يوجد سؤال أمان على هذا الحساب",
  "wrong security answer": "إجابة سؤال الأمان غير صحيحة",
  "security answer verified": "تم التحقق من إجابة سؤال الأمان",
  "permanent email, password and security question set":
    "تم ضبط البريد وكلمة المرور وسؤال الأمان",
  "profile details": "تعديل بيانات الملف الشخصي",
  "other sessions revoked": "تم إنهاء الجلسات الأخرى",
  "security question replaced": "تم تغيير سؤال الأمان",
  "no-file": "لم يُرفق ملف",
};

const describeDetail = (detail: string) => {
  if (!detail) return "";
  const known = DETAILS[detail];
  if (known) return known;
  const revision = /^revision (\d+)$/.exec(detail);
  if (revision) return `الإصدار ${revision[1]}`;
  const id = /^id (\d+)$/.exec(detail);
  if (id) return `رقم ${id[1]}`;
  const role = /^(.+) as (owner|admin)$/.exec(detail);
  if (role)
    return `${role[1]} — ${role[2] === "owner" ? "مالك" : "مشرف"}`;
  const active = /^(.+) active=(true|false)$/.exec(detail);
  if (active)
    return `${active[1]} — ${active[2] === "true" ? "ظاهرة" : "مخفية"}`;
  return detail;
};

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

      <div className="stat-row">
        <StatPill
          label="إجمالي الأحداث"
          value={summary?.total ?? 0}
          tone="blue"
          icon={<Icons.activity size={18} />}
        />
        <StatPill
          label="آخر ٢٤ ساعة"
          value={summary?.last24h ?? 0}
          tone="green"
          icon={<Icons.clock size={18} />}
        />
        <StatPill
          label="أحداث مريبة"
          value={suspicious}
          tone={suspicious > 0 ? "red" : "violet"}
          icon={<Icons.alert size={18} />}
        />
      </div>

      {suspicious > 0 && (
        <Notice
          tone="warn"
          icon={<Icons.shield size={18} />}
          title={`${suspicious} حدثًا يحتاج مراجعة`}
        >
          محاولات دخول فاشلة أو طلبات مرفوضة — راجعها في القائمة بالأسفل.
        </Notice>
      )}

      <Card
        title="آخر الأحداث"
        className="audit-card"
        icon={<Icons.history size={18} />}
        actions={
          <SegmentedControl
            label="تصفية السجل"
            size="sm"
            value={filter}
            onChange={setFilter}
            options={[
              { value: "all", label: "الكل" },
              { value: "suspicious", label: "المريبة فقط", count: suspicious },
            ]}
          />
        }
      >
        {items === null ? (
          <SkeletonRows rows={5} height={48} />
        ) : items.length === 0 ? (
          <EmptyState
            compact
            icon={<Icons.activity size={26} />}
            title={
              filter === "suspicious"
                ? "لا توجد أحداث مريبة"
                : "لا توجد أحداث مسجّلة بعد"
            }
            description={
              filter === "suspicious"
                ? "كل شيء يبدو طبيعيًا حتى الآن."
                : undefined
            }
          />
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
                    {entry.suspicious && (
                      <Badge tone="red" size="sm">
                        يحتاج مراجعة
                      </Badge>
                    )}
                  </div>
                  <p className="audit-detail">
                    {describeDetail(entry.detail) || labelFor(entry.kind)}
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
