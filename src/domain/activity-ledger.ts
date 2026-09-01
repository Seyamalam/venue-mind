import { venueError } from "./errors.ts";
import { detectLockConflicts } from "./locks.ts";

const clone: any = (value: any) => JSON.parse(JSON.stringify(value));

const stableStringify: any = (value: any) => {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key: any) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
};

export const stableFingerprint = (prefix: any, value: any) => {
  const input: any = stableStringify(value);
  let hash: any = 0x811c9dc5;
  for (let index: any = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${prefix}-${(hash >>> 0).toString(16).padStart(8, "0")}`;
};

export const fingerprintPlan = (plan: any) => stableFingerprint("plan", plan);
export const fingerprintEventBrief = (brief: any) => stableFingerprint("brief", brief);

export const createActivityEntry = (sequence: any, type: any, actor: any, details: any = {}, metadata: any = {}) => ({
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

const entryPayload: any = (entry: any, previousHash: any) => {
  const { hash: _hash, previousHash: _previousHash, ...content } = entry;
  return { ...content, previousHash };
};

export function sealActivityLedger(entries: any) {
  let previousHash: any = "genesis";
  return entries.map((entry: any, index: any) => {
    const normalized: any = createActivityEntry(
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
    const payload: any = entryPayload(normalized, previousHash);
    const hash: any = stableFingerprint("ledger", payload);
    const sealed: any = { ...payload, hash };
    previousHash = hash;
    return sealed;
  });
}

export function verifyActivityLedger(entries: any) {
  const expected: any = sealActivityLedger(entries);
  const valid: any = entries.length === expected.length && entries.every((entry: any, index: any) => (
    entry.schemaVersion === 1
    && entry.sequence === expected[index].sequence
    && entry.previousHash === expected[index].previousHash
    && entry.hash === expected[index].hash
  ));
  return {
    status: valid ? "pass" : "fail",
    entries: entries.length,
    headHash: valid ? expected.at(-1)?.hash ?? "genesis" : null,
  };
}

export function normalizeActivityLedger(entries: any) {
  if (!Array.isArray(entries)) throw new Error("Activity Ledger must be an array");
  const hasIntegrityFields: any = entries.some((entry: any) => entry.hash || entry.previousHash || entry.schemaVersion);
  if (!hasIntegrityFields) return sealActivityLedger(entries);
  const integrity: any = verifyActivityLedger(entries);
  if (integrity.status !== "pass") throw venueError("LEDGER_INTEGRITY_FAILED", { integrity });
  return clone(entries);
}

export function replayActivityLedger(entries: any, currentPlan: any, currentBrief: any = null) {
  const integrity: any = verifyActivityLedger(entries);
  if (integrity.status !== "pass") throw venueError("LEDGER_INTEGRITY_FAILED", { integrity });
  const truthFingerprintViolations: any = entries.flatMap((entry: any) => {
    const violations: any[] = [];
    if (entry.details?.acceptedPlan) {
      const actual: any = fingerprintPlan(entry.details.acceptedPlan);
      if (entry.details.planFingerprint !== actual) violations.push({ ledgerEntryId: entry.id, truth: "plan", declared: entry.details.planFingerprint ?? null, actual });
    }
    if (entry.details?.acceptedBrief) {
      const actual: any = fingerprintEventBrief(entry.details.acceptedBrief);
      if (entry.details.briefFingerprint !== actual) violations.push({ ledgerEntryId: entry.id, truth: "brief", declared: entry.details.briefFingerprint ?? null, actual });
    }
    return violations;
  });
  const transitions: any = entries
    .filter((entry: any) => entry.details?.acceptedPlan)
    .map((entry: any) => ({
      ledgerEntryId: entry.id,
      type: entry.type,
      planVersion: entry.details.acceptedPlan.version,
      planFingerprint: fingerprintPlan(entry.details.acceptedPlan),
      plan: clone(entry.details.acceptedPlan),
      briefFingerprint: entry.details.acceptedBrief ? fingerprintEventBrief(entry.details.acceptedBrief) : null,
      brief: entry.details.acceptedBrief ? clone(entry.details.acceptedBrief) : null,
    }));
  const replayed: any = transitions.at(-1)?.plan ?? null;
  const replayedFingerprint: any = replayed ? fingerprintPlan(replayed) : null;
  const currentFingerprint: any = fingerprintPlan(currentPlan);
  const briefTransitions: any = entries.filter((entry: any) => entry.details?.acceptedBrief).map((entry: any) => ({ ledgerEntryId: entry.id, brief: clone(entry.details.acceptedBrief) }));
  const replayedBrief: any = briefTransitions.at(-1)?.brief ?? null;
  const replayedBriefFingerprint: any = replayedBrief ? fingerprintEventBrief(replayedBrief) : null;
  const currentBriefFingerprint: any = currentBrief ? fingerprintEventBrief(currentBrief) : null;
  const lockedObjectViolations: any[] = [];
  for (let index: any = 1; index < transitions.length; index += 1) {
    const before: any = transitions[index - 1];
    const after: any = transitions[index];
    const afterObjects: any = new Map((after.plan.objects ?? []).map((object: any) => [object.id, object]));
    for (const object of (before.plan.objects ?? []).filter((item: any) => item.locked)) {
      const next: any = afterObjects.get(object.id);
      const spatialEffects: any[] = [];
      if (!next) spatialEffects.push({ operation: "delete_object", objectId: object.id });
      else {
        if (stableFingerprint("footprint", object.footprint) !== stableFingerprint("footprint", next.footprint)) spatialEffects.push({ operation: "update_footprint", objectId: object.id, footprint: clone(next.footprint) });
        const metadata: any = (value: any) => Object.fromEntries(Object.entries(value).filter(([key]: any) => !["footprint", "locks", "locked"].includes(key)));
        if (stableFingerprint("metadata", metadata(object)) !== stableFingerprint("metadata", metadata(next))) spatialEffects.push({ operation: "update_metadata", objectId: object.id, values: metadata(next) });
      }
      const conflicts: any = detectLockConflicts(before.plan, [{ id: `replay-${before.planVersion}-${after.planVersion}-${object.id}`, targetObjectIds: [], spatialEffects }]);
      const lockMetadataChanged: any = next && stableFingerprint("locks", object.locks ?? []) !== stableFingerprint("locks", next.locks ?? []);
      if (conflicts.length || lockMetadataChanged) {
        lockedObjectViolations.push({
          objectId: object.id,
          fromLedgerEntryId: before.ledgerEntryId,
          toLedgerEntryId: after.ledgerEntryId,
          fromPlanVersion: before.planVersion,
          toPlanVersion: after.planVersion,
          type: !next ? "locked-object-deleted" : lockMetadataChanged ? "lock-metadata-changed" : "locked-property-changed",
          lockTypes: [...new Set(conflicts.map((conflict: any) => conflict.lockType))],
        });
      }
    }
  }
  return {
    status: replayedFingerprint === currentFingerprint && (!currentBrief || (replayedBrief && replayedBriefFingerprint === currentBriefFingerprint)) && lockedObjectViolations.length === 0 && truthFingerprintViolations.length === 0 ? "pass" : "fail",
    transitions: transitions.map(({ plan: _plan, brief: _brief, ...transition }: any) => transition),
    currentPlanVersion: currentPlan.version,
    replayedFingerprint,
    currentFingerprint,
    replayedBriefFingerprint,
    currentBriefFingerprint,
    briefTransitions: briefTransitions.map(({ brief: _brief, ...transition }: any) => transition),
    ledgerHeadHash: integrity.headHash,
    lockedObjectViolations,
    truthFingerprintViolations,
  };
}
