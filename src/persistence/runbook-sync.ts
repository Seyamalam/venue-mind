export async function synchronizeRunbook({ projectId, runbook, store, remote, clock = () => new Date().toISOString() }: any) {
  if (!projectId || !runbook?.versionId || !store || !remote) throw new TypeError("Runbook synchronization requires project, Runbook, store, and remote");
  const created = await remote.create(projectId, runbook);
  const pending = await store.listOutbox(runbook.versionId);
  let acknowledgements: any = [];
  let authoritative = created.runbook ?? runbook;

  if (pending.length) {
    const keys = pending.map((entry: any) => entry.idempotencyKey);
    await store.markAttempted(runbook.versionId, keys);
    const result = await remote.sync(projectId, runbook.versionId, pending.map((entry: any) => entry.command));
    acknowledgements = result.acknowledgements ?? result.results ?? [];
    authoritative = result.runbook ?? authoritative;
  }

  const reconciliation = await store.acknowledge(runbook.versionId, acknowledgements, { runbook: authoritative });
  const conflictCount = reconciliation.outbox.filter((entry: any) => ["conflict", "rejected"].includes(entry.syncStatus)).length;
  return {
    runbook: authoritative,
    acknowledgements,
    reconciliation,
    syncState: {
      state: conflictCount ? "conflict" : reconciliation.outbox.length ? "offline" : "online",
      pendingCount: reconciliation.outbox.length,
      conflictCount,
      lastSyncedAt: clock(),
    },
  };
}
