BEGIN;
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'admin' CHECK(role IN ('admin','class_viewer'));
CREATE TABLE IF NOT EXISTS class_viewers (
  user_id uuid NOT NULL REFERENCES admin_users(user_id) ON DELETE CASCADE,
  class_id uuid NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  PRIMARY KEY(user_id,class_id)
);
CREATE INDEX IF NOT EXISTS class_viewers_class ON class_viewers(class_id);
INSERT INTO schema_migrations(version) VALUES('003_class_viewers') ON CONFLICT DO NOTHING;
COMMIT;
