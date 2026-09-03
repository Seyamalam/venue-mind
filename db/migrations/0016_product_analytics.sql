-- VenueMind database schema v16: aggregate-only product analytics.
-- migration-destructive: false
-- migration-requires-project-export: false
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
)
-- statement-breakpoint
CREATE INDEX idx_product_analytics_daily_window ON product_analytics_daily(scope_hash, metric_day DESC)
-- statement-breakpoint
CREATE INDEX idx_product_analytics_daily_retention ON product_analytics_daily(metric_day)
