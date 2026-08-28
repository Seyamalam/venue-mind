export function pageHref(page) {
  return page.canonicalPath;
}

export function buildDocsNavigation(pages) {
  return pages.filter((page) => !page.navigation?.hidden).reduce((groups, page) => {
    let group = groups.find((item) => item.label === page.group);
    if (!group) {
      group = { label: page.group, pages: [] };
      groups.push(group);
    }
    group.pages.push({ slug: page.slug, title: page.title, href: pageHref(page) });
    return groups;
  }, []);
}

export function buildTableOfContents(page) {
  return page.sections.map((section) => ({
    id: section.id,
    title: section.title,
    href: `${page.canonicalPath}#${section.id}`,
  }));
}

export function getDocsNeighbors(pages, slug) {
  const current = pages.find((page) => page.slug === slug);
  const sequence = current?.navigation?.collection && current.navigation.hidden
    ? pages.filter((page) => page.navigation?.collection === current.navigation.collection && page.navigation.hidden)
    : pages.filter((page) => !page.navigation?.hidden);
  const index = sequence.findIndex((page) => page.slug === slug);
  return {
    previous: index > 0 ? sequence[index - 1] : null,
    next: index >= 0 && index < sequence.length - 1 ? sequence[index + 1] : null,
  };
}
