import { Menu, X, ArrowUpLeft } from "lucide-react";
import { SECTION_NAMES, SITE } from "../data";
import { BrandLogo } from "./shared";
export default function Header({
  section,
  goTo,
  menu,
  setMenu,
}: {
  section: number;
  goTo: (n: number) => void;
  menu: boolean;
  setMenu: (open: boolean) => void;
}) {
  return (
    <>
      <header className="site-header">
        <button
          className="header-brand"
          onClick={() => goTo(0)}
          aria-label="البان إلباظ - الرئيسية"
        >
          <BrandLogo />
          <span>
            {SITE.name}
            <small>طبيعة نقية. طعم أصيل.</small>
          </span>
        </button>
        <nav className="header-nav" aria-label="التنقل الرئيسي">
          {[0, 1, 3, 4].map((i) => (
            <button
              key={i}
              className={section === i ? "active" : ""}
              onClick={() => goTo(i)}
            >
              {SECTION_NAMES[i]}
            </button>
          ))}
          <button
            className={`nav-contact ${section === 7 ? "active" : ""}`}
            onClick={() => goTo(7)}
          >
            تواصل معنا
            <ArrowUpLeft size={15} />
          </button>
        </nav>
        <button
          className="menu-toggle icon-button"
          onClick={() => setMenu(!menu)}
          aria-label={menu ? "إغلاق القائمة" : "فتح القائمة"}
          aria-expanded={menu}
          aria-controls="mobile-nav"
        >
          {menu ? <X /> : <Menu />}
        </button>
      </header>
      {menu && (
        <nav
          className="mobile-menu"
          id="mobile-nav"
          aria-label="قائمة أقسام الموقع"
        >
          {SECTION_NAMES.map((name, i) => (
            <button
              className={section === i ? "active" : ""}
              key={name}
              onClick={() => {
                setMenu(false);
                goTo(i);
              }}
            >
              <span>{name}</span>
              <small>0{i + 1}</small>
            </button>
          ))}
        </nav>
      )}
    </>
  );
}
