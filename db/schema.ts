export const schemaStatements = [
  `CREATE TABLE IF NOT EXISTS users (
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
  )`,
  `CREATE TABLE IF NOT EXISTS organizations (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    created_by TEXT NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS organization_memberships (
    organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    roles_json TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (organization_id, user_id)
  )`,
  `CREATE TABLE IF NOT EXISTS organization_invitations (
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
  )`,
  `CREATE TABLE IF NOT EXISTS user_sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    revoked_at TEXT,
    last_seen_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS organization_audit_events (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    actor_user_id TEXT NOT NULL REFERENCES users(id),
    target_user_id TEXT,
    details_json TEXT NOT NULL,
    fingerprint TEXT NOT NULL,
    occurred_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS account_deletion_requests (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    requested_at TEXT NOT NULL,
    completed_at TEXT,
    status TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    organization_id TEXT REFERENCES organizations(id),
    name TEXT NOT NULL,
    active_plan_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    provenance_json TEXT,
    archived_at TEXT,
    deleted_at TEXT,
    recovery_until TEXT,
    pinned INTEGER NOT NULL DEFAULT 0,
    last_opened_at TEXT,
    revision INTEGER NOT NULL DEFAULT 1,
    write_token TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS project_states (
    project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
    schema_version INTEGER NOT NULL,
    snapshot_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS project_collaboration_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    previous_event_id INTEGER,
    event_type TEXT NOT NULL,
    actor_user_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    project_revision INTEGER NOT NULL,
    payload_json TEXT NOT NULL,
    occurred_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS project_presence (
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
  )`,
  `CREATE TABLE IF NOT EXISTS project_share_links (
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
  )`,
  `CREATE TABLE IF NOT EXISTS notification_preferences (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    in_app_enabled INTEGER NOT NULL DEFAULT 1,
    email_enabled INTEGER NOT NULL DEFAULT 0,
    event_types_json TEXT NOT NULL DEFAULT '["review_requested","adjustment_requested","approval_completed","conflict_detected"]',
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    body_code TEXT NOT NULL,
    subject_refs_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    read_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS notification_email_outbox (
    id TEXT PRIMARY KEY,
    notification_id TEXT NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
    recipient_email TEXT NOT NULL,
    body_code TEXT NOT NULL,
    subject_refs_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    delivered_at TEXT,
    failure_code TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_projects_updated_at
    ON projects(updated_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_projects_organization_updated
    ON projects(organization_id, updated_at DESC)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_write_token
    ON projects(write_token) WHERE write_token IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS idx_collaboration_events_project_cursor
    ON project_collaboration_events(organization_id, project_id, id)`,
  `CREATE INDEX IF NOT EXISTS idx_project_presence_expiry
    ON project_presence(organization_id, project_id, expires_at)`,
  `CREATE INDEX IF NOT EXISTS idx_share_links_project
    ON project_share_links(organization_id, project_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
    ON notifications(user_id, read_at, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_memberships_user
    ON organization_memberships(user_id, status)`,
  `CREATE INDEX IF NOT EXISTS idx_invitations_organization_email
    ON organization_invitations(organization_id, email)`,
  `CREATE INDEX IF NOT EXISTS idx_sessions_user
    ON user_sessions(user_id, expires_at)`,
  `CREATE INDEX IF NOT EXISTS idx_account_audit_organization
    ON organization_audit_events(organization_id, occurred_at DESC)`,
];
