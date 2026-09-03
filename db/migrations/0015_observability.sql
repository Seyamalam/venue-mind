-- migration-destructive: false
-- migration-requires-project-export: false
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
)
-- statement-breakpoint
CREATE INDEX idx_observability_events_time ON observability_events(scope_hash, occurred_at DESC)
-- statement-breakpoint
CREATE INDEX idx_observability_events_correlation ON observability_events(scope_hash, correlation_id, occurred_at)
