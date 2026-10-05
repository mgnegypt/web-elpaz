import { WA_NUMBER } from "../data";
export const waLink = (text?: string) =>
  `https://wa.me/${WA_NUMBER}${text ? `?text=${encodeURIComponent(text)}` : ""}`;
export const orderMessage = (name: string) =>
  "السلام عليكم، عايز أطلب: " + name;
export function wholesaleMessage(
  name: string,
  quantity: string,
  unit: string,
  product: string,
  notes: string,
) {
  return `السلام عليكم، أنا ${name.trim()}، عايز أطلب ${quantity} ${unit} من ${product}. ${notes.trim()}`.trim();
}
