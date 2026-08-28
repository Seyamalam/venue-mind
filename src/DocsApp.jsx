import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  BookOpen,
  BracketsCurly,
  CaretLeft,
  CaretRight,
  CheckCircle,
  Copy,
  GraduationCap,
  LinkSimple,
  MagnifyingGlass,
  Robot,
  ShieldCheck,
  TerminalWindow,
  X,
} from "@phosphor-icons/react";
import { docsPageBySlug, docsPages } from "./docs/content.js";
import { applyDocsMetadata } from "./docs/metadata.js";
import { buildDocsNavigation, buildTableOfContents, getDocsNeighbors } from "./docs/navigation.js";
import { buildDocsSearchIndex, nextSearchSelection, searchDocs } from "./docs/search.js";
import "./docs.css";

const icons = { Start: BookOpen, Build: BracketsCurly, Tutorials: GraduationCap, Agents: Robot, Reference: ShieldCheck };
const currentSlug = () => window.location.pathname.replace(/^\/docs\/?/, "") || "overview";

function navigateDocs(href) {
  window.history.pushState({}, "", href);
  window.dispatchEvent(new PopStateEvent("popstate"));
  window.requestAnimationFrame(() => {
    const anchor = new URL(href, window.location.origin).hash.slice(1);
    if (anchor) document.getElementById(anchor)?.scrollIntoView({ block: "start" });
    else window.scrollTo({ top: 0, behavior: "instant" });
  });
}

function DocsLink({ href, children, className = "", onNavigate }) {
  const handleClick = (event) => {
    if (!href.startsWith("/docs")) return;
    event.preventDefault();
    onNavigate?.();
    navigateDocs(href);
  };
  return <a href={href} className={className} onClick={handleClick}>{children}</a>;
}

function DocBlock({ block }) {
  const [copied, setCopied] = useState(false);
  if (block.type === "prose") return <p>{block.value}</p>;
  if (block.type === "bullets") return <ul>{block.items.map((item) => <li key={item}><CheckCircle size={17} weight="fill" />{item}</li>)}</ul>;
  if (block.type === "steps") return <ol>{block.items.map((item, index) => <li key={item}><span>{index + 1}</span>{item}</li>)}</ol>;
  if (block.type === "links") return <div className="doc-link-grid">{block.items.map((item) => <DocsLink key={item.href} href={item.href}><span>{item.label}</span><ArrowRight size={16} /></DocsLink>)}</div>;
  if (block.type === "table") return <div className="doc-table-wrap"><table><thead><tr>{block.columns.map((column) => <th key={column.key} scope="col">{column.label}</th>)}</tr></thead><tbody>{block.rows.map((row, rowIndex) => <tr key={row.id ?? row.name ?? row.code ?? rowIndex}>{block.columns.map((column) => <td key={column.key}>{row[column.key] ?? "—"}</td>)}</tr>)}</tbody></table></div>;
  if (block.type === "code") return <div className="code-block"><div><span>{block.language}</span><button type="button" onClick={async () => { await navigator.clipboard?.writeText(block.value); setCopied(true); window.setTimeout(() => setCopied(false), 1200); }}><Copy size={14} />{copied ? "Copied" : "Copy"}</button></div><pre><code>{block.value}</code></pre></div>;
  return null;
}

function SectionHeading({ page, section }) {
  const [copied, setCopied] = useState(false);
  const href = `${page.canonicalPath}#${section.id}`;
  const copyLink = async () => {
    await navigator.clipboard?.writeText(new URL(href, window.location.origin).href);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };
  return (
    <h2 className="doc-section-heading">
      <a href={`#${section.id}`}>{section.title}</a>
      <button type="button" onClick={copyLink} aria-label={`Copy link to ${section.title}`} title={copied ? "Copied" : "Copy deep link"}>
        {copied ? <CheckCircle size={16} weight="fill" /> : <LinkSimple size={16} />}
      </button>
    </h2>
  );
}

function SearchDialog({ open, onClose, index }) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(-1);
  const inputRef = useRef(null);
  const results = useMemo(() => searchDocs(index, query), [index, query]);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setSelected(-1);
    window.requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  useEffect(() => setSelected(results.length ? 0 : -1), [query, results.length]);

  if (!open) return null;
  const selectResult = (result) => {
    if (!result) return;
    onClose();
    navigateDocs(result.href);
  };
  const onKeyDown = (event) => {
    if (event.key === "Escape") { event.preventDefault(); onClose(); return; }
    if (["ArrowDown", "ArrowUp"].includes(event.key)) {
      event.preventDefault();
      setSelected((value) => nextSearchSelection(value, event.key, results.length));
    }
    if (event.key === "Enter" && selected >= 0) {
      event.preventDefault();
      selectResult(results[selected]);
    }
  };

  return (
    <div className="docs-search-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="docs-search-dialog" role="dialog" aria-modal="true" aria-label="Search VenueMind documentation">
        <div className="docs-search-input">
          <MagnifyingGlass size={18} />
          <input ref={inputRef} value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={onKeyDown} placeholder="Search tools, concepts, workflows…" aria-label="Search documentation" aria-controls="docs-search-results" aria-activedescendant={selected >= 0 ? `docs-search-result-${selected}` : undefined} />
          <button type="button" onClick={onClose} aria-label="Close search"><X size={17} /></button>
        </div>
        <div id="docs-search-results" className="docs-search-results" role="listbox" aria-label="Documentation search results">
          {!query && <div className="docs-search-empty"><span>Search all pages and headings</span><kbd>↑↓</kbd><span>navigate</span><kbd>↵</kbd><span>open</span></div>}
          {query && !results.length && <div className="docs-search-empty">No matching documentation</div>}
          {results.map((result, indexValue) => (
            <button id={`docs-search-result-${indexValue}`} key={result.id} type="button" role="option" aria-selected={selected === indexValue} className={selected === indexValue ? "selected" : ""} onMouseEnter={() => setSelected(indexValue)} onClick={() => selectResult(result)}>
              <span><strong>{result.sectionTitle}</strong><small>{result.pageTitle}</small></span><ArrowRight size={15} />
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

export function DocsApp() {
  const [slug, setSlug] = useState(currentSlug);
  const [searchOpen, setSearchOpen] = useState(false);
  const page = docsPageBySlug[slug] ?? docsPageBySlug.overview;
  const navigation = useMemo(() => buildDocsNavigation(docsPages), []);
  const searchIndex = useMemo(() => buildDocsSearchIndex(docsPages), []);
  const tableOfContents = useMemo(() => buildTableOfContents(page), [page]);
  const neighbors = useMemo(() => getDocsNeighbors(docsPages, page.slug), [page.slug]);

  useEffect(() => {
    const update = () => setSlug(currentSlug());
    window.addEventListener("popstate", update);
    return () => window.removeEventListener("popstate", update);
  }, []);

  useEffect(() => {
    applyDocsMetadata(page);
    if (window.location.hash) window.requestAnimationFrame(() => document.getElementById(window.location.hash.slice(1))?.scrollIntoView({ block: "start" }));
  }, [page]);

  useEffect(() => {
    const openFromKeyboard = (event) => {
      const target = event.target;
      const isTyping = target instanceof HTMLElement && (target.matches("input, textarea, select") || target.isContentEditable);
      if ((event.key === "/" && !isTyping) || ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k")) {
        event.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", openFromKeyboard);
    return () => window.removeEventListener("keydown", openFromKeyboard);
  }, []);

  return (
    <div className="docs-shell">
      <header className="docs-header">
        <DocsLink href="/docs" className="docs-brand"><img src="/assets/venuemind-mark.png" alt="" /><strong>VenueMind</strong><span>Docs</span></DocsLink>
        <button type="button" className="docs-search-trigger" onClick={() => setSearchOpen(true)} aria-label="Search documentation"><MagnifyingGlass size={15} /><span>Search docs</span><kbd>⌘ K</kbd></button>
        <nav aria-label="Utility"><a href="/">Open Studio</a><a href="/llms.txt">llms.txt</a><a href="/schemas/venue-command.schema.json">Schemas</a></nav>
      </header>
      <aside className="docs-nav" aria-label="Documentation navigation">
        {navigation.map((group) => {
          const Icon = icons[group.label];
          return <section key={group.label}><h2>{Icon && <Icon size={15} />}{group.label}</h2>{group.pages.map((item) => <DocsLink key={item.slug} href={item.href} className={page.slug === item.slug ? "active" : ""}>{item.title}</DocsLink>)}</section>;
        })}
      </aside>
      <main className="docs-main">
        <div className="docs-hero">
          <span>{page.eyebrow}</span>
          <h1>{page.title}</h1>
          <p>{page.description}</p>
          <div className="docs-badges" aria-label="Page compatibility">{page.compatibility.map((badge) => <span key={badge}>{badge}</span>)}</div>
          <div className="docs-page-meta"><span>{page.audience.join(" · ")}</span><span>Reviewed for {page.lastReviewedVersion}</span></div>
          {page.slug === "overview" && <DocsLink href="/docs/quickstart" className="docs-cta"><TerminalWindow size={18} />Quickstart<ArrowRight size={16} /></DocsLink>}
        </div>
        <article>{page.sections.map((section) => <section id={section.id} key={section.id}><SectionHeading page={page} section={section} />{section.blocks.map((block, index) => <DocBlock key={`${section.id}-${index}`} block={block} />)}</section>)}</article>
        <nav className="docs-pagination" aria-label="Previous and next pages">
          {neighbors.previous ? <DocsLink href={neighbors.previous.canonicalPath}><CaretLeft size={17} /><span><small>Previous</small><strong>{neighbors.previous.title}</strong></span></DocsLink> : <span />}
          {neighbors.next ? <DocsLink href={neighbors.next.canonicalPath}><span><small>Next</small><strong>{neighbors.next.title}</strong></span><CaretRight size={17} /></DocsLink> : <span />}
        </nav>
      </main>
      <aside className="docs-toc"><span>On this page</span>{tableOfContents.map((item) => <a key={item.id} href={`#${item.id}`}>{item.title}</a>)}</aside>
      <SearchDialog open={searchOpen} onClose={() => setSearchOpen(false)} index={searchIndex} />
    </div>
  );
}
