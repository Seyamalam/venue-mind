"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import {
  ArrowRight,
  CheckCircle,
  Copy,
  LinkSimple,
  MagnifyingGlass,
  X,
} from "@phosphor-icons/react";
import { nextSearchSelection, searchDocs } from "@/src/docs/search.js";

type SearchEntry = {
  id: string;
  pageSlug: string;
  pageTitle: string;
  sectionTitle: string;
  href: string;
  text: string;
  order: number;
};

type SearchPayload = {
  schemaVersion: number;
  entries: SearchEntry[];
};

function SearchDialog({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(-1);
  const [index, setIndex] = useState<SearchEntry[] | null>(null);
  const [failed, setFailed] = useState(false);
  const results = useMemo(() => searchDocs(index ?? [], query) as SearchEntry[], [index, query]);
  const activeSelection = selected >= 0 && selected < results.length ? selected : results.length ? 0 : -1;

  useEffect(() => {
    window.requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/docs-search.json", { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`Search index request failed: ${response.status}`);
        return response.json() as Promise<SearchPayload>;
      })
      .then((payload) => {
        setIndex(payload.entries);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setFailed(true);
      });
    return () => controller.abort();
  }, []);

  const selectResult = (result?: SearchEntry) => {
    if (!result) return;
    onClose();
    router.push(result.href as Route);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setSelected(() => nextSearchSelection(activeSelection, event.key, results.length));
    }
    if (event.key === "Enter" && activeSelection >= 0) {
      event.preventDefault();
      selectResult(results[activeSelection]);
    }
  };

  return createPortal(
    <div className="docs-search-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="docs-search-dialog" role="dialog" aria-modal="true" aria-label="Search VenueMind documentation">
        <div className="docs-search-input">
          <MagnifyingGlass size={18} />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => {
              const nextQuery = event.target.value;
              setQuery(nextQuery);
              setSelected(searchDocs(index ?? [], nextQuery).length ? 0 : -1);
            }}
            onKeyDown={onKeyDown}
            placeholder="Search tools, concepts, workflows…"
            aria-label="Search documentation"
            aria-controls="docs-search-results"
            aria-activedescendant={activeSelection >= 0 ? `docs-search-result-${activeSelection}` : undefined}
          />
          <button type="button" onClick={onClose} aria-label="Close search"><X size={17} /></button>
        </div>
        <div id="docs-search-results" className="docs-search-results" role="listbox" aria-label="Documentation search results">
          {!query && !index && !failed && <div className="docs-search-empty">Loading documentation index</div>}
          {!query && failed && <div className="docs-search-empty">Search index unavailable</div>}
          {!query && index && <div className="docs-search-empty"><span>Search all pages and headings</span><kbd>↑↓</kbd><span>navigate</span><kbd>↵</kbd><span>open</span></div>}
          {query && index && !results.length && <div className="docs-search-empty">No matching documentation</div>}
          {results.map((result, indexValue) => (
            <button
              id={`docs-search-result-${indexValue}`}
              key={result.id}
              type="button"
              role="option"
              aria-selected={activeSelection === indexValue}
              className={activeSelection === indexValue ? "selected" : ""}
              onMouseEnter={() => setSelected(indexValue)}
              onClick={() => selectResult(result)}
            >
              <span><strong>{result.sectionTitle}</strong><small>{result.pageTitle}</small></span>
              <ArrowRight size={15} />
            </button>
          ))}
        </div>
      </section>
    </div>,
    document.body,
  );
}

export function DocsSearch() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const openFromKeyboard = (event: KeyboardEvent) => {
      const target = event.target;
      const isTyping = target instanceof HTMLElement && (target.matches("input, textarea, select") || target.isContentEditable);
      if ((event.key === "/" && !isTyping) || ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k")) {
        event.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", openFromKeyboard);
    return () => window.removeEventListener("keydown", openFromKeyboard);
  }, []);

  return (
    <div className="docs-search-controller">
      <button type="button" className="docs-search-trigger" onClick={() => setOpen(true)} aria-label="Search documentation">
        <MagnifyingGlass size={15} /><span>Search docs</span><kbd>⌘ K</kbd>
      </button>
      {open && <SearchDialog onClose={() => setOpen(false)} />}
    </div>
  );
}

export function CopyTextButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await navigator.clipboard?.writeText(text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };

  return <button type="button" onClick={copy}><Copy size={14} />{copied ? "Copied" : "Copy"}</button>;
}

export function CopyDeepLinkButton({ href, title }: { href: string; title: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await navigator.clipboard?.writeText(new URL(href, window.location.origin).href);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };

  return (
    <button type="button" onClick={copy} aria-label={`Copy link to ${title}`} title={copied ? "Copied" : "Copy deep link"}>
      {copied ? <CheckCircle size={16} weight="fill" /> : <LinkSimple size={16} />}
    </button>
  );
}
