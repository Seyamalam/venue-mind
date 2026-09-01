"use client";

import { useRouter } from "next/navigation";
import type { Route } from "next";
import { ArrowRight } from "@phosphor-icons/react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Command,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";

export type SearchEntry = {
  id: string;
  pageSlug: string;
  pageTitle: string;
  sectionTitle: string;
  href: string;
  text: string;
  order: number;
};

type DocsSearchPaletteProps = {
  open: boolean;
  query: string;
  results: SearchEntry[];
  loading: boolean;
  failed: boolean;
  onOpenChange: (open: boolean) => void;
  onQueryChange: (query: string) => void;
  onSelect: () => void;
  onReturnFocus: () => void;
};

export function DocsSearchPalette({
  open,
  query,
  results,
  loading,
  failed,
  onOpenChange,
  onQueryChange,
  onSelect,
  onReturnFocus,
}: DocsSearchPaletteProps) {
  const router = useRouter();

  const selectResult = (result: SearchEntry) => {
    onSelect();
    router.push(result.href as Route);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="docs-search-dialog"
        showCloseButton
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          onReturnFocus();
        }}
      >
        <DialogHeader className="sr-only">
          <DialogTitle>Search VenueMind documentation</DialogTitle>
          <DialogDescription>Search tools, concepts, and workflows.</DialogDescription>
        </DialogHeader>
        <Command className="docs-search-command" shouldFilter={false} loop>
          <CommandInput
            className="docs-search-input"
            value={query}
            onValueChange={onQueryChange}
            placeholder="Search tools, concepts, workflows…"
            aria-label="Search documentation"
          />
          <CommandList id="docs-search-results" className="docs-search-results" aria-label="Documentation search results">
            {!query && loading && <div className="docs-search-empty">Loading documentation index</div>}
            {!query && failed && <div className="docs-search-empty">Search index unavailable</div>}
            {!query && !loading && !failed && <div className="docs-search-empty"><span>Search all pages and headings</span><kbd>↑↓</kbd><span>navigate</span><kbd>↵</kbd><span>open</span></div>}
            {query && !loading && !results.length && <div className="docs-search-empty">No matching documentation</div>}
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
