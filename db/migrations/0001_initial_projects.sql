-- migration-destructive: false
-- migration-requires-project-export: false
CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  active_plan_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
)
-- statement-breakpoint
CREATE TABLE project_states (
  project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  schema_version INTEGER NOT NULL,
  snapshot_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
)
-- statement-breakpoint
CREATE INDEX idx_projects_updated_at ON projects(updated_at DESC)
