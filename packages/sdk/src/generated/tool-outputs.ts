/* Generated from VenueMind canonical tool output contracts. Do not edit. */

export type VenueMindCommentAnchor =
  | {
      kind: "project";
      planId: string;
      projectId: string;
    }
  | {
      kind: "plan-version";
      planId: string;
      planVersion: string;
    }
  | {
      kind: "proposal";
      planId: string;
      proposalId: string;
    }
  | {
      kind: "change";
      planId: string;
      proposalId: string;
      changeId: string;
    }
  | {
      kind: "constraint";
      planId: string;
      constraintId: string;
    }
  | {
      kind: "coordinate";
      planId: string;
      planVersion: string;
      point: {
        x: number;
        y: number;
      };
    };
export type VenueMindConstraint = {
  id: string;
  checkId: string;
  evaluator:
    | "minimum_metric"
    | "maximum_metric"
    | "protected_objects_unchanged"
    | "accessible_route_graph"
    | "turning_clearance"
    | "accessible_seating"
    | "accessible_seating_sightlines"
    | "door_clearance"
    | "temporary_ramp"
    | "occupancy_capacity"
    | "circulation_graph"
    | "sightline_raycast"
    | "production_readiness"
    | "catering_readiness"
    | "emergency_readiness";
  label: string;
  category: string;
  severity: "error" | "warning";
  waivable: boolean;
  enabled?: boolean;
  scope: {
    kind: "plan" | "zone" | "object";
    id?: string;
  };
  parameters: {
    [k: string]: unknown;
  };
  policy?: {
    source: string;
    jurisdiction: string;
    effectiveDate: string;
  };
  remediation: string;
};
export type VenueMindActivityLedger = {
  id: string;
  schemaVersion: 1;
  sequence: number;
  type: string;
  actor: "human" | "agent" | "system";
  actorId: string;
  actorType: "human" | "agent" | "system";
  source: "studio" | "webmcp" | "mcp" | "system" | "agent-tool";
  sessionId: string;
  occurredAt: string;
  details: {
    [k: string]: unknown;
  };
  previousHash: "genesis" | string;
  hash: string;
}[];

export interface VenueMindToolOutputMap {
  "venue.list_projects": VenueMindProjectListResult;
  "venue.open_project": VenueMindProjectOpenResult;
  "venue.inspect_templates": unknown;
  "venue.get_project_brief": unknown;
  "venue.list_constraints": unknown;
  "venue.inspect_layout": VenueMindLayoutInspection;
  "venue.get_object": unknown;
  "venue.search_objects": unknown;
  "venue.preview_revision": VenueMindPreviewRevisionResult;
  "venue.preview_template_update": unknown;
  "venue.apply_edit": unknown;
  "venue.measure_objects": unknown;
  "venue.validate_layout": VenueMindValidationResult;
  "venue.get_validation_evidence": unknown;
  "venue.list_proposal_branches": unknown;
  "venue.compare_proposal_branches": unknown;
  "venue.create_proposal_branch": unknown;
  "venue.switch_proposal_branch": unknown;
  "venue.update_proposal_branch": unknown;
  "venue.duplicate_proposal_branch": unknown;
  "venue.archive_proposal_branch": unknown;
  "venue.restore_proposal_branch": unknown;
  "venue.detect_proposal_conflicts": unknown;
  "venue.rebase_proposal": unknown;
  "venue.request_adjustment": unknown;
  "venue.list_comments": unknown;
  "venue.add_comment": unknown;
  "venue.edit_comment": unknown;
  "venue.set_comment_status": unknown;
  "venue.get_change_log": VenueMindActivityLedger;
  "venue.replay_history": unknown;
  "venue.list_scenarios": unknown;
  "venue.list_scenario_runs": unknown;
  "venue.get_scenario_result": unknown;
  "venue.run_scenario": unknown;
  "venue.compare_simulations": unknown;
  "venue.export_simulation": unknown;
  "venue.inspect_live_occupancy": {
    monitor: VenueMindLiveOccupancyMonitor;
    projection: VenueMindLiveOccupancyProjection;
    receipt?: {
      [k: string]: unknown;
    };
    duplicate?: boolean;
  };
  "venue.ingest_occupancy_signal": {
    monitor: VenueMindLiveOccupancyMonitor;
    projection: VenueMindLiveOccupancyProjection;
    receipt?: {
      [k: string]: unknown;
    };
    duplicate?: boolean;
  };
  "venue.refresh_live_occupancy": {
    monitor: VenueMindLiveOccupancyMonitor;
    projection: VenueMindLiveOccupancyProjection;
    receipt?: {
      [k: string]: unknown;
    };
    duplicate?: boolean;
  };
  "venue.export_live_occupancy": {
    filename: string;
    mimeType: "application/json";
    content: string;
  };
  "venue.inspect_incidents": {
    register: VenueMindIncidentRegister;
    incidents?: VenueMindOperationalIncident[];
    incident?: VenueMindOperationalIncident;
    receipt?: {
      [k: string]: unknown;
    };
    duplicate?: boolean;
  };
  "venue.report_incident": {
    register: VenueMindIncidentRegister;
    incidents?: VenueMindOperationalIncident[];
    incident?: VenueMindOperationalIncident;
    receipt?: {
      [k: string]: unknown;
    };
    duplicate?: boolean;
  };
  "venue.export_incident_record": {
    filename: string;
    mimeType: "application/json";
    content: string;
  };
  "venue.export_audit_package": VenueMindPlanExport;
  "venue.export_plan": VenueMindPlanExport;
}
export interface VenueMindProjectListResult {
  source: string;
  projects: {
    id: string;
    name: string;
    activePlanId: string;
    schemaVersion?: number;
    planVersion: string | null;
    proposalId?: string | null;
    updatedAt?: string;
    active: boolean;
  }[];
}
export interface VenueMindProjectOpenResult {
  status: "active" | "opening";
  project: {
    id: string;
    name: string;
    activePlanId: string;
    schemaVersion?: number;
    planVersion: string | null;
    proposalId?: string | null;
    updatedAt?: string;
    active: boolean;
  };
}
export interface VenueMindLayoutInspection {
  planId: string;
  planVersion: string;
  event: {
    [k: string]: unknown;
  };
  venue: {
    [k: string]: unknown;
  };
  templateBindings: {
    [k: string]: unknown;
  };
  inventoryAvailability: {
    [k: string]: unknown;
  }[];
  occupancy: {
    [k: string]: unknown;
  };
  staffing: {
    [k: string]: unknown;
  } | null;
  productionPolicy: {
    [k: string]: unknown;
  } | null;
  cateringPolicy: {
    [k: string]: unknown;
  } | null;
  emergencyPlan: {
    [k: string]: unknown;
  } | null;
  emergencyReviews: {
    [k: string]: unknown;
  }[];
  spatial: VenueMindSpatialGeometry;
  spatialObjects: {
    id: string;
    kind: string;
    label: string;
    [k: string]: unknown;
  }[];
  lockedObjects: {
    [k: string]: unknown;
  }[];
  projectLocks: VenueMindObjectLock[];
  comments: VenueMindComment[];
  scenarios: {
    [k: string]: unknown;
  }[];
  scenarioRuns: {
    [k: string]: unknown;
  }[];
  constraints: VenueMindConstraint[];
  metrics: {
    [k: string]: unknown;
  };
  proposal: {
    id: string;
    baseVersion: string;
    revision: number;
    status: string;
    goal: string;
    changedItems: number;
    templateUpdate: {
      [k: string]: unknown;
    } | null;
  } | null;
  activeBranchId: string;
  proposalBranches: {
    id: string;
    name: string;
    strategy: string;
    proposalId: string;
  }[];
  commandReceiptCount: number;
  ledgerIntegrity: {
    [k: string]: unknown;
  };
  brief: VenueMindEventBrief;
}
export interface VenueMindSpatialGeometry {
  schemaVersion: 1;
  unit: "m";
  units: {
    length: "m";
    area: "m2";
    angle: "deg";
    time: "s";
  };
  /**
   * @minItems 7
   * @maxItems 7
   */
  layers: [unknown, unknown, unknown, unknown, unknown, unknown, unknown];
  coordinateSystem: {
    origin: "southwest";
    xAxis: "east";
    yAxis: "north";
    rotationDirection: "clockwise";
  };
  precision: {
    distance: 3;
    angle: 1;
  };
  roomBoundary: {
    /**
     * @minItems 3
     */
    outer: [
      {
        x: number;
        y: number;
      },
      {
        x: number;
        y: number;
      },
      {
        x: number;
        y: number;
      },
      ...{
        x: number;
        y: number;
      }[]
    ];
    holes: [
      {
        x: number;
        y: number;
      },
      {
        x: number;
        y: number;
      },
      {
        x: number;
        y: number;
      },
      ...{
        x: number;
        y: number;
      }[]
    ][];
  };
  fingerprint: string;
}
export interface VenueMindObjectLock {
  id: string;
  objectId: string;
  type: "position" | "rotation" | "dimension" | "deletion" | "role";
  source: "venue-template" | "project";
  reasonCode: string;
  authorId: string;
  createdAt?: string;
  expiresAt?: string | null;
  releasedAt?: string;
  releasedBy?: string;
  active: boolean;
}
export interface VenueMindComment {
  id: string;
  anchor: VenueMindCommentAnchor;
  body: string;
  mentions: string[];
  decisionRelevant: boolean;
  status: "open" | "resolved";
  authorId: string;
  authorType: "human" | "agent" | "system";
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
  editHistory: {
    body: string;
    mentions: string[];
    decisionRelevant: boolean;
    editedAt: string;
    editedBy: string;
  }[];
}
export interface VenueMindEventBrief {
  id: string;
  eventName: string;
  date: string | null;
  timezone: string;
  venueId: string | null;
  roomId: string | null;
  attendeeTarget: number;
  occupancyMode: "theater" | "classroom" | "banquet" | "standing" | "mixed" | "custom";
  schedule?: null | {
    startAt: string;
    endAt: string;
    timezone: string;
  };
  planningEffectBindings?: {
    set_attendance_target?: {
      targetRequirementId: string;
      category: "seating";
      /**
       * @minItems 1
       */
      affectedConstraintIds: [string, ...string[]];
    };
    set_event_schedule?: {
      targetRequirementId: string;
      category: "staffing";
      /**
       * @maxItems 0
       */
      affectedConstraintIds: [];
    };
  };
  requirements: {
    id: string;
    category:
      "accessibility" | "seating" | "production" | "catering" | "staffing" | "security" | "emergency" | "circulation";
    label: string;
    priority: "critical" | "high" | "medium" | "low";
    owner: string | null;
    status: "open" | "confirmed" | "satisfied" | "waived";
    measurable: boolean;
    constraintIds: string[];
    evidenceRefs: string[];
  }[];
}
export interface VenueMindPreviewRevisionResult {
  proposalId: string;
  baseVersion: string;
  revision: number;
  changedItems: number;
  requiresHumanApproval: true;
}
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
export interface VenueMindLiveOccupancyMonitor {
  schemaVersion: 1;
  id: string;
  projectId: string;
  runbookVersionId: string;
  source: {
    [k: string]: unknown;
  };
  baseline: {
    [k: string]: unknown;
  };
  policy: {
    [k: string]: unknown;
  };
  feeds: VenueMindAggregateOccupancySignal[];
  observations: {
    [k: string]: unknown;
  }[];
  activeAlerts: {
    id: string;
    key: string;
    code: "STALE_SOURCE" | "CONFLICTING_FEEDS" | "THRESHOLD_WARNING" | "CAPACITY_EXCEEDED";
    severity: "warning" | "critical";
    status: "open" | "acknowledged";
    scopeId?: string | null;
    sourceIds: string[];
    actual: number;
    threshold: number;
    unit: "seconds" | "persons";
    openedAt: string;
    acknowledgedAt?: string;
    acknowledgedBy?: string;
    reasonCode?: string;
  }[];
  receipts: {
    [k: string]: unknown;
  }[];
  ledger: {
    [k: string]: unknown;
  }[];
  revision: number;
  createdAt: string;
  updatedAt: string;
}
export interface VenueMindAggregateOccupancySignal {
  sourceId: string;
  sourceType: "registration" | "sensor" | "manual-counter";
  sourceVersion: string;
  kind: "check-in" | "zone-occupancy";
  observedAt: string;
  confidence: "low" | "medium" | "high";
  /**
   * @minItems 1
   * @maxItems 100
   */
  readings: [
    {
      scopeId: string;
      count: number;
    },
    ...{
      scopeId: string;
      count: number;
    }[]
  ];
}
export interface VenueMindLiveOccupancyProjection {
  monitorId: string;
  runbookVersionId: string;
  evaluatedAt: string;
  overallStatus: "unavailable" | "nominal" | "warning" | "exceeded" | "conflicting" | "stale";
  sources: {
    sourceId: string;
    sourceType: "registration" | "sensor" | "manual-counter";
    sourceVersion: string;
    kind: "check-in" | "zone-occupancy";
    observedAt: string;
    confidence: "low" | "medium" | "high";
    ageSeconds: number;
    status: "fresh" | "aging" | "stale";
  }[];
  scopes: {
    scopeId: string;
    kind: "check-in" | "venue" | "zone";
    label: string;
    target: number;
    capacity: number;
    status: "unavailable" | "nominal" | "warning" | "exceeded" | "conflicting" | "stale";
    count: number | null;
    utilization: number | null;
    confidence: "low" | "medium" | "high";
    sourceIds: string[];
    freshness: "missing" | "fresh" | "aging" | "stale";
    expectedPeak: number | null;
    simulationDelta: number | null;
  }[];
  alerts: {
    [k: string]: unknown;
  }[];
  privacy: {
    mode: "aggregate-only";
    personRecordsStored: false;
    individualEventsStored: false;
  };
}
export interface VenueMindIncidentRegister {
  schemaVersion: 1;
  id: string;
  projectId: string;
  runbookVersionId: string;
  source: {
    [k: string]: unknown;
  };
  baseline: {
    fingerprint: string;
    [k: string]: unknown;
  };
  incidents: VenueMindOperationalIncident[];
  transitions: {
    [k: string]: unknown;
  }[];
  receipts: {
    [k: string]: unknown;
  }[];
  ledger: {
    [k: string]: unknown;
  }[];
  revision: number;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
}
export interface VenueMindOperationalIncident {
  schemaVersion: 1;
  id: string;
  revision: number;
  severity: "low" | "medium" | "high" | "critical";
  category:
    | "accessibility"
    | "crowd-capacity"
    | "medical"
    | "security"
    | "fire-life-safety"
    | "facilities"
    | "production-av"
    | "catering"
    | "staffing"
    | "transport"
    | "weather"
    | "other";
  summaryCode: string;
  status: "open" | "mitigating" | "resolved" | "closed";
  acknowledgement: {
    [k: string]: unknown;
  };
  escalation: {
    [k: string]: unknown;
  };
  location: VenueMindIncidentLocationContext;
  owner: {
    [k: string]: unknown;
  } | null;
  /**
   * @maxItems 50
   */
  relatedRefs: {
    [k: string]: unknown;
  }[];
  handoffs: {
    [k: string]: unknown;
  }[];
  emergencyActions: {
    [k: string]: unknown;
  }[];
  timestamps: {
    [k: string]: unknown;
  };
}
export interface VenueMindIncidentLocationContext {
  kind: "plan-object" | "coordinate";
  planId: string;
  planVersion: string;
  planFingerprint: string;
  planObjectId?: string;
  point?: {
    x: number;
    y: number;
  };
}
export interface VenueMindPlanExport {
  format:
    | "json"
    | "text"
    | "svg"
    | "pdf"
    | "pdf-emergency"
    | "csv"
    | "csv-objects"
    | "csv-inventory"
    | "csv-staffing"
    | "svg-post-map"
    | "csv-production"
    | "svg-production"
    | "csv-catering-stations"
    | "csv-replenishment"
    | "audit";
  filename: string;
  mimeType: string;
  encoding: "utf8" | "base64";
  content: string;
}
