import { useEffect, useState } from "react";
import { Bell, CalendarRange, ChevronLeft, X } from "lucide-react";
import { EVENT_TYPE_LABELS } from "../../shared/content.ts";
import { useEvents } from "../content/ContentContext";

const DISMISS_KEY = "elbaz-announcement-dismissed";

/**
 * Announcements published from the dashboard. Rendered as a slim bar under the
 * header (not a section) so the site's scroll-snap layout is untouched, and
 * hidden automatically when there is nothing active.
 */
export default function Announcements() {
  const events = useEvents();
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState<string>("");

  useEffect(() => {
    try {
      setDismissed(sessionStorage.getItem(DISMISS_KEY) ?? "");
    } catch {
      /* storage disabled */
    }
  }, []);

  const active = events.filter((event) => event.id.toString() !== dismissed);
  if (active.length === 0) return null;
  const [first, ...rest] = active;

  const dismiss = () => {
    setOpen(false);
    setDismissed(first.id.toString());
    try {
      sessionStorage.setItem(DISMISS_KEY, first.id.toString());
    } catch {
      /* ignore */
    }
  };

  return (
    <div className={`announce-bar${open ? " announce-bar--open" : ""}`}>
      <button
        className="announce-main"
        onClick={() => (rest.length ? setOpen((value) => !value) : undefined)}
        aria-expanded={rest.length ? open : undefined}
        aria-label={rest.length ? "عرض كل التنبيهات" : first.title}
      >
        <span className="announce-icon">
          <Bell size={15} />
        </span>
        <span className="announce-type">{EVENT_TYPE_LABELS[first.type]}</span>
        <strong>{first.title}</strong>
        <span className="announce-text">{first.description}</span>
        {rest.length > 0 && (
          <span className="announce-more">
            +{rest.length}
            <ChevronLeft size={14} />
          </span>
        )}
      </button>
      <button className="announce-close" onClick={dismiss} aria-label="إغلاق التنبيه">
        <X size={15} />
      </button>
      {open && rest.length > 0 && (
        <ul className="announce-list">
          {active.map((event) => (
            <li key={event.id}>
              {event.imageUrl && <img src={event.imageUrl} alt="" loading="lazy" />}
              <div>
                <span className="announce-type">{EVENT_TYPE_LABELS[event.type]}</span>
                <strong>{event.title}</strong>
                <p>{event.description}</p>
                {(event.startAt || event.endAt) && (
                  <small>
                    <CalendarRange size={13} />
                    {event.startAt || "—"} ← {event.endAt || "—"}
                  </small>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
