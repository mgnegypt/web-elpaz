import { useContent } from "../content/ContentContext";
import { waLink } from "../lib/whatsapp";
import { WhatsAppIcon } from "./shared";
export default function WhatsAppFab() {
  const { site } = useContent();
  return (
    <a
      className="whatsapp-fab"
      href={waLink(site.whatsapp, "السلام عليكم، عايز أستفسر عن منتجاتكم")}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="تواصل عبر واتساب"
    >
      <WhatsAppIcon size={25} />
      <span className="fab-tooltip">اطلب عبر واتساب</span>
    </a>
  );
}
