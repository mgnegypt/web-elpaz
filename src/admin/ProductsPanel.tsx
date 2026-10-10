// Products: create, edit and publish. Every save goes live immediately (the
// server broadcasts the change to the public site).
import { useMemo, useState } from "react";
import {
  AVAILABILITY,
  AVAILABILITY_LABELS,
  PRODUCT_IMAGE_AUTHENTICITY_LABELS,
  productImageIsIllustrative,
  type Authenticity,
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
  ColorField,
  ConfirmDialog,
  Disclosure,
  EmptyState,
  Field,
  Grid,
  IconButton,
  ImageField,
  Modal,
  OptionGroup,
  PageHeader,
  SearchInput,
  SegmentedControl,
  Select,
  StatPill,
  Switch,
  TextArea,
  TextInput,
  Thumb,
  Toolbar,
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
  imageAuthenticity: Authenticity;
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
  // Never assumed: the administrator says whether the picture is the real
  // product photo or a temporary stand-in.
  imageAuthenticity: "unspecified",
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
  discountPercent: product.discountPercent
    ? String(product.discountPercent)
    : "",
  badge: product.badge,
  imageAuthenticity: product.imageAuthenticity,
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
  discountPercent:
    draft.discountPercent.trim() === "" ? 0 : Number(draft.discountPercent),
  badge: draft.badge.trim(),
  imageAuthenticity: draft.imageAuthenticity,
});

const availabilityTone = (availability: Availability) =>
  availability === "coming_soon"
    ? "violet"
    : availability === "made_to_order"
      ? "blue"
      : "green";

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
  const [state, setState] = useState<"all" | "new" | "discount" | "soon">(
    "all",
  );
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pendingDelete, setPendingDelete] = useState<Product | null>(null);
  const toast = useToast();

  const categoryOptions = useMemo(() => {
    const merged = new Set([
      ...categories.filter((category) => category !== "الكل"),
      ...content.products.map((product) => product.category),
    ]);
    return [...merged].filter(Boolean);
  }, [categories, content.products]);

  const visible = useMemo(() => {
    const needle = query.trim();
    return content.products.filter((product) => {
      if (filter !== "الكل" && product.category !== filter) return false;
      if (state === "new" && !product.isNew) return false;
      if (state === "discount" && product.discountPercent <= 0) return false;
      if (state === "soon" && product.availability !== "coming_soon")
        return false;
      if (
        needle &&
        !product.name.includes(needle) &&
        !product.desc.includes(needle)
      )
        return false;
      return true;
    });
  }, [content.products, filter, query, state]);

  const stats = useMemo(
    () => ({
      total: content.products.length,
      comingSoon: content.products.filter(
        (product) => product.availability === "coming_soon",
      ).length,
      new: content.products.filter((product) => product.isNew).length,
      discounted: content.products.filter(
        (product) => product.discountPercent > 0,
      ).length,
    }),
    [content.products],
  );

  const startNew = () =>
    setDraft(emptyDraft(categoryOptions[0] ?? "منتجات"));

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
      onContent({
        ...content,
        products: replaceProduct(content.products, result.product),
        revision: result.revision,
      });
      setDraft(null);
      toast.push(
        "success",
        draft.id === null
          ? "تمت إضافة المنتج ونشره فورًا."
          : "تم حفظ التعديلات ونشرها.",
      );
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
      const result = await adminApi.deleteProduct(
        pendingDelete.id,
        content.revision,
      );
      onContent({
        ...content,
        products: result.products,
        revision: result.revision,
      });
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
      const result = await adminApi.updateProduct(
        product.id,
        toPayload(next),
        content.revision,
      );
      onContent({
        ...content,
        products: replaceProduct(content.products, result.product),
        revision: result.revision,
      });
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
          <TextInput
            value={draft.name}
            onChange={(name) => setDraft({ ...draft, name })}
            maxLength={120}
            placeholder="مثال: جبن قريش بلدي"
          />
        </Field>
        <Field
          label="التصنيف"
          required
          error={errors.category}
          hint="يظهر كفلتر في صفحة المنتجات."
        >
          <TextInput
            value={draft.category}
            onChange={(category) => setDraft({ ...draft, category })}
            maxLength={60}
            placeholder="أجبان، ألبان، عسل…"
          />
        </Field>
      </Grid>

      <Field
        label="وصف قصير"
        required
        error={errors.desc}
        hint="سطر أو سطران يظهران تحت اسم المنتج في القائمة."
      >
        <TextArea
          value={draft.desc}
          onChange={(desc) => setDraft({ ...draft, desc })}
          rows={2}
          maxLength={400}
        />
      </Field>
      <Field
        label="وصف تفصيلي"
        hint="يظهر داخل نافذة تفاصيل المنتج على الموقع."
      >
        <TextArea
          value={draft.longDesc}
          onChange={(longDesc) => setDraft({ ...draft, longDesc })}
          rows={3}
          maxLength={800}
        />
      </Field>

      <ImageField
        label="صورة المنتج"
        value={draft.img}
        webpValue={draft.webp}
        onChange={(img) => setDraft({ ...draft, img })}
        onWebpChange={(webp) => setDraft({ ...draft, webp })}
        hint="صورة واضحة للمنتج على خلفية بسيطة تعطي أفضل نتيجة."
      />

      <Field
        label="نوع الصورة"
        required
        hint={
          draft.imageAuthenticity === "unspecified"
            ? productImageIsIllustrative(
                { id: draft.id ?? 0, imageAuthenticity: "unspecified" },
                content.contentStatus,
              )
              ? "هذا المنتج معلَّم حاليًا كصورة توضيحية من إعداد قديم. اختر «صورة المنتج الحقيقية» لإزالة التنبيه من الموقع."
              : "لن يظهر أي تنبيه تحت الصورة. حدِّد النوع ليكون العرض دقيقًا للزائر."
            : draft.imageAuthenticity === "genuine"
              ? "لن يظهر أي تنبيه: الصورة معتمدة كصورة المنتج نفسه."
              : "سيظهر للزائر تنبيه أن الصورة توضيحية وسيتم تحديثها."
        }
      >
        <OptionGroup<Authenticity>
          value={draft.imageAuthenticity}
          onChange={(imageAuthenticity) => setDraft({ ...draft, imageAuthenticity })}
          options={[
            {
              value: "genuine",
              label: PRODUCT_IMAGE_AUTHENTICITY_LABELS.genuine,
              hint: "صورة حقيقية لهذا المنتج",
              icon: <Icons.check size={16} />,
            },
            {
              value: "illustrative",
              label: PRODUCT_IMAGE_AUTHENTICITY_LABELS.illustrative,
              hint: "صورة مؤقتة حتى تصوير المنتج",
              icon: <Icons.info size={16} />,
            },
            {
              value: "unspecified",
              label: PRODUCT_IMAGE_AUTHENTICITY_LABELS.unspecified,
              hint: "لا تغيير عن الوضع الحالي",
              icon: <Icons.help size={16} />,
            },
          ]}
        />
      </Field>

      <Field label="حالة التوفر" required>
        <OptionGroup<Availability>
          value={draft.availability}
          onChange={(availability) => setDraft({ ...draft, availability })}
          options={[
            {
              value: "available",
              label: AVAILABILITY_LABELS.available,
              hint: "متاح للطلب الآن",
              icon: <Icons.package size={16} />,
            },
            {
              value: "unlimited",
              label: AVAILABILITY_LABELS.unlimited,
              hint: "بدون تتبّع كمية",
              icon: <Icons.activity size={16} />,
            },
            {
              value: "made_to_order",
              label: AVAILABILITY_LABELS.made_to_order,
              hint: "يُحضّر بعد الطلب",
              icon: <Icons.truck size={16} />,
            },
            {
              value: "coming_soon",
              label: AVAILABILITY_LABELS.coming_soon,
              hint: "غير متاح للطلب بعد",
              icon: <Icons.clock size={16} />,
            },
          ]}
        />
      </Field>

      <Grid columns={2}>
        <Field
          label="الكمية المتاحة"
          hint={
            draft.availability === "unlimited"
              ? "غير مطلوبة مع «كميات غير محدودة»."
              : "اتركها فارغة إن لم ترغب في تتبّع الكمية."
          }
          error={errors.quantity}
        >
          <TextInput
            value={draft.quantity}
            onChange={(quantity) => setDraft({ ...draft, quantity })}
            type="number"
            inputMode="numeric"
            dir="ltr"
            min={0}
            disabled={draft.availability === "unlimited"}
          />
        </Field>
        <Field
          label="نسبة الخصم %"
          hint="٠ يعني بدون خصم."
          error={errors.discountPercent}
        >
          <TextInput
            value={draft.discountPercent}
            onChange={(discountPercent) =>
              setDraft({ ...draft, discountPercent })
            }
            type="number"
            inputMode="numeric"
            dir="ltr"
            min={0}
            max={95}
          />
        </Field>
      </Grid>

      <Switch
        checked={draft.isNew}
        onChange={(isNew) => setDraft({ ...draft, isNew })}
        label="منتج جديد — شارة «جديد» على الموقع"
        hint="تظهر الشارة فورًا للزوار وتختفي عند إيقافها أو انتهاء التاريخ."
      />
      {draft.isNew && (
        <Field
          label="تنتهي شارة «جديد» في (اختياري)"
          hint="اتركه فارغًا لتبقى الشارة حتى توقفها يدويًا."
        >
          <TextInput
            value={draft.newUntil}
            onChange={(newUntil) => setDraft({ ...draft, newUntil })}
            type="date"
            dir="ltr"
          />
        </Field>
      )}

      <Disclosure label="خيارات إضافية" hint="العبوة، شارة نصية، لون البطاقة">
        <Grid columns={2}>
          <Field label="العبوة / الحجم" hint="مثال: ١ كجم، ٥٠٠ مل.">
            <TextInput
              value={draft.size}
              onChange={(size) => setDraft({ ...draft, size })}
              maxLength={60}
            />
          </Field>
          <Field label="شارة نصية (اختياري)" hint="مثال: عرض الموسم.">
            <TextInput
              value={draft.badge}
              onChange={(badge) => setDraft({ ...draft, badge })}
              maxLength={24}
            />
          </Field>
        </Grid>
        <ColorField
          label="لون البطاقة على الموقع"
          value={draft.color}
          onChange={(color) => setDraft({ ...draft, color })}
          hint="يُستخدم كخلفية لطيفة خلف صورة المنتج."
        />
      </Disclosure>
    </>
  );

  return (
    <>
      <PageHeader
        title="المنتجات"
        description="أضف وعدّل المنتجات والصور والكميات وحالة التوفر — والنتيجة تظهر على الموقع مباشرة."
        actions={
          <Button icon={<Icons.plus size={17} />} onClick={startNew}>
            منتج جديد
          </Button>
        }
      />

      <div className="stat-row">
        <StatPill
          label="إجمالي المنتجات"
          value={stats.total}
          tone="blue"
          icon={<Icons.package size={18} />}
        />
        <StatPill
          label="منتجات جديدة"
          value={stats.new}
          tone="violet"
          icon={<Icons.sparkles size={18} />}
        />
        <StatPill
          label="عليها خصم"
          value={stats.discounted}
          tone="amber"
          icon={<Icons.badgePercent size={18} />}
        />
        <StatPill
          label="قريبًا"
          value={stats.comingSoon}
          tone="green"
          icon={<Icons.clock size={18} />}
        />
      </div>

      <Card
        title="قائمة المنتجات"
        description={`${visible.length} من ${content.products.length} منتج`}
        icon={<Icons.list size={18} />}
      >
        <Toolbar>
          <SearchInput
            value={query}
            onChange={setQuery}
            label="بحث في المنتجات"
            placeholder="ابحث بالاسم أو الوصف"
          />
          <Select
            value={filter}
            onChange={setFilter}
            ariaLabel="تصفية حسب التصنيف"
            options={[
              { value: "الكل", label: "كل التصنيفات" },
              ...categoryOptions.map((category) => ({
                value: category,
                label: category,
              })),
            ]}
          />
          <SegmentedControl
            label="تصفية حسب الحالة"
            value={state}
            onChange={setState}
            options={[
              { value: "all", label: "الكل" },
              { value: "new", label: "جديد" },
              { value: "discount", label: "خصم" },
              { value: "soon", label: "قريبًا" },
            ]}
          />
        </Toolbar>

        {visible.length === 0 ? (
          <EmptyState
            icon={<Icons.packageSearch size={30} />}
            title={
              content.products.length === 0
                ? "لا توجد منتجات بعد"
                : "لا توجد منتجات مطابقة"
            }
            description={
              content.products.length === 0
                ? "أضف أول منتج ليظهر مباشرة في صفحة المنتجات على الموقع."
                : "جرّب تعديل البحث أو الفلاتر، أو أضف منتجًا جديدًا."
            }
            action={
              <Button
                variant="soft"
                icon={<Icons.plus size={16} />}
                onClick={startNew}
              >
                إضافة منتج
              </Button>
            }
          />
        ) : (
          <div className="product-grid">
            {visible.map((product, index) => (
              <article
                className="product-tile anim-card"
                key={product.id}
                style={{ "--i": index } as React.CSSProperties}
              >
                <div className="product-tile-image">
                  <Thumb src={product.img} fallback={product.fallback} />
                  <div className="product-tile-flags">
                    {product.isNew && (
                      <Badge tone="red" size="sm">
                        جديد
                      </Badge>
                    )}
                    {product.discountPercent > 0 && (
                      <Badge tone="amber" size="sm">
                        -{product.discountPercent}%
                      </Badge>
                    )}
                    {product.badge && (
                      <Badge tone="violet" size="sm">
                        {product.badge}
                      </Badge>
                    )}
                  </div>
                </div>

                <div className="product-tile-body">
                  <span className="product-tile-cat">{product.category}</span>
                  <h3>{product.name}</h3>
                  <p>{product.desc}</p>
                  <div className="product-tile-meta">
                    <Badge
                      tone={availabilityTone(product.availability)}
                      size="sm"
                    >
                      {AVAILABILITY_LABELS[product.availability]}
                    </Badge>
                    {product.availability !== "unlimited" &&
                      product.quantity !== null && (
                        <span
                          className={`meta-line${product.quantity === 0 ? " meta-line--warn" : ""}`}
                        >
                          الكمية: {product.quantity}
                        </span>
                      )}
                    <span className="meta-line">العبوة: {product.size}</span>
                  </div>
                </div>

                <footer className="product-tile-actions">
                  <Button
                    variant="soft"
                    size="sm"
                    icon={<Icons.pencil size={15} />}
                    onClick={() => setDraft(toDraft(product))}
                  >
                    تعديل
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={<Icons.sparkles size={15} />}
                    onClick={() =>
                      void quickToggle(product, { isNew: !product.isNew })
                    }
                    disabled={busy}
                  >
                    {product.isNew ? "إيقاف «جديد»" : "تعليم كجديد"}
                  </Button>
                  {product.availability !== "coming_soon" ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={<Icons.clock size={15} />}
                      onClick={() =>
                        void quickToggle(product, {
                          availability: "coming_soon",
                        })
                      }
                      disabled={busy}
                    >
                      قريبًا
                    </Button>
                  ) : (
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={<Icons.checkCircle size={15} />}
                      onClick={() =>
                        void quickToggle(product, { availability: "available" })
                      }
                      disabled={busy}
                    >
                      إتاحة
                    </Button>
                  )}
                  <IconButton
                    label={`حذف ${product.name}`}
                    variant="danger"
                    icon={<Icons.trash size={16} />}
                    onClick={() => setPendingDelete(product)}
                    disabled={busy}
                    className="product-tile-delete"
                  />
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
            <Button
              icon={<Icons.save size={17} />}
              loading={busy}
              onClick={() => void save()}
            >
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
        message={`سيُحذف «${pendingDelete?.name ?? ""}» من الموقع فورًا، ولا يمكن التراجع عن هذا الإجراء.`}
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
  return exists
    ? products.map((product) => (product.id === next.id ? next : product))
    : [...products, next];
}

export const AVAILABILITY_ORDER = AVAILABILITY;
export type { Content };
