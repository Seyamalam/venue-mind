CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, checksum TEXT NOT NULL, applied_at TEXT NOT NULL, adopted INTEGER NOT NULL DEFAULT 0);
CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  active_plan_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE project_states (
  project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  schema_version INTEGER NOT NULL,
  snapshot_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_projects_updated_at ON projects(updated_at DESC);
INSERT INTO schema_migrations (version, name, checksum, applied_at, adopted) VALUES (1, 'initial_projects', '35c5016e7ae358e1a8f477845b742f6738661a43959baf78dfc8d3d98deabc18', CURRENT_TIMESTAMP, 0);
