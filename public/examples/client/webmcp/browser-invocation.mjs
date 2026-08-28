import { createVenuePlanner } from "../../src/domain/venue-planner.js";
import { summitForwardPlan } from "../../src/domain/summit-forward.js";
import { registerVenueTools } from "../../src/webmcp/register-venue-tools.js";

export function createBrowserToolHarness() {
  const tools = new Map();
  return Object.freeze({
    modelContext: {
      async registerTool(definition, { signal } = {}) {
        if (signal?.aborted) throw new DOMException("Registration aborted", "AbortError");
        tools.set(definition.name, definition);
        signal?.addEventListener("abort", () => tools.delete(definition.name), { once: true });
      },
    },
    names: () => [...tools.keys()],
    async invoke(name, input = {}, { signal } = {}) {
      const tool = tools.get(name);
      if (!tool) throw new Error(`WebMCP tool is not registered: ${name}`);
      return tool.execute(input, { signal });
    },
  });
}

export async function runBrowserExample() {
  const planner = createVenuePlanner(summitForwardPlan);
  const harness = createBrowserToolHarness();
  const controller = new AbortController();
  await registerVenueTools(harness.modelContext, planner, controller.signal);

  const inspection = await harness.invoke("venue.inspect_layout");
  const previewInput = {
    goal: "Protect the west accessible route",
    idempotencyKey: "browser-example-preview-001",
    correlationId: "browser-example-001",
  };
  const preview = await harness.invoke("venue.preview_revision", previewInput);
  const retry = await harness.invoke("venue.preview_revision", previewInput);
  const validation = await harness.invoke("venue.validate_layout");
  const exported = await harness.invoke("venue.export_plan", { format: "text" });

  const registeredBeforeAbort = harness.names().length;
  controller.abort();
  return { registeredBeforeAbort, registeredAfterAbort: harness.names().length, inspection, preview, retry, validation, exported };
}
