import { fingerprintEventBrief, fingerprintPlan, normalizeActivityLedger, replayActivityLedger, stableFingerprint, verifyActivityLedger } from "./activity-ledger.js";
import { normalizeEventBrief } from "./event-brief.js";
import { venueError } from "./errors.js";

const canonicalize = (value) => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  return value;
};

const sha256 = async (value) => {
  const bytes = new TextEncoder().encode(JSON.stringify(canonicalize(value)));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
};

export async function inspectLegacyBriefMigration(record) {
  const snapshot = record?.snapshot;
  if (!record?.id || !Number.isInteger(record.revision) || !snapshot?.plan || !snapshot?.brief || !Array.isArray(snapshot?.ledger)) throw venueError("SNAPSHOT_INVALID");
  const ledger = normalizeActivityLedger(snapshot.ledger);
  const integrity = verifyActivityLedger(ledger);
  if (integrity.status !== "pass") throw venueError("LEDGER_INTEGRITY_FAILED", { integrity });
  const requiresAttestation = ledger.every((entry) => !entry.details?.acceptedBrief && !entry.details?.briefFingerprint);
  if (!requiresAttestation) return { status: "not-required", projectId: record.id, projectRevision: record.revision, ledgerHeadHash: integrity.headHash };
  const replay = replayActivityLedger(ledger, snapshot.plan, null);
  if (replay.status !== "pass") throw venueError("LEDGER_INTEGRITY_FAILED", { replay }, "Legacy Activity Ledger does not reproduce accepted Plan truth.");
  const brief = normalizeEventBrief(snapshot.brief);
  const planSha256 = await sha256(snapshot.plan);
  const briefSha256 = await sha256(brief);
  const binding = {
    projectId: record.id,
    projectRevision: record.revision,
    legacyLedgerHeadHash: integrity.headHash,
    planSha256,
    briefSha256,
  };
  const challengeSha256 = await sha256(binding);
  const lastBriefEvidence = [...ledger].reverse().find((entry) => entry.type === "brief.updated")?.details ?? null;
  return {
    status: "attestation-required",
    challengeId: `legacy-brief-${challengeSha256.slice(0, 32)}`,
    ...binding,
    planFingerprint: fingerprintPlan(snapshot.plan),
    briefFingerprint: fingerprintEventBrief(brief),
    brief,
    legacyEvidence: {
      attendeeTarget: lastBriefEvidence?.attendeeTarget ?? null,
      requirementIds: Array.isArray(lastBriefEvidence?.requirementIds) ? [...lastBriefEvidence.requirementIds] : [],
      completeness: "partial",
      evidenceFingerprint: stableFingerprint("legacy-brief-evidence", lastBriefEvidence ?? {}),
    },
  };
}

export async function createLegacyBriefAttestationProof({ inspection, brief, actorId, actorRole, reason, idempotencyKey }) {
  const normalizedReason = String(reason ?? "").trim();
  const normalizedIdempotencyKey = String(idempotencyKey ?? "").trim();
  if (inspection?.status !== "attestation-required" || !normalizedReason || normalizedReason.length > 500 || !normalizedIdempotencyKey || normalizedIdempotencyKey.length > 200) throw venueError("LEGACY_BRIEF_ATTESTATION_REQUIRED", { reason: "attestation-input-invalid" });
  const attestationSha256 = await sha256({ challengeId: inspection.challengeId, actorId, actorRole, reason: normalizedReason, idempotencyKey: normalizedIdempotencyKey });
  return {
    source: "authenticated-human-attestation",
    brief: normalizeEventBrief(brief),
    attestationId: `attestation-${attestationSha256.slice(0, 32)}`,
    actorId,
    actorRole,
    challengeId: inspection.challengeId,
    projectRevision: inspection.projectRevision,
    legacyLedgerHeadHash: inspection.legacyLedgerHeadHash,
    planSha256: inspection.planSha256,
    briefSha256: inspection.briefSha256,
    reason: normalizedReason,
    idempotencyKey: normalizedIdempotencyKey,
  };
}
