import { AdapterContractError } from "./contracts.js";

const clone = (value) => structuredClone(value);

const fail = (code, message, details = {}) => {
  throw new AdapterContractError(code, message, details);
};

const assertBound = (value, label, maximum) => {
  if (!Number.isInteger(value) || value < 1 || value > maximum) {
    fail("ADAPTER_PAGINATION_INVALID", `${label} must be an integer from 1 to ${maximum}`);
  }
  return value;
};

const assertCursor = (value, label) => {
  if (value !== null && (typeof value !== "string" || value.length === 0)) {
    fail("ADAPTER_PAGINATION_INVALID", `${label} must be null or a non-empty opaque string`);
  }
  return value;
};

const assertNotAborted = (signal) => {
  if (signal?.aborted) fail("ADAPTER_PAGINATION_ABORTED", "Adapter pagination was aborted");
};

const normalizePage = (value, pageIndex) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("ADAPTER_PAGINATION_INVALID", "Adapter page must be an object", { pageIndex });
  }
  const unknown = Object.keys(value).filter((key) => !["items", "nextCursor", "sourceVersion"].includes(key));
  if (unknown.length) {
    fail("ADAPTER_PAGINATION_INVALID", "Adapter page contains unknown fields", { pageIndex, fieldCount: unknown.length });
  }
  if (!Array.isArray(value.items)) fail("ADAPTER_PAGINATION_INVALID", "Adapter page items must be an array", { pageIndex });
  const nextCursor = assertCursor(value.nextCursor, "Adapter page nextCursor");
  if (typeof value.sourceVersion !== "string" || value.sourceVersion.length === 0) {
    fail("ADAPTER_PAGINATION_INVALID", "Adapter page sourceVersion must be a non-empty string", { pageIndex });
  }
  return { items: clone(value.items), nextCursor, sourceVersion: value.sourceVersion };
};

export async function collectAdapterPages({
  fetchPage,
  initialCursor = null,
  maxPages = 100,
  maxItems = 10_000,
  signal,
} = {}) {
  if (typeof fetchPage !== "function") fail("ADAPTER_PAGINATION_INVALID", "Adapter pagination requires a fetchPage function");
  let cursor = assertCursor(initialCursor, "Adapter initialCursor");
  const pageLimit = assertBound(maxPages, "Adapter maxPages", 1_000);
  const itemLimit = assertBound(maxItems, "Adapter maxItems", 1_000_000);
  const seenCursors = new Set(cursor === null ? [] : [cursor]);
  const items = [];
  let sourceVersion = null;

  for (let pageIndex = 0; pageIndex < pageLimit; pageIndex += 1) {
    assertNotAborted(signal);
    const page = normalizePage(await fetchPage({ cursor, pageIndex, signal }), pageIndex);
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

  fail("ADAPTER_PAGINATION_PAGE_LIMIT", "Adapter pagination exceeded maxPages", { maxPages: pageLimit });
}
