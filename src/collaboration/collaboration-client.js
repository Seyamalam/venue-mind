const EVENT_TYPES = ["project.created", "project.updated", "comment.updated", "ledger.appended", "proposal.updated", "approval.committed", "sync.reset", "sync.cursor", "presence.snapshot"];

export function createCollaborationClient({
  projectId,
  organizationId,
  fetchImpl = globalThis.fetch?.bind(globalThis),
  EventSourceImpl = globalThis.EventSource,
  onEvent = () => {},
  onPresence = () => {},
  onStatus = () => {},
  heartbeatMs = 10_000,
} = {}) {
  if (!projectId || !organizationId) throw new TypeError("Collaboration client requires Project and Organization IDs");
  let source = null;
  let heartbeat = null;
  let currentPresence = { planVersion: "0.0", focusedObjectId: null, viewport: null };
  const url = `/api/projects/${encodeURIComponent(projectId)}/collaboration?organizationId=${encodeURIComponent(organizationId)}`;
  const presenceUrl = `/api/projects/${encodeURIComponent(projectId)}/collaboration/presence?organizationId=${encodeURIComponent(organizationId)}`;
  const sendPresence = async () => {
    try {
      const response = await fetchImpl(presenceUrl, { method: "PUT", credentials: "same-origin", headers: { "content-type": "application/json", "x-venuemind-organization-id": organizationId }, body: JSON.stringify(currentPresence) });
      if (!response.ok) throw new Error(`Presence failed: ${response.status}`);
      onStatus("live");
    } catch { onStatus("retry"); }
  };
  return Object.freeze({
    start() {
      if (source || typeof EventSourceImpl !== "function") { if (!EventSourceImpl) onStatus("unsupported"); return; }
      source = new EventSourceImpl(url, { withCredentials: true });
      source.onopen = () => onStatus("live");
      source.onerror = () => onStatus("retry");
      for (const type of EVENT_TYPES) source.addEventListener(type, (event) => {
        let data;
        try { data = JSON.parse(event.data); } catch { return; }
        if (type === "presence.snapshot") onPresence(data.presence ?? []);
        else onEvent({ type, id: event.lastEventId ? Number(event.lastEventId) : null, ...data });
      });
      void sendPresence();
      heartbeat = globalThis.setInterval(sendPresence, heartbeatMs);
    },
    updatePresence(next) {
      currentPresence = { ...currentPresence, ...next };
      return sendPresence();
    },
    async stop() {
      if (heartbeat) globalThis.clearInterval(heartbeat);
      heartbeat = null;
      source?.close();
      source = null;
      try { await fetchImpl(presenceUrl, { method: "DELETE", credentials: "same-origin", keepalive: true, headers: { "x-venuemind-organization-id": organizationId } }); } catch { /* lease expires */ }
      onStatus("offline");
    },
  });
}
