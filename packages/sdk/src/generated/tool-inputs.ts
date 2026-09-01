/* Generated from VenueMind canonical tool contracts. Do not edit. */

export interface VenueMindToolInputMap {
  "venue.list_projects": {};
  "venue.open_project": {
    projectId: string;
  };
  "venue.inspect_templates": {};
  "venue.get_project_brief": {};
  "venue.list_constraints": {
    category?: string;
    severity?: "error" | "warning" | "preference";
  };
  "venue.inspect_layout": {};
  "venue.get_object": {
    objectId: string;
    scope?: "accepted" | "proposal";
  };
  "venue.search_objects": {
    query?: string;
    /**
     * @maxItems 10
     */
    kinds?:
      | []
      | [string]
      | [string, string]
      | [string, string, string]
      | [string, string, string, string]
      | [string, string, string, string, string]
      | [string, string, string, string, string, string]
      | [string, string, string, string, string, string, string]
      | [string, string, string, string, string, string, string, string]
      | [string, string, string, string, string, string, string, string, string]
      | [string, string, string, string, string, string, string, string, string, string];
    /**
     * @maxItems 7
     */
    layers?:
      | []
      | ["architecture" | "furniture" | "access" | "production" | "catering" | "safety" | "annotations"]
      | [
          "architecture" | "furniture" | "access" | "production" | "catering" | "safety" | "annotations",
          "architecture" | "furniture" | "access" | "production" | "catering" | "safety" | "annotations"
        ]
      | [
          "architecture" | "furniture" | "access" | "production" | "catering" | "safety" | "annotations",
          "architecture" | "furniture" | "access" | "production" | "catering" | "safety" | "annotations",
          "architecture" | "furniture" | "access" | "production" | "catering" | "safety" | "annotations"
        ]
      | [
          "architecture" | "furniture" | "access" | "production" | "catering" | "safety" | "annotations",
          "architecture" | "furniture" | "access" | "production" | "catering" | "safety" | "annotations",
          "architecture" | "furniture" | "access" | "production" | "catering" | "safety" | "annotations",
          "architecture" | "furniture" | "access" | "production" | "catering" | "safety" | "annotations"
        ]
      | [
          "architecture" | "furniture" | "access" | "production" | "catering" | "safety" | "annotations",
          "architecture" | "furniture" | "access" | "production" | "catering" | "safety" | "annotations",
          "architecture" | "furniture" | "access" | "production" | "catering" | "safety" | "annotations",
          "architecture" | "furniture" | "access" | "production" | "catering" | "safety" | "annotations",
          "architecture" | "furniture" | "access" | "production" | "catering" | "safety" | "annotations"
        ]
      | [
          "architecture" | "furniture" | "access" | "production" | "catering" | "safety" | "annotations",
          "architecture" | "furniture" | "access" | "production" | "catering" | "safety" | "annotations",
          "architecture" | "furniture" | "access" | "production" | "catering" | "safety" | "annotations",
          "architecture" | "furniture" | "access" | "production" | "catering" | "safety" | "annotations",
          "architecture" | "furniture" | "access" | "production" | "catering" | "safety" | "annotations",
          "architecture" | "furniture" | "access" | "production" | "catering" | "safety" | "annotations"
        ]
      | [
          "architecture" | "furniture" | "access" | "production" | "catering" | "safety" | "annotations",
          "architecture" | "furniture" | "access" | "production" | "catering" | "safety" | "annotations",
          "architecture" | "furniture" | "access" | "production" | "catering" | "safety" | "annotations",
          "architecture" | "furniture" | "access" | "production" | "catering" | "safety" | "annotations",
          "architecture" | "furniture" | "access" | "production" | "catering" | "safety" | "annotations",
          "architecture" | "furniture" | "access" | "production" | "catering" | "safety" | "annotations",
          "architecture" | "furniture" | "access" | "production" | "catering" | "safety" | "annotations"
        ];
    locked?: boolean;
    scope?: "accepted" | "proposal";
    limit?: number;
  };
  "venue.preview_revision": {
    /**
     * The spatial outcome the revision should achieve.
     */
    goal: string;
    /**
     * Unique retry key for this semantic command.
     */
    idempotencyKey: string;
    /**
     * Optional caller correlation identifier.
     */
    correlationId?: string;
  };
  "venue.preview_template_update": {
    templateId: string;
    toVersion: string;
    /**
     * Unique retry key for this semantic command.
     */
    idempotencyKey: string;
    /**
     * Optional caller correlation identifier.
     */
    correlationId?: string;
  };
  "venue.apply_edit": {
    edit: {
      operation:
        | "place"
        | "move"
        | "rotate"
        | "resize"
        | "duplicate"
        | "align"
        | "distribute"
        | "delete"
        | "group"
        | "ungroup"
        | "create-zone"
        | "edit-zone-vertices"
        | "paste"
        | "apply-layout";
      [k: string]: unknown;
    };
    /**
     * Unique retry key for this semantic command.
     */
    idempotencyKey: string;
    /**
     * Optional caller correlation identifier.
     */
    correlationId?: string;
  };
  "venue.measure_objects": {
    /**
     * @minItems 1
     */
    objectIds: [string, ...string[]];
  };
  "venue.validate_layout": {};
  "venue.get_validation_evidence": {
    validationId?: string;
    /**
     * @maxItems 50
     */
    constraintIds?: string[];
    includeSpatialEvidence?: boolean;
  };
  "venue.list_proposal_branches": {};
  "venue.compare_proposal_branches": {
    leftBranchId: string;
    rightBranchId: string;
  };
  "venue.create_proposal_branch": {
    name: string;
    strategy: "balanced" | "access-first" | "circulation-first" | "sightlines-first";
    goal?: string;
    /**
     * Unique retry key for this semantic command.
     */
    idempotencyKey: string;
    /**
     * Optional caller correlation identifier.
     */
    correlationId?: string;
  };
  "venue.switch_proposal_branch": {
    branchId: string;
    /**
     * Unique retry key for this semantic command.
     */
    idempotencyKey: string;
    /**
     * Optional caller correlation identifier.
     */
    correlationId?: string;
  };
  "venue.update_proposal_branch": {
    branchId: string;
    name?: string;
    notes?: string;
    /**
     * Unique retry key for this semantic command.
     */
    idempotencyKey: string;
    /**
     * Optional caller correlation identifier.
     */
    correlationId?: string;
  };
  "venue.duplicate_proposal_branch": {
    branchId: string;
    proposalId?: string;
    name?: string;
    /**
     * Unique retry key for this semantic command.
     */
    idempotencyKey: string;
    /**
     * Optional caller correlation identifier.
     */
    correlationId?: string;
  };
  "venue.archive_proposal_branch": {
    branchId: string;
    /**
     * Unique retry key for this semantic command.
     */
    idempotencyKey: string;
    /**
     * Optional caller correlation identifier.
     */
    correlationId?: string;
  };
  "venue.restore_proposal_branch": {
    branchId: string;
    /**
     * Unique retry key for this semantic command.
     */
    idempotencyKey: string;
    /**
     * Optional caller correlation identifier.
     */
    correlationId?: string;
  };
  "venue.detect_proposal_conflicts": {
    branchId?: string;
  };
  "venue.rebase_proposal": {
    branchId: string;
    /**
     * Unique retry key for this semantic command.
     */
    idempotencyKey: string;
    /**
     * Optional caller correlation identifier.
     */
    correlationId?: string;
  };
  "venue.request_adjustment": {
    instruction: string;
    /**
     * Unique retry key for this semantic command.
     */
    idempotencyKey: string;
    /**
     * Optional caller correlation identifier.
     */
    correlationId?: string;
  };
  "venue.list_comments": {
    status?: "open" | "resolved";
    authorId?: string;
    subjectKind?: "project" | "plan-version" | "proposal" | "change" | "constraint" | "coordinate";
    decisionRelevant?: boolean;
  };
  "venue.add_comment": {
    anchor: {
      kind: "project" | "plan-version" | "proposal" | "change" | "constraint" | "coordinate";
      projectId?: string;
      planVersion?: string;
      proposalId?: string;
      changeId?: string;
      constraintId?: string;
      point?: {
        x: number;
        y: number;
      };
    };
    body: string;
    mentions?: string[];
    decisionRelevant?: boolean;
    authorId: string;
    /**
     * Unique retry key for this semantic command.
     */
    idempotencyKey: string;
    /**
     * Optional caller correlation identifier.
     */
    correlationId?: string;
  };
  "venue.edit_comment": {
    commentId: string;
    body: string;
    mentions?: string[];
    decisionRelevant?: boolean;
    authorId: string;
    /**
     * Unique retry key for this semantic command.
     */
    idempotencyKey: string;
    /**
     * Optional caller correlation identifier.
     */
    correlationId?: string;
  };
  "venue.set_comment_status": {
    commentId: string;
    status: "open" | "resolved";
    authorId: string;
    /**
     * Unique retry key for this semantic command.
     */
    idempotencyKey: string;
    /**
     * Optional caller correlation identifier.
     */
    correlationId?: string;
  };
  "venue.get_change_log": {};
  "venue.replay_history": {};
  "venue.list_scenarios": {};
  "venue.list_scenario_runs": {};
  "venue.get_scenario_result": {
    runId: string;
    includeDensityFrames?: boolean;
  };
  "venue.run_scenario": {
    scenario: {
      model?: "operations" | "ingress-egress" | "queue";
      id: string;
      name?: string;
      seed: number;
      horizonSeconds: number;
      sampleCount?: number;
      /**
       * @minItems 1
       */
      phases?: [
        {
          id: string;
          label?: string;
          startSecond: number;
          endSecond: number;
          demandShare?: number;
        },
        ...{
          id: string;
          label?: string;
          startSecond: number;
          endSecond: number;
          demandShare?: number;
        }[]
      ];
      inputs: {
        population: number;
        arrivalRatePerMinute: number;
        serviceRatePerMinute: number;
        servers: number;
        mobilityFactor?: number;
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
    };
    branchId?: string;
    /**
     * Unique retry key for this semantic command.
     */
    idempotencyKey: string;
    /**
     * Optional caller correlation identifier.
     */
    correlationId?: string;
  };
  "venue.compare_simulations": {
    leftRunId: string;
    rightRunId: string;
  };
  "venue.export_simulation": {
    runId: string;
  };
  "venue.inspect_live_occupancy": {};
  "venue.ingest_occupancy_signal": {
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
    /**
     * Unique retry key for this semantic command.
     */
    idempotencyKey: string;
    /**
     * Optional caller correlation identifier.
     */
    correlationId?: string;
  };
  "venue.refresh_live_occupancy": {
    /**
     * Unique retry key for this semantic command.
     */
    idempotencyKey: string;
    /**
     * Optional caller correlation identifier.
     */
    correlationId?: string;
  };
  "venue.export_live_occupancy": {};
  "venue.export_audit_package": {};
  "venue.export_plan": {
    format?:
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
  };
}
