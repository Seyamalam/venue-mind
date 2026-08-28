-- migration-destructive: false
-- migration-requires-project-export: false
CREATE TABLE project_collaboration_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  previous_event_id INTEGER,
  event_type TEXT NOT NULL,
  actor_user_id TEXT NOT NULL REFERENCES users(id),
  session_id TEXT NOT NULL,
  project_revision INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  occurred_at TEXT NOT NULL
)
-- statement-breakpoint
CREATE INDEX idx_collaboration_events_project_cursor ON project_collaboration_events(organization_id, project_id, id)
-- statement-breakpoint
CREATE TABLE project_presence (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  plan_version TEXT NOT NULL,
  focused_object_id TEXT,
  viewport_json TEXT,
  last_seen_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  PRIMARY KEY (project_id, session_id)
)
-- statement-breakpoint
CREATE INDEX idx_project_presence_expiry ON project_presence(organization_id, project_id, expires_at)
