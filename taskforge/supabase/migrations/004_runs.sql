-- Create public.runs table referencing workflows & workflow_versions
CREATE TABLE IF NOT EXISTS public.runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workflow_id UUID NOT NULL REFERENCES public.workflows(id) ON DELETE CASCADE,
    version_id UUID REFERENCES public.workflow_versions(id) ON DELETE CASCADE,
    status TEXT NOT NULL,
    started_at TIMESTAMPTZ DEFAULT now(),
    finished_at TIMESTAMPTZ
);

-- Index for workflow run lookups
CREATE INDEX IF NOT EXISTS idx_runs_workflow_id ON public.runs(workflow_id);
CREATE INDEX IF NOT EXISTS idx_runs_status ON public.runs(status);
