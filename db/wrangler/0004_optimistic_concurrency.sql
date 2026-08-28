CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, checksum TEXT NOT NULL, applied_at TEXT NOT NULL, adopted INTEGER NOT NULL DEFAULT 0);
ALTER TABLE projects ADD COLUMN revision INTEGER NOT NULL DEFAULT 1;
ALTER TABLE projects ADD COLUMN write_token TEXT;
CREATE UNIQUE INDEX idx_projects_write_token ON projects(write_token) WHERE write_token IS NOT NULL;
INSERT INTO schema_migrations (version, name, checksum, applied_at, adopted) VALUES (4, 'optimistic_concurrency', 'bfac1ab0c7d6320045da6af0863e094ff270087262d56fa8507ab414a59b169b', CURRENT_TIMESTAMP, 0);
