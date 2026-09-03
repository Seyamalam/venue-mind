import {
  createAdapterRuntime,
  createVenueAdapter,
  type AdapterCapabilityContract,
  type AdapterHandlerContext,
  type AdapterRuntimeResult,
  type NormalizedAdapterExport,
  type NormalizedWebhookEvent,
} from "./adapter.js";

type InventoryAdapterContracts = Readonly<{
  export: AdapterCapabilityContract<
    Readonly<{ format: "csv" | "json" }>,
    Readonly<NormalizedAdapterExport<readonly string[]>>,
    Readonly<{ sourceSystem: string; mediaType: string; sourceVersion: string; data: readonly string[] }>
  >;
  webhook: AdapterCapabilityContract<
    Readonly<{ eventId: string; quantity: number }>,
    Readonly<NormalizedWebhookEvent<Readonly<{ quantity: number }>>>,
    Readonly<{
      sourceSystem: string;
      eventId: string;
      eventType: string;
      occurredAt: string;
      sourceVersion: string;
      payload: Readonly<{ quantity: number }>;
    }>
  >;
}>;

const definition = {
  contractVersion: 1,
  id: "type-test-inventory",
  displayName: "Type test inventory",
  version: "1.0.0",
  capabilities: ["export", "webhook"],
  scopes: { export: [], webhook: [] },
} as const;

const adapter = createVenueAdapter<InventoryAdapterContracts>(definition, {
  export(input) {
    input.format.toUpperCase();
    return {
      sourceSystem: "type-test",
      mediaType: input.format === "csv" ? "text/csv" : "application/json",
      sourceVersion: "1",
      data: [input.format],
    };
  },
  webhook(input, _context: AdapterHandlerContext) {
    input.quantity.toFixed();
    return {
      sourceSystem: "type-test",
      eventId: input.eventId,
      eventType: "inventory.updated",
      occurredAt: "2026-09-03T00:00:00.000Z",
      sourceVersion: "1",
      payload: { quantity: input.quantity },
    };
  },
});

const runtime = createAdapterRuntime();
const handlerContext: AdapterHandlerContext = {
  invocationId: "type-test",
  attempt: 1,
  clock: () => "2026-09-03T00:00:00.000Z",
  secrets: { get: () => Promise.resolve("type-test") },
};

export const compileTimeContractChecks = async (): Promise<void> => {
  const _exported: AdapterRuntimeResult<InventoryAdapterContracts["export"]["output"]> = await runtime.execute(
    adapter,
    "export",
    { format: "csv" },
  );
  const _webhook: AdapterRuntimeResult<InventoryAdapterContracts["webhook"]["output"]> = await runtime.execute(
    adapter,
    "webhook",
    { eventId: "evt-1", quantity: 2 },
  );
  // @ts-expect-error webhook inputs cannot be supplied to the export capability.
  await runtime.execute(adapter, "export", { eventId: "evt-1", quantity: 2 });
  // @ts-expect-error export inputs cannot be supplied to the webhook capability.
  await adapter.invoke("webhook", { format: "json" }, handlerContext);
};
