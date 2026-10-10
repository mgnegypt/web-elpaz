import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import type { Product } from "../shared/content.ts";
import { useContent, useContentState } from "./content/ContentContext";
import { useSectionNav } from "./hooks/useSectionNav";
import Hero from "./components/Hero";
import Loader from "./components/Loader";
import MilkWave from "./components/MilkWave";
import Header from "./components/Header";
import Announcements from "./components/Announcements";
import ContentNotice from "./components/ContentNotice";
import WhatsAppFab from "./components/WhatsAppFab";
import ThemeToggle from "./components/ThemeToggle";
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
  const content = useContent();
  const { source, ready: contentReady } = useContentState();
  const [loading, setLoading] = useState(true),
    [product, setProduct] = useState<Product | null>(null),
    [lightbox, setLightbox] = useState<number | null>(null),
    [menu, setMenu] = useState(false);
  const { section, goTo, isTransitioning, waveDir } = useSectionNav(
    loading || !!product || lightbox !== null,
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
  useEffect(() => {
    if (!menu) return;
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenu(false);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [menu]);
  const names = content.sectionNames;
  useEffect(() => {
    document.title =
      section === 0 ? content.seo.title : `${names[section]} | ${content.site.name}`;
  }, [section, names, content.seo.title, content.site.name]);
  // Keep the document metadata in step with published content.
  useEffect(() => {
    const set = (selector: string, value: string) => {
      const node = document.querySelector(selector);
      if (node) node.setAttribute("content", value);
    };
    set('meta[name="description"]', content.seo.description);
    set('meta[property="og:title"]', content.seo.title);
    set('meta[property="og:description"]', content.seo.description);
  }, [content.seo]);
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
        className={`${dark ? "theme-dark" : "theme-light"}${source === "fallback" ? " content-offline" : ""}`}
        inert={loading}
      >
        <Header
          section={section}
          goTo={navigate}
          menu={menu}
          setMenu={setMenu}
          blocked={isTransitioning}
        />
        <Announcements />
        <main id="main-content" aria-label={content.site.name}>
          {components.map((component, i) =>
            Math.abs(i - section) <= 1 && (!loading || i === 0) ? (
              <section
                key={`${i}-${i === section ? "active" : "neighbor"}`}
                className={`section-shell section-${i} ${i === section ? "is-active" : ""} ${[3, 5].includes(i) ? "blue-section" : ""}`}
                data-section-scroll
                aria-label={names[i]}
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
        <ThemeToggle />
        <DotsNav section={section} goTo={goTo} blocked={isTransitioning} />
        <ProgressTop
          section={section}
          onClick={() => goTo(0)}
          blocked={isTransitioning}
        />
        <div className="mobile-section-counter" dir="ltr">
          <b>0{section + 1}</b> / 08
        </div>
        <span className="sr-only" aria-live="polite">
          {names[section]}
        </span>
        <ContentNotice />
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
      {loading && <Loader onDone={doneLoading} contentReady={contentReady} />}
    </>
  );
}
