import { useCallback, useEffect, useRef, useState } from "react";

export type Theme = "light" | "dark";

/** Explicit user choice, or null when the visitor has never chosen (system preference wins). */
export const THEME_STORAGE_KEY = "elbaz-theme";

export function readStoredTheme(): Theme | null {
  try {
    const value = localStorage.getItem(THEME_STORAGE_KEY);
    return value === "light" || value === "dark" ? value : null;
  } catch {
    // Private mode / storage disabled: fall back to the system preference every time.
    return null;
  }
}

export function storeTheme(theme: Theme) {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    /* keep working without persistence */
  }
}

export function systemTheme(): Theme {
  try {
    return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  } catch {
    return "light";
  }
}

/** Reads whatever public/theme-init.js already applied, so React never re-flashes. */
function currentTheme(): Theme {
  const applied = document.documentElement.dataset.theme;
  if (applied === "light" || applied === "dark") return applied;
  return readStoredTheme() ?? systemTheme();
}

function paint(theme: Theme, animate: boolean) {
  const root = document.documentElement;
  if (animate) {
    root.classList.add("theme-anim");
    window.setTimeout(() => root.classList.remove("theme-anim"), 460);
  }
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
}

type ViewTransitionDocument = Document & {
  startViewTransition?: (callback: () => void) => {
    ready: Promise<void>;
    finished: Promise<void>;
  };
};

export function prefersReducedMotion() {
  try {
    return matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(currentTheme);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  // While the visitor has made no explicit choice, keep following the system.
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      if (readStoredTheme()) return;
      const next: Theme = media.matches ? "dark" : "light";
      paint(next, false);
      setTheme(next);
    };
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  const toggle = useCallback(
    (origin?: { x: number; y: number } | null) => {
      if (busyRef.current) return; // ignore repeat clicks while a transition runs

      const next: Theme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
      const reduced = prefersReducedMotion();
      const doc = document as ViewTransitionDocument;
      const commit = () => {
        paint(next, false);
        storeTheme(next);
        setTheme(next);
      };

      // Reduced motion: swap instantly, no reveal.
      if (reduced || typeof doc.startViewTransition !== "function") {
        paint(next, !reduced);
        storeTheme(next);
        setTheme(next);
        return;
      }

      busyRef.current = true;
      setBusy(true);

      const x = origin?.x ?? window.innerWidth - 52;
      const y = origin?.y ?? 96;
      const radius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
      const transition = doc.startViewTransition(commit);

      transition.ready
        .then(() => {
          document.documentElement.animate(
            {
              clipPath: [
                `circle(0px at ${x}px ${y}px)`,
                `circle(${radius}px at ${x}px ${y}px)`,
              ],
            },
            {
              duration: 560,
              easing: "cubic-bezier(0.22, 1, 0.36, 1)",
              pseudoElement: "::view-transition-new(root)",
            },
          );
        })
        .catch(() => {
          /* the swap already happened; the animation is cosmetic */
        });

      transition.finished
        .catch(() => {})
        .finally(() => {
          busyRef.current = false;
          setBusy(false);
        });
    },
    [],
  );

  return { theme, busy, toggle };
}
