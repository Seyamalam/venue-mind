CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, checksum TEXT NOT NULL, applied_at TEXT NOT NULL, adopted INTEGER NOT NULL DEFAULT 0);
CREATE TABLE observability_events (
  event_id TEXT PRIMARY KEY CHECK (length(event_id) BETWEEN 1 AND 96),
  scope_hash TEXT NOT NULL CHECK (length(scope_hash) = 64),
  occurred_at TEXT NOT NULL,
  correlation_id TEXT NOT NULL CHECK (length(correlation_id) BETWEEN 1 AND 96),
  component TEXT NOT NULL CHECK (component IN ('client', 'api', 'repository', 'planner', 'adapter')),
  operation TEXT NOT NULL CHECK (operation IN ('request', 'command', 'policy', 'validation', 'simulation', 'persistence', 'conflict', 'approval', 'ledger', 'integrity', 'external-adapter')),
  outcome TEXT NOT NULL CHECK (outcome IN ('started', 'ok', 'failed', 'conflict', 'approved', 'rejected', 'cancelled', 'degraded')),
  level TEXT NOT NULL CHECK (level IN ('info', 'warn', 'error')),
  duration_ms REAL CHECK (duration_ms IS NULL OR (duration_ms >= 0 AND duration_ms <= 3600000)),
  action TEXT CHECK (action IS NULL OR length(action) BETWEEN 1 AND 80),
  error_code TEXT CHECK (error_code IS NULL OR length(error_code) BETWEEN 1 AND 64)
);
CREATE INDEX idx_observability_events_time ON observability_events(scope_hash, occurred_at DESC);
CREATE INDEX idx_observability_events_correlation ON observability_events(scope_hash, correlation_id, occurred_at);
INSERT INTO schema_migrations (version, name, checksum, applied_at, adopted) VALUES (15, 'observability', '0dcf2e599ccad179b091e51ee941b03f1e6887951d497bad610d04c79624b44b', CURRENT_TIMESTAMP, 0);
