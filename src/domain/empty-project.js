import { legacyConstraintsToRegistry } from "./constraint-engine.js";

const safeId = (value) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "untitled";

export function createEmptyVenuePlan({ projectId, name = "Untitled event" }) {
  const projectToken = safeId(projectId);
  return {
    id: `plan-${projectToken}`,
    version: "1.0",
    event: {
      id: `event-${projectToken}`,
      name,
      program: "Planning workspace",
      attendeeTarget: 0,
      date: null,
    },
    brief: {
      id: `brief-${projectToken}`,
      eventName: name,
      date: null,
      timezone: "UTC",
      venueId: `venue-${projectToken}`,
      roomId: `room-${projectToken}`,
      attendeeTarget: 0,
      occupancyMode: "custom",
      requirements: [],
    },
    venue: {
      id: `venue-${projectToken}`,
      name: "Untitled venue",
      room: "Main room",
    },
    spatial: {
      schemaVersion: 1,
      unit: "m",
      units: { length: "m", area: "m2", angle: "deg", time: "s" },
      layers: ["architecture", "furniture", "access", "production", "catering", "safety", "annotations"],
      coordinateSystem: { origin: "southwest", xAxis: "east", yAxis: "north", rotationDirection: "clockwise" },
      precision: { distance: 3, angle: 1 },
      roomBoundary: {
        outer: [{ x: 0, y: 0 }, { x: 24, y: 0 }, { x: 24, y: 16 }, { x: 0, y: 16 }],
        holes: [],
      },
    },
    objects: [],
    constraints: legacyConstraintsToRegistry({
      accessibleRouteMinWidthFt: 6,
      attendeeCapacityMin: 0,
      sightlineCoverageMin: 0,
      peakCongestionMax: 80,
      protectedObjectIds: [],
    }),
    metrics: {
      accessibleRouteWidthFt: 6,
      attendeeCapacity: 0,
      sightlineCoverage: 1,
      peakCongestionIndex: 0,
      serviceLaneWidthFt: 0,
      queueBufferSqFt: 0,
      eastRouteClear: true,
    },
    proposal: {
      id: `proposal-${projectToken}-1`,
      revision: 1,
      goal: "",
      changes: [],
    },
  };
}
