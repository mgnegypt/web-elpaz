import { useCallback, useEffect, useRef, useState } from "react";
import { useReducedMotion } from "./useReducedMotion";
export function useSectionNav(
  blocked: boolean,
  onWave: () => void,
  gestureBlocked = false,
) {
  const [section, setSection] = useState(0),
    [isTransitioning, setTransitioning] = useState(false),
    [waveDir, setWaveDir] = useState<"down" | "up">("down");
  const reduced = useReducedMotion(),
    lock = useRef(false),
    timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const goTo = useCallback(
    (target: number) => {
      if (
        blocked ||
        lock.current ||
        target === section ||
        target < 0 ||
        target > 7
      )
        return;
      lock.current = true;
      setTransitioning(true);
      setWaveDir(target > section ? "down" : "up");
      onWave();
      timers.current.push(
        setTimeout(() => setSection(target), reduced ? 150 : 700),
      );
      timers.current.push(
        setTimeout(
          () => {
            lock.current = false;
            setTransitioning(false);
          },
          reduced ? 300 : 1500,
        ),
      );
    },
    [blocked, section, reduced, onWave],
  );
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  useEffect(() => {
    let startX = 0,
      startY = 0,
      touchTarget: EventTarget | null = null,
      lastScroll = -Infinity,
      lastWheel = 0;
    const editable = (target: EventTarget | null) =>
      target instanceof Element &&
      !!target.closest('input,textarea,select,[contenteditable="true"]');
    const edge = (target: EventTarget | null, delta: number) => {
      const scroller =
        target instanceof Element
          ? target.closest<HTMLElement>("[data-section-scroll]")
          : null;
      if (!scroller) return true;
      const overflowing = scroller.scrollHeight > scroller.clientHeight + 3;
      if (!overflowing) return true;
      if (performance.now() - lastScroll < 300) return false;
      return delta > 0
        ? scroller.scrollTop + scroller.clientHeight >=
            scroller.scrollHeight - 3
        : scroller.scrollTop <= 3;
    };
    const scroll = (e: Event) => {
      if (
        e.target instanceof HTMLElement &&
        e.target.matches("[data-section-scroll]")
      )
        lastScroll = performance.now();
    };
    const wheel = (e: WheelEvent) => {
      if (gestureBlocked) return;
      if (
        editable(e.target) ||
        Math.abs(e.deltaY) < 20 ||
        Math.abs(e.deltaX) > Math.abs(e.deltaY)
      )
        return;
      const now = performance.now();
      const gap = now - lastWheel;
      lastWheel = now;
      if (gap < 160) return;
      if (edge(e.target, e.deltaY)) goTo(section + (e.deltaY > 0 ? 1 : -1));
    };
    const touchstart = (e: TouchEvent) => {
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      touchTarget = e.target;
    };
    const touchend = (e: TouchEvent) => {
      if (gestureBlocked) return;
      if (editable(touchTarget)) return;
      const dx = e.changedTouches[0].clientX - startX,
        dy = startY - e.changedTouches[0].clientY;
      if (
        Math.abs(dy) > 50 &&
        Math.abs(dy) > Math.abs(dx) &&
        edge(touchTarget, dy)
      )
        goTo(section + (dy > 0 ? 1 : -1));
    };
    const key = (e: KeyboardEvent) => {
      if (gestureBlocked || blocked) return;
      if (
        e.target instanceof Element &&
        e.target.closest(
          'input,textarea,select,button,a,[contenteditable="true"]',
        )
      )
        return;
      const d = ["ArrowDown", "PageDown", " "].includes(e.key)
        ? 1
        : ["ArrowUp", "PageUp"].includes(e.key)
          ? -1
          : 0;
      if (d) {
        const scroller = document.querySelector<HTMLElement>(
          ".section-shell.is-active",
        );
        if (edge(scroller, d)) {
          e.preventDefault();
          goTo(section + d);
        } else {
          e.preventDefault();
          scroller?.scrollBy({
            top: d * scroller.clientHeight * 0.7,
            behavior: reduced ? "instant" : "smooth",
          });
        }
      }
    };
    window.addEventListener("wheel", wheel, { passive: true });
    window.addEventListener("touchstart", touchstart, { passive: true });
    window.addEventListener("touchend", touchend, { passive: true });
    window.addEventListener("keydown", key);
    document.addEventListener("scroll", scroll, true);
    return () => {
      window.removeEventListener("wheel", wheel);
      window.removeEventListener("touchstart", touchstart);
      window.removeEventListener("touchend", touchend);
      window.removeEventListener("keydown", key);
      document.removeEventListener("scroll", scroll, true);
    };
  }, [goTo, section, reduced, gestureBlocked, blocked]);
  return { section, goTo, isTransitioning, waveDir };
}
