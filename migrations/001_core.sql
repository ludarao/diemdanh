BEGIN;
CREATE TABLE IF NOT EXISTS schema_migrations(version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS admin_users (
  user_id uuid PRIMARY KEY, email text NOT NULL, enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS classes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, slug text NOT NULL UNIQUE,
  is_default boolean NOT NULL DEFAULT false, auto_daily boolean NOT NULL DEFAULT true,
  latitude double precision NOT NULL DEFAULT 13.993095 CHECK(latitude BETWEEN -90 AND 90),
  longitude double precision NOT NULL DEFAULT 107.997195 CHECK(longitude BETWEEN -180 AND 180),
  radius double precision NOT NULL DEFAULT 100 CHECK(radius > 0 AND radius < 'Infinity'::float8),
  max_accuracy double precision NOT NULL DEFAULT 150 CHECK(max_accuracy > 0 AND max_accuracy < 'Infinity'::float8),
  morning_open text NOT NULL DEFAULT '07:00', morning_deadline text NOT NULL DEFAULT '08:00',
  afternoon_open text NOT NULL DEFAULT '13:30', afternoon_deadline text NOT NULL DEFAULT '14:00',
  revision integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS classes_one_default ON classes(is_default) WHERE is_default;
CREATE TABLE IF NOT EXISTS students (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), class_id uuid NOT NULL REFERENCES classes(id),
  ordinal integer, name text NOT NULL, normalized_name text NOT NULL, birth_date date, unit text NOT NULL DEFAULT '',
  active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS students_names ON students(class_id, normalized_name) WHERE active;
CREATE TABLE IF NOT EXISTS sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), class_id uuid NOT NULL REFERENCES classes(id),
  day date NOT NULL, name text NOT NULL,
  opens_at timestamptz NOT NULL, deadline_at timestamptz NOT NULL, accepts_until timestamptz NOT NULL,
  state text NOT NULL DEFAULT 'active' CHECK(state IN ('active','cancelled')),
  latitude double precision NOT NULL, longitude double precision NOT NULL, radius double precision NOT NULL,
  max_accuracy double precision NOT NULL, config_revision integer NOT NULL,
  UNIQUE(class_id, day, name), CHECK(opens_at < deadline_at AND deadline_at < accepts_until)
);
CREATE INDEX IF NOT EXISTS sessions_day ON sessions(class_id,day);
CREATE TABLE IF NOT EXISTS session_roster (
  session_id uuid NOT NULL REFERENCES sessions(id), student_id uuid NOT NULL REFERENCES students(id),
  ordinal integer, name text NOT NULL, normalized_name text NOT NULL, unit text NOT NULL DEFAULT '',
  PRIMARY KEY(session_id,student_id)
);
CREATE INDEX IF NOT EXISTS roster_name ON session_roster(session_id,normalized_name);
CREATE TABLE IF NOT EXISTS attendance_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), class_id uuid NOT NULL REFERENCES classes(id),
  request_id uuid NOT NULL, payload_hash text NOT NULL, session_id uuid REFERENCES sessions(id),
  student_id uuid REFERENCES students(id), entered_name text NOT NULL, normalized_name text NOT NULL,
  entered_unit text NOT NULL DEFAULT '', declared_date text NOT NULL DEFAULT '',
  received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  kind text NOT NULL CHECK(kind IN ('present','reason')),
  match_state text NOT NULL CHECK(match_state IN ('matched','unmatched','ambiguous','outside_session')),
  reason text NOT NULL DEFAULT '', reason_status text CHECK(reason_status IN ('pending','approved','rejected')),
  device_id text NOT NULL, user_agent text NOT NULL DEFAULT '',
  latitude double precision, longitude double precision, accuracy double precision, distance double precision,
  config_snapshot jsonb NOT NULL DEFAULT '{}', UNIQUE(class_id,request_id),
  CHECK((kind='reason' AND length(reason)>0) OR kind='present')
);
CREATE INDEX IF NOT EXISTS attendance_session_device ON attendance_attempts(session_id,device_id) WHERE kind='present';
CREATE INDEX IF NOT EXISTS attendance_student ON attendance_attempts(session_id,student_id,received_at);
CREATE INDEX IF NOT EXISTS attendance_class_time ON attendance_attempts(class_id,received_at);
CREATE TABLE IF NOT EXISTS device_resolutions (
  session_id uuid NOT NULL REFERENCES sessions(id), device_id text NOT NULL, note text NOT NULL,
  actor_id uuid NOT NULL REFERENCES admin_users(user_id), created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(session_id,device_id)
);
CREATE TABLE IF NOT EXISTS audit_logs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, actor_id uuid REFERENCES admin_users(user_id),
  action text NOT NULL, class_id uuid REFERENCES classes(id), details jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS rate_limits (
  key text PRIMARY KEY, window_start timestamptz NOT NULL, hits integer NOT NULL
);
INSERT INTO classes(name,slug,is_default) VALUES ('Lớp học','lop-hoc',true) ON CONFLICT(slug) DO NOTHING;
INSERT INTO schema_migrations(version) VALUES ('001_core') ON CONFLICT DO NOTHING;
COMMIT;
