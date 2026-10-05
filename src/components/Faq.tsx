import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { FAQS } from "../data";
import { waLink } from "../lib/whatsapp";
import { SectionTitle, WhatsAppIcon } from "./shared";
export default function Faq() {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <div className="section-container faq-container centered-section">
      <SectionTitle
        eyebrow="كل اللي في بالك"
        title="أسئلة شائعة"
        subtitle="إجابات واضحة، عشان تطلب وأنت مطمّن."
      />
      <div className="faq-list">
        {FAQS.map((item, i) => (
          <article
            className={`faq-item ${open === i ? "open" : ""}`}
            key={item.q}
          >
            <h2>
              <button
                aria-expanded={open === i}
                aria-controls={`faq-answer-${i}`}
                id={`faq-question-${i}`}
                onClick={() => setOpen(open === i ? null : i)}
              >
                <span className="faq-number">0{i + 1}</span>
                <span>{item.q}</span>
                <ChevronDown size={21} />
              </button>
            </h2>
            <div
              id={`faq-answer-${i}`}
              className="faq-answer"
              role="region"
              aria-labelledby={`faq-question-${i}`}
              inert={open !== i}
            >
              <div>
                <p>{item.a}</p>
              </div>
            </div>
          </article>
        ))}
      </div>
      <div className="faq-cta">
        <span>عندك سؤال تاني؟</span>
        <a
          className="wa-button"
          target="_blank"
          rel="noopener noreferrer"
          href={waLink("السلام عليكم، عندي سؤال عن منتجاتكم")}
        >
          <WhatsAppIcon size={20} />
          اسألنا على واتساب
        </a>
      </div>
    </div>
  );
}
