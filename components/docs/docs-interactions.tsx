"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import { MagnifyingGlassIcon as MagnifyingGlass } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import type { SearchEntry } from "@/components/docs/docs-search-palette";
import { searchDocs } from "@/src/docs/search.ts";

type SearchPayload = {
  schemaVersion: number;
  entries: SearchEntry[];
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const decodeSearchEntry = (value: unknown): SearchEntry => {
  if (
    !isRecord(value) ||
    typeof value["id"] !== "string" ||
    typeof value["pageSlug"] !== "string" ||
    typeof value["pageTitle"] !== "string" ||
    typeof value["sectionTitle"] !== "string" ||
    typeof value["href"] !== "string" ||
    typeof value["text"] !== "string" ||
    typeof value["order"] !== "number"
  ) {
    throw new TypeError("Invalid documentation search entry");
  }
  return {
    id: value["id"],
    pageSlug: value["pageSlug"],
    pageTitle: value["pageTitle"],
    sectionTitle: value["sectionTitle"],
    href: value["href"],
    text: value["text"],
    order: value["order"],
  };
};

const decodeSearchPayload = (value: unknown): SearchPayload => {
  if (!isRecord(value) || typeof value["schemaVersion"] !== "number" || !Array.isArray(value["entries"])) {
    throw new TypeError("Invalid documentation search index");
  }
  return { schemaVersion: value["schemaVersion"], entries: value["entries"].map(decodeSearchEntry) };
};

const loadDocsSearchPalette = () =>
  import("@/components/docs/docs-search-palette").then((module) => module.DocsSearchPalette);

const LazyDocsSearchPalette = dynamic(loadDocsSearchPalette, {
  ssr: false,
  loading: () => null,
});

export function DocsSearch() {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [hasOpened, setHasOpened] = useState(false);
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState<SearchEntry[] | null>(null);
  const [failed, setFailed] = useState(false);
  const results = useMemo(() => searchDocs(index ?? [], query), [index, query]);

  useEffect(() => {
    if (!open || index || failed) return;
    const controller = new AbortController();
    fetch("/docs-search.json", { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`Search index request failed: ${response.status}`);
        return response.json();
      })
      .then((payload: unknown) => setIndex(decodeSearchPayload(payload).entries))
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setFailed(true);
      });
    return () => controller.abort();
  }, [failed, index, open]);

  const openSearch = () => {
    setQuery("");
    setFailed(false);
    setHasOpened(true);
    setOpen(true);
  };

  useEffect(() => {
    const openFromKeyboard = (event: KeyboardEvent) => {
      const target = event.target;
      const isTyping =
        target instanceof HTMLElement && (target.matches("input, textarea, select") || target.isContentEditable);
      if ((event.key === "/" && !isTyping) || ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k")) {
        event.preventDefault();
        setQuery("");
        setFailed(false);
        setHasOpened(true);
        setOpen(true);
      }
    };
    window.addEventListener("keydown", openFromKeyboard);
    return () => window.removeEventListener("keydown", openFromKeyboard);
  }, []);

  return (
    <>
      <Button
        variant="outline"
        ref={triggerRef}
        type="button"
        className="docs-search-trigger"
        aria-label="Search documentation"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={openSearch}
        onFocus={() => {
          void loadDocsSearchPalette();
        }}
        onPointerEnter={() => {
          void loadDocsSearchPalette();
        }}
      >
        <MagnifyingGlass size={15} />
        <span>Search docs</span>
        <kbd>⌘ K</kbd>
      </Button>
      {hasOpened && (
        <LazyDocsSearchPalette
          open={open}
          query={query}
          results={results}
          loading={!index && !failed}
          failed={failed}
          onOpenChange={setOpen}
          onQueryChange={setQuery}
          onSelect={() => setOpen(false)}
          onReturnFocus={() => triggerRef.current?.focus()}
        />
      )}
    </>
  );
}
