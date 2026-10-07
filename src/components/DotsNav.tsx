import { useContent } from "../content/ContentContext";
export default function DotsNav({
  section,
  goTo,
  blocked = false,
}: {
  section: number;
  goTo: (n: number) => void;
  blocked?: boolean;
}) {
  const { sectionNames } = useContent();
  return (
    <nav className="dots-nav" aria-label="أقسام الموقع" inert={blocked}>
      {sectionNames.map((name, i) => (
        <button
          key={name}
          aria-label={name}
          aria-current={i === section ? "location" : undefined}
          className={i === section ? "active" : ""}
          onClick={() => goTo(i)}
        >
          <span className="nav-dot" />
          <span className="dot-tooltip">{name}</span>
        </button>
      ))}
    </nav>
  );
}
