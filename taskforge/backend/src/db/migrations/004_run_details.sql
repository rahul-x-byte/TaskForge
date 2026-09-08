-- ====================================================
-- Migration 004: Run Detail and Error Diagnostics
-- ====================================================

ALTER TABLE public.runs ADD COLUMN IF NOT EXISTS error TEXT;
ALTER TABLE public.runs ADD COLUMN IF NOT EXISTS detail JSONB;
