/* Generated from VenueMind canonical JSON Schemas. Do not edit. */

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
