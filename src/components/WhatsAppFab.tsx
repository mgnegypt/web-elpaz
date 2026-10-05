import { waLink } from "../lib/whatsapp";
import { WhatsAppIcon } from "./shared";
export default function WhatsAppFab() {
  return (
    <a
      className="whatsapp-fab"
      href={waLink("السلام عليكم، عايز أستفسر عن منتجاتكم")}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="تواصل عبر واتساب"
    >
      <WhatsAppIcon size={25} />
      <span className="fab-tooltip">اطلب عبر واتساب</span>
    </a>
  );
}
