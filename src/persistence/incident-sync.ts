import type { IncidentRegister } from "../domain/operational-types.ts";
import type { IncidentRemote } from "./incident-remote.ts";
import type { IncidentStore } from "./incident-store.ts";

interface SynchronizeIncidentsOptions {
  readonly projectId: string;
  readonly registerId: string;
  readonly store: IncidentStore;
  readonly remote: IncidentRemote;
}

const lastSyncedAt = (register: IncidentRegister) => register.updatedAt;

export async function synchronizeIncidents({ projectId, registerId, store, remote }: SynchronizeIncidentsOptions) {
  if (!projectId.trim() || !registerId.trim())
    throw new TypeError("Incident sync requires Project and Incident Register IDs");
  const pending = await store.listOutbox();
  if (!pending.length) {
    const loaded = await remote.get(projectId, registerId);
    await store.saveRegister(loaded.register);
    return {
      ...loaded,
      acknowledgements: loaded.acknowledgements ?? [],
      syncState: { state: "online" as const, pendingCount: 0, lastSyncedAt: lastSyncedAt(loaded.register) },
    };
  }
  await store.markAttempted(pending.map((entry) => entry.idempotencyKey));
  const result = await remote.sync(
    projectId,
    registerId,
    pending.map((entry) => entry.command),
  );
  const acknowledgements = result.acknowledgements ?? [];
  await store.saveRegister(result.register);
  const acknowledgement = await store.acknowledge(acknowledgements);
  const remaining = await store.listOutbox();
  const conflict = acknowledgements.some((item) => item.status === "conflict" || item.status === "rejected");
  return {
    ...result,
    acknowledgements,
    acknowledgement,
    syncState: {
      state: conflict ? ("conflict" as const) : ("online" as const),
      pendingCount: remaining.length,
      lastSyncedAt: lastSyncedAt(result.register),
    },
  };
}
