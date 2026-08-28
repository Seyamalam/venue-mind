-- migration-destructive: false
-- migration-requires-project-export: false
ALTER TABLE projects ADD COLUMN revision INTEGER NOT NULL DEFAULT 1
-- statement-breakpoint
ALTER TABLE projects ADD COLUMN write_token TEXT
-- statement-breakpoint
CREATE UNIQUE INDEX idx_projects_write_token ON projects(write_token) WHERE write_token IS NOT NULL
