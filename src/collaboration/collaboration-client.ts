const EVENT_TYPES = [
  "project.created",
  "project.updated",
  "comment.updated",
  "ledger.appended",
  "proposal.updated",
  "approval.committed",
  "sync.reset",
  "sync.cursor",
  "presence.snapshot",
] as const;

type CollaborationEventType = (typeof EVENT_TYPES)[number];
type CollaborationStatus = "live" | "retry" | "unsupported" | "offline";
type JsonScalar = string | number | boolean | null;
type JsonValue = JsonScalar | JsonObject | JsonValue[];
type JsonObject = { [key: string]: JsonValue };

export interface PresenceState {
  planVersion: string;
  focusedObjectId: string | null;
  viewport: JsonObject | null;
}

export interface CollaborationEvent extends JsonObject {
  type: CollaborationEventType;
  id: number | null;
}

interface EventSourceLike {
  onopen: ((event: Event) => void) | null;
  onerror: ((event: Event) => void) | null;
  addEventListener(type: string, listener: (event: MessageEvent<string>) => void): void;
  close(): void;
}

interface EventSourceConstructor {
  new (url: string, eventSourceInitDict?: EventSourceInit): EventSourceLike;
}

export interface CollaborationClientOptions {
  projectId: string;
  organizationId: string;
  fetchImpl?: typeof globalThis.fetch;
  EventSourceImpl?: EventSourceConstructor;
  onEvent?: (event: CollaborationEvent) => void;
  onPresence?: (presence: JsonValue[]) => void;
  onStatus?: (status: CollaborationStatus) => void;
  heartbeatMs?: number;
}

const isJsonObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const decodeJsonValue = (value: unknown): JsonValue => {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean")
    return value;
  if (Array.isArray(value)) return value.map(decodeJsonValue);
  if (!isJsonObject(value)) throw new TypeError("Invalid collaboration event payload");
  const decoded: JsonObject = {};
  for (const [key, item] of Object.entries(value)) decoded[key] = decodeJsonValue(item);
  return decoded;
};

export function createCollaborationClient({
  projectId,
  organizationId,
  fetchImpl = globalThis.fetch.bind(globalThis),
  EventSourceImpl = globalThis.EventSource,
  onEvent = () => {},
  onPresence = () => {},
  onStatus = () => {},
  heartbeatMs = 10_000,
}: CollaborationClientOptions) {
  if (!projectId || !organizationId) throw new TypeError("Collaboration client requires Project and Organization IDs");
  let source: EventSourceLike | null = null;
  let heartbeat: ReturnType<typeof globalThis.setInterval> | null = null;
  let currentPresence: PresenceState = { planVersion: "0.0", focusedObjectId: null, viewport: null };
  const url = `/api/projects/${encodeURIComponent(projectId)}/collaboration?organizationId=${encodeURIComponent(organizationId)}`;
  const presenceUrl = `/api/projects/${encodeURIComponent(projectId)}/collaboration/presence?organizationId=${encodeURIComponent(organizationId)}`;
  const sendPresence = async () => {
    try {
      const response = await fetchImpl(presenceUrl, {
        method: "PUT",
        credentials: "same-origin",
        headers: { "content-type": "application/json", "x-venuemind-organization-id": organizationId },
        body: JSON.stringify(currentPresence),
      });
      if (!response.ok) throw new Error(`Presence failed: ${response.status}`);
      onStatus("live");
    } catch {
      onStatus("retry");
    }
  };
  return Object.freeze({
    start() {
      if (source || typeof EventSourceImpl !== "function") {
        if (!EventSourceImpl) onStatus("unsupported");
        return;
      }
      source = new EventSourceImpl(url, { withCredentials: true });
      source.onopen = () => onStatus("live");
      source.onerror = () => onStatus("retry");
      for (const type of EVENT_TYPES)
        source.addEventListener(type, (event) => {
          let decoded: JsonValue;
          try {
            decoded = decodeJsonValue(JSON.parse(event.data));
          } catch {
            return;
          }
          if (decoded === null || Array.isArray(decoded) || typeof decoded !== "object") return;
          if (type === "presence.snapshot") onPresence(Array.isArray(decoded["presence"]) ? decoded["presence"] : []);
          else onEvent({ ...decoded, type, id: event.lastEventId ? Number(event.lastEventId) : null });
        });
      void sendPresence();
      heartbeat = globalThis.setInterval(() => {
        void sendPresence();
      }, heartbeatMs);
    },
    updatePresence(next: Partial<PresenceState>) {
      currentPresence = { ...currentPresence, ...next };
      return sendPresence();
    },
    async stop() {
      if (heartbeat !== null) globalThis.clearInterval(heartbeat);
      heartbeat = null;
      source?.close();
      source = null;
      try {
        await fetchImpl(presenceUrl, {
          method: "DELETE",
          credentials: "same-origin",
          keepalive: true,
          headers: { "x-venuemind-organization-id": organizationId },
        });
      } catch {
        /* lease expires */
      }
      onStatus("offline");
    },
  });
}
