import { useRef } from "react";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "../theme/theme";

/** Persistent light/dark control. Replaces the old sound toggle in the same corner. */
export default function ThemeToggle() {
  const { theme, busy, toggle } = useTheme();
  const ref = useRef<HTMLButtonElement>(null);
  const dark = theme === "dark";

  return (
    <button
      ref={ref}
      type="button"
      className="theme-toggle"
      data-theme-toggle={theme}
      data-busy={busy}
      aria-pressed={dark}
      aria-label={dark ? "التبديل إلى الوضع الفاتح" : "التبديل إلى الوضع الداكن"}
      title={dark ? "الوضع الفاتح" : "الوضع الداكن"}
      onClick={() => {
        const rect = ref.current?.getBoundingClientRect();
        toggle(
          rect
            ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
            : null,
        );
      }}
    >
      <span className="theme-icon" key={theme}>
        {dark ? <Sun size={19} /> : <Moon size={19} />}
      </span>
    </button>
  );
}
