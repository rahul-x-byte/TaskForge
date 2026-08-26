-- Create public.workflows table referencing auth.users
CREATE TABLE IF NOT EXISTS public.workflows (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    current_version_id UUID NULL
);

-- Index for ownership lookups
CREATE INDEX IF NOT EXISTS idx_workflows_user_id ON public.workflows(user_id);
