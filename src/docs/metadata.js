function upsertMeta(selector, attributes) {
  let element = document.head.querySelector(selector);
  if (!element) {
    element = document.createElement("meta");
    document.head.append(element);
  }
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
}

function upsertCanonical(href) {
  let element = document.head.querySelector('link[rel="canonical"]');
  if (!element) {
    element = document.createElement("link");
    element.setAttribute("rel", "canonical");
    document.head.append(element);
  }
  element.setAttribute("href", href);
}

export function applyDocsMetadata(page, origin = window.location.origin) {
  const title = `${page.title} · VenueMind Docs`;
  const canonicalUrl = new URL(page.canonicalPath, origin).href;
  document.title = title;
  upsertCanonical(canonicalUrl);
  upsertMeta('meta[name="description"]', { name: "description", content: page.description });
  upsertMeta('meta[property="og:type"]', { property: "og:type", content: "website" });
  upsertMeta('meta[property="og:title"]', { property: "og:title", content: title });
  upsertMeta('meta[property="og:description"]', { property: "og:description", content: page.description });
  upsertMeta('meta[property="og:url"]', { property: "og:url", content: canonicalUrl });
  upsertMeta('meta[name="twitter:card"]', { name: "twitter:card", content: "summary" });
  upsertMeta('meta[name="twitter:title"]', { name: "twitter:title", content: title });
  upsertMeta('meta[name="twitter:description"]', { name: "twitter:description", content: page.description });
}
