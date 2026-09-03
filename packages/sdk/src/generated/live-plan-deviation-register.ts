/* Generated from VenueMind canonical JSON Schemas. Do not edit. */

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
