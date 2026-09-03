CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, checksum TEXT NOT NULL, applied_at TEXT NOT NULL, adopted INTEGER NOT NULL DEFAULT 0);
-- VenueMind database schema v16: aggregate-only product analytics.
CREATE TABLE product_analytics_daily (
  scope_hash TEXT NOT NULL CHECK (length(scope_hash) = 64 AND scope_hash NOT GLOB '*[^0-9a-f]*'),
  metric_day TEXT NOT NULL CHECK (length(metric_day) = 10),
  event_name TEXT NOT NULL CHECK (event_name IN ('golden-loop.completed', 'validation.completed', 'adjustment.cycle', 'branch.compared', 'export.completed', 'product.error', 'workflow.abandoned')),
  outcome TEXT NOT NULL CHECK (outcome IN ('completed', 'pass', 'warn', 'fail', 'requested', 'compared', 'exported', 'error', 'abandoned')),
  stage TEXT NOT NULL CHECK (stage IN ('inspect', 'preview', 'validate', 'review', 'approve', 'adjust', 'compare', 'export')),
  error_category TEXT NOT NULL CHECK (error_category IN ('none', 'authorization', 'validation', 'conflict', 'persistence', 'export', 'unknown')),
  event_count INTEGER NOT NULL CHECK (event_count BETWEEN 1 AND 2147483647),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (scope_hash, metric_day, event_name, outcome, stage, error_category)
);
CREATE INDEX idx_product_analytics_daily_window ON product_analytics_daily(scope_hash, metric_day DESC);
CREATE INDEX idx_product_analytics_daily_retention ON product_analytics_daily(metric_day);
INSERT INTO schema_migrations (version, name, checksum, applied_at, adopted) VALUES (16, 'product_analytics', '2ab20058c0a231f0289277633aac4c8472b548feaef9c79618ecdee8e791124b', CURRENT_TIMESTAMP, 0);
