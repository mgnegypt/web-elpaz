// Structured data for the catalogue.
//
// Only products the owner has actually priced are published: search engines
// get real names, real prices and the real stock state, or nothing at all.
// No invented ratings, review counts, brands or availability.
import { useMemo } from "react";
import { unitPriceOf } from "../../shared/orders.ts";
import { useContent } from "../content/ContentContext";

export default function ProductJsonLd() {
  const { products, site, commerce, seo } = useContent();

  const json = useMemo(() => {
    const origin = typeof window === "undefined" ? "" : window.location.origin;
    const priced = products.filter(
      (product) => product.price !== null && product.price > 0,
    );
    if (!priced.length) return null;
    return {
      "@context": "https://schema.org",
      "@type": "ItemList",
      name: seo.title,
      itemListElement: priced.map((product, index) => ({
        "@type": "ListItem",
        position: index + 1,
        item: {
          "@type": "Product",
          name: product.name,
          description: product.longDesc || product.desc,
          category: product.category,
          ...(product.img || product.webp || product.fallback
            ? { image: product.webp || product.img || product.fallback }
            : {}),
          ...(product.size && product.size !== "—" ? { size: product.size } : {}),
          offers: {
            "@type": "Offer",
            price: unitPriceOf(product),
            // The owner names the display currency; EGP is the ISO code for
            // «ج.م», which is what this business sells in.
            priceCurrency: "EGP",
            availability:
              product.availability === "coming_soon"
                ? "https://schema.org/PreOrder"
                : product.quantity === 0
                  ? "https://schema.org/OutOfStock"
                  : "https://schema.org/InStock",
            ...(commerce.ordersEnabled && origin
              ? { url: `${origin}/?category=${encodeURIComponent(product.category)}` }
              : {}),
            seller: { "@type": "Organization", name: site.name },
          },
        },
      })),
    };
  }, [products, site.name, seo.title, commerce.ordersEnabled]);

  if (!json) return null;
  return (
    <script
      type="application/ld+json"
      // A JSON data block, not executable script: the content is produced by
      // JSON.stringify, so it cannot break out of the element.
      dangerouslySetInnerHTML={{ __html: JSON.stringify(json) }}
    />
  );
}
