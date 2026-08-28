import { blockText } from "./blocks.js";

const normalize = (value) => value.toLocaleLowerCase().replace(/[^a-z0-9.:-]+/g, " ").trim();

export function buildDocsSearchIndex(pages) {
  return pages.flatMap((page, pageIndex) => [
    {
      id: `${page.slug}:page`,
      pageSlug: page.slug,
      pageTitle: page.title,
      sectionTitle: "Overview",
      href: page.canonicalPath,
      text: normalize([page.title, page.description, page.eyebrow, page.audience.join(" "), page.compatibility.join(" ")].join(" ")),
      order: pageIndex * 1000,
    },
    ...page.sections.map((section, sectionIndex) => ({
      id: `${page.slug}:${section.id}`,
      pageSlug: page.slug,
      pageTitle: page.title,
      sectionTitle: section.title,
      href: `${page.canonicalPath}#${section.id}`,
      text: normalize([page.title, section.title, ...section.blocks.map(blockText)].join(" ")),
      order: pageIndex * 1000 + sectionIndex + 1,
    })),
  ]);
}

function searchScore(entry, tokens) {
  let score = 0;
  const heading = normalize(`${entry.pageTitle} ${entry.sectionTitle}`);
  for (const token of tokens) {
    if (!entry.text.includes(token)) return -1;
    if (heading === token) score += 20;
    else if (heading.startsWith(token)) score += 12;
    else if (heading.includes(token)) score += 7;
    else score += 2;
  }
  return score;
}

export function searchDocs(index, query, limit = 10) {
  const tokens = normalize(query).split(" ").filter(Boolean);
  if (!tokens.length) return [];
  return index
    .map((entry) => ({ entry, score: searchScore(entry, tokens) }))
    .filter((result) => result.score >= 0)
    .sort((a, b) => b.score - a.score || a.entry.order - b.entry.order)
    .slice(0, limit)
    .map(({ entry }) => entry);
}

export function nextSearchSelection(current, key, resultCount) {
  if (!resultCount) return -1;
  if (key === "ArrowDown") return current < resultCount - 1 ? current + 1 : 0;
  if (key === "ArrowUp") return current > 0 ? current - 1 : resultCount - 1;
  return current;
}
