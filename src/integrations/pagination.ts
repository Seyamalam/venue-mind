import { AdapterContractError } from "./contracts.ts";

const clone = <Value>(value: Value): Value => structuredClone(value);

const fail = (code: string, message: string, details: Readonly<Record<string, unknown>> = {}): never => {
  throw new AdapterContractError(code, message, details);
};

const assertBound = (value: unknown, label: string, maximum: number): number => {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > maximum)
    return fail("ADAPTER_PAGINATION_INVALID", `${label} must be an integer from 1 to ${maximum}`);
  return value;
};

const assertCursor = (value: unknown, label: string): string | null => {
  if (value === null) return null;
  if (typeof value === "string" && value.length > 0) return value;
  return fail("ADAPTER_PAGINATION_INVALID", `${label} must be null or a non-empty opaque string`);
};

const assertNotAborted = (signal: AbortSignal | undefined): void => {
  if (signal?.aborted) fail("ADAPTER_PAGINATION_ABORTED", "Adapter pagination was aborted");
};

interface AdapterPage<Item> {
  readonly items: Item[];
  readonly nextCursor: string | null;
  readonly sourceVersion: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const normalizePage = <Item>(value: AdapterPage<Item>, pageIndex: number): AdapterPage<Item> => {
  if (!isRecord(value)) return fail("ADAPTER_PAGINATION_INVALID", "Adapter page must be an object", { pageIndex });
  const unknown = Object.keys(value).filter((key) => !["items", "nextCursor", "sourceVersion"].includes(key));
  if (unknown.length) {
    fail("ADAPTER_PAGINATION_INVALID", "Adapter page contains unknown fields", {
      pageIndex,
      fieldCount: unknown.length,
    });
  }
  if (!Array.isArray(value["items"]))
    return fail("ADAPTER_PAGINATION_INVALID", "Adapter page items must be an array", { pageIndex });
  const nextCursor = assertCursor(value["nextCursor"], "Adapter page nextCursor");
  if (typeof value["sourceVersion"] !== "string" || value["sourceVersion"].length === 0)
    return fail("ADAPTER_PAGINATION_INVALID", "Adapter page sourceVersion must be a non-empty string", { pageIndex });
  return { items: clone(value.items), nextCursor, sourceVersion: value["sourceVersion"] };
};

export interface CollectAdapterPagesOptions<Item> {
  readonly fetchPage: (
    context: Readonly<{ cursor: string | null; pageIndex: number; signal: AbortSignal | undefined }>,
  ) => Promise<AdapterPage<Item>> | AdapterPage<Item>;
  readonly initialCursor?: string | null;
  readonly maxPages?: number;
  readonly maxItems?: number;
  readonly signal?: AbortSignal;
}

export interface CollectedAdapterPages<Item> {
  readonly items: Item[];
  readonly nextCursor: null;
  readonly sourceVersion: string;
  readonly pageCount: number;
}

export async function collectAdapterPages<Item = object>({
  fetchPage,
  initialCursor = null,
  maxPages = 100,
  maxItems = 10_000,
  signal,
}: CollectAdapterPagesOptions<Item>): Promise<Readonly<CollectedAdapterPages<Item>>> {
  let cursor = assertCursor(initialCursor, "Adapter initialCursor");
  const pageLimit = assertBound(maxPages, "Adapter maxPages", 1_000);
  const itemLimit = assertBound(maxItems, "Adapter maxItems", 1_000_000);
  const seenCursors = new Set(cursor === null ? [] : [cursor]);
  const items: Item[] = [];
  let sourceVersion: string | null = null;

  for (let pageIndex = 0; pageIndex < pageLimit; pageIndex += 1) {
    assertNotAborted(signal);
    const page = normalizePage<Item>(await fetchPage({ cursor, pageIndex, signal }), pageIndex);
    assertNotAborted(signal);
    if (sourceVersion !== null && page.sourceVersion !== sourceVersion) {
      fail("ADAPTER_PAGINATION_VERSION_DRIFT", "Adapter sourceVersion changed during pagination", { pageIndex });
    }
    sourceVersion ??= page.sourceVersion;
    if (items.length + page.items.length > itemLimit) {
      fail("ADAPTER_PAGINATION_ITEM_LIMIT", "Adapter pagination exceeded maxItems", {
        pageIndex,
        maxItems: itemLimit,
        attemptedItems: items.length + page.items.length,
      });
    }
    items.push(...page.items);
    if (page.nextCursor === null) {
      return Object.freeze({
        items: clone(items),
        nextCursor: null,
        sourceVersion,
        pageCount: pageIndex + 1,
      });
    }
    if (seenCursors.has(page.nextCursor)) {
      fail("ADAPTER_PAGINATION_CURSOR_LOOP", "Adapter pagination repeated an opaque cursor", { pageIndex });
    }
    seenCursors.add(page.nextCursor);
    cursor = page.nextCursor;
  }

  return fail("ADAPTER_PAGINATION_PAGE_LIMIT", "Adapter pagination exceeded maxPages", { maxPages: pageLimit });
}
