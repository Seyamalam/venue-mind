-- migration-destructive: false
-- migration-requires-project-export: false
ALTER TABLE projects ADD COLUMN provenance_json TEXT
-- statement-breakpoint
ALTER TABLE projects ADD COLUMN archived_at TEXT
-- statement-breakpoint
ALTER TABLE projects ADD COLUMN deleted_at TEXT
-- statement-breakpoint
ALTER TABLE projects ADD COLUMN recovery_until TEXT
-- statement-breakpoint
ALTER TABLE projects ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0
-- statement-breakpoint
ALTER TABLE projects ADD COLUMN last_opened_at TEXT
