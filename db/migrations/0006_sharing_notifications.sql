-- migration-destructive: false
-- migration-requires-project-export: false
CREATE UNIQUE INDEX idx_projects_id_organization ON projects(id, organization_id)
-- statement-breakpoint
CREATE TABLE project_share_links (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  proposal_id TEXT,
  scope TEXT NOT NULL CHECK (scope IN ('read-only', 'reviewer')),
  token_hash TEXT NOT NULL UNIQUE CHECK (length(token_hash) = 64 AND token_hash NOT GLOB '*[^0-9a-f]*'),
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL CHECK (expires_at > created_at),
  revoked_at TEXT,
  revoked_by TEXT REFERENCES users(id),
  CHECK ((scope = 'read-only' AND proposal_id IS NULL) OR (scope = 'reviewer' AND proposal_id IS NOT NULL AND length(proposal_id) > 0)),
  CHECK ((revoked_at IS NULL AND revoked_by IS NULL) OR (revoked_at IS NOT NULL AND revoked_by IS NOT NULL)),
  FOREIGN KEY (project_id, organization_id) REFERENCES projects(id, organization_id) ON DELETE CASCADE
)
-- statement-breakpoint
CREATE INDEX idx_share_links_project ON project_share_links(organization_id, project_id, created_at DESC)
-- statement-breakpoint
CREATE TABLE notification_preferences (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  in_app_enabled INTEGER NOT NULL DEFAULT 1 CHECK (in_app_enabled IN (0, 1)),
  email_enabled INTEGER NOT NULL DEFAULT 0 CHECK (email_enabled IN (0, 1)),
  event_types_json TEXT NOT NULL DEFAULT '["review_requested","adjustment_requested","approval_completed","conflict_detected"]' CHECK (json_valid(event_types_json) AND json_type(event_types_json) = 'array'),
  updated_at TEXT NOT NULL
)
-- statement-breakpoint
CREATE TABLE notifications (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN ('review_requested', 'adjustment_requested', 'approval_completed', 'conflict_detected')),
  body_code TEXT NOT NULL CHECK (body_code = 'notification.' || event_type),
  subject_refs_json TEXT NOT NULL CHECK (json_valid(subject_refs_json) AND json_type(subject_refs_json) = 'object'),
  created_at TEXT NOT NULL,
  read_at TEXT,
  FOREIGN KEY (project_id, organization_id) REFERENCES projects(id, organization_id) ON DELETE CASCADE
)
-- statement-breakpoint
CREATE INDEX idx_notifications_user_unread ON notifications(user_id, read_at, created_at DESC)
-- statement-breakpoint
CREATE TABLE notification_email_outbox (
  id TEXT PRIMARY KEY,
  notification_id TEXT NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  recipient_email TEXT NOT NULL,
  body_code TEXT NOT NULL,
  subject_refs_json TEXT NOT NULL CHECK (json_valid(subject_refs_json) AND json_type(subject_refs_json) = 'object'),
  created_at TEXT NOT NULL,
  delivered_at TEXT,
  failure_code TEXT
)
