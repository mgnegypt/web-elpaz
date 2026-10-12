// Events & announcements: seasonal offers, discounts, new products, notices.
import { useEffect, useMemo, useState } from "react";
import {
  EVENT_TYPES,
  EVENT_TYPE_LABELS,
  type EventType,
  type SiteEvent,
} from "../../shared/content.ts";
import { adminApi } from "./api";
import { shortDateTime } from "./dates";
import { Icons } from "./icons";
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  Field,
  Grid,
  ImageField,
  Modal,
  PageHeader,
  SegmentedControl,
  Select,
  SkeletonRows,
  StatPill,
  Switch,
  TextArea,
  TextInput,
  Thumb,
  describeError,
  fieldErrorsOf,
  useToast,
} from "./ui";

type Draft = {
  id: number | null;
  title: string;
  description: string;
  type: EventType;
  imageUrl: string;
  startAt: string;
  endAt: string;
  active: boolean;
};

const emptyDraft = (): Draft => ({
  id: null,
  title: "",
  description: "",
  type: "offer",
  imageUrl: "",
  startAt: "",
  endAt: "",
  active: true,
});

const toDraft = (event: SiteEvent): Draft => ({
  id: event.id,
  title: event.title,
  description: event.description,
  type: event.type,
  imageUrl: event.imageUrl,
  startAt: event.startAt ? event.startAt.slice(0, 10) : "",
  endAt: event.endAt ? event.endAt.slice(0, 10) : "",
  active: event.active,
});

export default function EventsPanel() {
  const [items, setItems] = useState<SiteEvent[] | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pendingDelete, setPendingDelete] = useState<SiteEvent | null>(null);
  const [filter, setFilter] = useState<"all" | "active" | "hidden">("all");
  const toast = useToast();

  const load = async () => {
    try {
      const result = await adminApi.events();
      setItems(result.items);
    } catch (failure) {
      toast.push("error", describeError(failure));
      setItems([]);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const visible = useMemo(() => {
    const list = items ?? [];
    if (filter === "active") return list.filter((item) => item.active);
    if (filter === "hidden") return list.filter((item) => !item.active);
    return list;
  }, [items, filter]);

  const stats = useMemo(() => {
    const list = items ?? [];
    const now = Date.now();
    return {
      total: list.length,
      active: list.filter((item) => item.active).length,
      scheduled: list.filter((item) => item.startAt && new Date(item.startAt).getTime() > now).length,
    };
  }, [items]);

  const save = async () => {
    if (!draft) return;
    setBusy(true);
    setErrors({});
    try {
      const payload = {
        title: draft.title.trim(),
        description: draft.description.trim(),
        type: draft.type,
        imageUrl: draft.imageUrl.trim(),
        startAt: draft.startAt,
        endAt: draft.endAt,
        active: draft.active,
      };
      const result =
        draft.id === null
          ? await adminApi.createEvent(payload)
          : await adminApi.updateEvent(draft.id, payload);
      setItems((current) => {
        const list = current ?? [];
        const exists = list.some((item) => item.id === result.event.id);
        return exists
          ? list.map((item) => (item.id === result.event.id ? result.event : item))
          : [result.event, ...list];
      });
      setDraft(null);
      toast.push("success", "تم حفظ المناسبة ونشرها على الموقع فورًا.");
    } catch (failure) {
      const fields = fieldErrorsOf(failure);
      setErrors(fields);
      if (!Object.keys(fields).length) toast.push("error", describeError(failure));
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async (event: SiteEvent) => {
    setBusy(true);
    try {
      const result = await adminApi.updateEvent(event.id, {
        title: event.title,
        description: event.description,
        type: event.type,
        imageUrl: event.imageUrl,
        startAt: event.startAt,
        endAt: event.endAt,
        active: !event.active,
      });
      setItems((current) => (current ?? []).map((item) => (item.id === result.event.id ? result.event : item)));
      toast.push("success", result.event.active ? "المناسبة ظاهرة الآن على الموقع." : "تم إخفاء المناسبة من الموقع.");
    } catch (failure) {
      toast.push("error", describeError(failure));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!pendingDelete) return;
    setBusy(true);
    try {
      await adminApi.deleteEvent(pendingDelete.id);
      setItems((current) => (current ?? []).filter((item) => item.id !== pendingDelete.id));
      setPendingDelete(null);
      toast.push("success", "تم حذف المناسبة.");
    } catch (failure) {
      toast.push("error", describeError(failure));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        title="المناسبات والتنبيهات"
        description="عروض الموسم، الخصومات، المنتجات الجديدة والتنبيهات المهمة — تظهر للزوار بمجرد الحفظ."
        actions={
          <Button icon={<Icons.plus size={17} />} onClick={() => setDraft(emptyDraft())}>
            مناسبة جديدة
          </Button>
        }
      />

      <div className="stat-row">
        <StatPill label="إجمالي المناسبات" value={stats.total} tone="blue" icon={<Icons.events size={18} />} />
        <StatPill label="ظاهرة الآن" value={stats.active} tone="green" icon={<Icons.checkCircle size={18} />} />
        <StatPill label="مجدولة" value={stats.scheduled} tone="amber" icon={<Icons.calendar size={18} />} />
      </div>

      {items === null ? (
        <Card title="جارٍ التحميل" icon={<Icons.events size={18} />}>
          <SkeletonRows rows={3} height={64} />
        </Card>
      ) : items.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Icons.events size={30} />}
            title="لا توجد مناسبات بعد"
            description="أنشئ عرضًا أو تنبيهًا ليظهر في أعلى الموقع للزوار."
            action={
              <Button variant="soft" icon={<Icons.plus size={16} />} onClick={() => setDraft(emptyDraft())}>
                إضافة مناسبة
              </Button>
            }
          />
        </Card>
      ) : (
        <Card
          title="كل المناسبات"
          description={`${visible.length} من ${items.length} مناسبة`}
          icon={<Icons.events size={18} />}
          actions={
            <SegmentedControl
              label="تصفية المناسبات"
              size="sm"
              value={filter}
              onChange={setFilter}
              options={[
                { value: "all", label: "الكل", count: stats.total },
                { value: "active", label: "ظاهرة", count: stats.active },
                { value: "hidden", label: "مخفية", count: stats.total - stats.active },
              ]}
            />
          }
        >
        {visible.length === 0 ? (
          <EmptyState
            compact
            icon={<Icons.filter size={26} />}
            title="لا توجد مناسبات بهذا الفلتر"
            description="غيّر الفلتر لعرض باقي المناسبات."
          />
        ) : (
        <div className="event-list">
          {visible.map((event) => (
            <article className={`event-card${event.active ? "" : " event-card--off"}`} key={event.id}>
              {event.imageUrl ? (
                <Thumb className="event-thumb" src={event.imageUrl} />
              ) : (
                <span className="event-thumb event-thumb--icon">
                  <Icons.events size={22} />
                </span>
              )}
              <div className="event-body">
                <div className="event-head">
                  <h3>{event.title}</h3>
                  <Badge tone={event.active ? "green" : "neutral"}>
                    {event.active ? "ظاهرة" : "مخفية"}
                  </Badge>
                  <Badge tone="violet">{EVENT_TYPE_LABELS[event.type]}</Badge>
                </div>
                <p>{event.description}</p>
                <div className="event-meta">
                  <span>
                    <Icons.calendarRange size={14} />
                    {event.startAt ? shortDateTime(event.startAt) : "بدون تاريخ بداية"}
                    {" — "}
                    {event.endAt ? shortDateTime(event.endAt) : "بدون تاريخ نهاية"}
                  </span>
                  <span>
                    <Icons.clock size={14} />
                    آخر تحديث {shortDateTime(event.updatedAt)}
                  </span>
                </div>
              </div>
              <div className="event-actions">
                <Button variant="soft" size="sm" icon={<Icons.pencil size={15} />} onClick={() => setDraft(toDraft(event))}>
                  تعديل
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  icon={event.active ? <Icons.eyeOff size={15} /> : <Icons.eye size={15} />}
                  onClick={() => void toggleActive(event)}
                  disabled={busy}
                >
                  {event.active ? "إخفاء" : "إظهار"}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  icon={<Icons.trash size={15} />}
                  onClick={() => setPendingDelete(event)}
                  disabled={busy}
                >
                  حذف
                </Button>
              </div>
            </article>
          ))}
        </div>
        )}
        </Card>
      )}

      <Modal
        open={draft !== null}
        size="lg"
        title={draft?.id === null ? "مناسبة جديدة" : `تعديل: ${draft?.title || ""}`}
        description="تظهر في شريط التنبيهات على الموقع عند تفعيلها."
        onClose={() => setDraft(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDraft(null)}>
              إلغاء
            </Button>
            <Button icon={<Icons.save size={17} />} loading={busy} onClick={() => void save()}>
              حفظ ونشر
            </Button>
          </>
        }
      >
        {draft && (
          <>
            <Grid columns={2}>
              <Field label="العنوان" required error={errors.title}>
                <TextInput value={draft.title} onChange={(title) => setDraft({ ...draft, title })} maxLength={120} />
              </Field>
              <Field label="النوع" required error={errors.type}>
                <Select
                  value={draft.type}
                  onChange={(type) => setDraft({ ...draft, type: type as EventType })}
                  options={EVENT_TYPES.map((type) => ({ value: type, label: EVENT_TYPE_LABELS[type] }))}
                />
              </Field>
            </Grid>
            <Field label="الوصف" required error={errors.description}>
              <TextArea
                value={draft.description}
                onChange={(description) => setDraft({ ...draft, description })}
                rows={3}
                maxLength={500}
              />
            </Field>
            <ImageField
              label="صورة المناسبة (اختياري)"
              value={draft.imageUrl}
              onChange={(imageUrl) => setDraft({ ...draft, imageUrl })}
              hint="تظهر بجانب المناسبة في الموقع."
            />
            <Grid columns={2}>
              <Field label="تاريخ البداية (اختياري)" error={errors.startAt}>
                <TextInput value={draft.startAt} onChange={(startAt) => setDraft({ ...draft, startAt })} type="date" dir="ltr" />
              </Field>
              <Field label="تاريخ النهاية (اختياري)" error={errors.endAt}>
                <TextInput value={draft.endAt} onChange={(endAt) => setDraft({ ...draft, endAt })} type="date" dir="ltr" />
              </Field>
            </Grid>
            <Switch
              checked={draft.active}
              onChange={(active) => setDraft({ ...draft, active })}
              label="منشورة على الموقع"
              hint="أوقفها لإخفائها مؤقتًا دون حذفها."
            />
          </>
        )}
      </Modal>

      <ConfirmDialog
        open={pendingDelete !== null}
        title="حذف المناسبة"
        message={`سيُحذف «${pendingDelete?.title ?? ""}» نهائيًا.`}
        confirmLabel="حذف"
        busy={busy}
        onConfirm={() => void remove()}
        onCancel={() => setPendingDelete(null)}
      />
    </>
  );
}
