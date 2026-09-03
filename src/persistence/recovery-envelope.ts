const RECOVERY_ENVELOPE_SCHEMA_VERSION = 1 as const;
const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const FNV_MASK = 0xffffffffffffffffn;

export type RecoveryIntegrityStatus = "pass" | "recovered" | "quarantined" | "missing";

export interface RecoveryEnvelope<Value> {
  readonly schemaVersion: typeof RECOVERY_ENVELOPE_SCHEMA_VERSION;
  readonly sequence: number;
  readonly committedAt: string;
  readonly checksum: string;
  readonly value: Value;
}

export interface RecoveryInspection<Value> {
  readonly status: RecoveryIntegrityStatus;
  readonly envelope: RecoveryEnvelope<Value> | null;
  readonly reason: "valid" | "journal-recovered" | "invalid-json" | "invalid-envelope" | "checksum-mismatch" | "missing";
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const checksumText = (text: string): string => {
  let hash = FNV_OFFSET;
  const bytes = new TextEncoder().encode(text);
  for (const byte of bytes) {
    hash ^= BigInt(byte);
    hash = (hash * FNV_PRIME) & FNV_MASK;
  }
  return hash.toString(16).padStart(16, "0");
};

const checksumPayload = (sequence: number, committedAt: string, value: unknown): string =>
  checksumText(JSON.stringify({ schemaVersion: RECOVERY_ENVELOPE_SCHEMA_VERSION, sequence, committedAt, value }));

export const createRecoveryEnvelope = <Value>(
  value: Value,
  sequence: number,
  committedAt: string,
): RecoveryEnvelope<Value> => {
  if (!Number.isSafeInteger(sequence) || sequence < 1) throw new TypeError("Recovery sequence must be a positive integer");
  if (!committedAt) throw new TypeError("Recovery commit time is required");
  return Object.freeze({
    schemaVersion: RECOVERY_ENVELOPE_SCHEMA_VERSION,
    sequence,
    committedAt,
    checksum: checksumPayload(sequence, committedAt, value),
    value,
  });
};

export const inspectRecoveryEnvelope = <Value>(
  text: string | null,
  validate: (value: unknown) => value is Value,
): RecoveryInspection<Value> => {
  if (text === null) return { status: "missing", envelope: null, reason: "missing" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { status: "quarantined", envelope: null, reason: "invalid-json" };
  }
  if (
    !isRecord(parsed) ||
    parsed["schemaVersion"] !== RECOVERY_ENVELOPE_SCHEMA_VERSION ||
    typeof parsed["sequence"] !== "number" ||
    !Number.isSafeInteger(parsed["sequence"]) ||
    parsed["sequence"] < 1 ||
    typeof parsed["committedAt"] !== "string" ||
    !parsed["committedAt"] ||
    typeof parsed["checksum"] !== "string" ||
    !validate(parsed["value"])
  ) {
    return { status: "quarantined", envelope: null, reason: "invalid-envelope" };
  }
  const expected = checksumPayload(parsed["sequence"], parsed["committedAt"], parsed["value"]);
  if (parsed["checksum"] !== expected) {
    return { status: "quarantined", envelope: null, reason: "checksum-mismatch" };
  }
  return {
    status: "pass",
    reason: "valid",
    envelope: {
      schemaVersion: RECOVERY_ENVELOPE_SCHEMA_VERSION,
      sequence: parsed["sequence"],
      committedAt: parsed["committedAt"],
      checksum: parsed["checksum"],
      value: parsed["value"],
    },
  };
};

export const selectRecoveryEnvelope = <Value>(
  committed: RecoveryInspection<Value>,
  journal: RecoveryInspection<Value>,
): RecoveryInspection<Value> => {
  const committedSequence = committed.envelope?.sequence ?? 0;
  const journalSequence = journal.envelope?.sequence ?? 0;
  if (journal.envelope && journalSequence > committedSequence) {
    return { status: "recovered", envelope: journal.envelope, reason: "journal-recovered" };
  }
  if (committed.envelope) return committed;
  if (journal.envelope) return { status: "recovered", envelope: journal.envelope, reason: "journal-recovered" };
  if (committed.status === "quarantined") return committed;
  if (journal.status === "quarantined") return journal;
  return { status: "missing", envelope: null, reason: "missing" };
};
