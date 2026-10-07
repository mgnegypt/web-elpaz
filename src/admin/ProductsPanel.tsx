// Products: create, edit, reorder-free CRUD with images, stock state and badges.
// Every save publishes immediately (the server broadcasts to the public site).
import { useMemo, useState } from "react";
import {
  AVAILABILITY,
  AVAILABILITY_LABELS,
  type Availability,
  type Content,
  type ContentDoc,
  type Product,
} from "../../shared/content.ts";
import { adminApi, conflictRevision } from "./api";
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
  ImagePreview,
  Modal,
  OptionGroup,
  PageHeader,
  Select,
  Switch,
  TextArea,
  TextInput,
  describeError,
  fieldErrorsOf,
  useToast,
} from "./ui";

type Draft = {
  id: number | null;
  category: string;
  name: string;
  desc: string;
  longDesc: string;
  size: string;
  img: string;
  webp: string;
  fallback: string;
  color: string;
  availability: Availability;
  quantity: string;
  isNew: boolean;
  newUntil: string;
  discountPercent: string;
  badge: string;
};

const emptyDraft = (category: string): Draft => ({
  id: null,
  category,
  name: "",
  desc: "",
  longDesc: "",
  size: "—",
  img: "",
  webp: "",
  fallback: "",
  color: "#f3e3c3",
  availability: "available",
  quantity: "",
  isNew: false,
  newUntil: "",
  discountPercent: "",
  badge: "",
});

const toDraft = (product: Product): Draft => ({
  id: product.id,
  category: product.category,
  name: product.name,
  desc: product.desc,
  longDesc: product.longDesc,
  size: product.size,
  img: product.img,
  webp: product.webp,
  fallback: product.fallback,
  color: product.color,
  availability: product.availability,
  quantity: product.quantity === null ? "" : String(product.quantity),
  isNew: product.isNew,
  newUntil: product.newUntil,
  discountPercent: product.discountPercent ? String(product.discountPercent) : "",
  badge: product.badge,
});

const toPayload = (draft: Draft) => ({
  category: draft.category.trim(),
  name: draft.name.trim(),
  desc: draft.desc.trim(),
  longDesc: draft.longDesc.trim(),
  size: draft.size.trim() || "—",
  img: draft.img.trim(),
  webp: draft.webp.trim(),
  fallback: draft.fallback.trim(),
  color: draft.color,
  availability: draft.availability,
  quantity: draft.quantity.trim() === "" ? null : Number(draft.quantity),
  isNew: draft.isNew,
  newUntil: draft.isNew ? draft.newUntil : "",
  discountPercent: draft.discountPercent.trim() === "" ? 0 : Number(draft.discountPercent),
  badge: draft.badge.trim(),
});

export default function ProductsPanel({
  content,
  onContent,
  categories,
}: {
  content: ContentDoc;
  onContent: (document: ContentDoc) => void;
  categories: string[];
}) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("الكل");
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pendingDelete, setPendingDelete] = useState<Product | null>(null);
  const toast = useToast();

  const categoryOptions = useMemo(() => {
    const merged = new Set([...categories.filter((c) => c !== "الكل"), ...content.products.map((p) => p.category)]);
    return [...merged].filter(Boolean);
  }, [categories, content.products]);

  const visible = useMemo(() => {
    const needle = query.trim();
    return content.products.filter(
      (product) =>
        (filter === "الكل" || product.category === filter) &&
        (!needle || product.name.includes(needle) || product.desc.includes(needle)),
    );
  }, [content.products, filter, query]);

  const stats = useMemo(
    () => ({
      total: content.products.length,
      comingSoon: content.products.filter((p) => p.availability === "coming_soon").length,
      new: content.products.filter((p) => p.isNew).length,
      discounted: content.products.filter((p) => p.discountPercent > 0).length,
    }),
    [content.products],
  );

  const save = async () => {
    if (!draft) return;
    setBusy(true);
    setErrors({});
    try {
      const payload = toPayload(draft);
      const result =
        draft.id === null
          ? await adminApi.createProduct(payload, content.revision)
          : await adminApi.updateProduct(draft.id, payload, content.revision);
      onContent({ ...content, products: replaceProduct(content.products, result.product), revision: result.revision });
      setDraft(null);
      toast.push("success", draft.id === null ? "تمت إضافة المنتج ونشره فورًا." : "تم حفظ التعديلات ونشرها.");
    } catch (failure) {
      const fields = fieldErrorsOf(failure);
      if (Object.keys(fields).length) setErrors(fields);
      const conflict = conflictRevision(failure);
      if (conflict) {
        onContent(conflict);
        toast.push("info", "تم تحديث البيانات من نسخة أحدث — أعد المحاولة.");
      } else if (!Object.keys(fields).length) {
        toast.push("error", describeError(failure));
      }
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!pendingDelete) return;
    setBusy(true);
    try {
      const result = await adminApi.deleteProduct(pendingDelete.id, content.revision);
      onContent({ ...content, products: result.products, revision: result.revision });
      setPendingDelete(null);
      toast.push("success", "تم حذف المنتج من الموقع.");
    } catch (failure) {
      const conflict = conflictRevision(failure);
      if (conflict) onContent(conflict);
      toast.push("error", describeError(failure));
    } finally {
      setBusy(false);
    }
  };

  const quickToggle = async (product: Product, patch: Partial<Draft>) => {
    setBusy(true);
    try {
      const next = { ...toDraft(product), ...patch };
      const result = await adminApi.updateProduct(product.id, toPayload(next), content.revision);
      onContent({ ...content, products: replaceProduct(content.products, result.product), revision: result.revision });
      toast.push("success", "تم التحديث على الموقع.");
    } catch (failure) {
      const conflict = conflictRevision(failure);
      if (conflict) onContent(conflict);
      toast.push("error", describeError(failure));
    } finally {
      setBusy(false);
    }
  };

  const body = draft && (
    <>
      <Grid columns={2}>
        <Field label="اسم المنتج" required error={errors.name}>
          <TextInput value={draft.name} onChange={(name) => setDraft({ ...draft, name })} maxLength={120} />
        </Field>
        <Field label="التصنيف" required error={errors.category}>
          <TextInput
            value={draft.category}
            onChange={(category) => setDraft({ ...draft, category })}
            maxLength={60}
            placeholder="أجبان، ألبان، عسل…"
          />
        </Field>
      </Grid>
      <Field label="وصف قصير" required error={errors.desc} hint="يظهر تحت اسم المنتج في القائمة.">
        <TextArea value={draft.desc} onChange={(desc) => setDraft({ ...draft, desc })} rows={2} maxLength={400} />
      </Field>
      <Field label="وصف تفصيلي" hint="يظهر داخل نافذة تفاصيل المنتج.">
        <TextArea value={draft.longDesc} onChange={(longDesc) => setDraft({ ...draft, longDesc })} rows={3} maxLength={800} />
      </Field>
      <Grid columns={2}>
        <Field label="العبوة / الحجم" hint="مثال: ١ كجم، ٥٠٠ مل.">
          <TextInput value={draft.size} onChange={(size) => setDraft({ ...draft, size })} maxLength={60} />
        </Field>
        <Field label="اللون المميّز للبطاقة">
          <div className="color-row">
            <input
              type="color"
              value={draft.color}
              aria-label="لون المنتج"
              onChange={(event) => setDraft({ ...draft, color: event.target.value })}
            />
            <TextInput value={draft.color} onChange={(color) => setDraft({ ...draft, color })} dir="ltr" />
          </div>
        </Field>
      </Grid>

      <ImageField
        label="صورة المنتج"
        value={draft.img}
        webpValue={draft.webp}
        onChange={(img) => setDraft({ ...draft, img })}
        onWebpChange={(webp) => setDraft({ ...draft, webp })}
        hint="ارفع صورة من جهازك أو الصق رابطًا خارجيًا. تُستخدم الصورة في الموقع ولوحة التحكم."
      />

      <Field label="حالة التوفر" required>
        <OptionGroup<Availability>
          value={draft.availability}
          onChange={(availability) => setDraft({ ...draft, availability })}
          options={[
            { value: "available", label: AVAILABILITY_LABELS.available, icon: <Icons.package size={16} /> },
            { value: "unlimited", label: AVAILABILITY_LABELS.unlimited, icon: <Icons.activity size={16} /> },
            { value: "made_to_order", label: AVAILABILITY_LABELS.made_to_order, icon: <Icons.truck size={16} /> },
            { value: "coming_soon", label: AVAILABILITY_LABELS.coming_soon, icon: <Icons.clock size={16} /> },
          ]}
        />
      </Field>

      <Grid columns={2}>
        <Field
          label="الكمية المتاحة"
          hint={draft.availability === "unlimited" ? "غير مطلوبة مع «كميات غير محدودة»." : "اتركها فارغة إن لم ترغب في تتبّع الكمية."}
          error={errors.quantity}
        >
          <TextInput
            value={draft.quantity}
            onChange={(quantity) => setDraft({ ...draft, quantity })}
            type="number"
            dir="ltr"
            disabled={draft.availability === "unlimited"}
          />
        </Field>
        <Field label="نسبة الخصم %" hint="٠ يعني بدون خصم." error={errors.discountPercent}>
          <TextInput
            value={draft.discountPercent}
            onChange={(discountPercent) => setDraft({ ...draft, discountPercent })}
            type="number"
            dir="ltr"
          />
        </Field>
      </Grid>

      <Grid columns={2}>
        <Field label="شارة نصية (اختياري)" hint="مثال: عرض الموسم.">
          <TextInput value={draft.badge} onChange={(badge) => setDraft({ ...draft, badge })} maxLength={24} />
        </Field>
        <Field label="ينتهي تلقائيًا في (اختياري)" hint="اتركه فارغًا ليبقى بدون تاريخ انتهاء.">
          <TextInput value={draft.newUntil} onChange={(newUntil) => setDraft({ ...draft, newUntil })} type="date" dir="ltr" />
        </Field>
      </Grid>

      <Switch
        checked={draft.isNew}
        onChange={(isNew) => setDraft({ ...draft, isNew })}
        label="منتج جديد — شارة «جديد» حمراء على الموقع"
        hint="تظهر الشارة فورًا للزوار وتختفي عند إيقافها أو انتهاء التاريخ."
      />
    </>
  );

  return (
    <>
      <PageHeader
        title="المنتجات"
        description="أضف وعدّل المنتجات والصور والكميات وحالة التوفر — والنتيجة تظهر على الموقع مباشرة."
        actions={
          <Button icon={<Icons.plus size={17} />} onClick={() => setDraft(emptyDraft(categoryOptions[0] ?? "منتجات"))}>
            منتج جديد
          </Button>
        }
      />

      <div className="stat-row">
        <StatPill label="إجمالي المنتجات" value={stats.total} tone="blue" icon={<Icons.package size={16} />} />
        <StatPill label="منتجات جديدة" value={stats.new} tone="red" icon={<Icons.sparkles size={16} />} />
        <StatPill label="عليها خصم" value={stats.discounted} tone="amber" icon={<Icons.badgePercent size={16} />} />
        <StatPill label="قريبًا" value={stats.comingSoon} tone="violet" icon={<Icons.clock size={16} />} />
      </div>

      <Card
        title="قائمة المنتجات"
        description={`${visible.length} من ${content.products.length} منتج`}
        icon={<Icons.list size={18} />}
        actions={
          <div className="toolbar">
            <div className="search-box">
              <Icons.search size={16} />
              <input
                className="input"
                value={query}
                placeholder="ابحث بالاسم أو الوصف"
                onChange={(event) => setQuery(event.target.value)}
                aria-label="بحث في المنتجات"
              />
            </div>
            <Select
              value={filter}
              onChange={setFilter}
              options={[{ value: "الكل", label: "كل التصنيفات" }, ...categoryOptions.map((c) => ({ value: c, label: c }))]}
            />
          </div>
        }
      >
        {visible.length === 0 ? (
          <EmptyState
            icon={<Icons.packageSearch size={30} />}
            title="لا توجد منتجات مطابقة"
            description="جرّب تعديل البحث أو أضف منتجًا جديدًا."
            action={
              <Button variant="soft" icon={<Icons.plus size={16} />} onClick={() => setDraft(emptyDraft(categoryOptions[0] ?? "منتجات"))}>
                إضافة منتج
              </Button>
            }
          />
        ) : (
          <div className="product-grid">
            {visible.map((product) => (
              <article className="product-tile" key={product.id}>
                <div className="product-tile-image">
                  {product.img ? (
                    <img src={product.img} alt={product.name} loading="lazy" />
                  ) : (
                    <ImagePreview url="" alt={product.name} />
                  )}
                  <div className="product-tile-flags">
                    {product.isNew && <Badge tone="red">جديد</Badge>}
                    {product.discountPercent > 0 && <Badge tone="amber">-{product.discountPercent}%</Badge>}
                    {product.badge && <Badge tone="violet">{product.badge}</Badge>}
                  </div>
                </div>
                <div className="product-tile-body">
                  <span className="product-tile-cat">{product.category}</span>
                  <h3>{product.name}</h3>
                  <p>{product.desc}</p>
                  <div className="product-tile-meta">
                    <Badge
                      tone={
                        product.availability === "coming_soon"
                          ? "violet"
                          : product.availability === "made_to_order"
                            ? "blue"
                            : "green"
                      }
                    >
                      {AVAILABILITY_LABELS[product.availability]}
                    </Badge>
                    {product.availability !== "unlimited" && product.quantity !== null && (
                      <span className="meta-line">الكمية: {product.quantity}</span>
                    )}
                    <span className="meta-line">العبوة: {product.size}</span>
                  </div>
                </div>
                <footer className="product-tile-actions">
                  <Button variant="soft" size="sm" icon={<Icons.pencil size={15} />} onClick={() => setDraft(toDraft(product))}>
                    تعديل
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={<Icons.sparkles size={15} />}
                    onClick={() => void quickToggle(product, { isNew: !product.isNew })}
                    disabled={busy}
                  >
                    {product.isNew ? "إيقاف «جديد»" : "تعليم كجديد"}
                  </Button>
                  {product.availability !== "coming_soon" ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={<Icons.clock size={15} />}
                      onClick={() => void quickToggle(product, { availability: "coming_soon" })}
                      disabled={busy}
                    >
                      قريبًا
                    </Button>
                  ) : (
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={<Icons.checkCircle size={15} />}
                      onClick={() => void quickToggle(product, { availability: "available" })}
                      disabled={busy}
                    >
                      إتاحة
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={<Icons.trash size={15} />}
                    onClick={() => setPendingDelete(product)}
                    disabled={busy}
                    aria-label={`حذف ${product.name}`}
                  >
                    حذف
                  </Button>
                </footer>
              </article>
            ))}
          </div>
        )}
      </Card>

      <Modal
        open={draft !== null}
        size="lg"
        title={draft?.id === null ? "منتج جديد" : `تعديل: ${draft?.name || ""}`}
        description="كل حفظ ينشر التغيير على الموقع مباشرة."
        onClose={() => {
          setDraft(null);
          setErrors({});
        }}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDraft(null)}>
              إلغاء
            </Button>
            <Button icon={<Icons.save size={17} />} loading={busy} onClick={() => void save()}>
              {draft?.id === null ? "إضافة ونشر" : "حفظ ونشر"}
            </Button>
          </>
        }
      >
        {body}
      </Modal>

      <ConfirmDialog
        open={pendingDelete !== null}
        title="حذف المنتج"
        message={`سيُحذف «${pendingDelete?.name ?? ""}» من الموقع فورًا. لا يمكن التراجع.`}
        confirmLabel="حذف نهائي"
        busy={busy}
        onConfirm={() => void remove()}
        onCancel={() => setPendingDelete(null)}
      />
    </>
  );
}

function replaceProduct(products: Product[], next: Product): Product[] {
  const exists = products.some((product) => product.id === next.id);
  return exists ? products.map((product) => (product.id === next.id ? next : product)) : [...products, next];
}

export function StatPill({
  label,
  value,
  tone,
  icon,
}: {
  label: string;
  value: number | string;
  tone: "blue" | "green" | "red" | "amber" | "violet";
  icon?: React.ReactNode;
}) {
  return (
    <div className={`stat-pill stat-pill--${tone}`}>
      <span className="stat-icon">{icon}</span>
      <div>
        <strong>{value}</strong>
        <small>{label}</small>
      </div>
    </div>
  );
}

export const AVAILABILITY_ORDER = AVAILABILITY;
export type { Content };
