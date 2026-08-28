import { mkdir, writeFile } from "node:fs/promises";
import { docsPages } from "../src/docs/content.js";
import { buildDocsNavigation } from "../src/docs/navigation.js";
import { referenceManifest } from "../src/docs/pages/reference.js";

const configuredOrigin = process.env.VENUEMIND_PUBLIC_ORIGIN?.trim() || "http://localhost:4173";
const originUrl = new URL(configuredOrigin);
if (!["http:", "https:"].includes(originUrl.protocol) || originUrl.username || originUrl.password) {
  throw new Error("VENUEMIND_PUBLIC_ORIGIN must be an HTTP(S) origin without credentials");
}
originUrl.pathname = "/";
originUrl.search = "";
originUrl.hash = "";
const origin = originUrl.origin;
const outputDirectory = new URL("../public/", import.meta.url);
const lastModified = "2026-08-27";

const sitemapEntries = ["/", "/projects", ...docsPages.map((page) => page.canonicalPath)]
  .map((pathname) => `  <url><loc>${new URL(pathname, origin).href}</loc><lastmod>${lastModified}</lastmod></url>`)
  .join("\n");
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${sitemapEntries}
</urlset>
`;

const manifest = {
  schemaVersion: 1,
  canonicalOrigin: origin,
  generatedFrom: "src/docs/content.js",
  pages: docsPages.map(({ slug, title, description, canonicalPath, audience, lastReviewedVersion, compatibility, sections }) => ({
    slug,
    title,
    description,
    canonicalPath,
    audience,
    lastReviewedVersion,
    compatibility,
    anchors: sections.map((section) => section.id),
  })),
  navigation: buildDocsNavigation(docsPages),
};

await mkdir(outputDirectory, { recursive: true });
await Promise.all([
  writeFile(new URL("sitemap.xml", outputDirectory), sitemap),
  writeFile(new URL("robots.txt", outputDirectory), `User-agent: *\nAllow: /\nSitemap: ${origin}/sitemap.xml\n`),
  writeFile(new URL("docs-manifest.json", outputDirectory), `${JSON.stringify(manifest, null, 2)}\n`),
  writeFile(new URL("reference-manifest.json", outputDirectory), `${JSON.stringify(referenceManifest, null, 2)}\n`),
]);

console.log(`Generated docs metadata for ${docsPages.length} pages`);
