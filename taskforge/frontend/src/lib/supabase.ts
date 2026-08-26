import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://mock-taskforge-project.supabase.co';
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY || 'mock-anon-publishable-key-for-local-testing';

if (!import.meta.env.VITE_SUPABASE_URL) {
  console.warn('[Supabase Client] VITE_SUPABASE_URL is not set. Falling back to default configuration.');
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
