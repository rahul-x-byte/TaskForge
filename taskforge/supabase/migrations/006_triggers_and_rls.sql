-- Automatic Profile Creation Trigger on auth.users INSERT
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, name, email, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'name', NEW.email),
    NEW.email,
    'user'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Secure Helper Function for RLS Admin Check (non-recursive)
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN COALESCE(
    (SELECT role = 'admin' FROM public.profiles WHERE id = auth.uid()),
    false
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Revoke default public EXECUTE permissions on SECURITY DEFINER functions to eliminate Security Advisor warnings
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.is_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;

-- Enable Row Level Security (RLS) on all application tables
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workflows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workflow_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.schedules ENABLE ROW LEVEL SECURITY;

-- ----------------------------------------------------
-- RLS POLICIES FOR PROFILES
-- ----------------------------------------------------
DROP POLICY IF EXISTS "Users and Admins can view profiles" ON public.profiles;
CREATE POLICY "Users and Admins can view profiles"
  ON public.profiles FOR SELECT
  TO authenticated
  USING ((select auth.uid()) = id OR public.is_admin());

DROP POLICY IF EXISTS "Users and Admins can update profiles" ON public.profiles;
CREATE POLICY "Users and Admins can update profiles"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING ((select auth.uid()) = id OR public.is_admin())
  WITH CHECK ((select auth.uid()) = id OR public.is_admin());

-- ----------------------------------------------------
-- RLS POLICIES FOR WORKFLOWS
-- ----------------------------------------------------
DROP POLICY IF EXISTS "Users can view own workflows" ON public.workflows;
CREATE POLICY "Users can view own workflows"
  ON public.workflows FOR SELECT
  TO authenticated
  USING ((select auth.uid()) = user_id OR public.is_admin());

DROP POLICY IF EXISTS "Users can create own workflows" ON public.workflows;
CREATE POLICY "Users can create own workflows"
  ON public.workflows FOR INSERT
  TO authenticated
  WITH CHECK ((select auth.uid()) = user_id OR public.is_admin());

DROP POLICY IF EXISTS "Users can update own workflows" ON public.workflows;
CREATE POLICY "Users can update own workflows"
  ON public.workflows FOR UPDATE
  TO authenticated
  USING ((select auth.uid()) = user_id OR public.is_admin())
  WITH CHECK ((select auth.uid()) = user_id OR public.is_admin());

DROP POLICY IF EXISTS "Users can delete own workflows" ON public.workflows;
CREATE POLICY "Users can delete own workflows"
  ON public.workflows FOR DELETE
  TO authenticated
  USING ((select auth.uid()) = user_id OR public.is_admin());

-- ----------------------------------------------------
-- RLS POLICIES FOR WORKFLOW_VERSIONS
-- ----------------------------------------------------
DROP POLICY IF EXISTS "Users can view own workflow versions" ON public.workflow_versions;
CREATE POLICY "Users can view own workflow versions"
  ON public.workflow_versions FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.workflows w
      WHERE w.id = workflow_id AND w.user_id = (select auth.uid())
    ) OR public.is_admin()
  );

DROP POLICY IF EXISTS "Users can insert own workflow versions" ON public.workflow_versions;
CREATE POLICY "Users can insert own workflow versions"
  ON public.workflow_versions FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.workflows w
      WHERE w.id = workflow_id AND w.user_id = (select auth.uid())
    ) OR public.is_admin()
  );

DROP POLICY IF EXISTS "Users can update own workflow versions" ON public.workflow_versions;
CREATE POLICY "Users can update own workflow versions"
  ON public.workflow_versions FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.workflows w
      WHERE w.id = workflow_id AND w.user_id = (select auth.uid())
    ) OR public.is_admin()
  );

DROP POLICY IF EXISTS "Users can delete own workflow versions" ON public.workflow_versions;
CREATE POLICY "Users can delete own workflow versions"
  ON public.workflow_versions FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.workflows w
      WHERE w.id = workflow_id AND w.user_id = (select auth.uid())
    ) OR public.is_admin()
  );

-- ----------------------------------------------------
-- RLS POLICIES FOR RUNS
-- ----------------------------------------------------
DROP POLICY IF EXISTS "Users can view own workflow runs" ON public.runs;
CREATE POLICY "Users can view own workflow runs"
  ON public.runs FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.workflows w
      WHERE w.id = workflow_id AND w.user_id = (select auth.uid())
    ) OR public.is_admin()
  );

DROP POLICY IF EXISTS "Users can insert own workflow runs" ON public.runs;
CREATE POLICY "Users can insert own workflow runs"
  ON public.runs FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.workflows w
      WHERE w.id = workflow_id AND w.user_id = (select auth.uid())
    ) OR public.is_admin()
  );

DROP POLICY IF EXISTS "Users can update own workflow runs" ON public.runs;
CREATE POLICY "Users can update own workflow runs"
  ON public.runs FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.workflows w
      WHERE w.id = workflow_id AND w.user_id = (select auth.uid())
    ) OR public.is_admin()
  );

DROP POLICY IF EXISTS "Users can delete own workflow runs" ON public.runs;
CREATE POLICY "Users can delete own workflow runs"
  ON public.runs FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.workflows w
      WHERE w.id = workflow_id AND w.user_id = (select auth.uid())
    ) OR public.is_admin()
  );

-- ----------------------------------------------------
-- RLS POLICIES FOR SCHEDULES
-- ----------------------------------------------------
DROP POLICY IF EXISTS "Users can view own schedules" ON public.schedules;
CREATE POLICY "Users can view own schedules"
  ON public.schedules FOR SELECT
  TO authenticated
  USING ((select auth.uid()) = user_id OR public.is_admin());

DROP POLICY IF EXISTS "Users can insert own schedules" ON public.schedules;
CREATE POLICY "Users can insert own schedules"
  ON public.schedules FOR INSERT
  TO authenticated
  WITH CHECK ((select auth.uid()) = user_id OR public.is_admin());

DROP POLICY IF EXISTS "Users can update own schedules" ON public.schedules;
CREATE POLICY "Users can update own schedules"
  ON public.schedules FOR UPDATE
  TO authenticated
  USING ((select auth.uid()) = user_id OR public.is_admin());

DROP POLICY IF EXISTS "Users can delete own schedules" ON public.schedules;
CREATE POLICY "Users can delete own schedules"
  ON public.schedules FOR DELETE
  TO authenticated
  USING ((select auth.uid()) = user_id OR public.is_admin());
