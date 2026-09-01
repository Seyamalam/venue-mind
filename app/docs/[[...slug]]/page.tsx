import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DocsRoute } from "@/components/routes/docs-route";
import { docsPageBySlug, docsPages } from "@/src/docs/content.js";

export const dynamicParams = false;

export function generateStaticParams() {
  return docsPages.map((page) => ({ slug: page.slug === "overview" ? [] : [page.slug] }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug?: string[] }> }): Promise<Metadata> {
  const { slug = [] } = await params;
  const page = docsPageBySlug[slug[0] ?? "overview"];
  if (!page || slug.length > 1) return {};
  return {
    title: page.title,
    description: page.description,
    alternates: { canonical: page.canonicalPath },
  };
}

export default async function DocsPage({ params }: { params: Promise<{ slug?: string[] }> }) {
  const { slug = [] } = await params;
  if (slug.length > 1 || !docsPageBySlug[slug[0] ?? "overview"]) notFound();
  return <DocsRoute />;
}
