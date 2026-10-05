// OWNER CONTENT — TODO: confirm all descriptions, policies and contact details before launch.
export const WA_NUMBER = "201141322878";
export const LOGO_URL = ""; // TODO: upload the official company logo.
export const SITE = {
  name: "البان إلباظ",
  email: "info@elpaze.online",
  phone: "+201141322878",
  secondPhone: "+201141322878",
  domain: "https://YOUR-DOMAIN/",
  facebook: "https://www.facebook.com/elpaz",
  instagram: "https://www.instagram.com/elpaz",
  credit: "https://www.facebook.com/mgndigital",
}; // TODO: domain and second phone.
// Original PNGs are preserved. Local fallbacks are AI-generated illustrative packaging, NOT official product photography.
// TODO: replace fallback files with official packshots; set webp to a WebP version of the SAME original photograph.
export const IMAGES = [
  {
    src: "https://files.catbox.moe/ujceh0.png",
    webp: "",
    fallback: "/images/mozzarella.webp",
    bg: "#5B2A9E",
    panel: "#7A4BBE",
    name: "جبن موزاريلا مبشور",
    desc: "موزاريلا طبيعية مبشورة، ذوبان مثالي وشد رائع للبيتزا والمعجنات. عبوة 1 كجم.",
  },
  {
    src: "https://files.catbox.moe/attqvm.png",
    webp: "",
    fallback: "/images/honey.webp",
    bg: "#F2A01A",
    panel: "#F6B84A",
    name: "عسل أبيض طبيعي",
    desc: "عسل أبيض طبيعي بيور في عبوة الدبدوب المحببة للأطفال والكبار.",
  },
  {
    src: "https://files.catbox.moe/u55juy.png",
    webp: "",
    fallback: "/images/olive.webp",
    bg: "#1E3FA8",
    panel: "#4766C8",
    name: "زيت زيتون طبيعي خام",
    desc: "زيت زيتون طبيعي خام معصور على البارد، نكهة أصيلة وفوائد كاملة.",
  },
  {
    src: "https://files.catbox.moe/cnd6q7.png",
    webp: "",
    fallback: "/images/nuts.webp",
    bg: "#E9BE2E",
    panel: "#F0CF5C",
    name: "مكسرات بالعسل",
    desc: "تشكيلة مكسرات فاخرة مغمورة في عسل أبيض طبيعي، غذاء وطاقة في برطمان واحد.",
  },
];
export const CATEGORIES = [
  "الكل",
  "أجبان",
  "عسل ومكسرات",
  "زيوت",
  "ألبان وسمن",
];
export const PRODUCTS = [
  {
    id: 1,
    category: "أجبان",
    name: "جبن موزاريلا مبشور",
    desc: "موزاريلا طبيعية مبشورة بذوبان مثالي للبيتزا والمعجنات.",
    longDesc:
      "موزاريلا طبيعية مبشورة جاهزة للاستخدام، تمنحك شدًّا وذوبانًا مثاليًّا. مناسبة للبيتزا والمعجنات والمطاعم. عبوة 1 كجم.",
    size: "1 كجم",
    img: IMAGES[0].src,
    fallback: IMAGES[0].fallback,
    webp: "",
    color: "#5B2A9E",
  },
  {
    id: 2,
    category: "عسل ومكسرات",
    name: "عسل أبيض طبيعي",
    desc: "عسل أبيض بيور في عبوة الدبدوب العملية.",
    longDesc:
      "عسل أبيض طبيعي بيور في عبوة دبدوب عملية وسهلة الاستخدام، محببة للأطفال والكبار.",
    size: "—",
    img: IMAGES[1].src,
    fallback: IMAGES[1].fallback,
    webp: "",
    color: "#F2A01A",
  },
  {
    id: 3,
    category: "زيوت",
    name: "زيت زيتون طبيعي خام",
    desc: "زيت زيتون خام معصور على البارد بنكهة أصيلة.",
    longDesc:
      "زيت زيتون طبيعي خام بنكهة أصيلة، مثالي للسلطات والطبخ والاستخدام اليومي.",
    size: "—",
    img: IMAGES[2].src,
    fallback: IMAGES[2].fallback,
    webp: "",
    color: "#1E3FA8",
  },
  {
    id: 4,
    category: "عسل ومكسرات",
    name: "مكسرات بالعسل",
    desc: "مكسرات فاخرة في عسل أبيض طبيعي.",
    longDesc:
      "تشكيلة مكسرات فاخرة مغمورة في عسل أبيض طبيعي، غذاء وطاقة في برطمان واحد.",
    size: "—",
    img: IMAGES[3].src,
    fallback: IMAGES[3].fallback,
    webp: "",
    color: "#E9BE2E",
  },
  // TODO: products 5–9 temporarily reuse other product photos. Replace before publishing.
  {
    id: 5,
    category: "أجبان",
    name: "جبنة رومي",
    desc: "جبنة رومي معتّقة بطعم قوي ومميز.",
    longDesc: "جبنة رومي معتّقة بطعم قوي ومميز.",
    size: "—",
    img: IMAGES[0].src,
    fallback: IMAGES[0].fallback,
    webp: "",
    color: "#5B2A9E",
  },
  {
    id: 6,
    category: "أجبان",
    name: "جبنة فيتا",
    desc: "جبنة بيضاء طرية بطعم متوازن للفطار والسلطات.",
    longDesc: "جبنة بيضاء طرية بطعم متوازن.",
    size: "—",
    img: IMAGES[0].src,
    fallback: IMAGES[0].fallback,
    webp: "",
    color: "#5B2A9E",
  },
  {
    id: 7,
    category: "أجبان",
    name: "جبنة شيدر",
    desc: "شيدر كريمي غني للسندوتشات والوجبات السريعة.",
    longDesc: "شيدر كريمي غني بالنكهة.",
    size: "—",
    img: IMAGES[0].src,
    fallback: IMAGES[0].fallback,
    webp: "",
    color: "#5B2A9E",
  },
  {
    id: 8,
    category: "ألبان وسمن",
    name: "سمن بلدي",
    desc: "سمن بلدي صافي برائحة وطعم الريف.",
    longDesc: "سمن بلدي صافي برائحة وطعم الريف.",
    size: "—",
    img: IMAGES[2].src,
    fallback: IMAGES[2].fallback,
    webp: "",
    color: "#1E3FA8",
  },
  {
    id: 9,
    category: "ألبان وسمن",
    name: "قشطة طازجة",
    desc: "قشطة طازجة كريمية من مزارعنا إليكم.",
    longDesc: "قشطة طازجة كريمية.",
    size: "—",
    img: IMAGES[1].src,
    fallback: IMAGES[1].fallback,
    webp: "",
    color: "#F2A01A",
  },
];
export type Product = (typeof PRODUCTS)[number];
export const WHY_US = [
  {
    icon: "Leaf",
    title: "مواد طبيعية",
    text: "خامات طبيعية مختارة من مزارعنا.",
  },
  {
    icon: "ShieldCheck",
    title: "جودة مضمونة",
    text: "تصنيع وتعبئة بأعلى معايير الجودة.",
  },
  { icon: "Truck", title: "توصيل سريع", text: "نوصّل طلبك في أسرع وقت." },
  {
    icon: "BadgePercent",
    title: "أسعار جملة",
    text: "أسعار تنافسية للكميات الكبيرة.",
  },
] as const; // TODO: confirm claims.
export const STATS = [
  { value: 10, suffix: "+", label: "سنوات خبرة" },
  { value: 9, suffix: "+", label: "منتج" },
  { value: 500, suffix: "+", label: "عميل سعيد" },
  { value: 100, suffix: "%", label: "طبيعي" },
]; // TODO: PLACEHOLDER figures. Replace with verified numbers.
export const GALLERY = [
  { src: "", caption: "خط الإنتاج" },
  { src: "", caption: "المزرعة" },
  { src: "", caption: "التعبئة والتغليف" },
  { src: "", caption: "مراقبة الجودة" },
  { src: "", caption: "التخزين" },
  { src: "", caption: "التوزيع" },
]; // TODO: official farm and factory photos.
export const TESTIMONIALS = [
  {
    name: "اسم العميل",
    role: "صاحب مطعم",
    rating: 5,
    text: "نص رأي العميل هنا.",
  },
  {
    name: "اسم العميل",
    role: "تاجر جملة",
    rating: 5,
    text: "نص رأي العميل هنا.",
  },
  { name: "اسم العميل", role: "عميل", rating: 5, text: "نص رأي العميل هنا." },
  {
    name: "اسم العميل",
    role: "سوبر ماركت",
    rating: 5,
    text: "نص رأي العميل هنا.",
  },
]; // TODO: replace with real, authorized reviews before launch.
export const FAQS = [
  {
    q: "ما هو أقل كمية للطلب؟",
    a: "نلبي الطلبات بجميع الكميات من التجزئة إلى الجملة. تواصل معنا لتحديد الكمية المناسبة.",
  },
  {
    q: "هل يمكن التعبئة والتغليف باسم العميل؟",
    a: "نعم، نقدم خدمة التعبئة والتغليف حسب الطلب. تواصل معنا لمعرفة التفاصيل.",
  },
  {
    q: "هل يوجد توصيل لجميع المحافظات؟",
    a: "تواصل معنا وسنوضح لك مناطق التوصيل والمواعيد.",
  },
  {
    q: "ما هي طرق الدفع المتاحة؟",
    a: "يتم الاتفاق على طريقة الدفع عند تأكيد الطلب.",
  },
  {
    q: "ما هي مدة الصلاحية وطريقة التخزين؟",
    a: "مدة الصلاحية وطريقة التخزين مكتوبة على عبوة كل منتج.",
  },
]; // TODO: owner to confirm all policies.
export const ADDRESS_TEXT: string = ""; // TODO: complete company address; hidden until supplied.
export const MAPS_URL: string = "";
export const SECTION_NAMES = [
  "الرئيسية",
  "منتجاتنا",
  "لماذا نحن",
  "من نحن",
  "معرض الصور",
  "آراء العملاء",
  "أسئلة شائعة",
  "تواصل معنا",
];
export const COPY = {
  heroEyebrow: "من خير الطبيعة، بكل حب",
  heroTagline: "طبيعة نقية. طعم أصيل.",
  heroSeal: "من المزرعة إلى مائدتك",
  productsSubtitle: "جودة من المزرعة إلى مائدتك",
  whySubtitle: "تفاصيل صغيرة، تصنع فرقًا كبيرًا في كل منتج.",
  aboutTagline: "تصنيع وتعبئة وتغليف منتجات الألبان والأجبان",
  aboutDescription:
    "البان إلباظ شركة متخصصة في تصنيع وتعبئة وتغليف الألبان والأجبان والعسل الطبيعي وزيت الزيتون والمكسرات، نعتمد على أجود الخامات من مزارعنا ونصنّع بأعلى معايير الجودة لنقدم لكم منتجات طبيعية بطعم أصيل. نلبّي جميع الطلبات وبكل الكميات، من التجزئة إلى الجملة والتوريد للشركات، مع التزام كامل بالجودة والمواعيد.",
  aboutChips: ["تصنيع بجودة عالية", "تعبئة وتغليف", "جميع الكميات والطلبات"],
  gallerySubtitle: "وراء كل منتج حكاية… وهنا تبدأ حكايتنا.",
  testimonialSubtitle: "ثقتكم هي أجمل ما نقدّمه.",
  contactSubtitle: "طلب صغير أو شراكة كبيرة… يسعدنا نسمع منك.",
};
export const WHOLESALE_UNITS = ["كرتونة", "كجم", "طن"];

// TODO: switch these off only after replacing the corresponding demo content.
export const CONTENT_STATUS = {
  statsArePlaceholders: true,
  testimonialsArePlaceholders: true,
  placeholderProductIds: [5, 6, 7, 8, 9],
};
export const SEO_TITLE = "البان إلباظ | ألبان وأجبان وعسل طبيعي";
