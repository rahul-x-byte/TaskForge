import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://zsibgzphnnwwmiusfdlp.supabase.co';
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_56bvgEjvCRg7fJuazm8KCw_xmQ0dWwT';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
