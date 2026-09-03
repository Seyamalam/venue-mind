CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, checksum TEXT NOT NULL, applied_at TEXT NOT NULL, adopted INTEGER NOT NULL DEFAULT 0);
CREATE TABLE event_day_runbooks (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  schema_version INTEGER NOT NULL CHECK (schema_version = 1),
  source_plan_id TEXT NOT NULL CHECK (length(source_plan_id) > 0),
  source_plan_version TEXT NOT NULL CHECK (length(source_plan_version) > 0),
  source_plan_fingerprint TEXT NOT NULL CHECK (length(source_plan_fingerprint) > 0),
  source_validation_id TEXT,
  source_validation_fingerprint TEXT,
  source_activity_ledger_head_hash TEXT NOT NULL CHECK (length(source_activity_ledger_head_hash) > 0),
  definition_json TEXT NOT NULL CHECK (json_valid(definition_json) AND json_type(definition_json) = 'object'),
  frozen_by TEXT NOT NULL CHECK (length(frozen_by) > 0),
  frozen_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  sequence INTEGER NOT NULL DEFAULT 0 CHECK (sequence >= 0),
  ledger_head_hash TEXT NOT NULL CHECK (length(ledger_head_hash) > 0),
  UNIQUE (id, organization_id, project_id),
  FOREIGN KEY (project_id, organization_id) REFERENCES projects(id, organization_id) ON DELETE CASCADE
);
CREATE TABLE event_day_runbook_tasks (
  runbook_id TEXT NOT NULL,
  id TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  phase_id TEXT NOT NULL CHECK (length(phase_id) > 0),
  owner_role TEXT CHECK (owner_role IS NULL OR length(owner_role) > 0),
  definition_json TEXT NOT NULL CHECK (json_valid(definition_json) AND json_type(definition_json) = 'object'),
  status TEXT NOT NULL CHECK (length(status) > 0),
  task_revision INTEGER NOT NULL DEFAULT 0 CHECK (task_revision >= 0),
  last_transition_id TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (runbook_id, id),
  UNIQUE (runbook_id, id, organization_id, project_id),
  FOREIGN KEY (runbook_id, organization_id, project_id) REFERENCES event_day_runbooks(id, organization_id, project_id) ON DELETE CASCADE
);
CREATE TABLE event_day_runbook_transitions (
  id TEXT PRIMARY KEY,
  runbook_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  runbook_sequence INTEGER NOT NULL CHECK (runbook_sequence >= 1),
  expected_task_revision INTEGER NOT NULL CHECK (expected_task_revision >= 0),
  task_revision INTEGER NOT NULL CHECK (task_revision = expected_task_revision + 1),
  from_status TEXT NOT NULL CHECK (length(from_status) > 0),
  to_status TEXT NOT NULL CHECK (length(to_status) > 0),
  actor_type TEXT NOT NULL CHECK (actor_type IN ('human', 'agent', 'system')),
  actor_id TEXT NOT NULL CHECK (length(actor_id) > 0),
  source TEXT NOT NULL CHECK (source IN ('studio', 'webmcp', 'mcp', 'system', 'agent-tool')),
  session_id TEXT NOT NULL CHECK (length(session_id) > 0),
  reason_code TEXT CHECK (reason_code IS NULL OR length(reason_code) > 0),
  client_id TEXT NOT NULL CHECK (length(client_id) > 0),
  client_sequence INTEGER NOT NULL CHECK (client_sequence >= 1),
  client_occurred_at TEXT NOT NULL CHECK (length(client_occurred_at) > 0),
  accepted_at TEXT NOT NULL,
  evidence_json TEXT NOT NULL CHECK (json_valid(evidence_json) AND json_type(evidence_json) = 'array'),
  idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) > 0),
  input_fingerprint TEXT NOT NULL CHECK (length(input_fingerprint) > 0),
  correlation_id TEXT NOT NULL CHECK (length(correlation_id) > 0),
  UNIQUE (runbook_id, runbook_sequence),
  UNIQUE (runbook_id, idempotency_key),
  UNIQUE (runbook_id, client_id, client_sequence),
  UNIQUE (runbook_id, id, organization_id, project_id),
  FOREIGN KEY (runbook_id, task_id, organization_id, project_id) REFERENCES event_day_runbook_tasks(runbook_id, id, organization_id, project_id) ON DELETE CASCADE
);
CREATE TABLE event_day_runbook_ledger (
  id TEXT PRIMARY KEY,
  runbook_id TEXT NOT NULL,
  transition_id TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  schema_version INTEGER NOT NULL CHECK (schema_version = 1),
  sequence INTEGER NOT NULL CHECK (sequence >= 1),
  event_type TEXT NOT NULL CHECK (event_type = 'runbook.task_transitioned'),
  actor_type TEXT NOT NULL CHECK (actor_type IN ('human', 'agent', 'system')),
  actor_id TEXT NOT NULL CHECK (length(actor_id) > 0),
  source TEXT NOT NULL CHECK (source IN ('studio', 'webmcp', 'mcp', 'system', 'agent-tool')),
  session_id TEXT NOT NULL CHECK (length(session_id) > 0),
  occurred_at TEXT NOT NULL,
  details_json TEXT NOT NULL CHECK (json_valid(details_json) AND json_type(details_json) = 'object'),
  previous_hash TEXT NOT NULL CHECK (length(previous_hash) > 0),
  hash TEXT NOT NULL CHECK (length(hash) > 0),
  UNIQUE (runbook_id, sequence),
  UNIQUE (runbook_id, transition_id),
  UNIQUE (runbook_id, id, organization_id, project_id),
  FOREIGN KEY (runbook_id, transition_id, organization_id, project_id) REFERENCES event_day_runbook_transitions(runbook_id, id, organization_id, project_id) ON DELETE CASCADE
);
CREATE TABLE event_day_runbook_receipts (
  id TEXT PRIMARY KEY,
  runbook_id TEXT NOT NULL,
  transition_id TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) > 0),
  input_fingerprint TEXT NOT NULL CHECK (length(input_fingerprint) > 0),
  correlation_id TEXT NOT NULL CHECK (length(correlation_id) > 0),
  result_json TEXT NOT NULL CHECK (json_valid(result_json) AND json_type(result_json) = 'object'),
  occurred_at TEXT NOT NULL,
  UNIQUE (runbook_id, idempotency_key),
  UNIQUE (runbook_id, transition_id),
  FOREIGN KEY (runbook_id, transition_id, organization_id, project_id) REFERENCES event_day_runbook_transitions(runbook_id, id, organization_id, project_id) ON DELETE CASCADE
);
CREATE INDEX idx_event_day_runbooks_project ON event_day_runbooks(organization_id, project_id, frozen_at DESC);
CREATE INDEX idx_event_day_runbook_tasks_view ON event_day_runbook_tasks(runbook_id, owner_role, phase_id, status, id);
CREATE INDEX idx_event_day_runbook_transitions_cursor ON event_day_runbook_transitions(runbook_id, runbook_sequence);
CREATE TRIGGER validate_event_day_runbook_update BEFORE UPDATE ON event_day_runbooks BEGIN
  SELECT (CASE WHEN NEW.organization_id != OLD.organization_id OR NEW.project_id != OLD.project_id OR NEW.schema_version != OLD.schema_version OR NEW.source_plan_id != OLD.source_plan_id OR NEW.source_plan_version != OLD.source_plan_version OR NEW.source_plan_fingerprint != OLD.source_plan_fingerprint OR NOT (NEW.source_validation_id IS OLD.source_validation_id) OR NOT (NEW.source_validation_fingerprint IS OLD.source_validation_fingerprint) OR NEW.source_activity_ledger_head_hash != OLD.source_activity_ledger_head_hash OR NEW.definition_json != OLD.definition_json OR NEW.frozen_by != OLD.frozen_by OR NEW.frozen_at != OLD.frozen_at THEN RAISE(ABORT, 'RUNBOOK_BASELINE_IMMUTABLE') END);
  SELECT (CASE WHEN NOT ((NEW.sequence = OLD.sequence AND NEW.ledger_head_hash = OLD.ledger_head_hash) OR (NEW.sequence = OLD.sequence + 1 AND EXISTS (SELECT 1 FROM event_day_runbook_ledger l WHERE l.runbook_id = NEW.id AND l.organization_id = NEW.organization_id AND l.project_id = NEW.project_id AND l.sequence = NEW.sequence AND l.previous_hash = OLD.ledger_head_hash AND l.hash = NEW.ledger_head_hash))) THEN RAISE(ABORT, 'RUNBOOK_SEQUENCE_INVALID') END);
END;
CREATE TRIGGER validate_event_day_runbook_task_insert BEFORE INSERT ON event_day_runbook_tasks BEGIN
  SELECT (CASE WHEN NOT EXISTS (SELECT 1 FROM event_day_runbooks r WHERE r.id = NEW.runbook_id AND r.organization_id = NEW.organization_id AND r.project_id = NEW.project_id AND r.sequence = 0 AND r.ledger_head_hash = r.source_activity_ledger_head_hash) THEN RAISE(ABORT, 'RUNBOOK_TASK_BASELINE_INVALID') END);
END;
CREATE TRIGGER validate_event_day_runbook_task_update BEFORE UPDATE ON event_day_runbook_tasks BEGIN
  SELECT (CASE WHEN NEW.runbook_id != OLD.runbook_id OR NEW.id != OLD.id OR NEW.organization_id != OLD.organization_id OR NEW.project_id != OLD.project_id OR NEW.phase_id != OLD.phase_id OR NOT (NEW.owner_role IS OLD.owner_role) OR NEW.definition_json != OLD.definition_json THEN RAISE(ABORT, 'RUNBOOK_TASK_DEFINITION_IMMUTABLE') END);
  SELECT (CASE WHEN NEW.task_revision != OLD.task_revision + 1 OR NEW.last_transition_id IS NULL THEN RAISE(ABORT, 'RUNBOOK_TASK_REVISION_INVALID') END);
  SELECT (CASE WHEN NOT EXISTS (SELECT 1 FROM event_day_runbook_transitions t WHERE t.runbook_id = NEW.runbook_id AND t.id = NEW.last_transition_id AND t.task_id = NEW.id AND t.task_revision = NEW.task_revision AND t.to_status = NEW.status) THEN RAISE(ABORT, 'RUNBOOK_TASK_TRANSITION_INVALID') END);
END;
CREATE TRIGGER validate_event_day_runbook_transition_insert BEFORE INSERT ON event_day_runbook_transitions BEGIN
  SELECT (CASE WHEN NOT EXISTS (SELECT 1 FROM event_day_runbook_tasks t WHERE t.runbook_id = NEW.runbook_id AND t.id = NEW.task_id AND t.organization_id = NEW.organization_id AND t.project_id = NEW.project_id AND t.task_revision = NEW.expected_task_revision AND t.status = NEW.from_status) THEN RAISE(ABORT, 'RUNBOOK_TASK_REVISION_CONFLICT') END);
  SELECT (CASE WHEN NOT EXISTS (SELECT 1 FROM event_day_runbooks r WHERE r.id = NEW.runbook_id AND r.organization_id = NEW.organization_id AND r.project_id = NEW.project_id AND r.sequence + 1 = NEW.runbook_sequence) THEN RAISE(ABORT, 'RUNBOOK_SEQUENCE_CONFLICT') END);
END;
CREATE TRIGGER reject_event_day_runbook_transition_update BEFORE UPDATE ON event_day_runbook_transitions BEGIN
  SELECT RAISE(ABORT, 'RUNBOOK_TRANSITION_APPEND_ONLY');
END;
CREATE TRIGGER reject_event_day_runbook_transition_delete BEFORE DELETE ON event_day_runbook_transitions BEGIN
  SELECT RAISE(ABORT, 'RUNBOOK_TRANSITION_APPEND_ONLY');
END;
CREATE TRIGGER validate_event_day_runbook_ledger_insert BEFORE INSERT ON event_day_runbook_ledger BEGIN
  SELECT (CASE WHEN NOT EXISTS (SELECT 1 FROM event_day_runbook_transitions t WHERE t.runbook_id = NEW.runbook_id AND t.id = NEW.transition_id AND t.organization_id = NEW.organization_id AND t.project_id = NEW.project_id AND t.runbook_sequence = NEW.sequence AND t.actor_type = NEW.actor_type AND t.actor_id = NEW.actor_id AND t.source = NEW.source AND t.session_id = NEW.session_id AND t.accepted_at = NEW.occurred_at) THEN RAISE(ABORT, 'RUNBOOK_LEDGER_TRANSITION_INVALID') END);
  SELECT (CASE WHEN NOT EXISTS (SELECT 1 FROM event_day_runbooks r WHERE r.id = NEW.runbook_id AND r.organization_id = NEW.organization_id AND r.project_id = NEW.project_id AND r.ledger_head_hash = NEW.previous_hash) THEN RAISE(ABORT, 'RUNBOOK_LEDGER_PREVIOUS_HASH_INVALID') END);
END;
CREATE TRIGGER reject_event_day_runbook_ledger_update BEFORE UPDATE ON event_day_runbook_ledger BEGIN
  SELECT RAISE(ABORT, 'RUNBOOK_LEDGER_APPEND_ONLY');
END;
CREATE TRIGGER reject_event_day_runbook_ledger_delete BEFORE DELETE ON event_day_runbook_ledger BEGIN
  SELECT RAISE(ABORT, 'RUNBOOK_LEDGER_APPEND_ONLY');
END;
CREATE TRIGGER validate_event_day_runbook_receipt_insert BEFORE INSERT ON event_day_runbook_receipts BEGIN
  SELECT (CASE WHEN NOT EXISTS (SELECT 1 FROM event_day_runbook_transitions t WHERE t.runbook_id = NEW.runbook_id AND t.id = NEW.transition_id AND t.organization_id = NEW.organization_id AND t.project_id = NEW.project_id AND t.idempotency_key = NEW.idempotency_key AND t.input_fingerprint = NEW.input_fingerprint AND t.correlation_id = NEW.correlation_id) THEN RAISE(ABORT, 'RUNBOOK_RECEIPT_TRANSITION_INVALID') END);
END;
CREATE TRIGGER reject_event_day_runbook_receipt_update BEFORE UPDATE ON event_day_runbook_receipts BEGIN
  SELECT RAISE(ABORT, 'RUNBOOK_RECEIPT_APPEND_ONLY');
END;
CREATE TRIGGER reject_event_day_runbook_receipt_delete BEFORE DELETE ON event_day_runbook_receipts BEGIN
  SELECT RAISE(ABORT, 'RUNBOOK_RECEIPT_APPEND_ONLY');
END;
INSERT INTO schema_migrations (version, name, checksum, applied_at, adopted) VALUES (8, 'event_day_runbooks', '60c2ced659cdc107b6fb8d5eb0d80d70074f7a7cc903596404d435d7a4d3158b', CURRENT_TIMESTAMP, 0);
