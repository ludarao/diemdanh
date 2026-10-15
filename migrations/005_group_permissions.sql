BEGIN;
ALTER TABLE class_viewers ADD COLUMN IF NOT EXISTS can_import_roster boolean NOT NULL DEFAULT false;
ALTER TABLE class_viewers ADD COLUMN IF NOT EXISTS can_edit_schedule boolean NOT NULL DEFAULT false;
INSERT INTO schema_migrations(version) VALUES('005_group_permissions') ON CONFLICT DO NOTHING;
COMMIT;
