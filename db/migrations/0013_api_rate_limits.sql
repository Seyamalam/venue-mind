-- migration-destructive: false
-- migration-requires-project-export: false
CREATE TABLE api_rate_limit_windows (
  scope_type TEXT NOT NULL CHECK (scope_type IN ('identity', 'organization')),
  scope_hash TEXT NOT NULL CHECK (length(scope_hash) = 64),
  endpoint_family TEXT NOT NULL CHECK (endpoint_family IN ('project-writes', 'operational-command-sync', 'sharing-membership-mutations', 'adapter-webhook-mutation')),
  window_started_at INTEGER NOT NULL CHECK (window_started_at >= 0),
  request_count INTEGER NOT NULL CHECK (request_count > 0),
  expires_at INTEGER NOT NULL CHECK (expires_at > window_started_at),
  PRIMARY KEY (scope_type, scope_hash, endpoint_family, window_started_at)
)
-- statement-breakpoint
CREATE INDEX idx_api_rate_limit_windows_expiry ON api_rate_limit_windows(expires_at)
