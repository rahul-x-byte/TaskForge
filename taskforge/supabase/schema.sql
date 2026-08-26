-- ====================================================
-- TASKFORGE COMPLETE SUPABASE DATABASE SCHEMA & RLS
-- ====================================================

-- 1. Create Profiles Table (Linked to auth.users)
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_profiles_email ON public.profiles(email);
CREATE INDEX IF NOT EXISTS idx_profiles_role ON public.profiles(role);

-- 2. Create Workflows Table
CREATE TABLE IF NOT EXISTS public.workflows (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    current_version_id UUID NULL
);

CREATE INDEX IF NOT EXISTS idx_workflows_user_id ON public.workflows(user_id);

-- 3. Create Workflow Versions Table
CREATE TABLE IF NOT EXISTS public.workflow_versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workflow_id UUID NOT NULL REFERENCES public.workflows(id) ON DELETE CASCADE,
    steps JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_workflow_versions_workflow_id ON public.workflow_versions(workflow_id);

-- 4. Create Runs Table
CREATE TABLE IF NOT EXISTS public.runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workflow_id UUID NOT NULL REFERENCES public.workflows(id) ON DELETE CASCADE,
    version_id UUID REFERENCES public.workflow_versions(id) ON DELETE CASCADE,
    status TEXT NOT NULL,
    started_at TIMESTAMPTZ DEFAULT now(),
    finished_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_runs_workflow_id ON public.runs(workflow_id);
CREATE INDEX IF NOT EXISTS idx_runs_status ON public.runs(status);

-- 5. Create Schedules Table
CREATE TABLE IF NOT EXISTS public.schedules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    workflow_id UUID REFERENCES public.workflows(id) ON DELETE CASCADE,
    frequency TEXT NOT NULL,
    time TEXT,
    enabled BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_schedules_user_id ON public.schedules(user_id);
CREATE INDEX IF NOT EXISTS idx_schedules_workflow_id ON public.schedules(workflow_id);

-- 6. Automatic Profile Creation Trigger on auth.users INSERT
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

-- 7. Helper Function for RLS Admin Check
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

-- 8. Enable Row Level Security (RLS) on all tables
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workflows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workflow_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.schedules ENABLE ROW LEVEL SECURITY;

-- 9. RLS Policies for Profiles
DROP POLICY IF EXISTS "Users and Admins can view profiles" ON public.profiles;
CREATE POLICY "Users and Admins can view profiles"
  ON public.profiles FOR SELECT TO authenticated
  USING ((select auth.uid()) = id OR public.is_admin());

DROP POLICY IF EXISTS "Users and Admins can update profiles" ON public.profiles;
CREATE POLICY "Users and Admins can update profiles"
  ON public.profiles FOR UPDATE TO authenticated
  USING ((select auth.uid()) = id OR public.is_admin())
  WITH CHECK ((select auth.uid()) = id OR public.is_admin());

-- 10. RLS Policies for Workflows
DROP POLICY IF EXISTS "Users can view own workflows" ON public.workflows;
CREATE POLICY "Users can view own workflows"
  ON public.workflows FOR SELECT TO authenticated
  USING ((select auth.uid()) = user_id OR public.is_admin());

DROP POLICY IF EXISTS "Users can create own workflows" ON public.workflows;
CREATE POLICY "Users can create own workflows"
  ON public.workflows FOR INSERT TO authenticated
  WITH CHECK ((select auth.uid()) = user_id OR public.is_admin());

DROP POLICY IF EXISTS "Users can update own workflows" ON public.workflows;
CREATE POLICY "Users can update own workflows"
  ON public.workflows FOR UPDATE TO authenticated
  USING ((select auth.uid()) = user_id OR public.is_admin())
  WITH CHECK ((select auth.uid()) = user_id OR public.is_admin());

DROP POLICY IF EXISTS "Users can delete own workflows" ON public.workflows;
CREATE POLICY "Users can delete own workflows"
  ON public.workflows FOR DELETE TO authenticated
  USING ((select auth.uid()) = user_id OR public.is_admin());

-- 11. RLS Policies for Workflow Versions
DROP POLICY IF EXISTS "Users can view own workflow versions" ON public.workflow_versions;
CREATE POLICY "Users can view own workflow versions"
  ON public.workflow_versions FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.workflows w WHERE w.id = workflow_id AND w.user_id = (select auth.uid())) OR public.is_admin());

DROP POLICY IF EXISTS "Users can insert own workflow versions" ON public.workflow_versions;
CREATE POLICY "Users can insert own workflow versions"
  ON public.workflow_versions FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.workflows w WHERE w.id = workflow_id AND w.user_id = (select auth.uid())) OR public.is_admin());

DROP POLICY IF EXISTS "Users can update own workflow versions" ON public.workflow_versions;
CREATE POLICY "Users can update own workflow versions"
  ON public.workflow_versions FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.workflows w WHERE w.id = workflow_id AND w.user_id = (select auth.uid())) OR public.is_admin());

DROP POLICY IF EXISTS "Users can delete own workflow versions" ON public.workflow_versions;
CREATE POLICY "Users can delete own workflow versions"
  ON public.workflow_versions FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.workflows w WHERE w.id = workflow_id AND w.user_id = (select auth.uid())) OR public.is_admin());

-- 12. RLS Policies for Runs
DROP POLICY IF EXISTS "Users can view own workflow runs" ON public.runs;
CREATE POLICY "Users can view own workflow runs"
  ON public.runs FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.workflows w WHERE w.id = workflow_id AND w.user_id = (select auth.uid())) OR public.is_admin());

DROP POLICY IF EXISTS "Users can insert own workflow runs" ON public.runs;
CREATE POLICY "Users can insert own workflow runs"
  ON public.runs FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.workflows w WHERE w.id = workflow_id AND w.user_id = (select auth.uid())) OR public.is_admin());

DROP POLICY IF EXISTS "Users can update own workflow runs" ON public.runs;
CREATE POLICY "Users can update own workflow runs"
  ON public.runs FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.workflows w WHERE w.id = workflow_id AND w.user_id = (select auth.uid())) OR public.is_admin());

DROP POLICY IF EXISTS "Users can delete own workflow runs" ON public.runs;
CREATE POLICY "Users can delete own workflow runs"
  ON public.runs FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.workflows w WHERE w.id = workflow_id AND w.user_id = (select auth.uid())) OR public.is_admin());

-- 13. RLS Policies for Schedules
DROP POLICY IF EXISTS "Users can view own schedules" ON public.schedules;
CREATE POLICY "Users can view own schedules"
  ON public.schedules FOR SELECT TO authenticated
  USING ((select auth.uid()) = user_id OR public.is_admin());

DROP POLICY IF EXISTS "Users can insert own schedules" ON public.schedules;
CREATE POLICY "Users can insert own schedules"
  ON public.schedules FOR INSERT TO authenticated
  WITH CHECK ((select auth.uid()) = user_id OR public.is_admin());

DROP POLICY IF EXISTS "Users can update own schedules" ON public.schedules;
CREATE POLICY "Users can update own schedules"
  ON public.schedules FOR UPDATE TO authenticated
  USING ((select auth.uid()) = user_id OR public.is_admin());

DROP POLICY IF EXISTS "Users can delete own schedules" ON public.schedules;
CREATE POLICY "Users can delete own schedules"
  ON public.schedules FOR DELETE TO authenticated
  USING ((select auth.uid()) = user_id OR public.is_admin());
