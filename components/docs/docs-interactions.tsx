"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import {
  ArrowRight,
  CheckCircle,
  Copy,
  LinkSimple,
  MagnifyingGlass,
} from "@phosphor-icons/react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Command,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { searchDocs } from "@/src/docs/search.js";

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

export function DocsSearch() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState<SearchEntry[] | null>(null);
  const [failed, setFailed] = useState(false);
  const results = useMemo(() => searchDocs(index ?? [], query) as SearchEntry[], [index, query]);

  useEffect(() => {
    if (!open || index || failed) return;
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
  }, [failed, index, open]);

  useEffect(() => {
    const openFromKeyboard = (event: KeyboardEvent) => {
      const target = event.target;
      const isTyping = target instanceof HTMLElement && (target.matches("input, textarea, select") || target.isContentEditable);
      if ((event.key === "/" && !isTyping) || ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k")) {
        event.preventDefault();
        setQuery("");
        setFailed(false);
        setOpen(true);
      }
    };
    window.addEventListener("keydown", openFromKeyboard);
    return () => window.removeEventListener("keydown", openFromKeyboard);
  }, []);

  const updateOpen = (nextOpen: boolean) => {
    if (nextOpen) {
      setQuery("");
      setFailed(false);
    }
    setOpen(nextOpen);
  };

  const selectResult = (result?: SearchEntry) => {
    if (!result) return;
    setOpen(false);
    router.push(result.href as Route);
  };

  return (
    <Dialog open={open} onOpenChange={updateOpen}>
      <DialogTrigger asChild>
        <button type="button" className="docs-search-trigger" aria-label="Search documentation">
        <MagnifyingGlass size={15} /><span>Search docs</span><kbd>⌘ K</kbd>
        </button>
      </DialogTrigger>
      <DialogContent className="docs-search-dialog" showCloseButton>
        <DialogHeader className="sr-only">
          <DialogTitle>Search VenueMind documentation</DialogTitle>
          <DialogDescription>Search tools, concepts, and workflows.</DialogDescription>
        </DialogHeader>
        <Command className="docs-search-command" shouldFilter={false} loop>
          <CommandInput
            className="docs-search-input"
            value={query}
            onValueChange={setQuery}
            placeholder="Search tools, concepts, workflows…"
            aria-label="Search documentation"
          />
          <CommandList id="docs-search-results" className="docs-search-results" aria-label="Documentation search results">
            {!query && !index && !failed && <div className="docs-search-empty">Loading documentation index</div>}
            {!query && failed && <div className="docs-search-empty">Search index unavailable</div>}
            {!query && index && <div className="docs-search-empty"><span>Search all pages and headings</span><kbd>↑↓</kbd><span>navigate</span><kbd>↵</kbd><span>open</span></div>}
            {query && index && !results.length && <div className="docs-search-empty">No matching documentation</div>}
            {results.map((result) => (
              <CommandItem
                key={result.id}
                value={result.id}
                className="docs-search-result"
                onSelect={() => selectResult(result)}
              >
                <span><strong>{result.sectionTitle}</strong><small>{result.pageTitle}</small></span>
                <ArrowRight size={15} />
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
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
