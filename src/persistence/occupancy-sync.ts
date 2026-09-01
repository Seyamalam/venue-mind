export async function synchronizeOccupancy({ projectId, monitorId, store, remote }: any) {
  const pending = await store.listOutbox();
  if (!pending.length) {
    const loaded = await remote.get(projectId, monitorId);
    await store.saveMonitor(loaded.monitor);
    return { ...loaded, syncState: { state: "online", pendingCount: 0, lastSyncedAt: loaded.monitor.updatedAt } };
  }
  await store.markAttempted(pending.map((entry: any) => entry.idempotencyKey));
  const result = await remote.sync(projectId, monitorId, pending.map((entry: any) => entry.command));
  await store.saveMonitor(result.monitor);
  const acknowledgement = await store.acknowledge(result.acknowledgements);
  const remaining = await store.listOutbox();
  const conflict = result.acknowledgements.some((item: any) => ["conflict", "rejected"].includes(item.status));
  return { ...result, acknowledgement, syncState: { state: conflict ? "conflict" : "online", pendingCount: remaining.length, lastSyncedAt: result.monitor.updatedAt } };
}
