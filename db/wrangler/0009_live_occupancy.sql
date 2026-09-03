CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, checksum TEXT NOT NULL, applied_at TEXT NOT NULL, adopted INTEGER NOT NULL DEFAULT 0);
CREATE TABLE live_occupancy_monitors (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  runbook_id TEXT NOT NULL,
  schema_version INTEGER NOT NULL CHECK (schema_version = 1),
  baseline_fingerprint TEXT NOT NULL CHECK (length(baseline_fingerprint) > 0),
  baseline_json TEXT NOT NULL CHECK (json_valid(baseline_json) AND json_type(baseline_json) = 'object'),
  monitor_json TEXT NOT NULL CHECK (json_valid(monitor_json) AND json_type(monitor_json) = 'object'),
  revision INTEGER NOT NULL CHECK (revision >= 0),
  ledger_head_hash TEXT NOT NULL CHECK (length(ledger_head_hash) > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (runbook_id, organization_id, project_id),
  FOREIGN KEY (runbook_id, organization_id, project_id) REFERENCES event_day_runbooks(id, organization_id, project_id) ON DELETE CASCADE
);
CREATE INDEX idx_live_occupancy_project ON live_occupancy_monitors(organization_id, project_id, updated_at DESC);
CREATE TRIGGER validate_live_occupancy_update BEFORE UPDATE ON live_occupancy_monitors BEGIN
  SELECT (CASE WHEN NEW.organization_id != OLD.organization_id OR NEW.project_id != OLD.project_id OR NEW.runbook_id != OLD.runbook_id OR NEW.schema_version != OLD.schema_version OR NEW.baseline_fingerprint != OLD.baseline_fingerprint OR NEW.baseline_json != OLD.baseline_json OR NEW.created_at != OLD.created_at THEN RAISE(ABORT, 'OCCUPANCY_BASELINE_IMMUTABLE') END);
  SELECT (CASE WHEN NEW.revision != OLD.revision + 1 THEN RAISE(ABORT, 'OCCUPANCY_REVISION_INVALID') END);
END;
INSERT INTO schema_migrations (version, name, checksum, applied_at, adopted) VALUES (9, 'live_occupancy', '1ce0ac407378f795c8a4a2e667574cb1e79d89bd6be06d1d8d24cde8690b0222', CURRENT_TIMESTAMP, 0);
