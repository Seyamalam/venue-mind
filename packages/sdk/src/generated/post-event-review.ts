/* Generated from VenueMind canonical JSON Schemas. Do not edit. */

export interface VenueMindPostEventReview {
  schemaVersion: 1;
  id: string;
  projectId: string;
  runbookVersionId: string;
  source: {
    planId: string;
    planVersion: string | number;
    planFingerprint: string;
    runbookFingerprint: string;
    runbookLedgerHeadHash: string;
    occupancyMonitorFingerprint: string;
    occupancyProjectionFingerprint: string;
    occupancyLedgerHeadHash: string;
    incidentRegisterFingerprint: string;
    incidentLedgerHeadHash: string;
    deviationRegisterFingerprint: string;
    deviationLedgerHeadHash: string;
    scenarioRunFingerprints: {
      [k: string]: string;
    };
  };
  baseline: {
    runbook: {
      [k: string]: unknown;
    };
    occupancyMonitor: VenueMindLiveOccupancyMonitor;
    occupancyProjection: VenueMindLiveOccupancyProjection;
    incidentRegister: VenueMindIncidentRegister;
    deviationRegister: VenueMindLivePlanDeviationRegister;
    scenarioRuns: {
      [k: string]: unknown;
    }[];
    fingerprint: string;
  };
  /**
   * @minItems 1
   * @maxItems 100
   */
  predictions: [
    {
      key: string;
      family: "occupancy" | "queue" | "flow" | "incidents";
      metric:
        | "peak-persons"
        | "utilization-ratio"
        | "average-wait-seconds"
        | "p95-wait-seconds"
        | "maximum-queue-persons"
        | "abandonment-ratio"
        | "clearance-seconds"
        | "peak-congestion-index"
        | "backlog-persons"
        | "incident-count"
        | "resolution-seconds";
      scope: {
        kind: "venue" | "occupancy-zone" | "queue" | "route" | "incident-category";
        id: string;
      };
      value: number;
      unit: "persons" | "ratio" | "seconds" | "index" | "incidents";
      betterWhen: "lower" | "higher" | "target";
      tolerance: {
        absolute: number;
        relative: number;
      };
      /**
       * @minItems 1
       * @maxItems 50
       */
      evidenceRefs: [
        {
          kind:
            | "accepted-plan"
            | "runbook"
            | "occupancy-monitor"
            | "occupancy-projection"
            | "incident-register"
            | "deviation-register"
            | "scenario-run";
          id: string;
          fingerprint: string;
        },
        ...{
          kind:
            | "accepted-plan"
            | "runbook"
            | "occupancy-monitor"
            | "occupancy-projection"
            | "incident-register"
            | "deviation-register"
            | "scenario-run";
          id: string;
          fingerprint: string;
        }[]
      ];
    },
    ...{
      key: string;
      family: "occupancy" | "queue" | "flow" | "incidents";
      metric:
        | "peak-persons"
        | "utilization-ratio"
        | "average-wait-seconds"
        | "p95-wait-seconds"
        | "maximum-queue-persons"
        | "abandonment-ratio"
        | "clearance-seconds"
        | "peak-congestion-index"
        | "backlog-persons"
        | "incident-count"
        | "resolution-seconds";
      scope: {
        kind: "venue" | "occupancy-zone" | "queue" | "route" | "incident-category";
        id: string;
      };
      value: number;
      unit: "persons" | "ratio" | "seconds" | "index" | "incidents";
      betterWhen: "lower" | "higher" | "target";
      tolerance: {
        absolute: number;
        relative: number;
      };
      /**
       * @minItems 1
       * @maxItems 50
       */
      evidenceRefs: [
        {
          kind:
            | "accepted-plan"
            | "runbook"
            | "occupancy-monitor"
            | "occupancy-projection"
            | "incident-register"
            | "deviation-register"
            | "scenario-run";
          id: string;
          fingerprint: string;
        },
        ...{
          kind:
            | "accepted-plan"
            | "runbook"
            | "occupancy-monitor"
            | "occupancy-projection"
            | "incident-register"
            | "deviation-register"
            | "scenario-run";
          id: string;
          fingerprint: string;
        }[]
      ];
    }[]
  ];
  /**
   * @maxItems 100
   */
  observations: {
    schemaVersion: 1;
    id: string;
    predictionKey: string;
    family: "occupancy" | "queue" | "flow" | "incidents";
    metric:
      | "peak-persons"
      | "utilization-ratio"
      | "average-wait-seconds"
      | "p95-wait-seconds"
      | "maximum-queue-persons"
      | "abandonment-ratio"
      | "clearance-seconds"
      | "peak-congestion-index"
      | "backlog-persons"
      | "incident-count"
      | "resolution-seconds";
    scope: {
      kind: "venue" | "occupancy-zone" | "queue" | "route" | "incident-category";
      id: string;
    };
    value: number | null;
    unit: "persons" | "ratio" | "seconds" | "index" | "incidents";
    confidence: "measured" | "estimated" | "unavailable";
    /**
     * @minItems 1
     * @maxItems 50
     */
    evidenceRefs: [
      {
        kind:
          | "accepted-plan"
          | "runbook"
          | "occupancy-monitor"
          | "occupancy-projection"
          | "incident-register"
          | "deviation-register"
          | "scenario-run";
        id: string;
        fingerprint: string;
      },
      ...{
        kind:
          | "accepted-plan"
          | "runbook"
          | "occupancy-monitor"
          | "occupancy-projection"
          | "incident-register"
          | "deviation-register"
          | "scenario-run";
        id: string;
        fingerprint: string;
      }[]
    ];
    recorded: {
      actorType: "human" | "agent" | "system";
      actorId: string;
      source: "studio" | "webmcp" | "mcp" | "system" | "agent-tool";
      sessionId: string;
      occurredAt: string;
    };
  }[];
  /**
   * @maxItems 100
   */
  lessons: {
    schemaVersion: 1;
    id: string;
    comparisonKey: string;
    family: "occupancy" | "queue" | "flow" | "incidents";
    lessonCode: string;
    findingCode: string;
    recommendedActionCode: string;
    /**
     * @maxItems 100
     */
    requirementIds: string[];
    /**
     * @maxItems 100
     */
    constraintIds: string[];
    recorded: {
      actorType: "human" | "agent" | "system";
      actorId: string;
      source: "studio" | "webmcp" | "mcp" | "system" | "agent-tool";
      sessionId: string;
      occurredAt: string;
    };
  }[];
  /**
   * @maxItems 100
   */
  templateProposals: {
    schemaVersion: 1;
    id: string;
    revision: number;
    status: "pending-human-review" | "approved-recommendation" | "rejected";
    target: {
      kind: "venue" | "room";
      templateId: string;
      version: string;
    };
    proposal: {
      id: string;
      baseVersion: string;
      revision: number;
      status: "review";
      goal: string;
      /**
       * @minItems 1
       * @maxItems 100
       */
      changes: [
        {
          id: string;
          title?: string;
          shortTitle?: string;
          label?: string;
          /**
           * @maxItems 100
           */
          targetObjectIds?: string[];
          /**
           * @maxItems 100
           */
          targetRequirementIds?: string[];
          effects: {
            [k: string]:
              | string
              | number
              | boolean
              | {
                  kind: string;
                  sourceId: string;
                  sourceChecksum: string;
                };
          };
        },
        ...{
          id: string;
          title?: string;
          shortTitle?: string;
          label?: string;
          /**
           * @maxItems 100
           */
          targetObjectIds?: string[];
          /**
           * @maxItems 100
           */
          targetRequirementIds?: string[];
          effects: {
            [k: string]:
              | string
              | number
              | boolean
              | {
                  kind: string;
                  sourceId: string;
                  sourceChecksum: string;
                };
          };
        }[]
      ];
      waivers: {
        [k: string]: unknown;
      }[];
      validation: {
        [k: string]: unknown;
      } | null;
      lineage: {
        [k: string]: unknown;
      }[];
    };
    /**
     * @minItems 1
     */
    traces: [
      {
        changeId: string;
        /**
         * @minItems 1
         */
        lessonIds: [string, ...string[]];
        /**
         * @minItems 1
         */
        comparisonKeys: [string, ...string[]];
        /**
         * @minItems 1
         */
        observationIds: [string, ...string[]];
      },
      ...{
        changeId: string;
        /**
         * @minItems 1
         */
        lessonIds: [string, ...string[]];
        /**
         * @minItems 1
         */
        comparisonKeys: [string, ...string[]];
        /**
         * @minItems 1
         */
        observationIds: [string, ...string[]];
      }[]
    ];
    created: {
      actorType: "human" | "agent" | "system";
      actorId: string;
      source: "studio" | "webmcp" | "mcp" | "system" | "agent-tool";
      sessionId: string;
      occurredAt: string;
    };
    review: {
      actorType: "human" | "agent" | "system";
      actorId: string;
      source: "studio" | "webmcp" | "mcp" | "system" | "agent-tool";
      sessionId: string;
      occurredAt: string;
      decision: "approved" | "rejected";
      reasonCode: string;
    } | null;
    publicationStatus: "not-published";
  }[];
  transitions: {
    [k: string]: unknown;
  }[];
  receipts: {
    id: string;
    idempotencyKey: string;
    inputFingerprint: string;
    operation: "record-observation" | "record-lesson" | "create-template-proposal" | "review-template-proposal";
    subjectId: string;
    aggregateRevision: number;
    ledgerSequence: number;
    acceptedAt: string;
  }[];
  ledger: {
    [k: string]: unknown;
  }[];
  revision: number;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
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
export interface VenueMindLivePlanDeviationRegister {
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
  deviations: VenueMindLivePlanDeviation[];
  recommendations: {
    [k: string]: unknown;
  }[];
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
export interface VenueMindLivePlanDeviation {
  schemaVersion: 1;
  id: string;
  sequence: number;
  revision: number;
  runbookVersionId: string;
  disposition: "temporary" | "revision-candidate";
  status: "active" | "ended";
  reasonCode: string;
  location: {
    [k: string]: unknown;
  };
  /**
   * @minItems 1
   */
  affectedObjectIds: [string, ...string[]];
  change: {
    id: string;
    number?: number;
    title?: string;
    shortTitle?: string;
    label?: string;
    editor?: {
      [k: string]: unknown;
    };
    metrics?: [string, string][];
    /**
     * @minItems 1
     * @maxItems 100
     */
    targetObjectIds: [string, ...string[]];
    /**
     * @maxItems 100
     */
    targetRequirementIds?: string[];
    effects?: {
      [k: string]: unknown;
    };
    planningEffects?: {
      [k: string]: unknown;
    }[];
    /**
     * @minItems 1
     * @maxItems 100
     */
    spatialEffects: [
      {
        [k: string]: unknown;
      },
      ...{
        [k: string]: unknown;
      }[]
    ];
    semantic?: {
      [k: string]: unknown;
    };
    lineage?: {
      [k: string]: unknown;
    };
    templateUpdate?: {
      [k: string]: unknown;
    };
  };
  objectLineage: {
    [k: string]: unknown;
  }[];
  validation: {
    [k: string]: unknown;
  };
  authored: {
    [k: string]: unknown;
  };
  ended: {
    [k: string]: unknown;
  } | null;
}
