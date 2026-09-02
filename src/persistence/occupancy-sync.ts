import type { OccupancyRemote } from "./occupancy-remote.ts";
import type { OccupancyStore } from "./occupancy-store.ts";

interface SynchronizeOccupancyOptions {
  readonly projectId: string;
  readonly monitorId: string;
  readonly store: OccupancyStore;
  readonly remote: OccupancyRemote;
}

export async function synchronizeOccupancy({ projectId, monitorId, store, remote }: SynchronizeOccupancyOptions) {
  const pending = await store.listOutbox();
  if (!pending.length) {
    const loaded = await remote.get(projectId, monitorId);
    await store.saveMonitor(loaded.monitor);
    return {
      ...loaded,
      acknowledgements: loaded.acknowledgements ?? [],
      syncState: { state: "online" as const, pendingCount: 0, lastSyncedAt: loaded.monitor.updatedAt },
    };
  }
  await store.markAttempted(pending.map((entry) => entry.idempotencyKey));
  const result = await remote.sync(
    projectId,
    monitorId,
    pending.map((entry) => entry.command),
  );
  const acknowledgements = result.acknowledgements ?? [];
  await store.saveMonitor(result.monitor);
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
      lastSyncedAt: result.monitor.updatedAt,
    },
  };
}
