CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, checksum TEXT NOT NULL, applied_at TEXT NOT NULL, adopted INTEGER NOT NULL DEFAULT 0);
CREATE TABLE organization_retention_policies (
  organization_id TEXT PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  schema_version INTEGER NOT NULL CHECK (schema_version = 1),
  operational_sensitive_days INTEGER NOT NULL CHECK (operational_sensitive_days BETWEEN 30 AND 2555),
  security_evidence_days INTEGER NOT NULL CHECK (security_evidence_days BETWEEN 90 AND 2555),
  project_recovery_days INTEGER NOT NULL CHECK (project_recovery_days BETWEEN 0 AND 30),
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL REFERENCES users(id)
);
CREATE TABLE project_deletion_requests (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL,
  project_revision INTEGER NOT NULL CHECK (project_revision >= 1),
  status TEXT NOT NULL CHECK (status IN ('recoverable', 'recovered', 'purged')),
  reason_code TEXT NOT NULL CHECK (length(reason_code) BETWEEN 1 AND 80),
  requested_by TEXT NOT NULL REFERENCES users(id),
  requested_at TEXT NOT NULL,
  recovery_until TEXT NOT NULL,
  cache_directive_id TEXT NOT NULL UNIQUE,
  cache_acknowledged_at TEXT,
  cache_acknowledged_by TEXT REFERENCES users(id),
  recovered_at TEXT,
  recovered_by TEXT REFERENCES users(id),
  purged_at TEXT,
  purged_by TEXT REFERENCES users(id),
  purge_verification_json TEXT CHECK (purge_verification_json IS NULL OR (json_valid(purge_verification_json) AND json_type(purge_verification_json) = 'object')),
  evidence_fingerprint TEXT NOT NULL CHECK (length(evidence_fingerprint) = 64 AND evidence_fingerprint NOT GLOB '*[^0-9a-f]*')
);
CREATE UNIQUE INDEX idx_project_deletion_active ON project_deletion_requests(organization_id, project_id) WHERE status = 'recoverable';
CREATE INDEX idx_project_deletion_due ON project_deletion_requests(status, recovery_until);
CREATE TRIGGER validate_project_deletion_request_insert BEFORE INSERT ON project_deletion_requests BEGIN
  SELECT (CASE WHEN NEW.status != 'recoverable' OR NEW.requested_at > NEW.recovery_until THEN RAISE(ABORT, 'PROJECT_DELETION_REQUEST_INVALID') END);
  SELECT (CASE WHEN (NEW.cache_acknowledged_at IS NULL) != (NEW.cache_acknowledged_by IS NULL) THEN RAISE(ABORT, 'PROJECT_CACHE_ACK_INVALID') END);
  SELECT (CASE WHEN NOT EXISTS (SELECT 1 FROM projects p WHERE p.id = NEW.project_id AND p.organization_id = NEW.organization_id AND p.deleted_at = NEW.requested_at AND p.recovery_until = NEW.recovery_until) THEN RAISE(ABORT, 'PROJECT_DELETION_SCOPE_INVALID') END);
END;
CREATE TRIGGER validate_project_deletion_request_update BEFORE UPDATE ON project_deletion_requests BEGIN
  SELECT (CASE WHEN NEW.id != OLD.id OR NEW.organization_id != OLD.organization_id OR NEW.project_id != OLD.project_id OR NEW.project_revision != OLD.project_revision OR NEW.reason_code != OLD.reason_code OR NEW.requested_by != OLD.requested_by OR NEW.requested_at != OLD.requested_at OR NEW.recovery_until != OLD.recovery_until OR NEW.cache_directive_id != OLD.cache_directive_id THEN RAISE(ABORT, 'PROJECT_DELETION_EVIDENCE_IMMUTABLE') END);
  SELECT (CASE WHEN OLD.cache_acknowledged_at IS NOT NULL AND (NOT (NEW.cache_acknowledged_at IS OLD.cache_acknowledged_at) OR NOT (NEW.cache_acknowledged_by IS OLD.cache_acknowledged_by)) THEN RAISE(ABORT, 'PROJECT_CACHE_ACK_IMMUTABLE') END);
  SELECT (CASE WHEN OLD.status != 'recoverable' AND (NEW.status != OLD.status OR NOT (NEW.recovered_at IS OLD.recovered_at) OR NOT (NEW.recovered_by IS OLD.recovered_by) OR NOT (NEW.purged_at IS OLD.purged_at) OR NOT (NEW.purged_by IS OLD.purged_by) OR NOT (NEW.purge_verification_json IS OLD.purge_verification_json)) THEN RAISE(ABORT, 'PROJECT_DELETION_TERMINAL_EVIDENCE_IMMUTABLE') END);
  SELECT (CASE WHEN (NEW.cache_acknowledged_at IS NULL) != (NEW.cache_acknowledged_by IS NULL) THEN RAISE(ABORT, 'PROJECT_CACHE_ACK_INVALID') END);
  SELECT (CASE WHEN NOT ((OLD.status = 'recoverable' AND NEW.status IN ('recoverable', 'recovered', 'purged')) OR OLD.status = NEW.status) THEN RAISE(ABORT, 'PROJECT_DELETION_STATUS_INVALID') END);
  SELECT (CASE WHEN (NEW.status = 'recovered') != (NEW.recovered_at IS NOT NULL AND NEW.recovered_by IS NOT NULL) THEN RAISE(ABORT, 'PROJECT_RECOVERY_EVIDENCE_INVALID') END);
  SELECT (CASE WHEN (NEW.status = 'purged') != (NEW.purged_at IS NOT NULL AND NEW.purged_by IS NOT NULL AND NEW.purge_verification_json IS NOT NULL) THEN RAISE(ABORT, 'PROJECT_PURGE_EVIDENCE_INVALID') END);
  SELECT (CASE WHEN NEW.status = 'purged' AND (EXISTS (SELECT 1 FROM projects WHERE id = NEW.project_id) OR EXISTS (SELECT 1 FROM project_states WHERE project_id = NEW.project_id) OR EXISTS (SELECT 1 FROM project_collaboration_events WHERE project_id = NEW.project_id) OR EXISTS (SELECT 1 FROM project_presence WHERE project_id = NEW.project_id) OR EXISTS (SELECT 1 FROM project_share_links WHERE project_id = NEW.project_id) OR EXISTS (SELECT 1 FROM notifications WHERE project_id = NEW.project_id) OR EXISTS (SELECT 1 FROM event_day_runbooks WHERE project_id = NEW.project_id) OR EXISTS (SELECT 1 FROM event_day_runbook_tasks WHERE project_id = NEW.project_id) OR EXISTS (SELECT 1 FROM event_day_runbook_transitions WHERE project_id = NEW.project_id) OR EXISTS (SELECT 1 FROM event_day_runbook_ledger WHERE project_id = NEW.project_id) OR EXISTS (SELECT 1 FROM event_day_runbook_receipts WHERE project_id = NEW.project_id) OR EXISTS (SELECT 1 FROM live_occupancy_monitors WHERE project_id = NEW.project_id) OR EXISTS (SELECT 1 FROM event_day_incident_registers WHERE project_id = NEW.project_id) OR EXISTS (SELECT 1 FROM event_day_deviation_registers WHERE project_id = NEW.project_id)) THEN RAISE(ABORT, 'PROJECT_PURGE_VERIFICATION_FAILED') END);
END;
DROP TRIGGER reject_event_day_runbook_transition_delete;
CREATE TRIGGER reject_event_day_runbook_transition_delete BEFORE DELETE ON event_day_runbook_transitions WHEN EXISTS (SELECT 1 FROM projects p WHERE p.id = OLD.project_id) BEGIN
  SELECT RAISE(ABORT, 'RUNBOOK_TRANSITION_APPEND_ONLY');
END;
DROP TRIGGER reject_event_day_runbook_ledger_delete;
CREATE TRIGGER reject_event_day_runbook_ledger_delete BEFORE DELETE ON event_day_runbook_ledger WHEN EXISTS (SELECT 1 FROM projects p WHERE p.id = OLD.project_id) BEGIN
  SELECT RAISE(ABORT, 'RUNBOOK_LEDGER_APPEND_ONLY');
END;
DROP TRIGGER reject_event_day_runbook_receipt_delete;
CREATE TRIGGER reject_event_day_runbook_receipt_delete BEFORE DELETE ON event_day_runbook_receipts WHEN EXISTS (SELECT 1 FROM projects p WHERE p.id = OLD.project_id) BEGIN
  SELECT RAISE(ABORT, 'RUNBOOK_RECEIPT_APPEND_ONLY');
END;
INSERT INTO schema_migrations (version, name, checksum, applied_at, adopted) VALUES (12, 'data_protection', '02e4f04bf41d19f5789c069e41ae6b559e4dd0a49b3bd80573ac8fd10262aed9', CURRENT_TIMESTAMP, 0);
