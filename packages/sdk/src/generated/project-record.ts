/* Generated from VenueMind canonical JSON Schemas. Do not edit. */

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
export type VenueMindPlanningEffect =
  | {
      operation: "set_attendance_target";
      targetBriefId: string;
      targetRequirementId: string;
      requirement: {
        id: string;
        category:
          | "accessibility"
          | "seating"
          | "production"
          | "catering"
          | "staffing"
          | "security"
          | "emergency"
          | "circulation";
        label: string;
        priority: "critical" | "high" | "medium" | "low";
        owner: string | null;
        status: "open" | "confirmed" | "satisfied" | "waived";
        measurable: boolean;
        constraintIds: string[];
        evidenceRefs: string[];
      };
      source: {
        adapterId: string;
        sourceSystem: string;
        entityType: string;
        externalId: string;
        sourceVersion: string;
        checksum: string;
        synchronizedAt: string;
      };
      before: number;
      after: number;
      /**
       * @minItems 1
       */
      affectedConstraintIds: [string, ...string[]];
      /**
       * @minItems 2
       * @maxItems 2
       */
      evidenceFamilies: never[];
    }
  | {
      operation: "set_event_schedule";
      targetBriefId: string;
      targetRequirementId: string;
      requirement: {
        id: string;
        category:
          | "accessibility"
          | "seating"
          | "production"
          | "catering"
          | "staffing"
          | "security"
          | "emergency"
          | "circulation";
        label: string;
        priority: "critical" | "high" | "medium" | "low";
        owner: string | null;
        status: "open" | "confirmed" | "satisfied" | "waived";
        measurable: boolean;
        constraintIds: string[];
        evidenceRefs: string[];
      };
      source: {
        adapterId: string;
        sourceSystem: string;
        entityType: string;
        externalId: string;
        sourceVersion: string;
        checksum: string;
        synchronizedAt: string;
      };
      before: null | {
        startAt: string;
        endAt: string;
        timezone: string;
      };
      after: {
        startAt: string;
        endAt: string;
        timezone: string;
      };
      /**
       * @maxItems 0
       */
      affectedConstraintIds: [];
      /**
       * @minItems 1
       * @maxItems 1
       */
      evidenceFamilies: never[];
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
export type VenueMindScenario = {
  schemaVersion: 1;
  model: "operations" | "ingress-egress" | "queue";
  id: string;
  name: string;
  seed: number;
  horizonSeconds: number;
  sampleCount: number;
  /**
   * @minItems 1
   */
  phases: [
    {
      id: string;
      label: string;
      startSecond: number;
      endSecond: number;
      demandShare: number;
    },
    ...{
      id: string;
      label: string;
      startSecond: number;
      endSecond: number;
      demandShare: number;
    }[]
  ];
  inputs: {
    population: number;
    arrivalRatePerMinute: number;
    serviceRatePerMinute: number;
    servers: number;
    mobilityFactor: number;
  };
  ingressEgress?: {
    mode?: "normal" | "emergency";
    curves?: {
      /**
       * @minItems 2
       */
      arrival?: [
        {
          second: number;
          cumulativeShare: number;
        },
        {
          second: number;
          cumulativeShare: number;
        },
        ...{
          second: number;
          cumulativeShare: number;
        }[]
      ];
      /**
       * @minItems 2
       */
      departure?: [
        {
          second: number;
          cumulativeShare: number;
        },
        {
          second: number;
          cumulativeShare: number;
        },
        ...{
          second: number;
          cumulativeShare: number;
        }[]
      ];
    };
    /**
     * @minItems 1
     */
    mobilityProfiles?: [
      {
        id: string;
        label?: string;
        share: number;
        speedFactor?: number;
        accessibleRouteRequired?: boolean;
      },
      ...{
        id: string;
        label?: string;
        share: number;
        speedFactor?: number;
        accessibleRouteRequired?: boolean;
      }[]
    ];
    assumptions?: {
      normal?: {
        responseDelaySeconds?: number;
        flowFactor?: number;
        elevatorsAvailable?: boolean;
      };
      emergency?: {
        responseDelaySeconds?: number;
        flowFactor?: number;
        elevatorsAvailable?: boolean;
      };
    };
  };
  queue?: {
    category?:
      "registration" | "security" | "cloakroom" | "food" | "beverage" | "restroom" | "merchandise" | "transport";
    arrivalRatePerMinute?: number;
    serviceRatePerServerMinute?: number;
    servers?: number;
    abandonment?: {
      enabled?: boolean;
      meanPatienceSeconds?: number;
    };
    priorityLanes?: {
      id: string;
      label?: string;
      arrivalShare?: number;
      servers?: number;
      serviceRatePerServerMinute?: number;
    }[];
    queueObjectId?: string | null;
    bufferAreaM2?: number;
    personAreaM2?: number;
  };
  confidence: {
    method: "seeded-percentile-sampling";
    level: number;
    uncertaintyDrivers: string[];
  };
};

export interface VenueMindProjectRecord {
  id: string;
  organizationId: string;
  name: string;
  activePlanId: string;
  schemaVersion: 10;
  snapshot: VenueMindPlannerSnapshot;
  createdAt: string;
  updatedAt: string;
  revision: number;
  archivedAt?: string | null;
  deletedAt?: string | null;
  recoveryUntil?: string | null;
  pinned?: boolean;
  lastOpenedAt?: string | null;
  provenance?: {
    sourceFormat: "venuemind-project";
    formatVersion: 1;
    packageId: string;
    payloadSha256: string;
    exportedAt: string;
    importedAt: string;
    originalProjectId: string;
    source: {
      [k: string]: unknown;
    };
  };
}
export interface VenueMindPlannerSnapshot {
  plan: {
    id: string;
    version: string;
    event: {
      [k: string]: unknown;
    };
    venue: {
      [k: string]: unknown;
    };
    occupancy?: {
      venueMaximum: number;
      staff: number;
      performers: number;
      vendors: number;
      densityM2PerAttendee?: number;
      sections: {
        objectId: string;
        zoneId: string | null;
        minimumCapacity: number;
        maximumCapacity: number;
      }[];
      zones: {
        id: string;
        label: string;
        /**
         * @minItems 1
         */
        sectionObjectIds: [string, ...string[]];
        minimumCapacity: number;
        maximumCapacity: number;
      }[];
    };
    staffing?: {
      [k: string]: unknown;
    };
    productionPolicy?: {
      [k: string]: unknown;
    };
    cateringPolicy?: {
      [k: string]: unknown;
    };
    emergencyPlan?: {
      [k: string]: unknown;
    };
    emergencyReviews?: {
      id: string;
      proposalId: string;
      basePlanVersion: string;
      acceptedPlanVersion: string;
      validationInputFingerprint: string;
      emergencyEvidenceFingerprint: string;
      /**
       * @minItems 1
       */
      changedObjectIds: [string, ...string[]];
      reviewerId: string;
      reviewerRole: "safety-officer" | "venue-administrator";
      assumptionsAccepted: true;
      assumptions: string[];
      note: string;
      reviewedAt: string;
    }[];
    spatial: VenueMindSpatialGeometry;
    objects: {
      id: string;
      kind:
        | "stage"
        | "screen"
        | "projector"
        | "speaker"
        | "camera"
        | "cable_route"
        | "backstage_zone"
        | "fire_exit"
        | "assembly_point"
        | "emergency_access_lane"
        | "fire_equipment"
        | "first_aid"
        | "command_post"
        | "entrance"
        | "column"
        | "table"
        | "chair"
        | "av_desk"
        | "refreshment"
        | "bar"
        | "buffet"
        | "kitchen"
        | "prep_zone"
        | "waste_point"
        | "water_point"
        | "barrier"
        | "signage"
        | "queue"
        | "staff_post"
        | "checkpoint"
        | "stairs"
        | "elevator"
        | "utility_point"
        | "rigging_point"
        | "accessible_entrance"
        | "seating_section"
        | "accessible_restroom"
        | "accessible_route"
        | "door"
        | "corridor"
        | "aisle"
        | "service_lane"
        | "restricted_zone"
        | "temporary_ramp";
      label: string;
      layer: "architecture" | "furniture" | "access" | "production" | "catering" | "safety" | "annotations";
      elevationM: number;
      footprint:
        | {
            kind: "rectangle";
            center: {
              x: number;
              y: number;
            };
            width: number;
            depth: number;
            rotationDegrees: number;
          }
        | {
            kind: "circle";
            center: {
              x: number;
              y: number;
            };
            radius: number;
          }
        | {
            kind: "line";
            start: {
              x: number;
              y: number;
            };
            end: {
              x: number;
              y: number;
            };
            width: number;
          }
        | {
            kind: "polygon";
            /**
             * @minItems 3
             */
            points: [
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
            rotationDegrees: number;
          };
      locked: boolean;
      locks: VenueMindObjectLock[];
      door?: {
        clearWidthM: number;
        swing: "inward" | "outward" | "sliding" | "revolving";
        accessible: boolean;
        clearance?: {
          side: "left" | "right" | "both";
          depthM: number;
          latchSideM: number;
        };
      };
      exit?: {
        clearWidthM: number;
        emergency: boolean;
        capacityPersons: number;
      };
      route?: {
        direction: "one-way" | "bidirectional";
        accessible: boolean;
        purpose: string;
        staffOnly?: boolean;
      };
      restriction?: {
        access: "prohibited" | "staff-only" | "conditional";
        reasonCode: string;
        blocksPlacement: boolean;
      };
      ramp?: {
        riseM: number;
        runM: number;
        clearWidthM: number;
        landingLengthM: number;
        edgeProtectionHeightM: number;
        handrails: boolean;
      };
      placement?: {
        collisionMode: "solid";
      };
      circulation?: {
        blocksPath?: boolean;
        blocksExitApproach?: boolean;
        role?: "queue" | "checkpoint";
        demandPersons?: number;
        capacityPersons?: number;
        capacityPersonsPerMinute?: number;
        clearWidthM?: number;
        carCapacityPersons?: number;
        cycleSeconds?: number;
        servesZoneIds?: string[];
      };
      queue?: {
        category:
          "registration" | "security" | "cloakroom" | "food" | "beverage" | "restroom" | "merchandise" | "transport";
        servers: number;
        serviceRatePerServerMinute: number;
        priorityLaneCount: number;
      };
      staffPost?: {
        coverageZoneObjectIds: string[];
        /**
         * @minItems 1
         */
        assignments: [
          {
            shiftId: string;
            roleId: string;
            count: number;
          },
          ...{
            shiftId: string;
            roleId: string;
            count: number;
          }[]
        ];
      };
      utility?: {
        type: "power";
        circuitId: string;
        rating?: string;
        voltage: number;
        maxWatts: number;
        powerKw?: number;
      };
      rigging?: {
        safeWorkingLoadKg: number;
      };
      productionZone?: {
        access: "crew-only" | "performer-only" | "mixed";
      };
      production?: {
        equipmentType:
          | "screen"
          | "projector"
          | "speaker"
          | "camera"
          | "control-desk"
          | "cable-route"
          | "power-distribution"
          | "rigged-equipment";
        targetObjectId?: string;
        targetObjectIds?: string[];
        targetZoneObjectIds?: string[];
        sourceObjectId?: string;
        circuitId?: string;
        riggingPointId?: string;
        viewableWidthM?: number;
        viewableHeightM?: number;
        throwRatioMin?: number;
        throwRatioMax?: number;
        powerWatts?: number;
        weightKg?: number;
        requiresRigging?: boolean;
        aimPoint?: {
          x: number;
          y: number;
        };
        coverageRangeM?: number;
        coverageAngleDegrees?: number;
        minimumDistanceM?: number;
        maximumDistanceM?: number;
        cableType?: string;
        crossingTreatment?: "none" | "overhead" | "cable-ramp" | "floor-channel";
      };
      catering?: {
        type:
          | "bar"
          | "buffet"
          | "service-counter"
          | "kitchen"
          | "prep"
          | "waste"
          | "water"
          | "queue-zone"
          | "replenishment-route";
        servers?: number;
        serviceRatePerServerMinute?: number;
        demandShare?: number;
        queueZoneObjectId?: string;
        queueBufferPersons?: number;
        accessibleServicePoint?: boolean;
        serviceHeightM?: number;
        dietaryOptions?: string[];
        allergenLabels?: string[];
        replenishmentSourceObjectId?: string;
        waterSourceObjectId?: string;
        sourceObjectId?: string;
        /**
         * @minItems 1
         */
        targetObjectIds?: [string, ...string[]];
        crossingControl?: string;
      };
      emergency?: {
        type: "assembly-point" | "emergency-access-lane" | "fire-equipment" | "first-aid" | "command-post";
        capacityPersons?: number;
        /**
         * @minItems 1
         */
        designatedExitObjectIds?: [string, ...string[]];
        responderOnly?: boolean;
        equipmentClass?: string;
        coverageRadiusM?: number;
        clearanceM?: number;
        accessible?: boolean;
        powerSourceCircuitId?: string;
        backupPowerMinutes?: number;
      };
      templateRef?: {
        kind: "venue-template" | "room-template" | "inventory-item-template";
        templateId: string;
        templateObjectId?: string;
        version: string;
      };
      resourceBinding?: {
        schemaVersion: 1;
        resourceId: string;
        kind: "inventory" | "av" | "power" | "catering" | "staffing";
        quantity: number;
      };
      templateOverrides?: string[];
      inventoryCount?: number;
      [k: string]: unknown;
    }[];
    constraints: VenueMindConstraint[];
    waivers?: VenueMindWarningWaiver[];
    metrics: {
      [k: string]: unknown;
    };
    [k: string]: unknown;
  };
  brief: VenueMindEventBrief;
  proposal: {
    changes: {
      planningEffects?: VenueMindPlanningEffect[];
      [k: string]: unknown;
    }[];
    waivers: VenueMindWarningWaiver[];
    [k: string]: unknown;
  };
  activeBranchId: string;
  /**
   * @minItems 1
   */
  branches: [
    {
      proposal: {
        changes: {
          planningEffects?: VenueMindPlanningEffect[];
          [k: string]: unknown;
        }[];
        waivers: VenueMindWarningWaiver[];
        [k: string]: unknown;
      };
      revisions?: {
        changes: {
          planningEffects?: VenueMindPlanningEffect[];
          [k: string]: unknown;
        }[];
        waivers: VenueMindWarningWaiver[];
        [k: string]: unknown;
      }[];
      [k: string]: unknown;
    },
    ...{
      proposal: {
        changes: {
          planningEffects?: VenueMindPlanningEffect[];
          [k: string]: unknown;
        }[];
        waivers: VenueMindWarningWaiver[];
        [k: string]: unknown;
      };
      revisions?: {
        changes: {
          planningEffects?: VenueMindPlanningEffect[];
          [k: string]: unknown;
        }[];
        waivers: VenueMindWarningWaiver[];
        [k: string]: unknown;
      }[];
      [k: string]: unknown;
    }[]
  ];
  ledger: VenueMindActivityLedger;
  receipts: VenueMindCommandReceipt[];
  projectLocks: VenueMindObjectLock[];
  editHistory?: {
    undo: {
      [k: string]: unknown;
    }[];
    redo: {
      [k: string]: unknown;
    }[];
  };
  comments?: VenueMindComment[];
  scenarios: VenueMindScenario[];
  scenarioRuns: {
    id: string;
    scenarioId: string;
    scenarioFingerprint?: string | null;
    scenarioSnapshot?: VenueMindScenario;
    model?: "operations" | "ingress-egress" | "queue";
    branchId: string;
    planId?: string;
    planVersion?: string;
    geometryFingerprint?: string;
    inputFingerprint: string;
    engineVersion: string;
    status: "queued" | "running" | "completed" | "cancelled" | "failed";
    progress: number;
    completedPhaseIds?: string[];
    partialResult?: VenueMindSimulationResult | null;
    result?: VenueMindSimulationResult | null;
    startedAt?: string;
    completedAt?: string | null;
    cancellationReason?: string | null;
    cacheHit?: boolean;
  }[];
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
export interface VenueMindCommandReceipt {
  id: string;
  idempotencyKey: string;
  commandType: string;
  inputFingerprint: string;
  correlationId: string;
  actor: "human" | "agent" | "system";
  resultIds: {
    [k: string]: string;
  };
  occurredAt: string;
  /**
   * Stored original result used to answer exact retries.
   */
  result?: {
    [k: string]: unknown;
  };
  error?: {
    code: string;
    message: string;
    remediation: string;
    details: {
      [k: string]: unknown;
    };
  };
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
export interface VenueMindSimulationResult {
  schemaVersion: 1;
  kind: "simulation-result";
  model: "operations" | "ingress-egress" | "queue";
  engineVersion: string;
  inputFingerprint: string;
  scenarioFingerprint: string;
  scenarioId: string;
  planId: string;
  planVersion: string;
  geometryFingerprint: string;
  branchId?: string | null;
  seed: number;
  horizonSeconds: number;
  sampleCount: number;
  completedSamples?: number;
  confidence: {
    [k: string]: unknown;
  };
  phases: {
    [k: string]: unknown;
  }[];
  summary: {
    [k: string]: unknown;
  };
  infrastructure?: {
    entrances: {
      [k: string]: unknown;
    }[];
    exits: {
      [k: string]: unknown;
    }[];
    checkpoints: {
      [k: string]: unknown;
    }[];
    doors: {
      [k: string]: unknown;
    }[];
    stairs: {
      [k: string]: unknown;
    }[];
    elevators: {
      [k: string]: unknown;
    }[];
    corridors: {
      [k: string]: unknown;
    }[];
    sections: {
      [k: string]: unknown;
    }[];
    graphFingerprint: string;
    fingerprint: string;
  };
  ingress?: {
    [k: string]: unknown;
  };
  egress?: {
    [k: string]: unknown;
  };
  assumptions?: {
    normal: {
      [k: string]: unknown;
    };
    emergency: {
      [k: string]: unknown;
    };
  };
  assumptionComparison?: {
    [k: string]: unknown;
  };
  densityFrames?: {
    id: string;
    second: number;
    progress: number;
    cells: {
      id: string;
      objectId: string;
      kind: "zone" | "route";
      point: {
        x: number;
        y: number;
      };
      occupancyPersons: number;
      densityPersonsPerM2: number;
      level: "low" | "medium" | "high" | "critical";
    }[];
    peakDensityPersonsPerM2: number;
  }[];
  queue?: {
    [k: string]: unknown;
  };
  lanes?: {
    [k: string]: unknown;
  }[];
  timeline?: {
    [k: string]: unknown;
  }[];
  spill?: {
    [k: string]: unknown;
  };
  suggestion?: {
    [k: string]: unknown;
  };
  evidenceFingerprint?: string;
}
