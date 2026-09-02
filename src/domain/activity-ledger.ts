import { venueError } from "./errors.ts";
import { detectLockConflicts } from "./locks.ts";
import type { SpatialMutation } from "./locks.ts";
import type { VenueObject } from "./geometry.ts";
import type { VenuePlan } from "./geometry.ts";
import type { EventBrief } from "./event-brief.ts";

export type ActivityActor = string;
export interface ActivityDetails {
  acceptedPlan?: VenuePlan;
  acceptedBrief?: EventBrief;
  planFingerprint?: string;
  briefFingerprint?: string;
  beforePlanVersion?: string;
  afterPlanVersion?: string;
  version?: string;
  toVersion?: string;
  lockId?: string;
  lockType?: string;
  objectId?: string;
  source?: string;
  reasonCode?: string;
  authorId?: string;
}
export interface ActivityLedgerEntry<TDetails extends object = ActivityDetails> {
  id: string;
  schemaVersion: 1;
  sequence: number;
  type: string;
  actor: ActivityActor;
  actorId: string;
  actorType: string;
  source: string;
  sessionId: string;
  occurredAt: string;
  details: ActivityDetails & TDetails;
  previousHash?: string;
  hash?: string;
}
export interface ActivityEntryMetadata {
  actorId?: string;
  actorType?: string;
  source?: string;
  sessionId?: string;
  occurredAt?: string;
}

const clone = <T>(value: T): T => structuredClone(value);

const stableStringify = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
};

export const stableFingerprint = (prefix: string, value: unknown): string => {
  const input = stableStringify(value);
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${prefix}-${(hash >>> 0).toString(16).padStart(8, "0")}`;
};

export const fingerprintPlan = (plan: VenuePlan) => stableFingerprint("plan", plan);
export const fingerprintEventBrief = (brief: EventBrief) => stableFingerprint("brief", brief);

export const createActivityEntry = <TDetails extends object>(
  sequence: number,
  type: string,
  actor: ActivityActor,
  details: TDetails,
  metadata: ActivityEntryMetadata = {},
): ActivityLedgerEntry<TDetails> => ({
  id: `ledger-${String(sequence).padStart(4, "0")}`,
  schemaVersion: 1,
  sequence,
  type,
  actor,
  actorId: metadata.actorId ?? actor,
  actorType: metadata.actorType ?? actor,
  source: metadata.source ?? (actor === "agent" ? "agent-tool" : actor === "human" ? "studio" : "system"),
  sessionId: metadata.sessionId ?? "session-unknown",
  occurredAt: metadata.occurredAt ?? new Date().toISOString(),
  details,
});

const entryPayload = <TDetails extends object>(entry: ActivityLedgerEntry<TDetails>, previousHash: string) => {
  const { hash: _hash, previousHash: _previousHash, ...content } = entry;
  return { ...content, previousHash };
};

export function sealActivityLedger(entries: readonly ActivityLedgerEntry[]): ActivityLedgerEntry[] {
  let previousHash = "genesis";
  return entries.map((entry, index) => {
    const normalized = createActivityEntry(
      index + 1,
      entry.type,
      entry.actor ?? entry.actorType ?? "system",
      clone(entry.details ?? {}),
      {
        actorId: entry.actorId,
        actorType: entry.actorType,
        source: entry.source,
        sessionId: entry.sessionId,
        occurredAt: entry.occurredAt,
      },
    );
    const payload = entryPayload(normalized, previousHash);
    const hash = stableFingerprint("ledger", payload);
    const sealed = { ...payload, hash };
    previousHash = hash;
    return sealed;
  });
}

export function verifyActivityLedger(entries: readonly ActivityLedgerEntry[]) {
  const expected = sealActivityLedger(entries);
  const valid =
    entries.length === expected.length &&
    entries.every(
      (entry, index) =>
        entry.schemaVersion === 1 &&
        entry.sequence === expected[index]?.sequence &&
        entry.previousHash === expected[index]?.previousHash &&
        entry.hash === expected[index]?.hash,
    );
  return {
    status: valid ? "pass" : "fail",
    entries: entries.length,
    headHash: valid ? (expected.at(-1)?.hash ?? "genesis") : null,
  };
}

export function normalizeActivityLedger(entries: readonly ActivityLedgerEntry[]): ActivityLedgerEntry[] {
  if (!isUnknownArray(entries)) throw new Error("Activity Ledger must be an array");
  const hasIntegrityFields = entries.some((entry) => entry.hash || entry.previousHash || entry.schemaVersion);
  if (!hasIntegrityFields) return sealActivityLedger(entries);
  const integrity = verifyActivityLedger(entries);
  if (integrity.status !== "pass") throw venueError("LEDGER_INTEGRITY_FAILED", { integrity });
  return clone([...entries]);
}

const isUnknownArray = (value: unknown): value is unknown[] => Array.isArray(value);

export function replayActivityLedger(
  entries: readonly ActivityLedgerEntry[],
  currentPlan: VenuePlan,
  currentBrief: EventBrief | null = null,
) {
  const integrity = verifyActivityLedger(entries);
  if (integrity.status !== "pass") throw venueError("LEDGER_INTEGRITY_FAILED", { integrity });
  const truthFingerprintViolations = entries.flatMap((entry) => {
    const violations = [];
    const acceptedPlan = entry.details.acceptedPlan;
    if (acceptedPlan) {
      const actual = fingerprintPlan(acceptedPlan);
      if (entry.details.planFingerprint !== actual)
        violations.push({
          ledgerEntryId: entry.id,
          truth: "plan",
          declared: entry.details.planFingerprint ?? null,
          actual,
        });
    }
    if (entry.details?.acceptedBrief) {
      const actual = fingerprintEventBrief(entry.details.acceptedBrief);
      if (entry.details.briefFingerprint !== actual)
        violations.push({
          ledgerEntryId: entry.id,
          truth: "brief",
          declared: entry.details.briefFingerprint ?? null,
          actual,
        });
    }
    return violations;
  });
  const transitions = entries.flatMap((entry) => {
    const acceptedPlan = entry.details.acceptedPlan;
    if (!acceptedPlan) return [];
    return [
      {
        ledgerEntryId: entry.id,
        type: entry.type,
        planVersion: acceptedPlan.version,
        planFingerprint: fingerprintPlan(acceptedPlan),
        plan: clone(acceptedPlan),
        briefFingerprint: entry.details.acceptedBrief ? fingerprintEventBrief(entry.details.acceptedBrief) : null,
        brief: entry.details.acceptedBrief ? clone(entry.details.acceptedBrief) : null,
      },
    ];
  });
  const replayed = transitions.at(-1)?.plan ?? null;
  const replayedFingerprint = replayed ? fingerprintPlan(replayed) : null;
  const currentFingerprint = fingerprintPlan(currentPlan);
  const briefTransitions = entries
    .filter((entry) => entry.details?.acceptedBrief)
    .map((entry) => ({ ledgerEntryId: entry.id, brief: clone(entry.details.acceptedBrief) }));
  const replayedBrief = briefTransitions.at(-1)?.brief ?? null;
  const replayedBriefFingerprint = replayedBrief ? fingerprintEventBrief(replayedBrief) : null;
  const currentBriefFingerprint = currentBrief ? fingerprintEventBrief(currentBrief) : null;
  const lockedObjectViolations: Array<{
    objectId: string;
    fromLedgerEntryId: string;
    toLedgerEntryId: string;
    fromPlanVersion: string;
    toPlanVersion: string;
    type: string;
    lockTypes: string[];
  }> = [];
  for (let index = 1; index < transitions.length; index += 1) {
    const before = transitions[index - 1];
    const after = transitions[index];
    if (!before || !after) continue;
    const afterObjects = new Map((after.plan.objects ?? []).map((object) => [object.id, object]));
    for (const object of (before.plan.objects ?? []).filter((item) => item.locked)) {
      const next = afterObjects.get(object.id);
      const spatialEffects: SpatialMutation[] = [];
      if (!next) spatialEffects.push({ operation: "delete_object", objectId: object.id });
      else {
        if (stableFingerprint("footprint", object.footprint) !== stableFingerprint("footprint", next.footprint))
          spatialEffects.push({ operation: "update_footprint", objectId: object.id, footprint: clone(next.footprint) });
        const metadata = ({
          footprint: _footprint,
          locks: _locks,
          locked: _locked,
          ...value
        }: VenueObject): Partial<VenueObject> => value;
        if (stableFingerprint("metadata", metadata(object)) !== stableFingerprint("metadata", metadata(next)))
          spatialEffects.push({ operation: "update_metadata", objectId: object.id, values: metadata(next) });
      }
      const conflicts = detectLockConflicts(before.plan, [
        { id: `replay-${before.planVersion}-${after.planVersion}-${object.id}`, targetObjectIds: [], spatialEffects },
      ]);
      const lockMetadataChanged =
        next && stableFingerprint("locks", object.locks ?? []) !== stableFingerprint("locks", next.locks ?? []);
      if (conflicts.length || lockMetadataChanged) {
        lockedObjectViolations.push({
          objectId: object.id,
          fromLedgerEntryId: before.ledgerEntryId,
          toLedgerEntryId: after.ledgerEntryId,
          fromPlanVersion: before.planVersion,
          toPlanVersion: after.planVersion,
          type: !next
            ? "locked-object-deleted"
            : lockMetadataChanged
              ? "lock-metadata-changed"
              : "locked-property-changed",
          lockTypes: [...new Set(conflicts.map((conflict) => conflict.lockType))],
        });
      }
    }
  }
  return {
    status:
      replayedFingerprint === currentFingerprint &&
      (!currentBrief || (replayedBrief && replayedBriefFingerprint === currentBriefFingerprint)) &&
      lockedObjectViolations.length === 0 &&
      truthFingerprintViolations.length === 0
        ? "pass"
        : "fail",
    transitions: transitions.map(({ plan: _plan, brief: _brief, ...transition }) => transition),
    currentPlanVersion: currentPlan.version,
    replayedFingerprint,
    currentFingerprint,
    replayedBriefFingerprint,
    currentBriefFingerprint,
    briefTransitions: briefTransitions.map(({ brief: _brief, ...transition }) => transition),
    ledgerHeadHash: integrity.headHash,
    lockedObjectViolations,
    truthFingerprintViolations,
  };
}
