import { Menu, X, ArrowUpLeft } from "lucide-react";
import { useContent } from "../content/ContentContext";
import { BrandLogo } from "./shared";
export default function Header({
  section,
  goTo,
  menu,
  setMenu,
  blocked = false,
}: {
  section: number;
  goTo: (n: number) => void;
  menu: boolean;
  setMenu: (open: boolean) => void;
  blocked?: boolean;
}) {
  const { site, sectionNames, copy } = useContent();
  return (
    <>
      <header className="site-header">
        <button
          className="header-brand"
          onClick={() => goTo(0)}
          aria-label={`${site.name} - الرئيسية`}
        >
          <BrandLogo />
          <span>
            {site.name}
            <small>{copy.heroTagline}</small>
          </span>
        </button>
        <nav className="header-nav" aria-label="التنقل الرئيسي" inert={blocked}>
          {[0, 1, 3, 4].map((i) => (
            <button
              key={i}
              className={section === i ? "active" : ""}
              onClick={() => goTo(i)}
            >
              {sectionNames[i]}
            </button>
          ))}
          <button
            className={`nav-contact ${section === 7 ? "active" : ""}`}
            onClick={() => goTo(7)}
          >
            {sectionNames[7]}
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
          inert={blocked}
        >
          {sectionNames.map((name, i) => (
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
