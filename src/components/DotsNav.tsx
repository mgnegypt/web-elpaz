import { SECTION_NAMES } from "../data";
export default function DotsNav({
  section,
  goTo,
}: {
  section: number;
  goTo: (n: number) => void;
}) {
  return (
    <nav className="dots-nav" aria-label="أقسام الموقع">
      {SECTION_NAMES.map((name, i) => (
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
