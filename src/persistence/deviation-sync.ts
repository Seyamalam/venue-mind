import type { DeviationRemote } from "./deviation-remote.ts";
import type { DeviationStore } from "./deviation-store.ts";

interface SynchronizeDeviationsOptions {
  readonly projectId: string;
  readonly registerId: string;
  readonly store: DeviationStore;
  readonly remote: DeviationRemote;
}

export async function synchronizeDeviations({
  projectId,
  registerId,
  store,
  remote,
}: SynchronizeDeviationsOptions) {
  if (!projectId.trim() || !registerId.trim())
    throw new TypeError("Deviation sync requires Project and Deviation Register IDs");
  const pending = await store.listOutbox();
  if (!pending.length) {
    const loaded = await remote.get(projectId, registerId);
    await store.saveRegister(loaded.register, { authoritative: true });
    return {
      ...loaded,
      acknowledgements: loaded.acknowledgements ?? [],
      acknowledgement: { removed: [], retained: [], ignored: [] },
      syncState: {
        state: "online" as const,
        pendingCount: 0,
        conflictCount: 0,
        lastSyncedAt: loaded.register.updatedAt,
      },
    };
  }
  await store.markAttempted(pending.map((entry) => entry.idempotencyKey));
  const result = await remote.sync(
    projectId,
    registerId,
    pending.map((entry) => entry.command),
  );
  const acknowledgements = result.acknowledgements ?? [];
  await store.saveRegister(result.register, { authoritative: true });
  const acknowledgement = await store.acknowledge(acknowledgements);
  const remaining = await store.listOutbox();
  const conflictCount = remaining.filter(
    (entry) => entry.syncStatus === "conflict" || entry.syncStatus === "rejected",
  ).length;
  return {
    ...result,
    acknowledgements,
    acknowledgement,
    syncState: {
      state: conflictCount ? ("conflict" as const) : remaining.length ? ("offline" as const) : ("online" as const),
      pendingCount: remaining.length,
      conflictCount,
      lastSyncedAt: result.register.updatedAt,
    },
  };
}
