import { applyDatabaseMigrations } from "./database-migrations.ts";

type D1Statement = {
  bind: (...values: unknown[]) => D1Statement;
  first: <T>() => Promise<T | null>;
  all: <T>() => Promise<{ results: T[] }>;
  run: () => Promise<unknown>;
};
type D1Database = { prepare: (sql: string) => D1Statement };

export type CollaborationEvent = {
  id: number;
  previousEventId: number | null;
  organizationId: string;
  projectId: string;
  type: string;
  actorUserId: string;
  sessionId: string;
  projectRevision: number;
  payload: Record<string, unknown>;
  occurredAt: string;
};

export type Presence = {
  organizationId: string;
  projectId: string;
  sessionId: string;
  userId: string;
  displayName: string;
  planVersion: string;
  focusedObjectId?: string | null;
  viewport?: Record<string, unknown> | null;
  lastSeenAt: string;
  expiresAt: string;
};

const initializedDatabases = new WeakSet<object>();
async function ensureSchema(db: D1Database) {
  if (initializedDatabases.has(db as object)) return;
  await applyDatabaseMigrations(db as never);
  initializedDatabases.add(db as object);
}

const mapEvent = (row: Record<string, unknown>): CollaborationEvent => ({
  id: Number(row.id),
  previousEventId: row.previous_event_id === null ? null : Number(row.previous_event_id),
  organizationId: String(row.organization_id),
  projectId: String(row.project_id),
  type: String(row.event_type),
  actorUserId: String(row.actor_user_id),
  sessionId: String(row.session_id),
  projectRevision: Number(row.project_revision),
  payload: JSON.parse(String(row.payload_json)),
  occurredAt: String(row.occurred_at),
});

const mapPresence = (row: Record<string, unknown>): Presence => ({
  organizationId: String(row.organization_id), projectId: String(row.project_id), sessionId: String(row.session_id), userId: String(row.user_id), displayName: String(row.display_name), planVersion: String(row.plan_version), focusedObjectId: row.focused_object_id ? String(row.focused_object_id) : null, viewport: row.viewport_json ? JSON.parse(String(row.viewport_json)) : null, lastSeenAt: String(row.last_seen_at), expiresAt: String(row.expires_at),
});

export function createD1CollaborationRepository(db: D1Database) {
  return {
    async append(input: Omit<CollaborationEvent, "id" | "previousEventId">) {
      await ensureSchema(db);
      const row = await db.prepare(
        `INSERT INTO project_collaboration_events (organization_id, project_id, previous_event_id, event_type, actor_user_id, session_id, project_revision, payload_json, occurred_at)
         VALUES (?, ?, (SELECT MAX(id) FROM project_collaboration_events WHERE organization_id = ? AND project_id = ?), ?, ?, ?, ?, ?, ?)
         RETURNING *`,
      ).bind(input.organizationId, input.projectId, input.organizationId, input.projectId, input.type, input.actorUserId, input.sessionId, input.projectRevision, JSON.stringify(input.payload), input.occurredAt).first<Record<string, unknown>>();
      if (!row) throw new Error("COLLABORATION_APPEND_FAILED");
      return mapEvent(row);
    },

    async events(organizationId: string, projectId: string, after = 0, limit = 100) {
      await ensureSchema(db);
      const { results } = await db.prepare(
        "SELECT * FROM project_collaboration_events WHERE organization_id = ? AND project_id = ? AND id > ? ORDER BY id LIMIT ?",
      ).bind(organizationId, projectId, after, Math.min(100, Math.max(1, limit))).all<Record<string, unknown>>();
      const events = results.map(mapEvent);
      const latest = await db.prepare("SELECT MAX(id) AS id FROM project_collaboration_events WHERE organization_id = ? AND project_id = ?").bind(organizationId, projectId).first<{ id: number | null }>();
      const cursor = Number(latest?.id ?? 0);
      const missed = after > cursor || (after > 0 && events.length > 0 && events[0].previousEventId !== after);
      return { events, cursor, missed };
    },

    async upsertPresence(input: Presence) {
      await ensureSchema(db);
      await db.prepare(
        `INSERT INTO project_presence (project_id, organization_id, session_id, user_id, display_name, plan_version, focused_object_id, viewport_json, last_seen_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(project_id, session_id) DO UPDATE SET display_name = excluded.display_name, plan_version = excluded.plan_version, focused_object_id = excluded.focused_object_id, viewport_json = excluded.viewport_json, last_seen_at = excluded.last_seen_at, expires_at = excluded.expires_at
         WHERE project_presence.organization_id = excluded.organization_id AND project_presence.user_id = excluded.user_id`,
      ).bind(input.projectId, input.organizationId, input.sessionId, input.userId, input.displayName, input.planVersion, input.focusedObjectId ?? null, input.viewport ? JSON.stringify(input.viewport) : null, input.lastSeenAt, input.expiresAt).run();
      return input;
    },

    async presence(organizationId: string, projectId: string, now: string) {
      await ensureSchema(db);
      await db.prepare("DELETE FROM project_presence WHERE expires_at <= ?").bind(now).run();
      const { results } = await db.prepare("SELECT * FROM project_presence WHERE organization_id = ? AND project_id = ? AND expires_at > ? ORDER BY display_name, session_id").bind(organizationId, projectId, now).all<Record<string, unknown>>();
      return results.map(mapPresence);
    },

    async removePresence(organizationId: string, projectId: string, sessionId: string, userId: string) {
      await ensureSchema(db);
      await db.prepare("DELETE FROM project_presence WHERE organization_id = ? AND project_id = ? AND session_id = ? AND user_id = ?").bind(organizationId, projectId, sessionId, userId).run();
    },
  };
}

export function createMemoryCollaborationRepository({ clock = () => new Date().toISOString() } = {}) {
  const eventRecords: CollaborationEvent[] = [];
  const presenceRecords = new Map<string, Presence>();
  return {
    async append(input: Omit<CollaborationEvent, "id" | "previousEventId">) {
      const previous = eventRecords.filter((event) => event.organizationId === input.organizationId && event.projectId === input.projectId).at(-1);
      const event = { ...structuredClone(input), id: eventRecords.length + 1, previousEventId: previous?.id ?? null };
      eventRecords.push(event);
      return structuredClone(event);
    },
    async events(organizationId: string, projectId: string, after = 0, limit = 100) {
      const events = eventRecords.filter((event) => event.organizationId === organizationId && event.projectId === projectId && event.id > after).slice(0, limit).map((event) => structuredClone(event));
      const cursor = eventRecords.filter((event) => event.organizationId === organizationId && event.projectId === projectId).at(-1)?.id ?? 0;
      return { events, cursor, missed: after > cursor || (after > 0 && events.length > 0 && events[0].previousEventId !== after) };
    },
    async upsertPresence(input: Presence) { presenceRecords.set(`${input.organizationId}:${input.projectId}:${input.sessionId}`, structuredClone(input)); return structuredClone(input); },
    async presence(organizationId: string, projectId: string, now = clock()) { return [...presenceRecords.values()].filter((item) => item.organizationId === organizationId && item.projectId === projectId && item.expiresAt > now).map((item) => structuredClone(item)); },
    async removePresence(organizationId: string, projectId: string, sessionId: string, userId: string) { const key = `${organizationId}:${projectId}:${sessionId}`; if (presenceRecords.get(key)?.userId === userId) presenceRecords.delete(key); },
    _events: eventRecords,
  };
}
