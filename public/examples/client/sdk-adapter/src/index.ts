import {
  ADAPTER_CONTRACT_VERSION,
  collectAdapterPages,
  createSyncCursor,
  createVenueAdapter,
  defineAdapter,
} from "@venuemind/sdk/adapter";

interface InventoryImportInput {
  basePlanVersion: string;
  proposalRevision: number;
  pages: Array<{ items: Array<{ id: string }>; nextCursor: string | null; sourceVersion: string }>;
}

const definition = defineAdapter({
  contractVersion: ADAPTER_CONTRACT_VERSION,
  id: "example-inventory",
  displayName: "Example inventory",
  version: "1.0.0",
  capabilities: ["import"],
  scopes: { import: ["inventory:read"] },
  retryPolicy: { maxAttempts: 2, initialDelayMs: 1, maximumDelayMs: 1, multiplier: 1 },
  rateLimit: { requests: 100, windowMs: 1_000 },
});

export const exampleInventoryAdapter = createVenueAdapter(definition, {
  async import(rawInput, context) {
    const input = rawInput as InventoryImportInput;
    const collected = await collectAdapterPages({
      fetchPage: ({ pageIndex }) => input.pages[pageIndex] ?? { items: [], nextCursor: null, sourceVersion: "fixture-v1" },
      maxPages: 10,
      maxItems: 100,
    });
    return {
      sourceSystem: "example-inventory",
      sourceVersion: collected.sourceVersion,
      synchronizedAt: context.clock(),
      syncCursor: await createSyncCursor(definition, {
        opaque: `complete-${collected.sourceVersion}`,
        sourceVersion: collected.sourceVersion,
      }),
      changes: [],
      mappings: [],
      sourceRecords: [],
      warnings: collected.items.length === 0 ? [] : [{ code: "EXAMPLE_RECORDS_IGNORED", count: collected.items.length }],
    };
  },
});

export const exampleAuthorization = Object.freeze({ grantedScopes: ["inventory:read"] });
