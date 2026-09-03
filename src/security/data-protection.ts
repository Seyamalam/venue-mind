export const DATA_CLASSES = [
  "public-contract",
  "project-content",
  "operational-sensitive",
  "account-identity",
  "security-evidence",
  "secret-reference",
] as const;

export type DataClass = (typeof DATA_CLASSES)[number];
export type DataStore = "d1-primary" | "browser-cache" | "on-demand-export" | "backup";

export interface RetentionRule {
  readonly dataClass: DataClass;
  readonly activeDays: number | null;
  readonly deletedRecoveryDays: number;
  readonly backupExpiryDays: number;
  readonly stores: readonly DataStore[];
}

export const DEFAULT_RETENTION_RULES = Object.freeze({
  "public-contract": Object.freeze({
    dataClass: "public-contract",
    activeDays: null,
    deletedRecoveryDays: 0,
    backupExpiryDays: 30,
    stores: Object.freeze(["d1-primary", "backup"] satisfies DataStore[]),
  }),
  "project-content": Object.freeze({
    dataClass: "project-content",
    activeDays: null,
    deletedRecoveryDays: 30,
    backupExpiryDays: 30,
    stores: Object.freeze(["d1-primary", "browser-cache", "on-demand-export", "backup"] satisfies DataStore[]),
  }),
  "operational-sensitive": Object.freeze({
    dataClass: "operational-sensitive",
    activeDays: 365,
    deletedRecoveryDays: 30,
    backupExpiryDays: 30,
    stores: Object.freeze(["d1-primary", "browser-cache", "on-demand-export", "backup"] satisfies DataStore[]),
  }),
  "account-identity": Object.freeze({
    dataClass: "account-identity",
    activeDays: null,
    deletedRecoveryDays: 0,
    backupExpiryDays: 30,
    stores: Object.freeze(["d1-primary", "browser-cache", "on-demand-export", "backup"] satisfies DataStore[]),
  }),
  "security-evidence": Object.freeze({
    dataClass: "security-evidence",
    activeDays: 400,
    deletedRecoveryDays: 0,
    backupExpiryDays: 30,
    stores: Object.freeze(["d1-primary", "backup"] satisfies DataStore[]),
  }),
  "secret-reference": Object.freeze({
    dataClass: "secret-reference",
    activeDays: null,
    deletedRecoveryDays: 0,
    backupExpiryDays: 0,
    stores: Object.freeze([] satisfies DataStore[]),
  }),
} satisfies Readonly<Record<DataClass, RetentionRule>>);

export interface OrganizationRetentionPolicy {
  readonly schemaVersion: 1;
  readonly organizationId: string;
  readonly operationalSensitiveDays: number;
  readonly securityEvidenceDays: number;
  readonly projectRecoveryDays: number;
  readonly updatedAt: string;
  readonly updatedBy: string;
}

const integerWithin = (value: number, minimum: number, maximum: number, field: string): number => {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum)
    throw new Error(`RETENTION_POLICY_INVALID:${field}`);
  return value;
};

const text = (value: string, field: string): string => {
  const normalized = value.trim();
  if (!normalized || normalized.length > 160) throw new Error(`RETENTION_POLICY_INVALID:${field}`);
  return normalized;
};

const instant = (value: string, field: string): string => {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`RETENTION_POLICY_INVALID:${field}`);
  return new Date(parsed).toISOString();
};

export const createOrganizationRetentionPolicy = (
  input: Omit<OrganizationRetentionPolicy, "schemaVersion">,
): OrganizationRetentionPolicy => Object.freeze({
  schemaVersion: 1,
  organizationId: text(input.organizationId, "organizationId"),
  operationalSensitiveDays: integerWithin(input.operationalSensitiveDays, 30, 2_555, "operationalSensitiveDays"),
  securityEvidenceDays: integerWithin(input.securityEvidenceDays, 90, 2_555, "securityEvidenceDays"),
  projectRecoveryDays: integerWithin(input.projectRecoveryDays, 0, 30, "projectRecoveryDays"),
  updatedAt: instant(input.updatedAt, "updatedAt"),
  updatedBy: text(input.updatedBy, "updatedBy"),
});

export interface DeletionTarget {
  readonly store: DataStore;
  readonly action: "purge-now" | "expire" | "user-managed";
  readonly dueAt: string | null;
  readonly verification: string;
}

const plusDays = (value: string, days: number): string =>
  new Date(Date.parse(value) + days * 24 * 60 * 60 * 1_000).toISOString();

export const projectDeletionTargets = (
  deletedAt: string,
  policy: OrganizationRetentionPolicy,
): readonly DeletionTarget[] => {
  const at = instant(deletedAt, "deletedAt");
  const primaryDue = plusDays(at, policy.projectRecoveryDays);
  return Object.freeze([
    Object.freeze({ store: "d1-primary", action: "expire", dueAt: primaryDue, verification: "project-cascade-absent" }),
    Object.freeze({ store: "browser-cache", action: "purge-now", dueAt: at, verification: "project-cache-absent" }),
    Object.freeze({ store: "on-demand-export", action: "user-managed", dueAt: null, verification: "export-not-server-stored" }),
    Object.freeze({ store: "backup", action: "expire", dueAt: plusDays(primaryDue, 30), verification: "backup-window-expired" }),
  ]);
};

const SENSITIVE_KEY = /(?:authorization|cookie|secret|token|password|email|display.?name|body|payload|snapshot|geometry|content)/i;
const SAFE_LOG_KEY = /^(?:event|level|code|route|method|status|durationMs|correlationId|organizationHash|identityHash|projectId|aggregateId|revision|count|occurredAt)$/;

export type SafeLogValue = string | number | boolean | null;
export type SafeLogRecord = Readonly<Record<string, SafeLogValue>>;

/** Redacts at the logging boundary and emits only bounded scalar diagnostic fields. */
export const safeLogRecord = (fields: Readonly<Record<string, unknown>>): SafeLogRecord => {
  const output: Record<string, SafeLogValue> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (!SAFE_LOG_KEY.test(key) || SENSITIVE_KEY.test(key)) continue;
    if (typeof value === "string") output[key] = value.slice(0, 200);
    else if (typeof value === "number" && Number.isFinite(value)) output[key] = value;
    else if (typeof value === "boolean" || value === null) output[key] = value;
  }
  return Object.freeze(output);
};

export const DATA_COLLECTION_BOUNDARIES = Object.freeze({
  attendeeRecords: false,
  individualOccupancyEvents: false,
  rawIntegrationCredentials: false,
  serverStoredExports: false,
  aggregateOccupancyOnly: true,
  opaqueSecretReferencesOnly: true,
});
