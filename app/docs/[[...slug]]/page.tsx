import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DocsPage as DocsPageContent, type DocsPageData } from "@/components/docs/docs-page";
import { docsPageBySlug, docsPages } from "@/src/docs/content.ts";

export function generateStaticParams() {
  return docsPages.map((page) => ({ slug: page.slug === "overview" ? [] : [page.slug] }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug?: string[] }> }): Promise<Metadata> {
  const { slug = [] } = await params;
  const page = docsPageBySlug[slug[0] ?? "overview"];
  if (!page || slug.length > 1) return {};
  const title = `${page.title} · VenueMind Docs`;
  return {
    title: page.title,
    description: page.description,
    alternates: { canonical: page.canonicalPath },
    openGraph: { title, description: page.description, url: page.canonicalPath, type: "website", siteName: "VenueMind" },
    twitter: { card: "summary", title, description: page.description },
  };
}

export default async function DocsPage({ params }: { params: Promise<{ slug?: string[] }> }) {
  const { slug = [] } = await params;
  const page = docsPageBySlug[slug[0] ?? "overview"];
  if (slug.length > 1 || !page) notFound();
  return <DocsPageContent page={page satisfies DocsPageData} pages={docsPages satisfies readonly DocsPageData[]} />;
}
