/* Generated from VenueMind canonical JSON Schemas. Do not edit. */

export interface VenueMindValidationResult {
  validationId: string;
  inputFingerprint: string;
  engineVersion: string;
  evaluatedPlanVersion: string;
  evaluatedProposalId: string | null;
  status: "pass" | "fail";
  checks: {
    id: string;
    constraintId: string;
    evaluator: string;
    label: string;
    category: string;
    severity: "error" | "warning";
    waivable: boolean;
    scope: {
      [k: string]: unknown;
    };
    status: "pass" | "warning" | "fail" | "not-applicable";
    actual: number | null;
    threshold: number | null;
    unit: string | null;
    evidence: {
      [k: string]: unknown;
    };
    remediation: string;
    waiver: VenueMindWarningWaiver | null;
  }[];
  candidateMetrics: {
    [k: string]: unknown;
  };
  candidateGeometryFingerprint: string;
  spatialEvidence: VenueMindSpatialEvidence;
  productionEvidence: {
    schemaVersion: 1;
    kind: "production-planning-result";
    planId: string;
    planVersion: string;
    geometryFingerprint: string;
    summary: {
      [k: string]: unknown;
    };
    evidenceFingerprint: string;
    [k: string]: unknown;
  };
  cateringEvidence: {
    schemaVersion: 1;
    kind: "catering-planning-result";
    planId: string;
    planVersion: string;
    geometryFingerprint: string;
    summary: {
      [k: string]: unknown;
    };
    evidenceFingerprint: string;
    [k: string]: unknown;
  };
  emergencyEvidence: {
    schemaVersion: 1;
    kind: "emergency-planning-result";
    planId: string;
    planVersion: string;
    geometryFingerprint: string;
    summary: {
      [k: string]: unknown;
    };
    degradedScenarios: {
      [k: string]: unknown;
    }[];
    evidenceFingerprint: string;
    [k: string]: unknown;
  };
  evidenceFamilyFingerprints: {
    accessibility: string;
    capacity: string;
    catering: string;
    emergency: string;
    flow: string;
    operations: string;
    production: string;
    sightlines: string;
  };
  planningEvidenceInvalidations: {
    affectedConstraintIds: string[];
    evidenceFamilies: ("capacity" | "flow" | "operations")[];
  };
  emergencyReviewRequired: boolean;
  emergencyChangedObjectIds: string[];
  authorizedEmergencyReviewerRoles: ("safety-officer" | "venue-administrator")[];
  blockingIssues: number;
  waivedWarnings: number;
  unwaivedWarnings: number;
  unresolvedIssues: number;
  inventoryAvailability: {
    id: string;
    templateId: string;
    version: string;
    requested: number;
    available: number;
    status: "available" | "warning";
    shortage: number;
  }[];
  inventoryWarnings: number;
}
export interface VenueMindWarningWaiver {
  id: string;
  constraintId: string;
  proposalId: string;
  baseVersion: string;
  validationInputFingerprint: string;
  authorId: string;
  reasonCode: "operational-acceptance" | "temporary-condition" | "equivalent-control" | "owner-approved-deviation";
  createdAt: string;
  acceptedPlanVersion?: string;
}
export interface VenueMindSpatialEvidence {
  accessibility: {
    source: "canonical-geometry";
    graphFingerprint: {
      [k: string]: unknown;
    };
    connected: boolean;
    routeObjectIds: string[];
    reachableDestinationIds: string[];
    unreachableDestinationIds: string[];
    minimumClearWidthM: number;
    turningClearanceM: number;
    accessibleSeats: number;
    companionSeats: number;
    seatingDistributed: boolean;
    accessibleSeatSampleIds: string[];
    blockedAccessibleSeatSampleIds: string[];
    accessibleSeatSightlineCoverageRatio: number;
    accessibleSeatSightlineSections: {
      [k: string]: unknown;
    }[];
    doorClearanceZones: {
      [k: string]: unknown;
    }[];
    accessibleDoorObjectIds: string[];
    minimumDoorClearWidthM: number;
    obstructedDoorObjectIds: string[];
    ramps: {
      [k: string]: unknown;
    }[];
    rampPolicy: {
      [k: string]: unknown;
    };
    nodes: {
      [k: string]: unknown;
    }[];
    edges: {
      [k: string]: unknown;
    }[];
    [k: string]: unknown;
  };
  capacity: {
    source: "canonical-geometry";
    roomAreaM2: number;
    excludedAreaM2: number;
    usableRoomAreaM2: number;
    occupancyMode: string;
    densityCapacity: number;
    sectionCapacities: {
      objectId: string;
      label: string;
      zoneId: string | null;
      capacity: number;
      minimumCapacity: number;
      maximumCapacity: number;
      status: "within-limit" | "under-target" | "over-capacity";
      deltaFromMinimum: number;
      headroom: number;
    }[];
    zoneCapacities: {
      zoneId: string;
      label: string;
      sectionObjectIds: string[];
      capacity: number;
      minimumCapacity: number;
      maximumCapacity: number;
      status: "within-limit" | "under-target" | "over-capacity";
      deltaFromMinimum: number;
      headroom: number;
    }[];
    placedCapacity: number;
    venueMaximum: number;
    nonAttendeeLoad: number;
    operationalLoad: number;
    effectiveCapacity: number;
    explanations: {
      code:
        | "SECTION_UNDER_TARGET"
        | "SECTION_OVER_CAPACITY"
        | "ZONE_UNDER_TARGET"
        | "ZONE_OVER_CAPACITY"
        | "PLAN_UNDER_TARGET"
        | "VENUE_OVER_CAPACITY"
        | "DENSITY_OVER_CAPACITY";
      scopeKind: "section" | "zone" | "plan" | "venue";
      scopeId: string;
      actual: number;
      target: number;
      delta: number;
    }[];
    changeDeltas: {
      changeId: string;
      placedCapacityDelta: number;
      effectiveCapacityDelta: number;
      operationalLoadDelta: number;
      sectionDeltas: {
        [k: string]: unknown;
      }[];
      zoneDeltas: {
        [k: string]: unknown;
      }[];
    }[];
    [k: string]: unknown;
  };
  circulation: {
    source: "canonical-geometry";
    graphFingerprint: {
      [k: string]: unknown;
    };
    connected: boolean;
    graphNodes: {
      [k: string]: unknown;
    }[];
    graphEdges: {
      [k: string]: unknown;
    }[];
    blockedRouteObjectIds: string[];
    blockingObjectIds: string[];
    exitApproachZones: {
      [k: string]: unknown;
    }[];
    obstructedExitObjectIds: string[];
    criticalRouteEdges: {
      [k: string]: unknown;
    }[];
    bottleneckLoads: {
      [k: string]: unknown;
    }[];
    bottleneckWidthM: number;
    peakCongestionIndex: number;
    shortestExitPaths: {
      [k: string]: unknown;
    }[];
    phaseProfiles: {
      [k: string]: unknown;
    }[];
    changeDeltas: {
      [k: string]: unknown;
    }[];
    [k: string]: unknown;
  };
  sightlines: {
    source: "canonical-geometry";
    evidenceFingerprint: {
      [k: string]: unknown;
    };
    focalPointId: string | null;
    sampledSeatIds: string[];
    blockedSampleIds: string[];
    coverageRatio: number;
    maximumViewingDistanceM: number;
    sectionSummaries: {
      [k: string]: unknown;
    }[];
    rays: {
      [k: string]: unknown;
    }[];
    [k: string]: unknown;
  };
}
