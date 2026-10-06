import { useState } from "react";
import { Loader2, Pencil, Plus, Trash2, X } from "lucide-react";
import type { ContentDoc, Product } from "../../shared/content.ts";
import { adminApi, conflictRevision } from "./api";
import { Field, TextAreaField, TextField } from "./fields";

type Draft = {
  name: string;
  category: string;
  desc: string;
  longDesc: string;
  size: string;
  color: string;
  img: string;
  webp: string;
  fallback: string;
};

const emptyDraft = (category: string): Draft => ({
  name: "",
  category,
  desc: "",
  longDesc: "",
  size: "—",
  color: "#1E3FA8",
  img: "",
  webp: "",
  fallback: "",
});

const toDraft = (product: Product): Draft => ({
  name: product.name,
  category: product.category,
  desc: product.desc,
  longDesc: product.longDesc,
  size: product.size,
  color: product.color,
  img: product.img,
  webp: product.webp,
  fallback: product.fallback,
});

export default function ProductsPanel({
  content,
  onContent,
}: {
  content: ContentDoc;
  onContent: (content: ContentDoc) => void;
}) {
  const [editing, setEditing] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<Draft>(emptyDraft(content.categories[1] ?? content.categories[0] ?? ""));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const handle = async (action: () => Promise<{ revision: number }>, message: string) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await action();
      const fresh = await adminApi.content();
      onContent({ ...fresh, revision: result.revision });
      setEditing(null);
      setCreating(false);
      setNotice(message);
    } catch (failure) {
      const current = conflictRevision(failure);
      if (current) {
        onContent(current);
        setError("تم تحديث المحتوى من مكان آخر. راجع النسخة الأحدث ثم أعد المحاولة.");
      } else {
        setError("تعذّر الحفظ. تأكد من صحة كل الحقول (الروابط يجب أن تبدأ بـ https:// أو /).");
      }
    } finally {
      setBusy(false);
    }
  };

  const save = (id: number) =>
    handle(
      () =>
        adminApi.updateProduct(
          id,
          { ...draft, id },
          content.revision,
        ),
      "تم تحديث المنتج.",
    );

  const create = () =>
    handle(
      () => adminApi.createProduct({ ...draft }, content.revision),
      "تمت إضافة المنتج.",
    );

  const remove = (product: Product) => {
    if (!window.confirm(`سيتم حذف «${product.name}» نهائيًا. متأكد؟`)) return;
    void handle(
      () => adminApi.deleteProduct(product.id, content.revision),
      "تم حذف المنتج.",
    );
  };

  const form = (onSubmit: () => void, submitLabel: string) => (
    <div className="admin-product-form">
      <TextField
        testId="product-name"
        label="اسم المنتج"
        value={draft.name}
        onChange={(name) => setDraft({ ...draft, name })}
      />
      <Field label="التصنيف">
        <select
          data-testid="product-category"
          value={draft.category}
          onChange={(event) => setDraft({ ...draft, category: event.target.value })}
        >
          {content.categories
            .filter((category) => category !== "الكل")
            .map((category) => (
              <option key={category}>{category}</option>
            ))}
        </select>
      </Field>
      <TextField
        testId="product-size"
        label="الوزن / الحجم"
        value={draft.size}
        onChange={(size) => setDraft({ ...draft, size })}
        placeholder="1 كجم"
      />
      <Field label="اللون التعريفي">
        <input
          data-testid="product-color"
          type="color"
          dir="ltr"
          value={draft.color}
          onChange={(event) => setDraft({ ...draft, color: event.target.value })}
        />
      </Field>
      <TextAreaField
        testId="product-desc"
        label="الوصف المختصر"
        value={draft.desc}
        onChange={(desc) => setDraft({ ...draft, desc })}
        rows={2}
      />
      <TextAreaField
        label="الوصف الكامل"
        value={draft.longDesc}
        onChange={(longDesc) => setDraft({ ...draft, longDesc })}
        rows={3}
      />
      <TextField
        testId="product-img"
        label="رابط الصورة"
        hint="(https:// أو /images/…)"
        dir="ltr"
        value={draft.img}
        onChange={(img) => setDraft({ ...draft, img })}
        placeholder="https://…"
      />
      <TextField
        label="رابط WebP"
        hint="(اختياري)"
        dir="ltr"
        value={draft.webp}
        onChange={(webp) => setDraft({ ...draft, webp })}
      />
      <TextField
        label="رابط الصورة البديلة"
        hint="(يُستخدم عند فشل التحميل)"
        dir="ltr"
        value={draft.fallback}
        onChange={(fallback) => setDraft({ ...draft, fallback })}
      />
      <div className="admin-form-actions">
        <button className="admin-primary" disabled={busy} onClick={onSubmit}>
          {busy && <Loader2 className="spin" size={16} />}
          {submitLabel}
        </button>
        <button
          className="admin-ghost"
          onClick={() => {
            setEditing(null);
            setCreating(false);
          }}
        >
          <X size={15} />
          إلغاء
        </button>
      </div>
      <p className="admin-hint">
        رفع الصور غير مطلوب: استخدم رابطًا مباشرًا بـ HTTPS أو ملفًا داخل public/images/.
      </p>
    </div>
  );

  return (
    <section className="admin-panel">
      <div className="admin-panel-head">
        <h1>المنتجات</h1>
        <div className="admin-tools">
          <span className="admin-muted">الإصدار {content.revision}</span>
          <button
            className="admin-primary"
            onClick={() => {
              setCreating(true);
              setEditing(null);
              setDraft(emptyDraft(content.categories[1] ?? ""));
            }}
          >
            <Plus size={16} />
            منتج جديد
          </button>
        </div>
      </div>

      {error && (
        <p className="admin-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="admin-notice" role="status">
          {notice}
        </p>
      )}

      {creating && (
        <div className="admin-card">
          <h2>إضافة منتج</h2>
          {form(create, "إضافة")}
        </div>
      )}

      <div className="admin-grid">
        {content.products.map((product) => (
          <article className="admin-card" key={product.id}>
            <div className="admin-card-head">
              <div>
                <h2>{product.name}</h2>
                <span className="admin-muted">
                  {product.category} · {product.size}
                </span>
              </div>
              <div className="admin-row-tools">
                <button
                  className="admin-icon"
                  data-testid={`edit-product-${product.id}`}
                  aria-label={`تعديل ${product.name}`}
                  onClick={() => {
                    setEditing(product.id);
                    setCreating(false);
                    setDraft(toDraft(product));
                  }}
                >
                  <Pencil size={15} />
                </button>
                <button
                  className="admin-icon danger"
                  data-testid={`delete-product-${product.id}`}
                  aria-label={`حذف ${product.name}`}
                  onClick={() => remove(product)}
                >
                  <Trash2 size={15} />
                </button>
              </div>
            </div>
            {editing === product.id ? (
              form(() => save(product.id), "حفظ")
            ) : (
              <p className="admin-product-desc">{product.desc}</p>
            )}
          </article>
        ))}
      </div>
      {content.products.length === 0 && (
        <p className="admin-empty">لا توجد منتجات بعد.</p>
      )}
    </section>
  );
}
