import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import type { Product } from "./data";
import { SECTION_NAMES, SEO_TITLE } from "./data";
import { useSectionNav } from "./hooks/useSectionNav";
import Hero from "./components/Hero";
import Loader from "./components/Loader";
import MilkWave from "./components/MilkWave";
import Header from "./components/Header";
import WhatsAppFab from "./components/WhatsAppFab";
import SoundToggle from "./components/SoundToggle";
import DotsNav from "./components/DotsNav";
import ProgressTop from "./components/ProgressTop";
const Products = lazy(() => import("./components/Products"));
const WhyUs = lazy(() => import("./components/WhyUs"));
const About = lazy(() => import("./components/About"));
const Gallery = lazy(() => import("./components/Gallery"));
const Testimonials = lazy(() => import("./components/Testimonials"));
const Faq = lazy(() => import("./components/Faq"));
const Contact = lazy(() => import("./components/Contact"));
const ProductModal = lazy(() => import("./components/ProductModal"));
const Lightbox = lazy(() => import("./components/Lightbox"));
export default function App() {
  const [loading, setLoading] = useState(true),
    [product, setProduct] = useState<Product | null>(null),
    [lightbox, setLightbox] = useState<number | null>(null),
    [sound, setSound] = useState(false),
    [menu, setMenu] = useState(false);
  const [rememberedSound, setRememberedSound] = useState(() => {
    try {
      return localStorage.getItem("elbaz-sound") === "true";
    } catch {
      return false;
    }
  });
  const soundRef = useRef<typeof import("./lib/sound") | null>(null),
    soundEnabled = useRef(false);
  const play = useCallback(() => {
    if (soundEnabled.current) soundRef.current?.whoosh();
  }, []);
  const { section, goTo, isTransitioning, waveDir } = useSectionNav(
    loading || !!product || lightbox !== null,
    play,
    menu,
  );
  const doneLoading = useCallback(() => setLoading(false), []);
  const navigate = useCallback(
    (n: number) => {
      setMenu(false);
      goTo(n);
    },
    [goTo],
  );
  // Preferences are remembered, but sound always requires a fresh explicit user gesture.
  const toggleSound = async () => {
    try {
      if (!soundRef.current) soundRef.current = await import("./lib/sound");
      if (!soundEnabled.current) await soundRef.current.initialize();
      const next = !soundEnabled.current;
      soundEnabled.current = next;
      setSound(next);
      setRememberedSound(next);
      try {
        localStorage.setItem("elbaz-sound", String(next));
      } catch {
        /* private mode */
      }
      if (next) soundRef.current.whoosh();
    } catch {
      soundEnabled.current = false;
      setSound(false);
    }
  };
  useEffect(() => {
    if (!menu) return;
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenu(false);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [menu]);
  useEffect(() => {
    document.title =
      section === 0 ? SEO_TITLE : `${SECTION_NAMES[section]} | البان إلباظ`;
  }, [section]);
  const components = [
    <Hero
      active={section === 0}
      goTo={goTo}
      blocked={loading || isTransitioning || menu}
    />,
    <Products onSelect={setProduct} />,
    <WhyUs goTo={goTo} />,
    <About active={section === 3} />,
    <Gallery onOpen={setLightbox} />,
    <Testimonials active={section === 5} />,
    <Faq />,
    <Contact />,
  ];
  const dark = [0, 3, 5].includes(section);
  return (
    <>
      <div
        id="site-content"
        className={dark ? "theme-dark" : "theme-light"}
        inert={loading}
      >
        <Header
          section={section}
          goTo={navigate}
          menu={menu}
          setMenu={setMenu}
        />
        <main id="main-content" aria-label="البان إلباظ">
          {components.map((component, i) =>
            Math.abs(i - section) <= 1 && (!loading || i === 0) ? (
              <section
                key={`${i}-${i === section ? "active" : "neighbor"}`}
                className={`section-shell section-${i} ${i === section ? "is-active" : ""} ${[3, 5].includes(i) ? "blue-section" : ""}`}
                data-section-scroll
                aria-label={SECTION_NAMES[i]}
                aria-hidden={i !== section}
                inert={i !== section}
                tabIndex={-1}
              >
                <Suspense
                  fallback={
                    <div className="section-loading" role="status">
                      لحظات من فضلك…
                    </div>
                  }
                >
                  {component}
                </Suspense>
              </section>
            ) : null,
          )}
        </main>
        <WhatsAppFab />
        <SoundToggle
          enabled={sound}
          remembered={rememberedSound}
          onToggle={toggleSound}
        />
        <DotsNav section={section} goTo={goTo} />
        <ProgressTop section={section} onClick={() => goTo(0)} />
        <div className="mobile-section-counter" dir="ltr">
          <b>0{section + 1}</b> / 08
        </div>
        <span className="sr-only" aria-live="polite">
          {SECTION_NAMES[section]}
        </span>
      </div>
      {isTransitioning && <MilkWave direction={waveDir} />}
      <Suspense
        fallback={
          <div className="modal-pending" role="status">
            جاري التحميل…
          </div>
        }
      >
        {product && (
          <ProductModal product={product} onClose={() => setProduct(null)} />
        )}{" "}
        {lightbox !== null && (
          <Lightbox initial={lightbox} onClose={() => setLightbox(null)} />
        )}
      </Suspense>
      {loading && <Loader onDone={doneLoading} />}
    </>
  );
}
