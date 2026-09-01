import type { PublishedDocsPage } from "./blocks.ts";

export type DocsNavigationItem = Readonly<{ slug: string; title: string; href: string }>;
export type DocsNavigationGroup = { label: string; pages: DocsNavigationItem[] };
export type DocsTableOfContentsItem = Readonly<{ id: string; title: string; href: string }>;

export function pageHref(page: PublishedDocsPage): string {
  return page.canonicalPath;
}

export function buildDocsNavigation(pages: readonly PublishedDocsPage[]): DocsNavigationGroup[] {
  return pages.filter((page) => !page.navigation?.hidden).reduce<DocsNavigationGroup[]>((groups, page) => {
    let group = groups.find((item) => item.label === page.group);
    if (!group) {
      group = { label: page.group, pages: [] };
      groups.push(group);
    }
    group.pages.push({ slug: page.slug, title: page.title, href: pageHref(page) });
    return groups;
  }, []);
}

export function buildTableOfContents(page: PublishedDocsPage): DocsTableOfContentsItem[] {
  return page.sections.map((section) => ({
    id: section.id,
    title: section.title,
    href: `${page.canonicalPath}#${section.id}`,
  }));
}

export function getDocsNeighbors(pages: readonly PublishedDocsPage[], slug: string): { previous: PublishedDocsPage | null; next: PublishedDocsPage | null } {
  const current = pages.find((page) => page.slug === slug);
  const collection = current?.navigation?.collection;
  const sequence = collection && current?.navigation?.hidden
    ? pages.filter((page) => page.navigation?.collection === collection && page.navigation?.hidden)
    : pages.filter((page) => !page.navigation?.hidden);
  const index = sequence.findIndex((page) => page.slug === slug);
  return {
    previous: index > 0 ? sequence[index - 1] : null,
    next: index >= 0 && index < sequence.length - 1 ? sequence[index + 1] : null,
  };
}
