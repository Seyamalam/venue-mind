import type { PlannerSnapshot } from "./venue-planner.ts";

export type ProjectMetadataScalar = string | number | boolean | null;
export type ProjectMetadataValue = ProjectMetadataScalar | ProjectMetadataObject | readonly ProjectMetadataValue[];
export interface ProjectMetadataObject {
  readonly [key: string]: ProjectMetadataValue;
}

export interface ImportedProjectProvenance {
  readonly sourceFormat: "venuemind-project";
  readonly formatVersion: 1;
  readonly packageId: string;
  readonly payloadSha256: string;
  readonly exportedAt: string;
  readonly importedAt: string;
  readonly originalProjectId: string;
  readonly source: ProjectMetadataObject;
}

export interface DuplicatedProjectProvenance {
  readonly kind: "project-duplicate";
  readonly sourceProjectId: string;
  readonly sourcePlanId: string;
  readonly sourcePlanVersion: string;
  readonly sourcePlanFingerprint: string;
  readonly duplicatedAt: string;
}

export type ProjectProvenance = ImportedProjectProvenance | DuplicatedProjectProvenance;

export interface ProjectRecord {
  readonly id: string;
  readonly organizationId: string;
  readonly name: string;
  readonly activePlanId: string;
  readonly schemaVersion: 10;
  readonly snapshot: PlannerSnapshot;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly revision: number;
  readonly archivedAt: string | null;
  readonly deletedAt: string | null;
  readonly recoveryUntil: string | null;
  readonly pinned: boolean;
  readonly lastOpenedAt: string | null;
  readonly provenance?: ProjectProvenance;
}

export type LocalProjectRecord = Omit<ProjectRecord, "revision"> & Readonly<{ revision?: number }>;

export interface ProjectRecordMetadata {
  readonly createdAt: string | null;
  readonly revision: number | null;
  readonly provenance: ProjectProvenance | null;
  readonly archivedAt: string | null;
  readonly deletedAt: string | null;
  readonly recoveryUntil: string | null;
  readonly pinned: boolean;
  readonly lastOpenedAt: string | null;
}

export interface SaveProjectInput {
  readonly id: string;
  readonly name: string;
  readonly activePlanId: string;
  readonly snapshot: PlannerSnapshot;
  readonly createdAt?: string | null;
  readonly provenance?: ProjectProvenance | null;
  readonly archivedAt?: string | null;
  readonly deletedAt?: string | null;
  readonly recoveryUntil?: string | null;
  readonly pinned?: boolean;
  readonly lastOpenedAt?: string | null;
}

export type ProjectMetadataPatch = Partial<
  Pick<ProjectRecord, "name" | "archivedAt" | "deletedAt" | "recoveryUntil" | "pinned" | "lastOpenedAt">
>;

export type ProjectMutableField =
  | "name"
  | "activePlanId"
  | "snapshot"
  | "provenance"
  | "archivedAt"
  | "deletedAt"
  | "recoveryUntil"
  | "pinned"
  | "lastOpenedAt";

export interface ProjectConflictAnalysis {
  readonly status: "conflict" | "merged";
  readonly kind?: "missing-base" | "planning" | "metadata";
  readonly overlappingFields: readonly ProjectMutableField[];
  readonly localFields: readonly ProjectMutableField[];
  readonly remoteFields: readonly ProjectMutableField[];
  readonly record?: LocalProjectRecord;
}

export interface ProjectConflict {
  readonly kind: "missing-base" | "planning" | "metadata";
  readonly projectId: string;
  readonly baseRevision: number | null;
  readonly localRevision: number | null;
  readonly remoteRevision: number;
  readonly overlappingFields: readonly ProjectMutableField[];
  readonly localFields: readonly ProjectMutableField[];
  readonly remoteFields: readonly ProjectMutableField[];
  readonly resolutions: readonly ("recover-proposal-branch" | "use-remote" | "preserve-project-copy")[];
  readonly base: LocalProjectRecord | null;
  readonly local: LocalProjectRecord;
  readonly remote: ProjectRecord;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isPlannerSnapshot = (value: unknown): value is PlannerSnapshot =>
  isObject(value) &&
  isObject(value["plan"]) &&
  isObject(value["proposal"]) &&
  Array.isArray(value["ledger"]) &&
  Array.isArray(value["receipts"]);

export const isLocalProjectRecord = (value: unknown): value is LocalProjectRecord =>
  isObject(value) &&
  typeof value["id"] === "string" &&
  typeof value["organizationId"] === "string" &&
  typeof value["name"] === "string" &&
  typeof value["activePlanId"] === "string" &&
  value["schemaVersion"] === 10 &&
  isPlannerSnapshot(value["snapshot"]) &&
  typeof value["createdAt"] === "string" &&
  typeof value["updatedAt"] === "string" &&
  (value["revision"] === undefined ||
    (typeof value["revision"] === "number" && Number.isSafeInteger(value["revision"]))) &&
  (value["archivedAt"] === null || typeof value["archivedAt"] === "string") &&
  (value["deletedAt"] === null || typeof value["deletedAt"] === "string") &&
  (value["recoveryUntil"] === null || typeof value["recoveryUntil"] === "string") &&
  typeof value["pinned"] === "boolean" &&
  (value["lastOpenedAt"] === null || typeof value["lastOpenedAt"] === "string");

export const isProjectRecord = (value: unknown): value is ProjectRecord =>
  isLocalProjectRecord(value) && typeof value.revision === "number" && value.revision >= 1;
