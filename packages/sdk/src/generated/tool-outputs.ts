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
export type VenueMindCommentAnchor1 =
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

export interface VenueMindToolOutputMap {
  "venue.list_projects": VenueMindProjectListResult;
  "venue.open_project": VenueMindProjectOpenResult;
  "venue.inspect_templates": VenueMindVenueTemplateCatalog;
  "venue.get_project_brief": VenueMindEventBrief;
  "venue.list_constraints": {
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
    evaluation: {
      status: "pass" | "warning" | "fail" | "not-applicable";
      actual: number | null;
      threshold: number | null;
      unit: string | null;
      waiver: VenueMindWarningWaiver | null;
    } | null;
  }[];
  "venue.inspect_layout": VenueMindLayoutInspection;
  "venue.get_object": {
    scope: "accepted" | "proposal";
    planId: string;
    planVersion: string;
    proposalId: string | null;
    object: {
      id: string;
      kind: string;
      label?: string;
      layer?: "architecture" | "furniture" | "access" | "production" | "catering" | "safety" | "annotations";
      elevationM?: number;
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
      capacity?: number;
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
      resourceBinding?: {
        schemaVersion: 1;
        resourceId: string;
        kind: "inventory" | "av" | "power" | "catering" | "staffing";
        quantity: number;
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
      entrance?: {
        clearWidthM?: number;
        accessible?: boolean;
      };
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
      locks?: VenueMindObjectLock[];
      locked?: boolean;
      occupancy?: {
        expected?: number;
        maximum?: number;
        minimumCapacity?: number;
        maximumCapacity?: number;
        zoneId?: string | null;
        excludesUsableArea?: boolean;
      };
      accessibility?: {
        accessible?: boolean;
        destination?: boolean;
        accessibleSeats?: number;
        companionSeats?: number;
        accessibleSeatSampleIds?: string[];
        clearanceExempt?: boolean;
      };
      sightline?: {
        focalPoints?: {
          id: string;
          point: {
            x: number;
            y: number;
          };
          elevationM: number;
          priority?: "primary" | "secondary";
        }[];
        samples?: {
          id: string;
          point: {
            x: number;
            y: number;
          };
          eyeHeightM: number;
        }[];
        opacity?: number;
        heightM?: number;
      };
      templateRef?: {
        kind: "venue-template" | "room-template" | "inventory-item-template";
        templateId: string;
        templateObjectId?: string;
        version: string;
      };
      templateOverrides?: string[];
      inventoryCount?: number;
      groupId?: string | null;
      specification?: {
        dimensions?: {
          [k: string]: number;
        };
        weightKg?: number;
        power?: {
          watts: number;
          connector: string;
        };
        capacity?: number;
        cost?: {
          amount: number;
          currency?: string;
          basis?: string;
        };
      };
      effectiveLocks: VenueMindObjectLock[];
    };
  };
  "venue.search_objects": {
    scope: "accepted" | "proposal";
    planId: string;
    planVersion: string;
    proposalId: string | null;
    total: number;
    limit: number;
    truncated: boolean;
    objects: {
      id: string;
      label?: string;
      kind: string;
      layer?: "architecture" | "furniture" | "access" | "production" | "catering" | "safety" | "annotations";
      elevationM?: number;
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
      lockIds: string[];
    }[];
  };
  "venue.preview_revision": {
    proposalId: string;
    baseVersion: string;
    revision: number;
    changedItems: number;
    requiresHumanApproval: true;
    receipt: {
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
    };
  };
  "venue.preview_template_update": {
    proposalId: string;
    branchId: string;
    baseVersion: string;
    templateId: string;
    fromVersion: string;
    toVersion: string;
    changedItems: number;
    preservedOverrides: {
      projectObjectId: string;
      templateObjectId: string;
      path: string;
    }[];
    requiresHumanApproval: true;
    receipt: {
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
    };
  };
  "venue.apply_edit": {
    status: "review";
    proposalId: string;
    changeId: string;
    operation:
      | "apply-layout"
      | "move"
      | "rotate"
      | "resize"
      | "delete"
      | "group"
      | "ungroup"
      | "edit-zone-vertices"
      | "align"
      | "distribute"
      | "duplicate"
      | "paste"
      | "place"
      | "create-zone";
    changedItems: number;
    requiresHumanApproval: true;
    receipt: {
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
    };
  };
  "venue.measure_objects": {
    /**
     * @minItems 1
     */
    objectIds: [string, ...string[]];
    centers: {
      objectId: string;
      point: {
        x: number;
        y: number;
      };
    }[];
    distances: {
      fromObjectId: string;
      toObjectId: string;
      distanceM: number;
    }[];
  };
  "venue.validate_layout": VenueMindValidationResult;
  "venue.get_validation_evidence": {
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
    candidateMetrics?: {
      [k: string]: unknown;
    };
    candidateGeometryFingerprint: string;
    spatialEvidence?: VenueMindSpatialEvidence;
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
    emergencyReviewRequired?: boolean;
    emergencyChangedObjectIds?: string[];
    authorizedEmergencyReviewerRoles?: ("safety-officer" | "venue-administrator")[];
    blockingIssues?: number;
    waivedWarnings?: number;
    unwaivedWarnings?: number;
    unresolvedIssues: number;
    inventoryAvailability?: {
      id: string;
      templateId: string;
      version: string;
      requested: number;
      available: number;
      status: "available" | "warning";
      shortage: number;
    }[];
    inventoryWarnings?: number;
    evidenceFingerprint: string;
  };
  "venue.list_proposal_branches": {
    id: string;
    name: string;
    notes: string;
    strategy: string;
    active: boolean;
    archived: boolean;
    decisionStatus: string | null;
    revisionCount: number;
    revisions: {
      proposalId: string;
      revision: number;
      status: string;
      current: boolean;
    }[];
    proposalId: string;
    baseVersion: string;
    status: string;
    changedItems: number;
    validationStatus: "pass" | "fail";
    unresolvedIssues: number;
    stale: boolean;
    conflicts: number;
    blockingConflicts: number;
    metrics: {
      capacity?: number;
      accessibility?: number;
      sightlines?: number;
      circulation?: number;
    };
  }[];
  "venue.compare_proposal_branches": VenueMindProposalBranchComparison;
  "venue.create_proposal_branch": {
    branchId: string;
    proposalId: string;
    strategy: string;
    changedItems: number;
    receipt: {
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
    };
  };
  "venue.switch_proposal_branch": {
    branchId: string;
    proposalId: string;
    status: string;
    receipt: {
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
    };
  };
  "venue.update_proposal_branch": {
    status: "updated";
    branchId: string;
    name: string;
    notes: string;
    receipt: {
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
    };
  };
  "venue.duplicate_proposal_branch": {
    status: "duplicated";
    branchId: string;
    proposalId: string;
    sourceBranchId: string;
    sourceProposalId: string;
    receipt: {
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
    };
  };
  "venue.archive_proposal_branch": {
    status: "archived";
    branchId: string;
    activeBranchId?: string;
    receipt: {
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
    };
  };
  "venue.restore_proposal_branch": {
    status: "restored";
    branchId: string;
    receipt: {
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
    };
  };
  "venue.detect_proposal_conflicts": VenueMindProposalConflicts;
  "venue.rebase_proposal": {
    status: "current" | "rebased";
    branchId: string;
    proposalId: string;
    baseVersion?: string;
    fromVersion?: string;
    toVersion?: string;
    changedItems?: number;
    validationStatus?: "pass" | "fail";
    validationId?: string;
    receipt: {
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
    };
  };
  "venue.request_adjustment": {
    proposalId: string;
    revision: number;
    status: string;
    receipt: {
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
    };
  };
  "venue.list_comments": VenueMindComment[];
  "venue.add_comment": {
    status: "open";
    commentId: string;
    anchor: VenueMindCommentAnchor1;
    receipt: {
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
    };
  };
  "venue.edit_comment": {
    status: "noop" | "edited";
    commentId: string;
    editNumber?: number;
    receipt: {
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
    };
  };
  "venue.set_comment_status": {
    status: "noop" | "open" | "resolved";
    commentId: string;
    receipt: {
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
    };
  };
  "venue.get_change_log": VenueMindActivityLedger;
  "venue.replay_history": {
    status: "pass" | "fail";
    transitions: {
      ledgerEntryId: string;
      type: string;
      planVersion: string;
      planFingerprint: string;
      briefFingerprint: string | null;
    }[];
    currentPlanVersion: string;
    replayedFingerprint: string | null;
    currentFingerprint: string;
    replayedBriefFingerprint: string | null;
    currentBriefFingerprint: string | null;
    briefTransitions: {
      ledgerEntryId: string;
    }[];
    ledgerHeadHash: string | null;
    lockedObjectViolations: {
      objectId: string;
      fromLedgerEntryId: string;
      toLedgerEntryId: string;
      fromPlanVersion: string;
      toPlanVersion: string;
      type: string;
      lockTypes: string[];
    }[];
    truthFingerprintViolations: {
      ledgerEntryId: string;
      truth: "plan" | "brief";
      declared: string | null;
      actual: string;
    }[];
  };
  "venue.list_scenarios": VenueMindScenario[];
  "venue.list_scenario_runs": {
    id: string;
    scenarioId: string;
    scenarioFingerprint: string;
    scenarioSnapshot: VenueMindScenario;
    model: "operations" | "ingress-egress" | "queue";
    branchId: string;
    planId: string;
    planVersion: string;
    geometryFingerprint?: string;
    inputFingerprint: string;
    engineVersion: string;
    status: "queued" | "running" | "completed" | "cancelled" | "failed";
    progress: number;
    completedPhaseIds: string[];
    partialResult: VenueMindSimulationResult | null;
    result: VenueMindSimulationResult | null;
    startedAt: string;
    completedAt: string | null;
    cancellationReason: string | null;
    cacheHit?: boolean;
  }[];
  "venue.get_scenario_result": {
    id: string;
    scenarioId: string;
    scenarioFingerprint: string;
    scenarioSnapshot?: VenueMindScenario;
    model: "operations" | "ingress-egress" | "queue";
    branchId: string;
    planId: string;
    planVersion: string;
    geometryFingerprint?: string;
    inputFingerprint: string;
    engineVersion: string;
    status: "queued" | "running" | "completed" | "cancelled" | "failed";
    progress: number;
    completedPhaseIds: string[];
    partialResult?: VenueMindSimulationResult | null;
    result: VenueMindSimulationResult | null;
    startedAt: string;
    completedAt: string | null;
    cancellationReason: string | null;
    cacheHit: boolean;
  };
  "venue.run_scenario": {
    status: "completed" | "cancelled";
    runId: string;
    scenarioId: string;
    branchId: string;
    inputFingerprint: string;
    cacheHit: boolean;
    result?: VenueMindSimulationResult;
    partialResult?: VenueMindSimulationResult;
    reason?: string;
    receipt: {
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
    };
  };
  "venue.compare_simulations": {
    id: string;
    scenarioId: string;
    engineVersion: string;
    left: {
      inputFingerprint: string;
      branchId: string | null;
      planVersion: string;
    };
    right: {
      inputFingerprint: string;
      branchId: string | null;
      planVersion: string;
    };
    deltas: {
      meanProcessedPersons: number;
      maximumP95BacklogPersons: number;
      maximumP95Utilization: number;
      totalClearanceSeconds?: number;
      p95ClearanceSeconds?: number;
      worstBottleneckDurationSeconds?: number;
      affectedOccupancyPersons?: number;
      accessibleRouteClearanceSeconds?: number;
      averageWaitSeconds?: number;
      p95WaitSeconds?: number;
      maximumQueueLength?: number;
      abandonmentRate?: number;
      requiredBufferAreaM2?: number;
    };
  };
  "venue.export_simulation": {
    filename: string;
    mimeType: "application/json";
    encoding: "utf8";
    content: string;
  };
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
  "venue.inspect_live_plan_deviations": {
    register: VenueMindLivePlanDeviationRegister;
    deviations: VenueMindLivePlanDeviation[];
    overlay: VenueMindLivePlanDeviationOverlay;
  };
  "venue.record_live_plan_deviation": {
    register: VenueMindLivePlanDeviationRegister;
    deviation: VenueMindLivePlanDeviation | null;
    proposal: {
      [k: string]: unknown;
    } | null;
    receipt: {
      [k: string]: unknown;
    };
    duplicate: boolean;
  };
  "venue.end_live_plan_deviation": {
    register: VenueMindLivePlanDeviationRegister;
    deviation: VenueMindLivePlanDeviation | null;
    proposal: {
      [k: string]: unknown;
    } | null;
    receipt: {
      [k: string]: unknown;
    };
    duplicate: boolean;
  };
  "venue.create_post_event_deviation_proposal": {
    register: VenueMindLivePlanDeviationRegister;
    deviation: VenueMindLivePlanDeviation | null;
    proposal: {
      [k: string]: unknown;
    } | null;
    receipt: {
      [k: string]: unknown;
    };
    duplicate: boolean;
  };
  "venue.export_live_plan_deviations": {
    filename: string;
    mediaType: "application/json";
    content: string;
    fingerprint: string;
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
export interface VenueMindVenueTemplateCatalog {
  schemaVersion: 1;
  venueTemplates: {
    schemaVersion: 1;
    kind: "venue-template";
    id: string;
    version: string;
    name: string;
    roomTemplateIds: string[];
  }[];
  roomTemplates: {
    schemaVersion: 1;
    kind: "room-template";
    id: string;
    version: string;
    name: string;
    useCase?: "conference" | "concert" | "banquet" | "exhibition" | "classroom" | "community-event";
    unit: "m";
    boundary: {
      [k: string]: unknown;
    };
    capacity?: number;
    objects: {
      [k: string]: unknown;
    }[];
  }[];
  inventoryTemplates: {
    schemaVersion: 1;
    kind: "inventory-item-template";
    id: string;
    version: string;
    name: string;
    category: "furniture" | "seating" | "barriers" | "staging" | "av" | "catering" | "signage" | "queue";
    dimensions: {
      [k: string]: unknown;
    };
    weightKg: number;
    power: {
      [k: string]: unknown;
    };
    capacity: number;
    cost: {
      [k: string]: unknown;
    };
    availability: {
      total: number;
      unavailable: number;
    };
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
export interface VenueMindProposalBranchComparison {
  comparisonId: string;
  planVersion: string;
  left: BranchSummary;
  right: BranchSummary;
  changeSet: {
    sharedIds: string[];
    leftOnlyIds: string[];
    rightOnlyIds: string[];
  };
  objectDeltas: {
    addedObjectIds: string[];
    removedObjectIds: string[];
    movedObjectIds: string[];
    rotatedObjectIds: string[];
    resizedObjectIds: string[];
    metadataObjectIds: string[];
  };
  acceptedDeltas: {
    left: ObjectDeltas;
    right: ObjectDeltas;
  };
  overlay: {
    roomBoundary: {
      [k: string]: unknown;
    };
    acceptedObjects: {
      [k: string]: unknown;
    }[];
    leftObjects: {
      [k: string]: unknown;
    }[];
    rightObjects: {
      [k: string]: unknown;
    }[];
  };
  metricDeltas: {
    metric: string;
    label: string;
    unit: string;
    left: number;
    right: number;
    delta: number;
  }[];
  constraintDeltas: {
    constraintId: string;
    label: string;
    category: string;
    leftStatus: "pass" | "warning" | "fail" | "not-applicable";
    rightStatus: "pass" | "warning" | "fail" | "not-applicable";
    leftActual: number | null;
    rightActual: number | null;
    unit: string | null;
    outcome: "improved" | "regressed" | "unchanged";
  }[];
  improvements: string[];
  regressions: string[];
}
export interface BranchSummary {
  branchId: string;
  name: string;
  notes: string;
  strategy: string;
  proposalId: string;
  baseVersion: string;
  changedItems: number;
  changeIds: string[];
  validationId: string;
  validationStatus: "pass" | "fail";
  blockingIssues: number;
  unresolvedIssues: number;
  geometryFingerprint: {
    [k: string]: unknown;
  };
}
export interface ObjectDeltas {
  addedObjectIds: string[];
  removedObjectIds: string[];
  movedObjectIds: string[];
  rotatedObjectIds: string[];
  resizedObjectIds: string[];
  metadataObjectIds: string[];
}
export interface VenueMindProposalConflicts {
  status: "clear" | "conflicts";
  branchId: string;
  proposalId: string;
  stale: boolean;
  baseVersion: string;
  currentVersion: string;
  conflicts: {
    id: string;
    type:
      | "stale-base"
      | "deleted-dependency"
      | "lock-conflict"
      | "same-object-edit"
      | "geometry-overlap"
      | "constraint-regression";
    severity: "error" | "warning";
    blocking: boolean;
    baseVersion: string;
    currentVersion: string;
    changeIds: string[];
    objectIds: string[];
    constraintId?: string;
    validationId?: string;
    lockId?: string;
    lockType?: "position" | "rotation" | "dimension" | "deletion" | "role";
    lockSource?: "venue-template" | "project";
    resolutionOptions: (
      "rebase" | "drop-change" | "keep-proposal" | "keep-plan" | "manual-resolution" | "revise-proposal"
    )[];
  }[];
  blockingConflicts: number;
  validation: VenueMindValidationResult1;
}
export interface VenueMindValidationResult1 {
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
export interface VenueMindLivePlanDeviationOverlay {
  registerId: string;
  registerRevision: number;
  runbookVersionId: string;
  acceptedPlanId: string;
  acceptedPlanVersion: string | number;
  acceptedPlanFingerprint: string;
  activeDeviationIds: string[];
  overlayPlan: {
    [k: string]: unknown;
  };
  overlayFingerprint: string;
  validation: {
    [k: string]: unknown;
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
