const lastSyncedAt = (register: any) => register?.updatedAt ?? null;

export async function synchronizeIncidents({ projectId, registerId, store, remote }: any) {
  if (typeof projectId !== "string" || !projectId.trim() || typeof registerId !== "string" || !registerId.trim()) {
    throw new TypeError("Incident sync requires Project and Incident Register IDs");
  }
  if (!store || !remote) throw new TypeError("Incident sync requires store and remote adapters");

  const pending = await store.listOutbox();
  if (!pending.length) {
    const loaded = await remote.get(projectId, registerId);
    await store.saveRegister(loaded.register);
    return { ...loaded, syncState: { state: "online", pendingCount: 0, lastSyncedAt: lastSyncedAt(loaded.register) } };
  }

  await store.markAttempted(pending.map((entry: any) => entry.idempotencyKey));
  const result = await remote.sync(projectId, registerId, pending.map((entry: any) => entry.command));
  await store.saveRegister(result.register);
  const acknowledgement = await store.acknowledge(result.acknowledgements);
  const remaining = await store.listOutbox();
  const conflict = result.acknowledgements.some((item: any) => item.status === "conflict" || item.status === "rejected");
  return {
    ...result,
    acknowledgement,
    syncState: {
      state: conflict ? "conflict" : "online",
      pendingCount: remaining.length,
      lastSyncedAt: lastSyncedAt(result.register),
    },
  };
}

