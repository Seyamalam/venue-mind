import Link from "next/link";
import Image from "next/image";
import type { ReactNode } from "react";
import {
  ArrowRight,
  BookOpen,
  Braces as BracketsCurly,
  ChevronLeft as CaretLeft,
  ChevronRight as CaretRight,
  CircleCheck as CheckCircle,
  GraduationCap,
  Bot as Robot,
  ShieldCheck,
  SquareTerminal as TerminalWindow,
} from "lucide-react";
import { CopyDeepLinkButton, CopyTextButton } from "@/components/docs/docs-copy-buttons";
import { DocsSearch } from "@/components/docs/docs-interactions";
import { buildDocsNavigation, buildTableOfContents, getDocsNeighbors } from "@/src/docs/navigation.ts";
import type { DocBlock, PublishedDocsPage } from "@/src/docs/blocks.ts";

export type DocsPageData = PublishedDocsPage;

const icons = {
  Start: BookOpen,
  Build: BracketsCurly,
  Tutorials: GraduationCap,
  Agents: Robot,
  Reference: ShieldCheck,
};

const isIconLabel = (label: string): label is keyof typeof icons => Object.hasOwn(icons, label);

function DocumentationLink({ href, children }: { href: string; children: ReactNode }) {
  if (href === "/docs" || href.startsWith("/docs/") || href.startsWith("#")) {
    return <a href={href}>{children}</a>;
  }
  return <a href={href}>{children}</a>;
}

function Block({ block }: { block: DocBlock }) {
  if (block.type === "prose") return <p>{block.value}</p>;
  if (block.type === "bullets")
    return (
      <ul>
        {block.items.map((item) => (
          <li key={item}>
            <CheckCircle size={17} fill="currentColor" />
            {item}
          </li>
        ))}
      </ul>
    );
  if (block.type === "steps")
    return (
      <ol>
        {block.items.map((item, index) => (
          <li key={item}>
            <span>{index + 1}</span>
            {item}
          </li>
        ))}
      </ol>
    );
  if (block.type === "links") {
    return (
      <div className="doc-link-grid">
        {block.items.map((item) => (
          <DocumentationLink key={item.href} href={item.href}>
            <span>{item.label}</span>
            <ArrowRight size={16} />
          </DocumentationLink>
        ))}
      </div>
    );
  }
  if (block.type === "table") {
    return (
      <div className="doc-table-wrap">
        <table>
          <thead>
            <tr>
              {block.columns.map((column) => (
                <th key={column.key} scope="col">
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row, rowIndex) => (
              <tr key={String(row["id"] ?? row["name"] ?? row["code"] ?? rowIndex)}>
                {block.columns.map((column) => (
                  <td key={column.key}>{row[column.key] ?? "—"}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  return (
    <div className="code-block">
      <div>
        <span>{block.language}</span>
        <CopyTextButton text={block.value} />
      </div>
      <pre>
        <code>{block.value}</code>
      </pre>
    </div>
  );
}

export function DocsPage({ page, pages }: { page: DocsPageData; pages: readonly DocsPageData[] }) {
  const navigation = buildDocsNavigation(pages);
  const tableOfContents = buildTableOfContents(page);
  const neighbors = getDocsNeighbors(pages, page.slug);

  return (
    <div className="docs-shell">
      <header className="docs-header">
        <Link href={{ pathname: "/docs/[[...slug]]", query: {} }} className="docs-brand">
          <Image src="/assets/venuemind-mark.webp" alt="" width={32} height={32} />
          <strong>VenueMind</strong>
          <span>Docs</span>
        </Link>
        <DocsSearch />
        <nav aria-label="Utility">
          <Link href="/">Open Studio</Link>
          <a href="/llms.txt">llms.txt</a>
          <a href="/schemas/venue-command.schema.json">Schemas</a>
        </nav>
      </header>
      <aside className="docs-nav" aria-label="Documentation navigation">
        {navigation.map((group) => {
          const Icon = isIconLabel(group.label) ? icons[group.label] : null;
          return (
            <section key={group.label}>
              <h2>
                {Icon && <Icon size={15} />}
                {group.label}
              </h2>
              {group.pages.map((item) => (
                <a
                  key={item.slug}
                  href={item.href}
                  className={page.slug === item.slug ? "active" : ""}
                  aria-current={page.slug === item.slug ? "page" : undefined}
                >
                  {item.title}
                </a>
              ))}
            </section>
          );
        })}
      </aside>
      <main className="docs-main">
        <div className="docs-hero">
          <span>{page.eyebrow}</span>
          <h1>{page.title}</h1>
          <p>{page.description}</p>
          <div className="docs-badges" aria-label="Page compatibility">
            {page.compatibility.map((badge) => (
              <span key={badge}>{badge}</span>
            ))}
          </div>
          <div className="docs-page-meta">
            <span>{page.audience.join(" · ")}</span>
            <span>Reviewed for {page.lastReviewedVersion}</span>
          </div>
          {page.slug === "overview" && (
            <Link href={{ pathname: "/docs/[[...slug]]", query: { slug: ["quickstart"] } }} className="docs-cta">
              <TerminalWindow size={18} />
              Quickstart
              <ArrowRight size={16} />
            </Link>
          )}
        </div>
        <article>
          {page.sections.map((section) => (
            <section id={section.id} key={section.id}>
              <h2 className="doc-section-heading">
                <a href={`#${section.id}`}>{section.title}</a>
                <CopyDeepLinkButton href={`${page.canonicalPath}#${section.id}`} title={section.title} />
              </h2>
              {section.blocks.map((block, index) => (
                <Block key={`${section.id}-${index}`} block={block} />
              ))}
            </section>
          ))}
        </article>
        <nav className="docs-pagination" aria-label="Previous and next pages">
          {neighbors.previous ? (
            <a href={neighbors.previous.canonicalPath}>
              <CaretLeft size={17} />
              <span>
                <small>Previous</small>
                <strong>{neighbors.previous.title}</strong>
              </span>
            </a>
          ) : (
            <span />
          )}
          {neighbors.next ? (
            <a href={neighbors.next.canonicalPath}>
              <span>
                <small>Next</small>
                <strong>{neighbors.next.title}</strong>
              </span>
              <CaretRight size={17} />
            </a>
          ) : (
            <span />
          )}
        </nav>
      </main>
      <aside className="docs-toc">
        <span>On this page</span>
        {tableOfContents.map((item: { id: string; title: string }) => (
          <a key={item.id} href={`#${item.id}`}>
            {item.title}
          </a>
        ))}
      </aside>
    </div>
  );
}
