import assert from "node:assert/strict";
import test from "node:test";
import { AdapterContractError } from "../src/integrations/contracts.ts";
import { collectAdapterPages } from "../src/integrations/pagination.ts";

test("collectAdapterPages returns one deterministic aggregate after every page succeeds", async () => {
  const calls = [];
  const source = new Map([
    [null, { items: [{ id: "a" }, { id: "b" }], nextCursor: "page-2", sourceVersion: "inventory-42" }],
    ["page-2", { items: [{ id: "c" }], nextCursor: null, sourceVersion: "inventory-42" }],
  ]);
  const result = await collectAdapterPages({
    fetchPage: async (context) => {
      calls.push(context);
      return source.get(context.cursor);
    },
  });

  assert.deepEqual(result, { items: [{ id: "a" }, { id: "b" }, { id: "c" }], nextCursor: null, sourceVersion: "inventory-42", pageCount: 2 });
  assert.deepEqual(calls.map(({ cursor, pageIndex }) => ({ cursor, pageIndex })), [{ cursor: null, pageIndex: 0 }, { cursor: "page-2", pageIndex: 1 }]);
  assert.equal(Object.isFrozen(result), true);
});

test("collectAdapterPages rejects cursor loops without requesting the repeated page", async () => {
  let calls = 0;
  await assert.rejects(() => collectAdapterPages({
    initialCursor: "page-1",
    fetchPage: async () => {
      calls += 1;
      return { items: [], nextCursor: "page-1", sourceVersion: "1" };
    },
  }), (error) => error instanceof AdapterContractError && error.code === "ADAPTER_PAGINATION_CURSOR_LOOP" && !JSON.stringify(error.details).includes("page-1"));
  assert.equal(calls, 1);
});

test("collectAdapterPages rejects source-version drift and page or item overflow", async () => {
  await assert.rejects(() => collectAdapterPages({
    fetchPage: async ({ pageIndex }) => pageIndex === 0
      ? { items: [1], nextCursor: "next", sourceVersion: "1" }
      : { items: [2], nextCursor: null, sourceVersion: "2" },
  }), (error) => error.code === "ADAPTER_PAGINATION_VERSION_DRIFT" && error.details.pageIndex === 1 && !JSON.stringify(error.details).includes("sourceVersion"));

  await assert.rejects(() => collectAdapterPages({
    maxItems: 2,
    fetchPage: async () => ({ items: [1, 2, 3], nextCursor: null, sourceVersion: "1" }),
  }), (error) => error.code === "ADAPTER_PAGINATION_ITEM_LIMIT" && error.details.attemptedItems === 3);

  let pageCalls = 0;
  await assert.rejects(() => collectAdapterPages({
    maxPages: 2,
    fetchPage: async () => ({ items: [], nextCursor: `cursor-${++pageCalls}`, sourceVersion: "1" }),
  }), (error) => error.code === "ADAPTER_PAGINATION_PAGE_LIMIT" && error.details.maxPages === 2);
  assert.equal(pageCalls, 2);
});

test("collectAdapterPages checks abort before and after each awaited page", async () => {
  const before = new AbortController();
  before.abort();
  let calls = 0;
  await assert.rejects(() => collectAdapterPages({
    signal: before.signal,
    fetchPage: async () => { calls += 1; },
  }), (error) => error.code === "ADAPTER_PAGINATION_ABORTED");
  assert.equal(calls, 0);

  const during = new AbortController();
  await assert.rejects(() => collectAdapterPages({
    signal: during.signal,
    fetchPage: async () => {
      during.abort();
      return { items: [{ id: "must-not-return" }], nextCursor: null, sourceVersion: "1" };
    },
  }), (error) => error.code === "ADAPTER_PAGINATION_ABORTED");
});

test("collectAdapterPages enforces an exact bounded page contract", async () => {
  for (const page of [
    null,
    { items: [], nextCursor: null, sourceVersion: "1", untrusted: true },
    { items: {}, nextCursor: null, sourceVersion: "1" },
    { items: [], nextCursor: "", sourceVersion: "1" },
    { items: [], nextCursor: null, sourceVersion: "" },
  ]) {
    await assert.rejects(() => collectAdapterPages({ fetchPage: async () => page }), (error) => error.code === "ADAPTER_PAGINATION_INVALID");
  }
  await assert.rejects(() => collectAdapterPages({ maxPages: 0, fetchPage: async () => ({}) }), (error) => error.code === "ADAPTER_PAGINATION_INVALID");
  await assert.rejects(() => collectAdapterPages({ maxItems: 1_000_001, fetchPage: async () => ({}) }), (error) => error.code === "ADAPTER_PAGINATION_INVALID");
});
