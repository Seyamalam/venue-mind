CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, checksum TEXT NOT NULL, applied_at TEXT NOT NULL, adopted INTEGER NOT NULL DEFAULT 0);
CREATE TABLE project_share_links (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  proposal_id TEXT,
  scope TEXT NOT NULL CHECK (scope IN ('read-only', 'reviewer')),
  token_hash TEXT NOT NULL UNIQUE,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  revoked_by TEXT REFERENCES users(id)
);
CREATE INDEX idx_share_links_project ON project_share_links(organization_id, project_id, created_at DESC);
CREATE TABLE notification_preferences (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  in_app_enabled INTEGER NOT NULL DEFAULT 1,
  email_enabled INTEGER NOT NULL DEFAULT 0,
  event_types_json TEXT NOT NULL DEFAULT '["review_requested","adjustment_requested","approval_completed","conflict_detected"]',
  updated_at TEXT NOT NULL
);
CREATE TABLE notifications (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  body_code TEXT NOT NULL,
  subject_refs_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  read_at TEXT
);
CREATE INDEX idx_notifications_user_unread ON notifications(user_id, read_at, created_at DESC);
CREATE TABLE notification_email_outbox (
  id TEXT PRIMARY KEY,
  notification_id TEXT NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  recipient_email TEXT NOT NULL,
  body_code TEXT NOT NULL,
  subject_refs_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  delivered_at TEXT,
  failure_code TEXT
);
INSERT INTO schema_migrations (version, name, checksum, applied_at, adopted) VALUES (6, 'sharing_notifications', 'b7271cddc304567f93e12c4177069a91187a2ab92a6ded865d5e625b8c05034d', CURRENT_TIMESTAMP, 0);
