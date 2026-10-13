BEGIN;
CREATE OR REPLACE FUNCTION public.is_attendance_admin() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public
AS $$ SELECT EXISTS(SELECT 1 FROM public.admin_users WHERE user_id=auth.uid() AND enabled AND role='admin') $$;
CREATE OR REPLACE FUNCTION public.can_view_attendance(target_class uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public
AS $$ SELECT EXISTS(SELECT 1 FROM public.admin_users u WHERE u.user_id=auth.uid() AND u.enabled
  AND (u.role='admin' OR (u.role='class_viewer' AND EXISTS(SELECT 1 FROM public.class_viewers v WHERE v.user_id=u.user_id AND v.class_id=target_class)))) $$;
REVOKE ALL ON FUNCTION public.can_view_attendance(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_view_attendance(uuid) TO authenticated;
ALTER TABLE public.class_viewers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.class_viewers FROM anon,authenticated;
DROP POLICY IF EXISTS attendance_admin_read ON public.attendance_attempts;
CREATE POLICY attendance_admin_read ON public.attendance_attempts FOR SELECT TO authenticated USING(public.can_view_attendance(class_id));
DROP POLICY IF EXISTS attendance_admin_read ON public.sessions;
CREATE POLICY attendance_admin_read ON public.sessions FOR SELECT TO authenticated USING(public.can_view_attendance(class_id));
-- Notes are included in the API dashboard. Direct access remains admin-only.
INSERT INTO schema_migrations(version) VALUES('004_class_viewers_security') ON CONFLICT DO NOTHING;
COMMIT;
