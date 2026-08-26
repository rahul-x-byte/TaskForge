import { createClient, SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://zsibgzphnnwwmiusfdlp.supabase.co';
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!SUPABASE_SECRET_KEY) {
  console.warn('[Supabase Admin] Warning: SUPABASE_SECRET_KEY is not set in process.env. Ensure SUPABASE_SECRET_KEY is supplied in your environment or .env file.');
}

export const supabaseAdmin: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY || 'dummy-secret-key-for-local-testing', {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});
