-- Create public.workflow_versions table referencing workflows
CREATE TABLE IF NOT EXISTS public.workflow_versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workflow_id UUID NOT NULL REFERENCES public.workflows(id) ON DELETE CASCADE,
    steps JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Index for workflow versions lookups
CREATE INDEX IF NOT EXISTS idx_workflow_versions_workflow_id ON public.workflow_versions(workflow_id);
