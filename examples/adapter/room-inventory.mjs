import { roomInventoryAdapter } from "../../src/integrations/adapters/room-inventory-adapter.js";
import { createAdapterRuntime } from "../../src/integrations/runtime.js";
import { createMemorySecretStore } from "../../src/integrations/secret-store.js";

const runtime = createAdapterRuntime();
const result = await runtime.execute(roomInventoryAdapter, "import", {
  basePlanVersion: "3.3",
  proposalRevision: 2,
  sourceSystem: "room-inventory-prod",
  sourceVersion: "inventory-42",
  stableIds: { "vendor-chair-7": "obj-import-chair-001" },
  records: [{ externalId: "vendor-chair-7", sourceVersion: "42", kind: "chair", label: "Stacking chair", capacity: 1, footprint: { kind: "rectangle", center: { x: 12, y: 8 }, width: 0.5, depth: 0.5, rotationDegrees: 0 } }],
}, {
  grantedScopes: ["inventory:read"],
  secretStore: createMemorySecretStore({ "room-inventory/api-token": "example-only" }),
  secretReferences: ["room-inventory/api-token"],
});

if (result.status !== "succeeded" || result.output.proposal.status !== "review") throw new Error("Adapter import did not create reviewable staging");
console.log(JSON.stringify({ status: result.status, batchId: result.output.id, proposal: result.output.proposal.status, requiresHumanApproval: true }, null, 2));
