import assert from "node:assert/strict";
import test from "node:test";
import { createVenueToolService } from "../src/tools/venue-tool-service.js";

const project = Object.freeze({
  id: "project-main",
  name: "Main",
  activePlanId: "plan-main",
  planVersion: "3.3",
  active: true,
});

const createService = (projectOperations) => createVenueToolService({
  executeCommand: async () => {
    throw new Error("project tools must not delegate to the command bus");
  },
  projectOperations,
});

test("project tools normalize host-specific results to one canonical SDK contract", async () => {
  const summaryHost = createService({
    listProjects: async () => [project],
    openProject: async () => project,
  });
  const wrappedHost = createService({
    listProjects: async () => ({ source: "repository", projects: [project] }),
    openProject: async () => ({ status: "active", project }),
  });

  const [summaryList, wrappedList, summaryOpen, wrappedOpen] = await Promise.all([
    summaryHost.execute("venue.list_projects"),
    wrappedHost.execute("venue.list_projects"),
    summaryHost.execute("venue.open_project", { projectId: project.id }),
    wrappedHost.execute("venue.open_project", { projectId: project.id }),
  ]);

  assert.deepEqual(summaryList, { source: "repository", projects: [project] });
  assert.deepEqual(wrappedList, summaryList);
  assert.deepEqual(summaryOpen, { status: "active", project });
  assert.deepEqual(wrappedOpen, summaryOpen);
});
