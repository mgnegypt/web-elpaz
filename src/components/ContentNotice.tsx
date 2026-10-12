import { RefreshCw, WifiOff } from "lucide-react";
import { useContentState } from "../content/ContentContext";

/**
 * Honest status for the published content.
 *
 * The site never swaps real content for the bundled demo copy on its own, so
 * when a refresh fails the visitor keeps reading the last good document and
 * this strip explains the situation and offers a retry. It is fixed-position
 * on purpose: the sections use scroll-snap and must keep their exact height.
 */
export default function ContentNotice() {
  const { status, source, refresh } = useContentState();
  if (status !== "error") return null;

  const bundled = source === "fallback";
  return (
    <div
      className={`content-notice${bundled ? " content-notice--bundled" : ""}`}
      role="status"
      aria-live="polite"
    >
      <span className="content-notice-icon" aria-hidden="true">
        <WifiOff size={16} />
      </span>
      <p>
        {bundled
          ? "تعذّر تحميل محتوى الموقع. ما تراه الآن نسخة مبدئية مؤقتة."
          : "تعذّر تحديث المحتوى الآن. نعرض آخر نسخة محفوظة."}
      </p>
      <button type="button" className="content-notice-retry" onClick={() => void refresh()}>
        <RefreshCw size={15} aria-hidden="true" />
        إعادة المحاولة
      </button>
    </div>
  );
}
