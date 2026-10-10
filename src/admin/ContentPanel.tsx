// Site content editor. Everything a non-technical administrator publishes on
// the public site lives here, split into tabs so no screen is an endless form.
// Nothing technical is exposed: icons are picked visually, ratings use stars,
// and genuinely advanced switches sit behind a disclosure.
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  REVIEW_AUTHENTICITY_LABELS,
  reviewIsIllustrative,
  unclassifiedIllustrativeProducts,
  unclassifiedIllustrativeReviews,
  type Authenticity,
  type Content,
  type ContentDoc,
} from "../../shared/content.ts";
import { adminApi, conflictRevision } from "./api";
import { Icons } from "./icons";
import {
  AddItemButton,
  Badge,
  Button,
  Card,
  ColorField,
  ConfirmDialog,
  Disclosure,
  Field,
  Grid,
  IconPicker,
  ImageField,
  ItemCard,
  OptionGroup,
  InlineListRow,
  Notice,
  PageHeader,
  StarRating,
  StickySaveBar,
  Switch,
  Tabs,
  TabPanel,
  TextArea,
  TextInput,
  moveItem,
  useToast,
} from "./ui";

/**
 * A one-step decision taken from «حالة المحتوى»: it classifies everything that
 * is still waiting, instead of making the owner open every single card.
 * Nothing is ever decided automatically — the owner picks, confirms, publishes.
 */
type BulkAction = {
  target: "products" | "reviews";
  value: Exclude<Authenticity, "unspecified">;
};

type TabKey =
  | "identity"
  | "hero"
  | "sections"
  | "showcase"
  | "voice"
  | "status";

const TABS: { key: TabKey; label: string; icon: ReactNode }[] = [
  { key: "identity", label: "الهوية والتواصل", icon: <Icons.store size={16} /> },
  { key: "hero", label: "الواجهة الرئيسية", icon: <Icons.image size={16} /> },
  { key: "sections", label: "النصوص والأقسام", icon: <Icons.text size={16} /> },
  { key: "showcase", label: "المعرض والأرقام", icon: <Icons.images size={16} /> },
  { key: "voice", label: "الآراء والأسئلة", icon: <Icons.star size={16} /> },
  { key: "status", label: "حالة المحتوى", icon: <Icons.info size={16} /> },
];

const COPY_FIELDS = [
  ["heroEyebrow", "النص العلوي للواجهة"],
  ["heroTagline", "شعار الواجهة"],
  ["heroSeal", "ختم الواجهة"],
  ["productsSubtitle", "وصف قسم المنتجات"],
  ["whySubtitle", "وصف قسم لماذا نحن"],
  ["aboutTagline", "وصف قسم من نحن"],
  ["gallerySubtitle", "وصف قسم المعرض"],
  ["testimonialSubtitle", "وصف قسم الآراء"],
  ["contactSubtitle", "وصف قسم التواصل"],
] as const;

const STATUS_FLAGS = [
  [
    "statsArePlaceholders",
    "الأرقام والإحصائيات توضيحية",
    "تظهر للزائر مع تنبيه أنها أرقام تقريبية.",
  ],
  [
    "testimonialsArePlaceholders",
    "اعتبار الآراء غير المحددة توضيحية",
    "يسري فقط على رأي لم تحدّد نوعه داخل بطاقته في تبويب «الآراء والأسئلة».",
  ],
  [
    "reviewsArePlaceholders",
    "قسم الآراء بالكامل توضيحي",
    "يخفي أي ادّعاء بأن الآراء رسمية.",
  ],
  ["galleryArePlaceholders", "صور المعرض توضيحية", "صور عامة وليست من المزرعة."],
  ["addressIsPlaceholder", "العنوان غير مؤكد", "لا يظهر العنوان كعنوان رسمي."],
] as const;

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
  const [tab, setTab] = useState<TabKey>("identity");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState<ContentDoc | null>(null);
  /** Which bulk classification the owner is being asked to confirm. */
  const [bulkAsk, setBulkAsk] = useState<BulkAction | null>(null);
  const toast = useToast();

  // Re-sync only when the server hands us a different revision.
  useEffect(() => {
    setDraft(content);
    onDirtyChange?.(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content]);

  const dirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(content),
    [draft, content],
  );

  /**
   * Products that still show the illustrative-image note only because their id
   * sits in the old `placeholderProductIds` list. They are listed by name (no
   * internal numbers) so the owner can classify them one by one.
   */
  const legacyPlaceholderProducts = useMemo(
    () => unclassifiedIllustrativeProducts(draft.products, draft.contentStatus),
    [draft.products, draft.contentStatus],
  );

  /**
   * Reviews that carry the "رأي توضيحي" note only because the global switch is
   * on and nobody has classified them yet. Their position travels with them so
   * a decision patches exactly the right review.
   */
  const legacyPlaceholderReviews = useMemo(
    () =>
      unclassifiedIllustrativeReviews(
        draft.reviews.map((review, index) => ({ ...review, index })),
        draft.contentStatus,
      ),
    [draft.reviews, draft.contentStatus],
  );

  // Report unsaved changes so the shell never overwrites them from a live update.
  useEffect(() => {
    onDirtyChange?.(dirty);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty]);

  const patch = <K extends keyof Content>(key: K, value: Content[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  /** Replaces one entry of a typed list without touching the others. */
  const mapList = <T,>(list: T[], index: number, change: (item: T) => T) =>
    list.map((item, i) => (i === index ? change(item) : item));

  /** Records an image decision; every other product field stays as it was. */
  const classifyImages = (ids: number[], value: Authenticity) =>
    patch(
      "products",
      draft.products.map((product) =>
        ids.includes(product.id)
          ? { ...product, imageAuthenticity: value }
          : product,
      ),
    );

  /** Records a review decision. Ratings and texts are never touched. */
  const classifyReviews = (indexes: number[], value: Authenticity) =>
    patch(
      "reviews",
      draft.reviews.map((review, index) =>
        indexes.includes(index) ? { ...review, authenticity: value } : review,
      ),
    );

  const bulkCount =
    bulkAsk?.target === "products"
      ? legacyPlaceholderProducts.length
      : legacyPlaceholderReviews.length;

  const applyBulk = () => {
    if (!bulkAsk) return;
    if (bulkAsk.target === "products")
      classifyImages(
        legacyPlaceholderProducts.map((product) => product.id),
        bulkAsk.value,
      );
    else
      classifyReviews(
        legacyPlaceholderReviews.map((review) => review.index),
        bulkAsk.value,
      );
    setBulkAsk(null);
    toast.push("info", "تم التحديد. اضغط «نشر التعديلات» ليظهر على الموقع.");
  };

  const save = async () => {
    setBusy(true);
    setError("");
    try {
      const saved = await adminApi.saveContent(draft, content.revision);
      onContent(saved);
      setConflict(null);
      toast.push("success", "تم التحديث على الموقع.");
    } catch (failure) {
      const current = conflictRevision(failure);
      if (current) {
        // Someone published first — never silently overwrite them.
        setConflict(current);
      } else {
        setError(
          "تعذّر الحفظ. تأكد من صحة الحقول والروابط (https:// أو / فقط) وبريد التواصل.",
        );
        toast.push("error", "تعذّر نشر التعديلات. راجع الحقول المطلوبة.");
      }
    } finally {
      setBusy(false);
    }
  };

  const site = draft.site;
  const hero = draft.hero;
  const copy = draft.copy;

  return (
    <>
      <PageHeader
        title="محتوى الموقع"
        description="كل ما يراه الزائر على الصفحة الرئيسية: البيانات، النصوص، الصور، الآراء والأسئلة."
        meta={
          <Badge tone="neutral" icon={<Icons.history size={13} />}>
            الإصدار المنشور {content.revision}
          </Badge>
        }
        actions={
          <Button
            icon={<Icons.save size={17} />}
            loading={busy}
            disabled={!dirty}
            onClick={() => void save()}
          >
            نشر التعديلات
          </Button>
        }
      />

      {conflict && (
        <Notice
          tone="warn"
          title={`يوجد إصدار أحدث على السيرفر (الإصدار ${conflict.revision})`}
          action={
            <Button
              variant="soft"
              size="sm"
              icon={<Icons.refresh size={15} />}
              onClick={() => {
                onContent(conflict);
                setDraft(conflict);
                setConflict(null);
              }}
            >
              تحميل النسخة الأحدث
            </Button>
          }
        >
          لم يتم استبدال تعديلاتك. حمّل النسخة الأحدث لتظهر لك التغييرات
          الأخيرة، ثم أعد تطبيق ما تريد.
        </Notice>
      )}

      {error && (
        <Notice tone="danger" title="لم يتم النشر">
          {error}
        </Notice>
      )}

      <Tabs
        label="أقسام محتوى الموقع"
        value={tab}
        onChange={(key) => setTab(key as TabKey)}
        items={TABS}
      />

      {/* ------------------------------------------- identity and contact */}
      <TabPanel tabKey="identity" active={tab === "identity"}>
        <Card
          title="بيانات النشاط"
          icon={<Icons.store size={18} />}
          description="تظهر في الترويسة والتذييل وصفحة التواصل."
        >
          <Grid columns={2}>
            <Field label="اسم النشاط" required>
              <TextInput
                testId="site-name"
                value={site.name}
                onChange={(name) => patch("site", { ...site, name })}
                maxLength={120}
              />
            </Field>
            <Field label="العنوان">
              <TextInput
                value={site.address}
                onChange={(address) => patch("site", { ...site, address })}
                maxLength={300}
              />
            </Field>
          </Grid>
          <ImageField
            label="شعار الموقع"
            value={site.logoUrl}
            onChange={(logoUrl) => patch("site", { ...site, logoUrl })}
            hint="ارفع صورة الشعار من جهازك أو الصق رابطًا. اتركه فارغًا لاستخدام الشعار النصي."
          />
        </Card>

        <Card
          title="وسائل التواصل"
          icon={<Icons.phone size={18} />}
          description="الأرقام والبريد التي يتواصل عبرها العملاء."
        >
          <Grid columns={2}>
            <Field label="رقم التواصل" required>
              <TextInput
                value={site.phone}
                onChange={(phone) => patch("site", { ...site, phone })}
                dir="ltr"
                inputMode="tel"
              />
            </Field>
            <Field label="رقم التواصل الثاني">
              <TextInput
                value={site.secondPhone}
                onChange={(secondPhone) =>
                  patch("site", { ...site, secondPhone })
                }
                dir="ltr"
                inputMode="tel"
              />
            </Field>
            <Field label="رقم واتساب" hint="أرقام فقط مع كود الدولة، مثل 20100…">
              <TextInput
                value={site.whatsapp}
                onChange={(whatsapp) => patch("site", { ...site, whatsapp })}
                dir="ltr"
                inputMode="numeric"
              />
            </Field>
            <Field label="البريد الإلكتروني">
              <TextInput
                value={site.email}
                onChange={(email) => patch("site", { ...site, email })}
                type="email"
                dir="ltr"
              />
            </Field>
          </Grid>
        </Card>

        <Card
          title="الروابط"
          icon={<Icons.link size={18} />}
          description="اتركها فارغة إذا لم تكن مستخدمة. تُقبل الروابط التي تبدأ بـ https:// فقط."
        >
          <Grid columns={2}>
            <Field label="فيسبوك">
              <TextInput
                value={site.facebook}
                onChange={(facebook) => patch("site", { ...site, facebook })}
                dir="ltr"
                placeholder="https://facebook.com/…"
              />
            </Field>
            <Field label="إنستجرام">
              <TextInput
                value={site.instagram}
                onChange={(instagram) => patch("site", { ...site, instagram })}
                dir="ltr"
                placeholder="https://instagram.com/…"
              />
            </Field>
            <Field label="رابط الخريطة">
              <TextInput
                value={site.mapsUrl}
                onChange={(mapsUrl) => patch("site", { ...site, mapsUrl })}
                dir="ltr"
                placeholder="https://maps.google.com/…"
              />
            </Field>
            <Field label="رابط الموقع">
              <TextInput
                value={site.domain}
                onChange={(domain) => patch("site", { ...site, domain })}
                dir="ltr"
                placeholder="https://elpaze.online"
              />
            </Field>
          </Grid>
          <Disclosure label="خيارات متقدمة" hint="روابط إضافية نادرًا ما تتغيّر.">
            <Field
              label="رابط جهة التطوير"
              hint="يظهر في تذييل الموقع بجانب حقوق النشر."
            >
              <TextInput
                value={site.credit}
                onChange={(credit) => patch("site", { ...site, credit })}
                dir="ltr"
              />
            </Field>
          </Disclosure>
        </Card>

        <Card
          title="بيانات محركات البحث"
          icon={<Icons.search size={18} />}
          description="النص الذي يظهر في نتائج البحث وعند مشاركة رابط الموقع."
        >
          <Field label="عنوان الصفحة" required>
            <TextInput
              value={draft.seo.title}
              onChange={(title) => patch("seo", { ...draft.seo, title })}
              maxLength={200}
            />
          </Field>
          <Field
            label="وصف الصفحة"
            required
            hint="سطران على الأكثر — يظهران أسفل العنوان في نتائج البحث."
          >
            <TextArea
              value={draft.seo.description}
              onChange={(description) =>
                patch("seo", { ...draft.seo, description })
              }
              rows={3}
              maxLength={400}
            />
          </Field>
        </Card>
      </TabPanel>

      {/* -------------------------------------------------------- the hero */}
      <TabPanel tabKey="hero" active={tab === "hero"}>
        <Card
          title="نصوص الواجهة"
          icon={<Icons.text size={18} />}
          description="أول ما يقرأه الزائر أعلى الصفحة."
        >
          <Grid columns={3}>
            <Field label="النص العلوي" required>
              <TextInput
                value={hero.eyebrow}
                onChange={(eyebrow) => patch("hero", { ...hero, eyebrow })}
                maxLength={120}
              />
            </Field>
            <Field label="الشعار الفرعي" required>
              <TextInput
                testId="hero-tagline"
                value={hero.tagline}
                onChange={(tagline) => patch("hero", { ...hero, tagline })}
                maxLength={120}
              />
            </Field>
            <Field label="الختم" required>
              <TextInput
                value={hero.seal}
                onChange={(seal) => patch("hero", { ...hero, seal })}
                maxLength={120}
              />
            </Field>
          </Grid>
        </Card>

        <Card
          title="شرائح الواجهة"
          icon={<Icons.image size={18} />}
          description="الصور المتبدّلة في أعلى الصفحة. يلزم شريحة واحدة على الأقل."
        >
          {hero.slides.map((slide, index) => (
            <ItemCard
              key={index}
              index={index}
              total={hero.slides.length}
              title={slide.name || `شريحة ${index + 1}`}
              subtitle="صورة + وصف قصير"
              removeLabel={`حذف الشريحة ${index + 1}`}
              onMove={(from, to) =>
                patch("hero", {
                  ...hero,
                  slides: moveItem(hero.slides, from, to),
                })
              }
              onRemove={() =>
                patch("hero", {
                  ...hero,
                  slides: hero.slides.filter((_, i) => i !== index),
                })
              }
            >
              <Grid columns={2}>
                <Field label={`اسم الشريحة ${index + 1}`}>
                  <TextInput
                    value={slide.name}
                    onChange={(name) =>
                      patch("hero", {
                        ...hero,
                        slides: hero.slides.map((item, i) =>
                          i === index ? { ...item, name } : item,
                        ),
                      })
                    }
                  />
                </Field>
                <Field label={`وصف الشريحة ${index + 1}`}>
                  <TextArea
                    value={slide.desc}
                    rows={2}
                    onChange={(desc) =>
                      patch("hero", {
                        ...hero,
                        slides: hero.slides.map((item, i) =>
                          i === index ? { ...item, desc } : item,
                        ),
                      })
                    }
                  />
                </Field>
              </Grid>
              <ImageField
                label={`صورة الشريحة ${index + 1}`}
                value={slide.src}
                webpValue={slide.webp}
                onChange={(src) =>
                  patch("hero", {
                    ...hero,
                    slides: hero.slides.map((item, i) =>
                      i === index ? { ...item, src } : item,
                    ),
                  })
                }
                onWebpChange={(webp) =>
                  patch("hero", {
                    ...hero,
                    slides: hero.slides.map((item, i) =>
                      i === index ? { ...item, webp } : item,
                    ),
                  })
                }
                hint="ارفع صورة من جهازك أو الصق رابطًا خارجيًا."
              />
              <Grid columns={2}>
                <ColorField
                  label={`لون خلفية الشريحة ${index + 1}`}
                  value={slide.bg}
                  onChange={(bg) =>
                    patch("hero", {
                      ...hero,
                      slides: hero.slides.map((item, i) =>
                        i === index ? { ...item, bg } : item,
                      ),
                    })
                  }
                />
                <ColorField
                  label={`لون لوحة الشريحة ${index + 1}`}
                  value={slide.panel}
                  onChange={(panel) =>
                    patch("hero", {
                      ...hero,
                      slides: hero.slides.map((item, i) =>
                        i === index ? { ...item, panel } : item,
                      ),
                    })
                  }
                />
              </Grid>
              <Disclosure label="خيارات متقدمة">
                <Field
                  label={`صورة بديلة للشريحة ${index + 1}`}
                  hint="تُستخدم تلقائيًا إذا تعذّر تحميل الصورة الأساسية."
                >
                  <TextInput
                    value={slide.fallback}
                    onChange={(fallback) =>
                      patch("hero", {
                        ...hero,
                        slides: hero.slides.map((item, i) =>
                          i === index ? { ...item, fallback } : item,
                        ),
                      })
                    }
                    dir="ltr"
                  />
                </Field>
              </Disclosure>
            </ItemCard>
          ))}
          <AddItemButton
            label="إضافة شريحة"
            onClick={() =>
              patch("hero", {
                ...hero,
                slides: [
                  ...hero.slides,
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
        </Card>
      </TabPanel>

      {/* ------------------------------------------------ texts & sections */}
      <TabPanel tabKey="sections" active={tab === "sections"}>
        <Card
          title="نصوص الأقسام"
          icon={<Icons.text size={18} />}
          description="السطر التعريفي أسفل عنوان كل قسم."
        >
          <Grid columns={2}>
            {COPY_FIELDS.map(([key, label]) => (
              <Field key={key} label={label} required>
                <TextInput
                  value={copy[key]}
                  onChange={(value) => patch("copy", { ...copy, [key]: value })}
                  maxLength={200}
                />
              </Field>
            ))}
          </Grid>
          <Field label="نبذة «من نحن»" required>
            <TextArea
              value={copy.aboutDescription}
              rows={5}
              onChange={(aboutDescription) =>
                patch("copy", { ...copy, aboutDescription })
              }
              maxLength={3000}
            />
          </Field>
        </Card>

        <Card
          title="وسوم «من نحن»"
          icon={<Icons.tags size={18} />}
          description="كلمات قصيرة تظهر كشارات بجانب النبذة."
        >
          {copy.aboutChips.map((chip, index) => (
            <InlineListRow
              key={index}
              index={index}
              total={copy.aboutChips.length}
              value={chip}
              label={`الوسم ${index + 1}`}
              onChange={(value) =>
                patch("copy", {
                  ...copy,
                  aboutChips: copy.aboutChips.map((item, i) =>
                    i === index ? value : item,
                  ),
                })
              }
              onMove={(from, to) =>
                patch("copy", {
                  ...copy,
                  aboutChips: moveItem(copy.aboutChips, from, to),
                })
              }
              onRemove={() =>
                patch("copy", {
                  ...copy,
                  aboutChips: copy.aboutChips.filter((_, i) => i !== index),
                })
              }
            />
          ))}
          <AddItemButton
            label="إضافة وسم"
            onClick={() =>
              patch("copy", {
                ...copy,
                aboutChips: [...copy.aboutChips, "وسم جديد"],
              })
            }
          />
        </Card>

        <Card
          title="أسماء الأقسام"
          icon={<Icons.list size={18} />}
          description="تظهر في قائمة التنقل أعلى الموقع العام."
        >
          <Grid columns={3}>
            {draft.sectionNames.map((name, index) => (
              <Field key={index} label={`القسم ${index + 1}`} required>
                <TextInput
                  value={name}
                  onChange={(value) =>
                    patch(
                      "sectionNames",
                      draft.sectionNames.map((item, i) =>
                        i === index ? value : item,
                      ),
                    )
                  }
                  maxLength={60}
                />
              </Field>
            ))}
          </Grid>
        </Card>

        <Grid columns={2}>
          <Card
            title="تصنيفات المنتجات"
            icon={<Icons.boxes size={18} />}
            description="تُستخدم في فلاتر المنتجات على الموقع."
          >
            {draft.categories.map((category, index) => (
              <InlineListRow
                key={index}
                index={index}
                total={draft.categories.length}
                value={category}
                label={`التصنيف ${index + 1}`}
                onChange={(value) =>
                  patch(
                    "categories",
                    draft.categories.map((item, i) =>
                      i === index ? value : item,
                    ),
                  )
                }
                onMove={(from, to) => patch("categories", moveItem(draft.categories, from, to))}
                onRemove={() => patch("categories", draft.categories.filter((_, i) => i !== index))}
              />
            ))}
            <AddItemButton
              label="إضافة تصنيف"
              onClick={() =>
                patch("categories", [...draft.categories, "تصنيف جديد"])
              }
            />
          </Card>

          <Card
            title="وحدات الطلب"
            icon={<Icons.package size={18} />}
            description="تظهر للعميل في نموذج طلب الجملة."
          >
            {draft.units.map((unit, index) => (
              <InlineListRow
                key={index}
                index={index}
                total={draft.units.length}
                value={unit}
                label={`الوحدة ${index + 1}`}
                onChange={(value) =>
                  patch(
                    "units",
                    draft.units.map((item, i) => (i === index ? value : item)),
                  )
                }
                onMove={(from, to) => patch("units", moveItem(draft.units, from, to))}
                onRemove={() => patch("units", draft.units.filter((_, i) => i !== index))}
              />
            ))}
            <AddItemButton
              label="إضافة وحدة"
              onClick={() => patch("units", [...draft.units, "وحدة"])}
            />
          </Card>
        </Grid>
      </TabPanel>

      {/* ------------------------------------------------ gallery & stats */}
      <TabPanel tabKey="showcase" active={tab === "showcase"}>
        <Card
          title="الأرقام والإحصائيات"
          icon={<Icons.trend size={18} />}
          description="أرقام قصيرة تظهر في شريط الإنجازات. لا تنشر رقمًا غير حقيقي."
        >
          {draft.stats.length === 0 && (
            <Notice tone="info">
              لا توجد أرقام منشورة. أضف رقمًا حقيقيًا فقط، أو اترك القسم فارغًا.
            </Notice>
          )}
          {draft.stats.map((stat, index) => (
            <ItemCard
              key={index}
              index={index}
              total={draft.stats.length}
              title={stat.label || `رقم ${index + 1}`}
              subtitle={`${stat.value}${stat.suffix}`}
              removeLabel={`حذف الرقم ${index + 1}`}
              onMove={(from, to) => patch("stats", moveItem(draft.stats, from, to))}
              onRemove={() => patch("stats", draft.stats.filter((_, i) => i !== index))}
            >
              <Grid columns={3}>
                <Field label={`القيمة ${index + 1}`}>
                  <TextInput
                    value={String(stat.value)}
                    onChange={(value) =>
                      patch("stats", mapList(draft.stats, index, (item) => ({ ...item, value: Number(value.replace(/[^\d.-]/g, "")) || 0 })))
                    }
                    dir="ltr"
                    inputMode="numeric"
                  />
                </Field>
                <Field label={`اللاحقة ${index + 1}`} hint="مثل + أو %">
                  <TextInput
                    value={stat.suffix}
                    onChange={(suffix) =>
                      patch("stats", mapList(draft.stats, index, (item) => ({ ...item, suffix })))
                    }
                    dir="ltr"
                    maxLength={8}
                  />
                </Field>
                <Field label={`المسمى ${index + 1}`}>
                  <TextInput
                    value={stat.label}
                    onChange={(label) =>
                      patch("stats", mapList(draft.stats, index, (item) => ({ ...item, label })))
                    }
                  />
                </Field>
              </Grid>
            </ItemCard>
          ))}
          <AddItemButton
            label="إضافة إحصائية"
            onClick={() =>
              patch("stats", [
                ...draft.stats,
                { value: 0, suffix: "+", label: "مسمى" },
              ])
            }
          />
        </Card>

        <Card
          title="معرض الصور"
          icon={<Icons.images size={18} />}
          description="صور المنتجات والمزرعة. الصورة بدون رابط تظهر كبطاقة «قريبًا»."
        >
          {draft.gallery.map((photo, index) => (
            <ItemCard
              key={index}
              index={index}
              total={draft.gallery.length}
              title={photo.caption || `صورة ${index + 1}`}
              removeLabel={`حذف الصورة ${index + 1}`}
              onMove={(from, to) => patch("gallery", moveItem(draft.gallery, from, to))}
              onRemove={() => patch("gallery", draft.gallery.filter((_, i) => i !== index))}
            >
              <Field label={`تعليق الصورة ${index + 1}`}>
                <TextInput
                  value={photo.caption}
                  onChange={(caption) =>
                    patch("gallery", mapList(draft.gallery, index, (item) => ({ ...item, caption })))
                  }
                />
              </Field>
              <ImageField
                label={`ملف الصورة ${index + 1}`}
                value={photo.src}
                onChange={(src) =>
                  patch("gallery", mapList(draft.gallery, index, (item) => ({ ...item, src })))
                }
                hint="اتركها فارغة لعرض بطاقة «قريبًا» بدل الصورة."
              />
            </ItemCard>
          ))}
          <AddItemButton
            label="إضافة صورة"
            onClick={() =>
              patch("gallery", [
                ...draft.gallery,
                { src: "", caption: "صورة جديدة" },
              ])
            }
          />
        </Card>
      </TabPanel>

      {/* -------------------------------------------- reviews, faqs, why us */}
      <TabPanel tabKey="voice" active={tab === "voice"}>
        <Card
          title="آراء العملاء"
          icon={<Icons.quote size={18} />}
          description="التقييم يقبل الكسور: ٤٫٥ أو ٤٫٨ تُحفظ كما هي بلا تقريب."
        >
          {draft.reviews.map((review, index) => (
            <ItemCard
              key={index}
              index={index}
              total={draft.reviews.length}
              title={review.name || `رأي ${index + 1}`}
              subtitle={review.role}
              removeLabel={`حذف الرأي ${index + 1}`}
              onMove={(from, to) => patch("reviews", moveItem(draft.reviews, from, to))}
              onRemove={() => patch("reviews", draft.reviews.filter((_, i) => i !== index))}
            >
              <Grid columns={2}>
                <Field label={`اسم صاحب الرأي ${index + 1}`}>
                  <TextInput
                    value={review.name}
                    onChange={(name) =>
                      patch("reviews", mapList(draft.reviews, index, (item) => ({ ...item, name })))
                    }
                  />
                </Field>
                <Field label={`صفة صاحب الرأي ${index + 1}`}>
                  <TextInput
                    value={review.role}
                    onChange={(role) =>
                      patch("reviews", mapList(draft.reviews, index, (item) => ({ ...item, role })))
                    }
                  />
                </Field>
              </Grid>
              <StarRating
                label={`تقييم الرأي ${index + 1}`}
                value={review.rating}
                hint="من ١ إلى ٥. اضغط النجمة مرتين للنصف، أو اكتب قيمة دقيقة مثل ٤٫٨."
                onChange={(rating) =>
                  patch("reviews", mapList(draft.reviews, index, (item) => ({ ...item, rating })))
                }
              />
              <Field label={`نص الرأي ${index + 1}`}>
                <TextArea
                  value={review.text}
                  rows={3}
                  onChange={(text) =>
                    patch("reviews", mapList(draft.reviews, index, (item) => ({ ...item, text })))
                  }
                />
              </Field>
              <Field
                label={`نوع الرأي ${index + 1}`}
                hint={
                  review.authenticity === "genuine"
                    ? "رأي عميل حقيقي: لن يظهر أي تنبيه، حتى لو كان التقييم منخفضًا."
                    : review.authenticity === "illustrative"
                      ? "سيظهر للزائر تنبيه أن هذا الرأي نموذج توضيحي."
                      : reviewIsIllustrative(review, draft.contentStatus)
                        ? "غير محدد: يظهر الآن كرأي توضيحي بسبب الإعداد العام في تبويب «حالة المحتوى»."
                        : "غير محدد: لا يظهر أي تنبيه حاليًا بحسب الإعداد العام."
                }
              >
                <OptionGroup<Authenticity>
                  value={review.authenticity}
                  onChange={(authenticity) =>
                    patch(
                      "reviews",
                      mapList(draft.reviews, index, (item) => ({ ...item, authenticity })),
                    )
                  }
                  options={[
                    {
                      value: "genuine",
                      label: REVIEW_AUTHENTICITY_LABELS.genuine,
                      hint: "رأي حقيقي من عميل",
                      icon: <Icons.check size={16} />,
                    },
                    {
                      value: "illustrative",
                      label: REVIEW_AUTHENTICITY_LABELS.illustrative,
                      hint: "نص توضيحي مؤقت",
                      icon: <Icons.info size={16} />,
                    },
                    {
                      value: "unspecified",
                      label: REVIEW_AUTHENTICITY_LABELS.unspecified,
                      hint: "اتباع الإعداد العام",
                      icon: <Icons.help size={16} />,
                    },
                  ]}
                />
              </Field>
            </ItemCard>
          ))}
          <AddItemButton
            label="إضافة رأي"
            onClick={() =>
              patch("reviews", [
                ...draft.reviews,
                {
                  name: "اسم العميل",
                  role: "عميل",
                  rating: 5,
                  text: "",
                  authenticity: "unspecified" as Authenticity,
                },
              ])
            }
          />
        </Card>

        <Card
          title="الأسئلة الشائعة"
          icon={<Icons.help size={18} />}
          description="أسئلة العملاء المتكررة وإجاباتها."
        >
          {draft.faqs.map((item, index) => (
            <ItemCard
              key={index}
              index={index}
              total={draft.faqs.length}
              title={item.q || `سؤال ${index + 1}`}
              removeLabel={`حذف السؤال ${index + 1}`}
              onMove={(from, to) => patch("faqs", moveItem(draft.faqs, from, to))}
              onRemove={() => patch("faqs", draft.faqs.filter((_, i) => i !== index))}
            >
              <Field label={`نص السؤال ${index + 1}`}>
                <TextInput
                  value={item.q}
                  onChange={(q) =>
                    patch("faqs", mapList(draft.faqs, index, (entry) => ({ ...entry, q })))
                  }
                />
              </Field>
              <Field label={`إجابة السؤال ${index + 1}`}>
                <TextArea
                  value={item.a}
                  rows={3}
                  onChange={(a) =>
                    patch("faqs", mapList(draft.faqs, index, (entry) => ({ ...entry, a })))
                  }
                />
              </Field>
            </ItemCard>
          ))}
          <AddItemButton
            label="إضافة سؤال"
            onClick={() =>
              patch("faqs", [...draft.faqs, { q: "سؤال جديد", a: "" }])
            }
          />
        </Card>

        <Card
          title="لماذا نحن"
          icon={<Icons.sparkles size={18} />}
          description="مميزات قصيرة مع أيقونة توضيحية لكل ميزة."
        >
          {draft.whyUs.map((item, index) => (
            <ItemCard
              key={index}
              index={index}
              total={draft.whyUs.length}
              title={item.title || `ميزة ${index + 1}`}
              removeLabel={`حذف الميزة ${index + 1}`}
              onMove={(from, to) => patch("whyUs", moveItem(draft.whyUs, from, to))}
              onRemove={() => patch("whyUs", draft.whyUs.filter((_, i) => i !== index))}
            >
              <Field label={`عنوان الميزة ${index + 1}`}>
                <TextInput
                  value={item.title}
                  onChange={(title) =>
                    patch("whyUs", mapList(draft.whyUs, index, (entry) => ({ ...entry, title })))
                  }
                />
              </Field>
              <IconPicker
                label={`أيقونة الميزة ${index + 1}`}
                value={item.icon}
                onChange={(icon) =>
                  patch("whyUs", mapList(draft.whyUs, index, (entry) => ({ ...entry, icon })))
                }
              />
              <Field label={`نص الميزة ${index + 1}`}>
                <TextArea
                  value={item.text}
                  rows={2}
                  onChange={(text) =>
                    patch("whyUs", mapList(draft.whyUs, index, (entry) => ({ ...entry, text })))
                  }
                />
              </Field>
            </ItemCard>
          ))}
          <AddItemButton
            label="إضافة ميزة"
            onClick={() =>
              patch("whyUs", [
                ...draft.whyUs,
                { icon: "leaf", title: "ميزة جديدة", text: "" },
              ])
            }
          />
        </Card>
      </TabPanel>

      {/* ------------------------------------------------- content honesty */}
      <TabPanel tabKey="status" active={tab === "status"}>
        <Card
          title="حالة المحتوى"
          icon={<Icons.info size={18} />}
          description="أبقِ العلامة مفعّلة طالما المحتوى توضيحي. إيقافها يعني أن الموقع يعرضه كمحتوى رسمي موثّق."
        >
          <div className="switch-list">
            {STATUS_FLAGS.map(([key, label, hint]) => (
              <Switch
                key={key}
                checked={draft.contentStatus[key]}
                label={label}
                hint={hint}
                onChange={(checked) =>
                  patch("contentStatus", {
                    ...draft.contentStatus,
                    [key]: checked,
                  })
                }
              />
            ))}
          </div>

        </Card>

        <Card
          title="صور المنتجات بانتظار المراجعة"
          icon={<Icons.image size={18} />}
          description="هذه المنتجات تعرض للزائر تنبيه «الصورة توضيحية». حدّد لكل منها — أو لها كلها دفعة واحدة — إن كانت الصورة صورة المنتج الحقيقية."
        >
          {legacyPlaceholderProducts.length === 0 ? (
            <Notice
              tone="success"
              icon={<Icons.check size={16} />}
              title="لا توجد منتجات بانتظار المراجعة"
            >
              كل منتج يعرض ما حدّدته في خانة «نوع الصورة» داخل بطاقة المنتج.
            </Notice>
          ) : (
            <>
              <Notice
                tone="warn"
                icon={<Icons.info size={16} />}
                title={`${legacyPlaceholderProducts.length} منتج يعرض تنبيه «الصورة توضيحية» من إعداد قديم`}
              >
                لم نقرّر نيابة عنك حتى لا يُوصف منتج حقيقي بالخطأ. اختر لكل منتج،
                أو استخدم القرار الجماعي إن كانت صور القائمة كلها من نوع واحد.
              </Notice>
              <div className="classify-bulk">
                <span className="classify-bulk-label">
                  قرار واحد لكل القائمة:
                </span>
                <Button
                  size="sm"
                  icon={<Icons.check size={14} />}
                  onClick={() =>
                    setBulkAsk({ target: "products", value: "genuine" })
                  }
                >
                  كلها صور منتجاتي الحقيقية
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<Icons.info size={14} />}
                  onClick={() =>
                    setBulkAsk({ target: "products", value: "illustrative" })
                  }
                >
                  كلها صور توضيحية مؤقتة
                </Button>
              </div>
              <ul className="classify-list">
                {legacyPlaceholderProducts.map((product) => (
                  <li key={product.id}>
                    <Icons.image size={15} />
                    <span>{product.name}</span>
                    <span className="classify-actions">
                      <Button
                        size="sm"
                        variant="ghost"
                        icon={<Icons.check size={14} />}
                        onClick={() => classifyImages([product.id], "genuine")}
                      >
                        صورة حقيقية
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        icon={<Icons.info size={14} />}
                        onClick={() =>
                          classifyImages([product.id], "illustrative")
                        }
                      >
                        صورة توضيحية
                      </Button>
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>

        <Card
          title="آراء بانتظار المراجعة"
          icon={<Icons.star size={18} />}
          description="هذه الآراء تعرض تنبيه «رأي توضيحي» بسبب الإعداد العام أعلاه. التقييم لا يدخل في القرار: رأي حقيقي بتقييم منخفض يبقى حقيقيًا."
        >
          {legacyPlaceholderReviews.length === 0 ? (
            <Notice
              tone="success"
              icon={<Icons.check size={16} />}
              title="لا توجد آراء بانتظار المراجعة"
            >
              كل رأي يعرض ما حدّدته في خانة «نوع الرأي» داخل تبويب «الآراء
              والأسئلة».
            </Notice>
          ) : (
            <>
              <Notice
                tone="warn"
                icon={<Icons.info size={16} />}
                title={`${legacyPlaceholderReviews.length} رأي يظهر الآن كرأي توضيحي`}
              >
                علّم الآراء التي كتبتها نقلًا عن عملاء حقيقيين. لا تعلّم رأيًا
                كتبته كنموذج للعرض.
              </Notice>
              <div className="classify-bulk">
                <span className="classify-bulk-label">
                  قرار واحد لكل القائمة:
                </span>
                <Button
                  size="sm"
                  icon={<Icons.check size={14} />}
                  onClick={() =>
                    setBulkAsk({ target: "reviews", value: "genuine" })
                  }
                >
                  كلها آراء عملاء حقيقية
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<Icons.info size={14} />}
                  onClick={() =>
                    setBulkAsk({ target: "reviews", value: "illustrative" })
                  }
                >
                  كلها نماذج توضيحية
                </Button>
              </div>
              <ul className="classify-list">
                {legacyPlaceholderReviews.map((review) => (
                  <li key={review.index}>
                    <Icons.star size={15} />
                    <span>
                      {review.name}
                      <small className="classify-note">{review.text}</small>
                    </span>
                    <span className="classify-actions">
                      <Button
                        size="sm"
                        variant="ghost"
                        icon={<Icons.check size={14} />}
                        onClick={() =>
                          classifyReviews([review.index], "genuine")
                        }
                      >
                        رأي حقيقي
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        icon={<Icons.info size={14} />}
                        onClick={() =>
                          classifyReviews([review.index], "illustrative")
                        }
                      >
                        رأي توضيحي
                      </Button>
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>
      </TabPanel>

      <ConfirmDialog
        open={bulkAsk !== null}
        danger={false}
        title={
          bulkAsk?.target === "products"
            ? "تأكيد تصنيف الصور"
            : "تأكيد تصنيف الآراء"
        }
        message={
          bulkAsk?.value === "genuine"
            ? bulkAsk.target === "products"
              ? `سيتم اعتبار صور ${bulkCount} منتج صورًا حقيقية، ويختفي تنبيه «الصورة توضيحية» عنها.`
              : `سيتم اعتبار ${bulkCount} رأي آراء عملاء حقيقية، ويختفي تنبيه «رأي توضيحي» عنها.`
            : bulkAsk?.target === "products"
              ? `سيظهر تنبيه «الصورة توضيحية» على ${bulkCount} منتج.`
              : `سيظهر تنبيه «رأي توضيحي» على ${bulkCount} رأي.`
        }
        detail={
          <p>
            لن يتغيّر شيء على الموقع قبل الضغط على «نشر التعديلات». يمكنك تعديل
            أي عنصر بعدها بشكل منفصل.
          </p>
        }
        confirmLabel="نعم، طبّق على القائمة"
        onConfirm={applyBulk}
        onCancel={() => setBulkAsk(null)}
      />

      <StickySaveBar
        dirty={dirty}
        saving={busy}
        saveLabel="نشر التعديلات"
        onSave={() => void save()}
        onReset={() => setDraft(content)}
        status={
          <span className="save-bar-rev">الإصدار {content.revision}</span>
        }
      />
    </>
  );
}
