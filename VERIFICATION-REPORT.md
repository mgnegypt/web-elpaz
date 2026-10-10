# تقرير التحقق النهائي — فرع `arena/935c2838-web-elpaz`

تقرير مبني على **الكود الفعلي الموجود في الفرع** وعلى **تشغيل حقيقي للاختبارات**، وليس على وصف
للتغييرات. كل رقم سطر في هذا الملف مأخوذ من الفرع الحالي (`4a1ea34`) أو من `main` (`afcb9b44`)
حيث يُذكر ذلك صراحة.

> **آخر تحقق:** أُعيد تشغيل كل الاختبارات بالكامل بعد إعادة ضبط بيئة العمل (`npm ci` من جديد)
> على الـ commit `4a1ea34`: **108 اختبارًا، نجح 108، فشل 0**، مع `npx tsc -b` و`npm run build`
> بنجاح. النتائج التفصيلية في القسم 3.

**لم يحدث أي من التالي:** دمج في `main`، نشر على `mgneg.online`، تعديل على قاعدة بيانات أو صور
الإنتاج، أو أي عملية seed/reset على بيانات حقيقية. كل الاختبارات تعمل على قواعد بيانات مؤقتة في
`/tmp`.

---

## 1. تشخيص مشكلة رجوع الموقع للبيانات القديمة

### 1.1 أين السبب بالضبط؟

| الطبقة | هل هي السبب؟ | الدليل |
|---|---|---|
| **Frontend fallback / تحميل البيانات** | **نعم — السبب المؤكد** | الكود القديم يستبدل المحتوى بالـ defaults عند أي فشل (أدناه) |
| API response / caching | **عامل مُساهم محتمل، غير مؤكد** | لا يوجد `Cache-Control` على `/api/content`، و`apiLimiter` مشترك 600/15د |
| SQLite / seed / initialization | **لا** | الـ seed كان محميًا بـ `COUNT(*)`، ولا يمكنه الكتابة فوق صف موجود |
| سبب آخر (Service Worker / كاش المتصفح) | **لا** | لا يوجد أي service worker في المستودع (تحقق بالبحث) |

### 1.2 الملفات والدوال والشروط المسؤولة (قبل الإصلاح، على `main`)

**الملف:** `src/content/ContentContext.tsx` (نسخة `afcb9b44`)

```ts
// السطر 35 — نقطة البداية: الموقع يبدأ دائمًا من المحتوى المرفق داخل الـ JS
}>({ content: DEFAULT_CONTENT, revision: 0, source: "fallback", ready: false, events: [] });

// الدالة المسؤولة: refresh (السطر 37)
const refresh = useCallback(async () => {
  try {
    const document_ = (await fetchContent()) as ContentResponse;
    setState({ ... source: "server", ready: true });
  } catch {
    // السطر 47–49 — الشرط المسؤول عن المشكلة:
    // أي فشل = "اعرض الـ defaults واعتبر الصفحة جاهزة"
    setState((previous) => ({ ...previous, ready: true }));
  }
}, []);
```

نقاط الضعف المؤكدة في هذا الكود:

1. **الحالة الابتدائية** `DEFAULT_CONTENT` = محتوى `src/data.ts` المجمَّع داخل الـ bundle (منتجات
   تجريبية، صور قديمة، الشعار القديم). يُرسم قبل وصول أي رد.
2. **`catch` صامت**: لا يميّز بين فشل الشبكة، مهلة، 429، رد ناقص — في كل الحالات تبقى الـ defaults
   معروضة وتُعتبر الصفحة "جاهزة".
3. **لا توجد ذاكرة**: لا شيء يحفظ آخر مستند صالح، فكل تحميل للصفحة يبدأ من الصفر.
4. **لا timeout**: `fetchContent` في `src/lib/api.ts:34` كانت تُمرّر `signal` اختياريًا ولا أحد
   يُمرّره → طلب معلّق بلا حد زمني.
5. **لا حماية من ترتيب الردود**: ردان متزامنان (تحميل أولي + رجوع للتبويب) يكتب أحدهما فوق الآخر،
   والرد الأقدم قد يفوز.
6. **لا حراسة على الـ revision**: رد أقدم (نسخة من بروكسي) يستطيع استبدال نسخة أحدث على الشاشة.

**العوامل المساعدة على جانب الخادم (قبل الإصلاح):**

- `server/app.ts:374` (نسخة `afcb9b44`): `app.get("/api/content", apiLimiter, ...)` — بلا أي
  `Cache-Control`.
- `server/app.ts:225`: `const apiLimiter = limiter(15 * 60 * 1000, 600)` — أي **600 طلب/15 دقيقة
  لكل IP**. ومع `TRUST_PROXY_HOPS=0` خلف بروكسي، كل الزوار يظهرون بنفس الـ IP → دلو واحد مشترك →
  `429` جماعي.

### 1.3 تسلسل حدوث المشكلة

```
زائر يفتح الموقع
   └─ React يرسم فورًا DEFAULT_CONTENT (منتجات/صور/شعار قديمة)
       └─ طلب GET /api/content
            ├─ نجح  → يُستبدل المحتوى بالحقيقي (المستخدم غالبًا لا يلاحظ الوميض)
            └─ فشل (429 أو انقطاع أو بطء بلا مهلة أو رد ناقص)
                 └─ catch → ready: true فقط
                      └─ تبقى الـ defaults معروضة طوال الزيارة
                           └─ عند تغيير التبويب والعودة: visibilitychange → refresh()
                                └─ نجح هذه المرة → "الموقع صلّح نفسه لوحده"
```

وهذا يفسّر العرَض الذي وصفته بدقة: ظهور بيانات قديمة ثم تعافٍ تلقائي بلا تدخل.

### 1.4 ما هو **غير** مؤكد (أصرّح به صراحةً)

- **سبب الفشل نفسه في الإنتاج غير مؤكد.** لم أطّلع على سجلات `mgneg.online` ولا على إعداد البروكسي.
  الـ 429 هو **الاحتمال الأقوى** (منطقي ومتسق مع الدلو المشترك)، لكنه **ليس مُثبتًا**. قد يكون
  انقطاعًا شبكيًا أو إعادة تشغيل للخادم أو بطئًا عابرًا.
- **لم أُثبت وجود caching للمتصفح/CDN كسبب.** الغياب الكامل لترويسة `Cache-Control` حقيقة في الكود،
  لكنه تصلّب دفاعي وليس سببًا مُثبتًا.
- **لم أفحص بيئة الإنتاج**: `DATA_DIR`، عدد العمليات، وخطوات النشر. إن كان الخادم يُشغَّل أحيانًا من
  مجلد عمل مختلف (`dataDir = resolve(projectRoot, DATA_DIR ?? ".data")` في `server/index.ts:25`)
  فهذا سبب مستقل محتمل لظهور بيانات تجريبية — ولهذا أضفت تقارير إقلاع تكشفه (البند التالي).

**المهم:** الإصلاح لا يعتمد على معرفة سبب الفشل. أيًا كان السبب، النتيجة الآن أن المحتوى المحفوظ لا
يُستبدل بالـ defaults.

### 1.5 التغييرات المنفّذة (الفرع الحالي)

**أ) جانب العميل — `src/content/ContentContext.tsx`**

| التغيير | السطر | الأثر |
|---|---|---|
| قراءة آخر نسخة صالحة من الكاش كحالة ابتدائية | 87–98 | الزائر العائد لا يرى الـ defaults إطلاقًا |
| `REQUEST_TIMEOUT_MS = 12_000` + `AbortController` | 49، 120–121 | لا طلب معلّق للأبد |
| `parseContentResponse()` — تحقق بـ `contentSchema` + `revision` صحيح | 66–75 | رد ناقص/فارغ/تالف يُرفض ولا يصل للشاشة |
| حارس الـ revision: `snapshot.revision < previous.revision` → تجاهل | 131–133 | رد قديم لا يُرجع الموقع للخلف |
| `catch` لا يغيّر المحتوى، يضبط `status: "error"` فقط | 147–156 | الفشل لا يُنزّل جودة ما هو معروض |
| `RETRY_DELAYS_MS = [2s, 4s, 8s, 16s, 30s]` تتوقف عند أول نجاح | 51، 157–163 | إعادة محاولة محدودة، ليست polling |
| `inFlightRef` — طلب واحد مشترك (single-flight) | 103، 172–180 | لا سباق بين الإقلاع/العودة للتبويب/إعادة المحاولة |
| `attemptRef` — يفوز الأحدث فقط | 102، 119، 126 | لا كتابة من رد قديم فوق رد جديد |

**ب) كاش جديد — `src/content/contentCache.ts`** (ملف جديد، 80 سطرًا)
`localStorage` تحت مفتاح `elbaz-content-cache` مع `CACHE_VERSION`. القراءة تتحقق بالـ schema وترفض
أي كاش تالف/قديم؛ الكتابة **لا تتراجع للخلف** (`existing.revision > snapshot.revision` → تجاهل)؛
كل العمليات داخل `try/catch` (وضع التصفح الخاص لا يكسر الموقع).

**ج) إشعار صريح للزائر — `src/components/ContentNotice.tsx`** (جديد) + أنماط في `src/index.css`.
يظهر فقط عند وجود مشكلة: «آخر نسخة محفوظة» مع زر **إعادة المحاولة**، أو «نسخة مبدئية مؤقتة» لو لم
يسبق للمتصفح تحميل الموقع أبدًا — أي أن الموقع يقول الحقيقة بدل التظاهر.

**د) جانب الخادم**

| التغيير | الموضع | السبب |
|---|---|---|
| `contentLimiter` مستقل (`publicReadLimit`، افتراضي 3000/15د، متغير `PUBLIC_READ_LIMIT`) | `server/app.ts:241–250`، `server/index.ts:54` | القراءة العامة لم تعد تتنافس مع بقية الـ API |
| `Cache-Control: no-cache, must-revalidate` | `server/app.ts:415` | إعادة تحقق دائمة مع بقاء ETag/304 |
| `503 content-unavailable` + `no-store` عند تعذّر قراءة المستند | `server/app.ts:418–434` | **لا تُقدَّم الـ defaults بديلًا عن محتوى تالف** |
| `ContentUnreadable` + تفاصيل الحقول في السجل والتدقيق | `server/db.ts:147–155` | إصلاح موجَّه بدل 500 صامت |
| seed ذرّي: `INSERT … SELECT … WHERE NOT EXISTS` | `server/db.ts:408–416` | عمليتان تقلعان معًا لا يمكنهما seed مزدوج |
| `db.provenance` (`createdDatabase`، `seededDefaults`، `revisionAtBoot`) + تحذير إقلاع | `server/db.ts:128–136` و487، `server/index.ts` | «هل هذه العملية تقرأ قاعدة البيانات الصحيحة؟» صار سؤالًا له إجابة |
| `/api/health` يعرض `readable / revision / updatedAt / seededThisBoot / freshDatabase` | `server/app.ts:387–405` | كشف خطأ `DATA_DIR` من الخارج بلا تسريب محتوى |

> **ملاحظة أمانة:** منطق الـ seed القديم **لم يكن** قادرًا على الكتابة فوق محتوى موجود (كان محميًا
> بـ `COUNT(*)` في `server/db.ts:364–374` على `main`). تغييري هنا **تحصين** ضد سباق الإقلاع وإضافة
> قابلية للكشف — وليس إصلاحًا لسبب مُثبت.

### 1.6 الاختبارات التي تُثبت أن المحفوظ لا يُستبدل بالافتراضي

| ما تُثبته | الاختبار | السويت |
|---|---|---|
| فشل التحديث بعد التحميل لا يغيّر المحتوى + زر إعادة محاولة | `a failed refresh keeps the loaded content and offers a retry` | site 25 |
| ردود غير صالحة/فارغة/أقدم لا تستبدل محتوى سليم | `invalid, empty or stale responses never replace good content` | site 26 |
| تحميل بارد و API ميت → آخر نسخة صالحة لا الـ bundle | `a cold load with a dead API reuses the last good content, not the bundle` | site 28 |
| زيارة أولى بلا كاش → إفصاح صريح بدل التظاهر | `a first visit with no cache and a dead API says so instead of pretending` | site 29 |
| المنشور يُعرض والـ defaults لا تُعرض | `published content is rendered, and the bundled defaults are not` | site 24 |
| مستند غير قابل للقراءة → 503 بلا defaults | `an unreadable stored document answers 503 instead of silently serving defaults` | api 23 |
| إعادة التشغيل ×3 على نفس القاعدة: لا seed، الـ revision ثابت | `a restart never re-seeds: published content survives and is not re-defaulted` | api 22 |
| الرد يُعاد التحقق منه ولا يُخدم من كاش | `the public content response is revalidated, never served stale from a cache` | api 20 |
| 429 يطلب العودة لاحقًا ولا «يفتح» على محتوى بديل | `a throttled public read asks the client to come back instead of failing open` | api 28 |

---

## 2. مصدر رسائل الصور التوضيحية وآراء العملاء

### 2.1 «الصورة توضيحية وسيتم تحديثها بصورة المنتج.»

| البند | التفاصيل |
|---|---|
| **موضع العرض** | `src/components/ProductModal.tsx:107–111` (نافذة المنتج) و`src/components/Products.tsx:90–92` (شارة «صورة توضيحية» على البطاقة) |
| **الشرط قبل الإصلاح** | `contentStatus.placeholderProductIds.includes(p.id)` |
| **مصدر البيانات** | `src/data.ts:284` (على `main`): `placeholderProductIds: [5, 6, 7, 8, 9]` |
| **الحقل المسؤول قبل الإصلاح** | **لا يوجد حقل على مستوى المنتج** — فقط قائمة أرقام (ids) عامة |
| **الخلل الجوهري** | الأرقام تُمنح بـ `Math.max(0, ...products.map(p => p.id)) + 1` (`server/app.ts:1566`). حذف منتج تجريبي ثم إضافة منتج حقيقي **يعيد تدوير نفس الرقم**، فيرث المنتج الحقيقي وصف «توضيحية» |

### 2.2 «رأي توضيحي — في انتظار آراء عملائنا الحقيقية»

| البند | التفاصيل |
|---|---|
| **موضع العرض** | `src/components/Testimonials.tsx:93–97` |
| **الشرط قبل الإصلاح** | `contentStatus.testimonialsArePlaceholders` — **مفتاح عام واحد** |
| **مصدر البيانات** | `src/data.ts:283` (على `main`): `testimonialsArePlaceholders: true` |
| **الحقل المسؤول قبل الإصلاح** | **لا يوجد إطلاقًا** على مستوى الرأي |
| **النتيجة** | ما دام المفتاح `true`، **كل** رأي يحمل التنبيه، حتى الآراء الحقيقية التي أدخلها المالك يدويًا |
| **علاقة التقييم** | **لا علاقة** — التقييم لم يكن جزءًا من الشرط أصلًا، ولا هو كذلك بعد الإصلاح |

### 2.3 كيف يفرّق التعديل الجديد بين الحقيقي والتوضيحي

حقل صريح من ثلاث حالات في `shared/content.ts`:

```ts
// shared/content.ts:117 و120
export const AUTHENTICITY = ["unspecified", "genuine", "illustrative"] as const;
export const authenticitySchema = z.enum(AUTHENTICITY).default("unspecified");
```

- `productSchema.imageAuthenticity` — `shared/content.ts:163`
- `reviewSchema.authenticity` — `shared/content.ts:220`

والقرار في مكان واحد يستخدمه الموقع ولوحة التحكم والاختبارات (`shared/content.ts:431–453`):

```ts
export const productImageIsIllustrative = (product, status) => {
  if (product.imageAuthenticity === "genuine") return false;       // قرار صريح يفوز
  if (product.imageAuthenticity === "illustrative") return true;   // قرار صريح يفوز
  return status.placeholderProductIds.includes(product.id);        // غير محدد → السلوك القديم
};

export const reviewIsIllustrative = (review, status) => {
  if (review.authenticity === "genuine") return false;
  if (review.authenticity === "illustrative") return true;
  return status.testimonialsArePlaceholders;                       // غير محدد → السلوك القديم
};
```

تحقّقتُ أن الواجهة العامة لم تعد تقرأ المفاتيح القديمة مباشرة في أي مكان:
`grep -rn "placeholderProductIds\|testimonialsArePlaceholders" src/components/ src/App.tsx` → لا نتائج.

**أدوات المشرف (عربية، بلا مصطلحات تقنية):**
- `src/admin/ProductsPanel.tsx:345–372` — حقل **«نوع الصورة»** تحت صورة المنتج: *صورة المنتج
  الحقيقية* / *صورة توضيحية مؤقتة*، مع تلميح يشرح ما سيظهر للزائر، وتنبيه خاص لو كان المنتج معلَّمًا
  من الإعداد القديم.
- `src/admin/ContentPanel.tsx:896–917` — حقل **«نوع الرأي»** لكل رأي، وتلميحه ينصّ صراحة: «رأي عميل
  حقيقي: لن يظهر أي تنبيه، **حتى لو كان التقييم منخفضًا**».
- `src/admin/ContentPanel.tsx` (تبويب حالة المحتوى) — قائمة **العناصر غير المصنَّفة** التي ما زالت
  تظهر كتوضيحية بسبب الإعداد القديم، حتى يعرف المالك ما الذي يحتاج مراجعة يدوية.

### 2.4 التعامل مع البيانات القديمة بلا تصنيف خاطئ

- الحقلان الجديدان لهما `.default("unspecified")`، فأي مستند مخزَّن قديم **يُقرأ كما هو** ولا يفشل
  التحقق (`db.getContent()` يُنفّذ `contentSchema.parse` على كل قراءة — أي حقل بلا default كان
  سيحوّل كل مستند إنتاج إلى خطأ دائم).
- `unspecified` **ليست ادعاءً** بأي اتجاه: تعني «لم يقرر أحد»، والعرض يتبع المفاتيح القديمة تمامًا
  كما كان قبل التعديل.
- **لا يوجد تصنيف جماعي تلقائي**: لم يُعلَّم أي منتج أو رأي قائم كـ «حقيقي» تلقائيًا، ولا يُستنتج
  شيء من رابط الصورة أو من كونها مرفوعة يدويًا.
- **عملية التنظيف الوحيدة المسموح بها**: إزالة رقم منتج من `placeholderProductIds` في اللحظة التي
  يصبح فيها الرقم مضلِّلًا — عند إنشاء منتج بنفس الرقم، أو حذفه، أو تعليم صورته كحقيقية
  (`server/app.ts:1502–1523`، 1578، 1607، 1637). لا يمسّ هذا أي منتج معلَّم صراحةً كتوضيحي.

### 2.5 تأكيدات مطلوبة

- **التقييم السلبي لا يجعل الرأي توضيحيًا:** التقييم لا يظهر إطلاقًا داخل `reviewIsIllustrative`
  (تحقق: `grep` على `rating` داخل كود التصنيف → لا نتائج). والاختبار
  `genuine reviews stay genuine, including negative ones` يعرض رأيًا حقيقيًا بتقييم **1.5/5** ويتأكد
  أن `.review-placeholder` غير موجود، بينما الرأي النموذجي بتقييم 5 **يحتفظ** بالتنبيه.
- **التقييمات العشرية 1–5 ما زالت تعمل:** النظام **تغيّر فعلًا** لكن في اتجاه التوسعة — كان
  `rating: z.number().int().min(1).max(5)` على `main` (`shared/content.ts:149` في `afcb9b44`)، وصار
  `ratingSchema` (`shared/content.ts:202–207`، والحقل عند 212): عدد نهائي بين 1 و5 مع `transform(roundRating)` الذي
  يحفظ منزلة عشرية واحدة. **4.5 تبقى 4.5 ولا تُقرَّب إلى 5.** واجهة النجوم تعرض تعبئة جزئية
  (`src/components/Testimonials.tsx:55–80`) وتطبع القيمة نصًا «1.5 / 5»، ولوحة التحكم تستخدم
  `RATING_STEP = 0.5` و`RATING_PRECISION_STEP = 0.1` مع `clampRating`
  (`src/admin/ui/forms.tsx:568–641`). القيم خارج المدى (0، 5.1، −1، NaN) تُرفض ولا تُقرَّب قسرًا.

---

## 3. نتائج الاختبارات الفعلية

كل الأوامر التالية نُفّذت على هذا الفرع بعد `npm ci` (بيئة الساندبوكس أُعيد ضبطها أثناء العمل،
فأُعيد تثبيت الحزم واستُرجع الفرع من الـ commit المدفوع `2ee5d02`).

| # | الأمر | النتيجة الفعلية |
|---|---|---|
| 1 | `npx tsc -b` | **EXIT=0** — بلا أخطاء |
| 2 | `npm run build` | **EXIT=0** — `✓ built in 6.29s` (tsc + vite) |
| 3 | `node scripts/test.mjs api` | **tests 28 / pass 28 / fail 0** |
| 4 | `node scripts/test.mjs security` | **tests 35 / pass 35 / fail 0** |
| 5 | `node scripts/test.mjs site` | **tests 32 / pass 32 / fail 0** |
| 6 | `node scripts/test.mjs admin` | **tests 7 / pass 7 / fail 0** |
| 7 | `node scripts/test.mjs layout` | **tests 6 / pass 6 / fail 0** |

**الإجمالي: 108 اختبارًا، نجح 108، فشل 0.**

### تغطية السيناريوهات المطلوبة (الاثنا عشر)

| السيناريو المطلوب | الاختبار الفعلي | الحالة |
|---|---|---|
| تحميل أولي ناجح | site 24 — `published content is rendered, and the bundled defaults are not` | نجح |
| فشل مؤقت للـ API بعد التحميل | site 25 — `a failed refresh keeps the loaded content and offers a retry` | نجح |
| ردود غير صالحة/ناقصة | site 26 — `invalid, empty or stale responses never replace good content` | نجح |
| أولوية المحفوظ على الـ defaults | site 28 — `a cold load with a dead API reuses the last good content, not the bundle` | نجح |
| التحديث بعد النشر من اللوحة | site 27 — `a published update reaches the site on the next refresh` + admin 4 | نجح |
| إعادة التشغيل / تهيئة القاعدة | api 22 — `a restart never re-seeds…` + api 21 — `health reports which database and revision…` | نجح |
| صور منتجات حقيقية بلا تنبيه | site 30 — `genuine product photos carry no illustrative disclaimer` | نجح |
| صور توضيحية تحتفظ بالتنبيه | site 30 (نفس الاختبار، منتج توضيحي صريح) + api 25 | نجح |
| آراء حقيقية بلا تنبيه | site 31 — `genuine reviews stay genuine, including negative ones` | نجح |
| رأي سلبي حقيقي يبقى حقيقيًا | site 31 (تقييم 1.5/5) + api 25 — `…ratings never decide` | نجح |
| آراء توضيحية تحتفظ بالتنبيه | site 31 (الرأي النموذجي) + site 32 | نجح |
| التوافق مع السجلات القديمة | api 24 — `documents written before the authenticity fields still load unchanged` + site 32 — `legacy documents without authenticity fields keep their old labels` | نجح |

### ما **لم** يُختبر (لا أدّعي نجاحه)

- **لا اختبار على بيئة الإنتاج** — لم يُشغَّل أي شيء على `mgneg.online` ولا على قاعدة بياناتها.
- **لا اختبار سلوك CDN/بروكسي حقيقي** — ترويسات الكاش مُختبرة على الخادم فقط.
- **لا اختبار حمل/أداء** ولا قياس لعدد الطلبات الفعلي تحت ضغط حقيقي.
- **لا اختبار متصفحات متعددة** — كل اختبارات المتصفح تعمل على Chromium فقط.
- **لا اختبار لسلوك `localStorage` الممتلئ (quota)** بخلاف أن الكتابة داخل `try/catch`.

---

## 4. مراجعة التغييرات قبل الدمج

### 4.1 ملفات هذه المهمة (المحتوى والتصنيف)

| الملف | الملخص |
|---|---|
| `shared/content.ts` | `AUTHENTICITY` + `authenticitySchema` (بـ default)، `imageAuthenticity` على المنتج، `authenticity` على الرأي، `ratingSchema` العشري، ودوال القرار `productImageIsIllustrative` / `reviewIsIllustrative` / `unclassifiedIllustrativeProducts` |
| `src/content/ContentContext.tsx` | إعادة بناء التحميل: كاش، مهلة، تحقق، حارس revision، إعادة محاولة محدودة، single-flight، حالات `loading/ready/error` |
| `src/content/contentCache.ts` *(جديد)* | تخزين آخر نسخة صالحة في `localStorage` مع تحقق ومنع التراجع |
| `src/components/ContentNotice.tsx` *(جديد)* | إشعار الحالة + زر إعادة المحاولة |
| `src/components/ProductModal.tsx`، `Products.tsx` | الشرط صار استدعاء `productImageIsIllustrative` |
| `src/components/Testimonials.tsx` | الشرط صار `reviewIsIllustrative` + عرض نجوم عشري |
| `src/components/Loader.tsx`، `src/App.tsx`، `src/index.css` | ربط شاشة الإقلاع بجاهزية المحتوى وأنماط الإشعار |
| `server/app.ts` | `contentLimiter` مستقل، ترويسات الكاش، 503 بدل defaults، `/api/health` تشغيلي، تحرير الـ id القديم عند الإنشاء/الحذف/التحقق |
| `server/db.ts` | `ContentUnreadable`، seed ذرّي، `provenance`، `contentHealth()` |
| `server/index.ts` | `PUBLIC_READ_LIMIT`، تسجيل مسار القاعدة والـ revision وتحذير واضح عند seed غير متوقع |
| `src/admin/ProductsPanel.tsx`، `src/admin/ContentPanel.tsx` | ضوابط «نوع الصورة» و«نوع الرأي» + قائمة غير المصنَّف |
| `tests/api.test.mjs` (+390 سطرًا)، `tests/site.test.mjs` (+365) | 18 اختبارًا جديدًا |
| `tests/admin.test.mjs` (+23/−…) | تحديث 3 محددات قديمة (لوحة الملف الشخصي صارت تبويبات، وحقل العبوة داخل «خيارات إضافية») — الفحوص نفسها لم تتغير |
| `README.md` | توثيق السلوك الجديد وتصحيح الأرقام |

> بقية الملفات في `git diff afcb9b44 --stat` (48 ملفًا) تخص **إعادة تصميم اللوحة** من المهمة
> السابقة، وليست جزءًا من هذه المهمة.

### 4.2 إصلاحات تخطيط حقيقية كشفتها السويتات أثناء التحقق

| المشكلة | الملف | الإصلاح |
|---|---|---|
| لوح الملف الشخصي يتجاوز عرض الشاشة على الموبايل (عناصر خارج الإطار) | `src/admin/styles/components.css` | `min-width: 0` على `.drawer` |
| شريط التبويبات ينهار إلى 1px داخل جسم flex عمودي → التبويبات غير قابلة للنقر | `src/admin/styles/components.css` | `flex: 0 0 auto` على `.tabs` |
| عمود التاريخ في جدول الطلبات يُقتطع عند ~768px | `src/admin/styles/components.css` + `RequestsPanel.tsx` | `.data-table--wide { min-width: 880px }` |
| الشريط العلوي يفرض تمريرًا أفقيًا عند تكبير 200% | `src/admin/styles/shell.css` | السماح لعناصر الشريط بالانكماش وقت الضيق فقط |
| `.toast-stack` بعرض `100vw` يتجاوز الشاشة عند التكبير | `src/admin/styles/components.css` | `calc(100% - 32px)` بدل `100vw` |
| رابط «لست أنت؟» أصغر من هدف اللمس | `src/admin/styles/panels.css` | `min-height: 44px` |

### 4.3 مخاطر ونقاط مفتوحة

1. **سبب الفشل الأصلي في الإنتاج ما زال غير مُثبت** (البند 1.4). الإصلاح يجعل العرَض غير ممكن، لكنه
   لا يغني عن مراجعة سجلات الخادم. أنصح بمتابعة `/api/health` بعد النشر: `seededThisBoot` يجب أن
   تكون `false` و`revision` يساوي آخر نسخة منشورة.
2. **توصية تشغيلية لم تُطبَّق** (لأن تعديل إعداد الإنتاج ممنوع): ضبط `TRUST_PROXY_HOPS` بما يطابق
   عدد البروكسيات، وإلا يبقى تحديد المعدل يعمل على دلو مشترك.
3. **الزوار الحاليون** يحملون نسخة JS قديمة؛ الحماية تبدأ من أول تحميل بعد النشر، والكاش يُبنى مع
   أول قراءة ناجحة.
4. **وضع التصفح الخاص / `localStorage` معطّل**: لا كاش، فزيارة أولى مع API معطّل تعرض إشعار «نسخة
   مبدئية مؤقتة» — إفصاح صريح لا تظاهر.
5. **التصنيف اليدوي مطلوب**: كل منتج ورأي ما زال `unspecified` يتبع الإعداد القديم. القائمة في
   «حالة المحتوى» تبيّن ما يحتاج قرار المالك؛ لم أقرر نيابة عنه.
6. **المفاتيح القديمة باقية عمدًا** (`placeholderProductIds`، `testimonialsArePlaceholders`) لضمان
   التوافق. يمكن إزالتها لاحقًا بعد تصنيف كل العناصر.
7. **تغيير سلوكي مقصود**: `/api/content` قد يُرجع `503` عند تلف المستند بدل محتوى افتراضي. أي مراقبة
   خارجية تعتبر 503 إنذارًا — وهذا هو المطلوب.

### 4.4 كيف تراجع التغييرات

```bash
git fetch origin arena/935c2838-web-elpaz
git diff afcb9b44..origin/arena/935c2838-web-elpaz --stat
# جوهر المهمة:
git diff afcb9b44..origin/arena/935c2838-web-elpaz -- shared/content.ts src/content server/db.ts server/app.ts
```

Pull Request للمراجعة فقط: <https://github.com/mgnegypt/web-elpaz/pull/3> — **لا تدمجه قبل موافقتك**.

### 4.5 الخلاصة

- **مشكلة 1:** السبب على جانب الواجهة **مؤكد ومُصلَح ومغطى باختبارات**. سبب الفشل الشبكي الأصلي في
  الإنتاج **غير مُثبت** ولا أدّعي إثباته.
- **مشكلة 2 و3:** السبب **مؤكد بالكود** (قائمة أرقام تُعاد تدويرها، ومفتاح عام واحد) و**مُصلَح** بحقل
  صريح متوافق رجعيًا، مع ضوابط عربية واضحة، وبلا أي تصنيف جماعي تلقائي.
- **الجاهزية:** الكود جاهز للمراجعة البشرية. يبقى قبل النشر: مراجعتك للفرق، نسخة احتياطية من قاعدة
  بيانات الإنتاج، ثم متابعة `/api/health` بعد النشر.
