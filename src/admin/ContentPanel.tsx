import { useEffect, useState } from "react";
import { Loader2, Save, TriangleAlert } from "lucide-react";
import type { Content, ContentDoc } from "../../shared/content.ts";
import { adminApi, conflictRevision } from "./api";
import {
  AddButton,
  Field,
  NumberField,
  RowTools,
  TextAreaField,
  TextField,
  moveItem,
} from "./fields";
import { ImageField } from "./ui";

export default function ContentPanel({
  content,
  onContent,
  onDirtyChange,
}: {
  content: ContentDoc;
  onContent: (content: ContentDoc) => void;
  /** Lets the shell warn instead of clobbering an unsaved draft on remote edits. */
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [draft, setDraft] = useState<Content>(content);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [conflict, setConflict] = useState<ContentDoc | null>(null);

  // Re-sync only when the server hands us a different revision.
  useEffect(() => {
    setDraft(content);
    onDirtyChange?.(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content]);

  // Report unsaved changes so the shell never overwrites them from a live update.
  useEffect(() => {
    onDirtyChange?.(JSON.stringify(draft) !== JSON.stringify(content));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, content]);

  const patch = <K extends keyof Content>(key: K, value: Content[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setNotice("");
  };

  const save = async () => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const saved = await adminApi.saveContent(draft, content.revision);
      onContent(saved);
      setNotice("تم نشر التعديلات.");
    } catch (failure) {
      const current = conflictRevision(failure);
      if (current) {
        // Someone published first — never silently overwrite them.
        setConflict(current);
      } else {
        setError(
          "تعذّر الحفظ. تأكد من صحة الحقول والروابط (https:// أو / فقط) وبريد التواصل.",
        );
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="admin-panel">
      <div className="admin-panel-head">
        <h1>محتوى الموقع</h1>
        <div className="admin-tools">
          <span className="admin-muted">
            الإصدار الحالي {content.revision}
          </span>
          <button className="admin-primary" onClick={() => void save()} disabled={busy}>
            {busy ? <Loader2 className="spin" size={16} /> : <Save size={16} />}
            نشر التعديلات
          </button>
        </div>
      </div>

      {conflict && (
        <div className="admin-conflict" role="alert">
          <TriangleAlert size={18} />
          <div>
            <strong>يوجد إصدار أحدث على السيرفر (الإصدار {conflict.revision}).</strong>
            <p>
              لم يتم استبدال تعديلاتك. حمّل النسخة الأحدث لتظهر لك التغييرات الأخيرة،
              ثم أعد تطبيق ما تريد.
            </p>
          </div>
          <button
            className="admin-ghost"
            onClick={() => {
              onContent(conflict);
              setDraft(conflict);
              setConflict(null);
            }}
          >
            تحميل النسخة الأحدث
          </button>
        </div>
      )}
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

      {/* ---------------- Business / contact ---------------- */}
      <div className="admin-card">
        <h2>بيانات النشاط والتواصل</h2>
        <div className="admin-form-grid">
          <TextField
            testId="site-name"
            label="اسم النشاط"
            value={draft.site.name}
            onChange={(name) => patch("site", { ...draft.site, name })}
          />
          <TextField
            label="البريد الإلكتروني"
            dir="ltr"
            value={draft.site.email}
            onChange={(email) => patch("site", { ...draft.site, email })}
          />
          <TextField
            label="رقم التواصل"
            dir="ltr"
            value={draft.site.phone}
            onChange={(phone) => patch("site", { ...draft.site, phone })}
          />
          <TextField
            label="رقم التواصل الثاني"
            dir="ltr"
            value={draft.site.secondPhone}
            onChange={(secondPhone) => patch("site", { ...draft.site, secondPhone })}
          />
          <TextField
            label="رقم واتساب"
            hint="(أرقام فقط مع كود الدولة)"
            dir="ltr"
            value={draft.site.whatsapp}
            onChange={(whatsapp) => patch("site", { ...draft.site, whatsapp })}
          />
          <ImageField
            label="شعار الموقع"
            value={draft.site.logoUrl}
            onChange={(logoUrl) => patch("site", { ...draft.site, logoUrl })}
            hint="ارفع صورة الشعار من جهازك أو الصق رابطًا. اتركه فارغًا لاستخدام الشعار النصي."
          />
          <TextField
            label="رابط الموقع (Domain)"
            dir="ltr"
            value={draft.site.domain}
            onChange={(domain) => patch("site", { ...draft.site, domain })}
          />
          <TextField
            label="فيسبوك"
            dir="ltr"
            value={draft.site.facebook}
            onChange={(facebook) => patch("site", { ...draft.site, facebook })}
          />
          <TextField
            label="إنستجرام"
            dir="ltr"
            value={draft.site.instagram}
            onChange={(instagram) => patch("site", { ...draft.site, instagram })}
          />
          <TextField
            label="رابط الحقوق"
            dir="ltr"
            value={draft.site.credit}
            onChange={(credit) => patch("site", { ...draft.site, credit })}
          />
          <TextField
            label="العنوان"
            value={draft.site.address}
            onChange={(address) => patch("site", { ...draft.site, address })}
          />
          <TextField
            label="رابط الخريطة"
            dir="ltr"
            value={draft.site.mapsUrl}
            onChange={(mapsUrl) => patch("site", { ...draft.site, mapsUrl })}
          />
        </div>
      </div>

      {/* ---------------- SEO ---------------- */}
      <div className="admin-card">
        <h2>بيانات محركات البحث</h2>
        <div className="admin-form-grid">
          <TextField
            label="عنوان الصفحة"
            value={draft.seo.title}
            onChange={(title) => patch("seo", { ...draft.seo, title })}
          />
          <TextAreaField
            label="وصف الصفحة"
            value={draft.seo.description}
            onChange={(description) => patch("seo", { ...draft.seo, description })}
            rows={2}
          />
        </div>
      </div>

      {/* ---------------- Hero ---------------- */}
      <div className="admin-card">
        <h2>الواجهة الرئيسية</h2>
        <div className="admin-form-grid">
          <TextField
            label="النص العلوي"
            value={draft.hero.eyebrow}
            onChange={(eyebrow) => patch("hero", { ...draft.hero, eyebrow })}
          />
          <TextField
            testId="hero-tagline"
            label="الشعار الفرعي"
            value={draft.hero.tagline}
            onChange={(tagline) => patch("hero", { ...draft.hero, tagline })}
          />
          <TextField
            label="الختم"
            value={draft.hero.seal}
            onChange={(seal) => patch("hero", { ...draft.hero, seal })}
          />
        </div>
        <h3>شرائح الواجهة</h3>
        {draft.hero.slides.map((slide, index) => (
          <div className="admin-subcard" key={index}>
            <RowTools
              index={index}
              total={draft.hero.slides.length}
              onMove={(from, to) =>
                patch("hero", { ...draft.hero, slides: moveItem(draft.hero.slides, from, to) })
              }
              onRemove={() =>
                patch("hero", {
                  ...draft.hero,
                  slides: draft.hero.slides.filter((_, i) => i !== index),
                })
              }
            />
            <div className="admin-form-grid">
              <TextField
                label="الاسم"
                value={slide.name}
                onChange={(name) =>
                  patch("hero", {
                    ...draft.hero,
                    slides: draft.hero.slides.map((item, i) =>
                      i === index ? { ...item, name } : item,
                    ),
                  })
                }
              />
              <ImageField
                label="صورة الشريحة"
                value={slide.src}
                webpValue={slide.webp}
                onChange={(src) =>
                  patch("hero", {
                    ...draft.hero,
                    slides: draft.hero.slides.map((item, i) =>
                      i === index ? { ...item, src } : item,
                    ),
                  })
                }
                onWebpChange={(webp) =>
                  patch("hero", {
                    ...draft.hero,
                    slides: draft.hero.slides.map((item, i) =>
                      i === index ? { ...item, webp } : item,
                    ),
                  })
                }
                hint="ارفع صورة من جهازك أو الصق رابطًا خارجيًا، مع نسخة WebP اختيارية."
              />
              <TextField
                label="رابط بديل"
                dir="ltr"
                value={slide.fallback}
                onChange={(fallback) =>
                  patch("hero", {
                    ...draft.hero,
                    slides: draft.hero.slides.map((item, i) =>
                      i === index ? { ...item, fallback } : item,
                    ),
                  })
                }
              />
              <Field label="لون الخلفية">
                <input
                  type="color"
                  dir="ltr"
                  value={slide.bg}
                  onChange={(event) =>
                    patch("hero", {
                      ...draft.hero,
                      slides: draft.hero.slides.map((item, i) =>
                        i === index ? { ...item, bg: event.target.value } : item,
                      ),
                    })
                  }
                />
              </Field>
              <Field label="لون اللوحة">
                <input
                  type="color"
                  dir="ltr"
                  value={slide.panel}
                  onChange={(event) =>
                    patch("hero", {
                      ...draft.hero,
                      slides: draft.hero.slides.map((item, i) =>
                        i === index ? { ...item, panel: event.target.value } : item,
                      ),
                    })
                  }
                />
              </Field>
              <TextAreaField
                label="الوصف"
                value={slide.desc}
                rows={2}
                onChange={(desc) =>
                  patch("hero", {
                    ...draft.hero,
                    slides: draft.hero.slides.map((item, i) =>
                      i === index ? { ...item, desc } : item,
                    ),
                  })
                }
              />
            </div>
          </div>
        ))}
        <AddButton
          label="إضافة شريحة"
          onClick={() =>
            patch("hero", {
              ...draft.hero,
              slides: [
                ...draft.hero.slides,
                {
                  src: "/images/mozzarella.webp",
                  webp: "",
                  fallback: "/images/mozzarella.webp",
                  bg: "#1E3FA8",
                  panel: "#4766C8",
                  name: "منتج جديد",
                  desc: "",
                },
              ],
            })
          }
        />
      </div>

      {/* ---------------- Copy ---------------- */}
      <div className="admin-card">
        <h2>النصوص</h2>
        <div className="admin-form-grid">
          {(
            [
              ["heroEyebrow", "النص العلوي"],
              ["heroTagline", "الشعار"],
              ["heroSeal", "ختم الواجهة"],
              ["productsSubtitle", "وصف المنتجات"],
              ["whySubtitle", "وصف لماذا نحن"],
              ["aboutTagline", "وصف من نحن"],
              ["gallerySubtitle", "وصف المعرض"],
              ["testimonialSubtitle", "وصف الآراء"],
              ["contactSubtitle", "وصف التواصل"],
            ] as const
          ).map(([key, label]) => (
            <TextField
              key={key}
              label={label}
              value={draft.copy[key]}
              onChange={(value) => patch("copy", { ...draft.copy, [key]: value })}
            />
          ))}
        </div>
        <TextAreaField
          label="نبذة من نحن"
          rows={4}
          value={draft.copy.aboutDescription}
          onChange={(aboutDescription) =>
            patch("copy", { ...draft.copy, aboutDescription })
          }
        />
        <h3>وسوم من نحن</h3>
        {draft.copy.aboutChips.map((chip, index) => (
          <div className="admin-inline-row" key={index}>
            <input
              value={chip}
              onChange={(event) =>
                patch("copy", {
                  ...draft.copy,
                  aboutChips: draft.copy.aboutChips.map((item, i) =>
                    i === index ? event.target.value : item,
                  ),
                })
              }
            />
            <RowTools
              index={index}
              total={draft.copy.aboutChips.length}
              onMove={(from, to) =>
                patch("copy", {
                  ...draft.copy,
                  aboutChips: moveItem(draft.copy.aboutChips, from, to),
                })
              }
              onRemove={() =>
                patch("copy", {
                  ...draft.copy,
                  aboutChips: draft.copy.aboutChips.filter((_, i) => i !== index),
                })
              }
            />
          </div>
        ))}
        <AddButton
          label="إضافة وسم"
          onClick={() =>
            patch("copy", { ...draft.copy, aboutChips: [...draft.copy.aboutChips, "وسم جديد"] })
          }
        />
      </div>

      {/* ---------------- Categories & units ---------------- */}
      <div className="admin-card">
        <h2>التصنيفات والوحدات</h2>
        <h3>التصنيفات</h3>
        {draft.categories.map((category, index) => (
          <div className="admin-inline-row" key={index}>
            <input
              value={category}
              onChange={(event) =>
                patch(
                  "categories",
                  draft.categories.map((item, i) =>
                    i === index ? event.target.value : item,
                  ),
                )
              }
            />
            <RowTools
              index={index}
              total={draft.categories.length}
              onMove={(from, to) => patch("categories", moveItem(draft.categories, from, to))}
              onRemove={() =>
                patch(
                  "categories",
                  draft.categories.filter((_, i) => i !== index),
                )
              }
            />
          </div>
        ))}
        <AddButton
          label="إضافة تصنيف"
          onClick={() => patch("categories", [...draft.categories, "تصنيف جديد"])}
        />
        <h3>وحدات الطلب</h3>
        {draft.units.map((unit, index) => (
          <div className="admin-inline-row" key={index}>
            <input
              value={unit}
              onChange={(event) =>
                patch(
                  "units",
                  draft.units.map((item, i) => (i === index ? event.target.value : item)),
                )
              }
            />
            <RowTools
              index={index}
              total={draft.units.length}
              onMove={(from, to) => patch("units", moveItem(draft.units, from, to))}
              onRemove={() =>
                patch(
                  "units",
                  draft.units.filter((_, i) => i !== index),
                )
              }
            />
          </div>
        ))}
        <AddButton
          label="إضافة وحدة"
          onClick={() => patch("units", [...draft.units, "وحدة"])}
        />
      </div>

      {/* ---------------- Section labels ---------------- */}
      <div className="admin-card">
        <h2>أسماء الأقسام</h2>
        <div className="admin-form-grid">
          {draft.sectionNames.map((name, index) => (
            <Field key={index} label={`القسم ${index + 1}`}>
              <input
                value={name}
                onChange={(event) =>
                  patch(
                    "sectionNames",
                    draft.sectionNames.map((item, i) =>
                      i === index ? event.target.value : item,
                    ),
                  )
                }
              />
            </Field>
          ))}
        </div>
      </div>

      {/* ---------------- Statistics ---------------- */}
      <div className="admin-card">
        <h2>الإحصائيات</h2>
        {draft.stats.map((stat, index) => (
          <div className="admin-subcard" key={index}>
            <RowTools
              index={index}
              total={draft.stats.length}
              onMove={(from, to) => patch("stats", moveItem(draft.stats, from, to))}
              onRemove={() =>
                patch("stats", draft.stats.filter((_, i) => i !== index))
              }
            />
            <div className="admin-form-grid">
              <NumberField
                label="القيمة"
                value={stat.value}
                onChange={(value) =>
                  patch(
                    "stats",
                    draft.stats.map((item, i) => (i === index ? { ...item, value } : item)),
                  )
                }
              />
              <TextField
                label="اللاحقة"
                value={stat.suffix}
                onChange={(suffix) =>
                  patch(
                    "stats",
                    draft.stats.map((item, i) => (i === index ? { ...item, suffix } : item)),
                  )
                }
              />
              <TextField
                label="المسمى"
                value={stat.label}
                onChange={(label) =>
                  patch(
                    "stats",
                    draft.stats.map((item, i) => (i === index ? { ...item, label } : item)),
                  )
                }
              />
            </div>
          </div>
        ))}
        <AddButton
          label="إضافة إحصائية"
          onClick={() =>
            patch("stats", [...draft.stats, { value: 0, suffix: "+", label: "مسمى" }])
          }
        />
      </div>

      {/* ---------------- Gallery ---------------- */}
      <div className="admin-card">
        <h2>معرض الصور</h2>
        {draft.gallery.map((photo, index) => (
          <div className="admin-subcard" key={index}>
            <RowTools
              index={index}
              total={draft.gallery.length}
              onMove={(from, to) => patch("gallery", moveItem(draft.gallery, from, to))}
              onRemove={() =>
                patch("gallery", draft.gallery.filter((_, i) => i !== index))
              }
            />
            <div className="admin-form-grid">
              <TextField
                label="التعليق"
                value={photo.caption}
                onChange={(caption) =>
                  patch(
                    "gallery",
                    draft.gallery.map((item, i) => (i === index ? { ...item, caption } : item)),
                  )
                }
              />
              <TextField
                label="رابط الصورة"
                hint="(اتركه فارغًا لعرض بطاقة «قريبًا»)"
                dir="ltr"
                value={photo.src}
                onChange={(src) =>
                  patch(
                    "gallery",
                    draft.gallery.map((item, i) => (i === index ? { ...item, src } : item)),
                  )
                }
              />
            </div>
          </div>
        ))}
        <AddButton
          label="إضافة صورة"
          onClick={() => patch("gallery", [...draft.gallery, { src: "", caption: "صورة جديدة" }])}
        />
      </div>

      {/* ---------------- Reviews ---------------- */}
      <div className="admin-card">
        <h2>آراء العملاء</h2>
        {draft.reviews.map((review, index) => (
          <div className="admin-subcard" key={index}>
            <RowTools
              index={index}
              total={draft.reviews.length}
              onMove={(from, to) => patch("reviews", moveItem(draft.reviews, from, to))}
              onRemove={() =>
                patch("reviews", draft.reviews.filter((_, i) => i !== index))
              }
            />
            <div className="admin-form-grid">
              <TextField
                label="الاسم"
                value={review.name}
                onChange={(name) =>
                  patch(
                    "reviews",
                    draft.reviews.map((item, i) => (i === index ? { ...item, name } : item)),
                  )
                }
              />
              <TextField
                label="الصفة"
                value={review.role}
                onChange={(role) =>
                  patch(
                    "reviews",
                    draft.reviews.map((item, i) => (i === index ? { ...item, role } : item)),
                  )
                }
              />
              <NumberField
                label="التقييم (1-5)"
                value={review.rating}
                min={1}
                max={5}
                onChange={(rating) =>
                  patch(
                    "reviews",
                    draft.reviews.map((item, i) => (i === index ? { ...item, rating } : item)),
                  )
                }
              />
            </div>
            <TextAreaField
              label="النص"
              rows={2}
              value={review.text}
              onChange={(text) =>
                patch(
                  "reviews",
                  draft.reviews.map((item, i) => (i === index ? { ...item, text } : item)),
                )
              }
            />
          </div>
        ))}
        <AddButton
          label="إضافة رأي"
          onClick={() =>
            patch("reviews", [
              ...draft.reviews,
              { name: "اسم العميل", role: "عميل", rating: 5, text: "" },
            ])
          }
        />
      </div>

      {/* ---------------- FAQs ---------------- */}
      <div className="admin-card">
        <h2>الأسئلة الشائعة</h2>
        {draft.faqs.map((item, index) => (
          <div className="admin-subcard" key={index}>
            <RowTools
              index={index}
              total={draft.faqs.length}
              onMove={(from, to) => patch("faqs", moveItem(draft.faqs, from, to))}
              onRemove={() => patch("faqs", draft.faqs.filter((_, i) => i !== index))}
            />
            <TextField
              label="السؤال"
              value={item.q}
              onChange={(q) =>
                patch(
                  "faqs",
                  draft.faqs.map((entry, i) => (i === index ? { ...entry, q } : entry)),
                )
              }
            />
            <TextAreaField
              label="الإجابة"
              rows={2}
              value={item.a}
              onChange={(a) =>
                patch(
                  "faqs",
                  draft.faqs.map((entry, i) => (i === index ? { ...entry, a } : entry)),
                )
              }
            />
          </div>
        ))}
        <AddButton
          label="إضافة سؤال"
          onClick={() => patch("faqs", [...draft.faqs, { q: "سؤال جديد", a: "" }])}
        />
      </div>

      {/* ---------------- Why us ---------------- */}
      <div className="admin-card">
        <h2>لماذا نحن</h2>
        {draft.whyUs.map((item, index) => (
          <div className="admin-subcard" key={index}>
            <RowTools
              index={index}
              total={draft.whyUs.length}
              onMove={(from, to) => patch("whyUs", moveItem(draft.whyUs, from, to))}
              onRemove={() => patch("whyUs", draft.whyUs.filter((_, i) => i !== index))}
            />
            <div className="admin-form-grid">
              <TextField
                label="الأيقونة"
                hint="(Leaf, ShieldCheck, Truck, BadgePercent)"
                dir="ltr"
                value={item.icon}
                onChange={(icon) =>
                  patch(
                    "whyUs",
                    draft.whyUs.map((entry, i) => (i === index ? { ...entry, icon } : entry)),
                  )
                }
              />
              <TextField
                label="العنوان"
                value={item.title}
                onChange={(title) =>
                  patch(
                    "whyUs",
                    draft.whyUs.map((entry, i) => (i === index ? { ...entry, title } : entry)),
                  )
                }
              />
            </div>
            <TextAreaField
              label="النص"
              rows={2}
              value={item.text}
              onChange={(text) =>
                patch(
                  "whyUs",
                  draft.whyUs.map((entry, i) => (i === index ? { ...entry, text } : entry)),
                )
              }
            />
          </div>
        ))}
        <AddButton
          label="إضافة ميزة"
          onClick={() =>
            patch("whyUs", [
              ...draft.whyUs,
              { icon: "Leaf", title: "ميزة جديدة", text: "" },
            ])
          }
        />
      </div>

      {/* ---------------- Placeholder flags ---------------- */}
      <div className="admin-card">
        <h2>حالة المحتوى (محتوى توضيحي)</h2>
        <p className="admin-note">
          أبقِ هذه العلامات مفعّلة حتى يتم استبدال المحتوى التوضيحي بمحتوى حقيقي موثّق.
          إيقافها يعني أن الموقع سيعرضه كمحتوى رسمي.
        </p>
        {(
          [
            ["statsArePlaceholders", "الأرقام والإحصائيات توضيحية"],
            ["testimonialsArePlaceholders", "آراء العملاء توضيحية"],
            ["reviewsArePlaceholders", "قسم الآراء بالكامل توضيحي"],
            ["galleryArePlaceholders", "صور المعرض توضيحية"],
            ["addressIsPlaceholder", "العنوان غير مؤكد"],
          ] as const
        ).map(([key, label]) => (
          <label className="admin-check" key={key}>
            <input
              type="checkbox"
              checked={draft.contentStatus[key]}
              onChange={(event) =>
                patch("contentStatus", {
                  ...draft.contentStatus,
                  [key]: event.target.checked,
                })
              }
            />
            <span>{label}</span>
          </label>
        ))}
        <TextField
          label="أرقام المنتجات ذات الصور التوضيحية"
          hint="(أرقام مفصولة بفاصلة)"
          dir="ltr"
          value={draft.contentStatus.placeholderProductIds.join(", ")}
          onChange={(value) =>
            patch("contentStatus", {
              ...draft.contentStatus,
              placeholderProductIds: value
                .split(",")
                .map((part) => Number.parseInt(part.trim(), 10))
                .filter((n) => Number.isInteger(n) && n > 0),
            })
          }
        />
      </div>

      <div className="admin-sticky-save">
        <button className="admin-primary" onClick={() => void save()} disabled={busy}>
          {busy ? <Loader2 className="spin" size={16} /> : <Save size={16} />}
          نشر التعديلات
        </button>
      </div>
    </section>
  );
}
