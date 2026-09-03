-- migration-destructive: false
-- migration-requires-project-export: false
CREATE TABLE post_event_reviews (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  runbook_id TEXT NOT NULL,
  schema_version INTEGER NOT NULL CHECK (schema_version = 1),
  baseline_fingerprint TEXT NOT NULL CHECK (length(baseline_fingerprint) > 0),
  definition_fingerprint TEXT NOT NULL CHECK (length(definition_fingerprint) > 0),
  baseline_json TEXT NOT NULL CHECK (json_valid(baseline_json) AND json_type(baseline_json) = 'object'),
  review_json TEXT NOT NULL CHECK (json_valid(review_json) AND json_type(review_json) = 'object'),
  revision INTEGER NOT NULL CHECK (revision >= 0),
  ledger_head_hash TEXT NOT NULL CHECK (length(ledger_head_hash) > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (runbook_id, organization_id, project_id),
  FOREIGN KEY (runbook_id, organization_id, project_id) REFERENCES event_day_runbooks(id, organization_id, project_id) ON DELETE CASCADE
)
-- statement-breakpoint
CREATE INDEX idx_post_event_reviews_project ON post_event_reviews(organization_id, project_id, updated_at DESC)
-- statement-breakpoint
CREATE TRIGGER validate_post_event_review_update BEFORE UPDATE ON post_event_reviews BEGIN
  SELECT CASE WHEN NEW.organization_id != OLD.organization_id OR NEW.project_id != OLD.project_id OR NEW.runbook_id != OLD.runbook_id OR NEW.schema_version != OLD.schema_version OR NEW.baseline_fingerprint != OLD.baseline_fingerprint OR NEW.definition_fingerprint != OLD.definition_fingerprint OR NEW.baseline_json != OLD.baseline_json OR NEW.created_at != OLD.created_at THEN RAISE(ABORT, 'POST_EVENT_REVIEW_BASELINE_IMMUTABLE') END;
  SELECT CASE WHEN NEW.revision != OLD.revision + 1 THEN RAISE(ABORT, 'POST_EVENT_REVIEW_REVISION_INVALID') END;
END
