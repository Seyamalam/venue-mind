CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, checksum TEXT NOT NULL, applied_at TEXT NOT NULL, adopted INTEGER NOT NULL DEFAULT 0);
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  identity_provider TEXT NOT NULL,
  provider_subject TEXT NOT NULL,
  email TEXT NOT NULL,
  display_name TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  UNIQUE(identity_provider, provider_subject)
);
CREATE TABLE organizations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE TABLE organization_memberships (
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  roles_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (organization_id, user_id)
);
CREATE TABLE organization_invitations (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  roles_json TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  invited_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  accepted_at TEXT,
  revoked_at TEXT
);
CREATE TABLE user_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  last_seen_at TEXT NOT NULL
);
CREATE TABLE organization_audit_events (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,
  target_user_id TEXT,
  details_json TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  occurred_at TEXT NOT NULL
);
CREATE TABLE account_deletion_requests (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  requested_at TEXT NOT NULL,
  completed_at TEXT,
  status TEXT NOT NULL
);
ALTER TABLE projects ADD COLUMN organization_id TEXT REFERENCES organizations(id);
INSERT INTO users (id, identity_provider, provider_subject, email, display_name, status, created_at, updated_at)
SELECT 'user-legacy-migration', 'migration', 'legacy-project-owner', 'legacy-projects@venuemind.invalid', 'LEGACY', 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE EXISTS (SELECT 1 FROM projects) AND NOT EXISTS (SELECT 1 FROM users WHERE id = 'user-legacy-migration');
INSERT INTO organizations (id, name, slug, created_by, created_at, updated_at)
SELECT 'org-legacy-migration', 'LEGACY', 'legacy-migration', 'user-legacy-migration', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE EXISTS (SELECT 1 FROM projects) AND NOT EXISTS (SELECT 1 FROM organizations WHERE id = 'org-legacy-migration');
INSERT INTO organization_memberships (organization_id, user_id, roles_json, status, created_at, updated_at)
SELECT 'org-legacy-migration', 'user-legacy-migration', '["organization-administrator"]', 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE EXISTS (SELECT 1 FROM projects) AND NOT EXISTS (SELECT 1 FROM organization_memberships WHERE organization_id = 'org-legacy-migration' AND user_id = 'user-legacy-migration');
UPDATE projects SET organization_id = 'org-legacy-migration' WHERE organization_id IS NULL;
CREATE INDEX idx_projects_organization_updated ON projects(organization_id, updated_at DESC);
CREATE INDEX idx_memberships_user ON organization_memberships(user_id, status);
CREATE INDEX idx_invitations_organization_email ON organization_invitations(organization_id, email);
CREATE INDEX idx_sessions_user ON user_sessions(user_id, expires_at);
CREATE INDEX idx_account_audit_organization ON organization_audit_events(organization_id, occurred_at DESC);
INSERT INTO schema_migrations (version, name, checksum, applied_at, adopted) VALUES (3, 'accounts_and_tenancy', '9818dbe0d6e276af37e70d245f7c9558b1ad803458786ebef315e9af4ed10836', CURRENT_TIMESTAMP, 0);
