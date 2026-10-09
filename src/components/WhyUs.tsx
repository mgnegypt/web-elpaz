import { Leaf, ArrowLeft } from "lucide-react";
import { useContent } from "../content/ContentContext";
import { resolveContentIcon } from "../lib/contentIcons";
import { SectionTitle } from "./shared";
export default function WhyUs({ goTo }: { goTo: (n: number) => void }) {
  const { whyUs, copy } = useContent();
  return (
    <div className="section-container centered-section why-container">
      <SectionTitle
        eyebrow="وعدنا ليك"
        title="لماذا البان إلباظ؟"
        subtitle={copy.whySubtitle}
      />
      <div className="why-grid grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        {whyUs.map((item, i) => {
          const { Icon } = resolveContentIcon(item.icon);
          return (
            <article
              className="why-card enter"
              key={item.title}
              style={{ animationDelay: `${i * 80}ms` }}
            >
              <span className="card-index" dir="ltr">
                0{i + 1}
              </span>
              <div className="feature-icon">
                <Icon size={29} strokeWidth={1.6} />
              </div>
              <h2>{item.title}</h2>
              <p>{item.text}</p>
              <div className="why-line" />
            </article>
          );
        })}
      </div>
      <button className="text-link" onClick={() => goTo(3)}>
        اعرف حكايتنا
        <ArrowLeft size={18} />
      </button>
      <div className="quality-note">
        <Leaf size={18} />
        من أول اختيار للخامات… لآخر تفصيلة في العبوة.
      </div>
    </div>
  );
}
