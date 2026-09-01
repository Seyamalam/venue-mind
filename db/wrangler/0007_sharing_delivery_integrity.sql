CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, checksum TEXT NOT NULL, applied_at TEXT NOT NULL, adopted INTEGER NOT NULL DEFAULT 0);
CREATE UNIQUE INDEX idx_projects_id_organization ON projects(id, organization_id);
ALTER TABLE project_share_links ADD COLUMN lifecycle_state TEXT NOT NULL DEFAULT 'active' CHECK (lifecycle_state IN ('pending-create', 'active', 'pending-revoke', 'revoked'));
ALTER TABLE project_share_links ADD COLUMN creation_ledgered_at TEXT;
ALTER TABLE project_share_links ADD COLUMN revocation_ledgered_at TEXT;
ALTER TABLE project_share_links ADD COLUMN operation_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE project_share_links ADD COLUMN last_operation_error TEXT;
UPDATE project_share_links SET creation_ledgered_at = created_at WHERE lifecycle_state = 'active' AND creation_ledgered_at IS NULL;
UPDATE project_share_links SET lifecycle_state = 'pending-revoke' WHERE revoked_at IS NOT NULL;
ALTER TABLE notifications ADD COLUMN in_app_visible INTEGER NOT NULL DEFAULT 1 CHECK (in_app_visible IN (0, 1));
ALTER TABLE notification_email_outbox ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE notification_email_outbox ADD COLUMN last_attempt_at TEXT;
ALTER TABLE notification_email_outbox ADD COLUMN lease_token TEXT;
ALTER TABLE notification_email_outbox ADD COLUMN lease_expires_at TEXT;
CREATE INDEX idx_share_links_pending ON project_share_links(lifecycle_state, created_at);
CREATE INDEX idx_email_outbox_pending ON notification_email_outbox(delivered_at, lease_expires_at, created_at);
CREATE TRIGGER validate_share_link_insert BEFORE INSERT ON project_share_links BEGIN
  SELECT (CASE WHEN length(NEW.token_hash) != 64 OR NEW.token_hash GLOB '*[^0-9a-f]*' THEN RAISE(ABORT, 'SHARE_LINK_TOKEN_INVALID') END);
  SELECT (CASE WHEN NOT ((NEW.scope = 'read-only' AND NEW.proposal_id IS NULL) OR (NEW.scope = 'reviewer' AND NEW.proposal_id IS NOT NULL AND length(NEW.proposal_id) > 0)) THEN RAISE(ABORT, 'SHARE_LINK_SCOPE_INVALID') END);
  SELECT (CASE WHEN NOT EXISTS (SELECT 1 FROM projects p WHERE p.id = NEW.project_id AND p.organization_id = NEW.organization_id) THEN RAISE(ABORT, 'SHARE_LINK_ORGANIZATION_INVALID') END);
  SELECT (CASE WHEN NEW.expires_at <= NEW.created_at THEN RAISE(ABORT, 'SHARE_LINK_EXPIRY_INVALID') END);
END;
CREATE TRIGGER validate_share_link_update BEFORE UPDATE ON project_share_links BEGIN
  SELECT (CASE WHEN length(NEW.token_hash) != 64 OR NEW.token_hash GLOB '*[^0-9a-f]*' THEN RAISE(ABORT, 'SHARE_LINK_TOKEN_INVALID') END);
  SELECT (CASE WHEN NOT ((NEW.scope = 'read-only' AND NEW.proposal_id IS NULL) OR (NEW.scope = 'reviewer' AND NEW.proposal_id IS NOT NULL AND length(NEW.proposal_id) > 0)) THEN RAISE(ABORT, 'SHARE_LINK_SCOPE_INVALID') END);
  SELECT (CASE WHEN NOT EXISTS (SELECT 1 FROM projects p WHERE p.id = NEW.project_id AND p.organization_id = NEW.organization_id) THEN RAISE(ABORT, 'SHARE_LINK_ORGANIZATION_INVALID') END);
  SELECT (CASE WHEN NEW.expires_at <= NEW.created_at THEN RAISE(ABORT, 'SHARE_LINK_EXPIRY_INVALID') END);
  SELECT (CASE WHEN NOT ((NEW.revoked_at IS NULL AND NEW.revoked_by IS NULL) OR (NEW.revoked_at IS NOT NULL AND NEW.revoked_by IS NOT NULL)) THEN RAISE(ABORT, 'SHARE_LINK_REVOCATION_INVALID') END);
  SELECT (CASE WHEN NEW.lifecycle_state IN ('pending-revoke', 'revoked') AND NEW.revoked_at IS NULL THEN RAISE(ABORT, 'SHARE_LINK_REVOCATION_INVALID') END);
  SELECT (CASE WHEN NEW.lifecycle_state = 'active' AND NEW.creation_ledgered_at IS NULL THEN RAISE(ABORT, 'SHARE_LINK_LEDGER_INVALID') END);
  SELECT (CASE WHEN NEW.lifecycle_state = 'revoked' AND NEW.revocation_ledgered_at IS NULL THEN RAISE(ABORT, 'SHARE_LINK_LEDGER_INVALID') END);
END;
CREATE TRIGGER validate_notification_insert BEFORE INSERT ON notifications BEGIN
  SELECT (CASE WHEN NEW.event_type NOT IN ('review_requested', 'adjustment_requested', 'approval_completed', 'conflict_detected') OR NEW.body_code != ('notification.' || NEW.event_type) THEN RAISE(ABORT, 'NOTIFICATION_TYPE_INVALID') END);
  SELECT (CASE WHEN NOT json_valid(NEW.subject_refs_json) OR json_type(NEW.subject_refs_json) != 'object' THEN RAISE(ABORT, 'NOTIFICATION_REFS_INVALID') END);
  SELECT (CASE WHEN NOT EXISTS (SELECT 1 FROM projects p WHERE p.id = NEW.project_id AND p.organization_id = NEW.organization_id) THEN RAISE(ABORT, 'NOTIFICATION_ORGANIZATION_INVALID') END);
END;
CREATE TRIGGER validate_notification_update BEFORE UPDATE ON notifications BEGIN
  SELECT (CASE WHEN NEW.event_type NOT IN ('review_requested', 'adjustment_requested', 'approval_completed', 'conflict_detected') OR NEW.body_code != ('notification.' || NEW.event_type) THEN RAISE(ABORT, 'NOTIFICATION_TYPE_INVALID') END);
  SELECT (CASE WHEN NOT json_valid(NEW.subject_refs_json) OR json_type(NEW.subject_refs_json) != 'object' THEN RAISE(ABORT, 'NOTIFICATION_REFS_INVALID') END);
  SELECT (CASE WHEN NOT EXISTS (SELECT 1 FROM projects p WHERE p.id = NEW.project_id AND p.organization_id = NEW.organization_id) THEN RAISE(ABORT, 'NOTIFICATION_ORGANIZATION_INVALID') END);
  SELECT (CASE WHEN NEW.in_app_visible NOT IN (0, 1) THEN RAISE(ABORT, 'NOTIFICATION_VISIBILITY_INVALID') END);
END;
CREATE TRIGGER validate_notification_preferences_insert BEFORE INSERT ON notification_preferences BEGIN
  SELECT (CASE WHEN NEW.in_app_enabled NOT IN (0, 1) OR NEW.email_enabled NOT IN (0, 1) OR NOT json_valid(NEW.event_types_json) OR json_type(NEW.event_types_json) != 'array' OR EXISTS (SELECT 1 FROM json_each(NEW.event_types_json) WHERE value NOT IN ('review_requested', 'adjustment_requested', 'approval_completed', 'conflict_detected')) THEN RAISE(ABORT, 'NOTIFICATION_PREFERENCES_INVALID') END);
END;
CREATE TRIGGER validate_notification_preferences_update BEFORE UPDATE ON notification_preferences BEGIN
  SELECT (CASE WHEN NEW.in_app_enabled NOT IN (0, 1) OR NEW.email_enabled NOT IN (0, 1) OR NOT json_valid(NEW.event_types_json) OR json_type(NEW.event_types_json) != 'array' OR EXISTS (SELECT 1 FROM json_each(NEW.event_types_json) WHERE value NOT IN ('review_requested', 'adjustment_requested', 'approval_completed', 'conflict_detected')) THEN RAISE(ABORT, 'NOTIFICATION_PREFERENCES_INVALID') END);
END;
CREATE TRIGGER validate_email_outbox_insert BEFORE INSERT ON notification_email_outbox BEGIN
  SELECT (CASE WHEN NOT json_valid(NEW.subject_refs_json) OR json_type(NEW.subject_refs_json) != 'object' THEN RAISE(ABORT, 'EMAIL_OUTBOX_REFS_INVALID') END);
  SELECT (CASE WHEN NOT EXISTS (SELECT 1 FROM notifications n WHERE n.id = NEW.notification_id AND n.body_code = NEW.body_code AND n.subject_refs_json = NEW.subject_refs_json) THEN RAISE(ABORT, 'EMAIL_OUTBOX_NOTIFICATION_INVALID') END);
END;
CREATE TRIGGER validate_email_outbox_update BEFORE UPDATE ON notification_email_outbox BEGIN
  SELECT (CASE WHEN NOT json_valid(NEW.subject_refs_json) OR json_type(NEW.subject_refs_json) != 'object' THEN RAISE(ABORT, 'EMAIL_OUTBOX_REFS_INVALID') END);
  SELECT (CASE WHEN NOT EXISTS (SELECT 1 FROM notifications n WHERE n.id = NEW.notification_id AND n.body_code = NEW.body_code AND n.subject_refs_json = NEW.subject_refs_json) THEN RAISE(ABORT, 'EMAIL_OUTBOX_NOTIFICATION_INVALID') END);
END;
INSERT INTO schema_migrations (version, name, checksum, applied_at, adopted) VALUES (7, 'sharing_delivery_integrity', 'acab21ce5eb3565a9f9b322371a7bbd1d9efc09acac124f91a8c0cac0d438d1e', CURRENT_TIMESTAMP, 0);
