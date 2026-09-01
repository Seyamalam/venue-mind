/* Generated from VenueMind canonical JSON Schemas. Do not edit. */

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
