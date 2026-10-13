-- Run on Supabase after 001_core.sql. Local database tests use only 001_core.sql.
BEGIN;
CREATE OR REPLACE FUNCTION public.is_attendance_admin() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public
AS $$ SELECT EXISTS(SELECT 1 FROM public.admin_users WHERE user_id=auth.uid() AND enabled) $$;
REVOKE ALL ON FUNCTION public.is_attendance_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_attendance_admin() TO authenticated;
ALTER TABLE public.admin_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.classes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.students ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.session_roster ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.device_resolutions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.schema_migrations ENABLE ROW LEVEL SECURITY;
-- Browser writes all go through authenticated server API; no direct insert/update policies.
REVOKE ALL ON public.admin_users,public.classes,public.students,public.sessions,public.session_roster,
  public.attendance_attempts,public.device_resolutions,public.audit_logs,public.rate_limits,public.schema_migrations FROM anon,authenticated;
GRANT SELECT ON public.attendance_attempts,public.sessions,public.device_resolutions TO authenticated;
DROP POLICY IF EXISTS attendance_admin_read ON public.attendance_attempts;
CREATE POLICY attendance_admin_read ON public.attendance_attempts FOR SELECT TO authenticated USING(public.is_attendance_admin());
DROP POLICY IF EXISTS attendance_admin_read ON public.sessions;
CREATE POLICY attendance_admin_read ON public.sessions FOR SELECT TO authenticated USING(public.is_attendance_admin());
DROP POLICY IF EXISTS attendance_admin_read ON public.device_resolutions;
CREATE POLICY attendance_admin_read ON public.device_resolutions FOR SELECT TO authenticated USING(public.is_attendance_admin());
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime') THEN
    IF NOT EXISTS(SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='attendance_attempts') THEN ALTER PUBLICATION supabase_realtime ADD TABLE public.attendance_attempts; END IF;
    IF NOT EXISTS(SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='sessions') THEN ALTER PUBLICATION supabase_realtime ADD TABLE public.sessions; END IF;
    IF NOT EXISTS(SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='device_resolutions') THEN ALTER PUBLICATION supabase_realtime ADD TABLE public.device_resolutions; END IF;
  END IF;
END $$;
INSERT INTO schema_migrations(version) VALUES('002_supabase_security') ON CONFLICT DO NOTHING;
COMMIT;
