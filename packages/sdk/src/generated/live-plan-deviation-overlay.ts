/* Generated from VenueMind canonical JSON Schemas. Do not edit. */

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
