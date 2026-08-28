CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, checksum TEXT NOT NULL, applied_at TEXT NOT NULL, adopted INTEGER NOT NULL DEFAULT 0);
ALTER TABLE projects ADD COLUMN provenance_json TEXT;
ALTER TABLE projects ADD COLUMN archived_at TEXT;
ALTER TABLE projects ADD COLUMN deleted_at TEXT;
ALTER TABLE projects ADD COLUMN recovery_until TEXT;
ALTER TABLE projects ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;
ALTER TABLE projects ADD COLUMN last_opened_at TEXT;
INSERT INTO schema_migrations (version, name, checksum, applied_at, adopted) VALUES (2, 'project_lifecycle', '60b091a88ba6bfd1c5a327d7ba594e6c9d74e72579696e0057804bc9636e7f4b', CURRENT_TIMESTAMP, 0);
