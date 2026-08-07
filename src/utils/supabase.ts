import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL?.trim();
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

const isPlaceholder =
  !supabaseUrl ||
  !supabaseServiceKey ||
  supabaseUrl.startsWith('your_') ||
  supabaseServiceKey.startsWith('your_');

// We use service role client on the backend to bypass RLS and perform pgvector indexing
export const supabase = !isPlaceholder
  ? createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    })
  : null;

export function isSupabaseConfigured(): boolean {
  return !isPlaceholder && !!supabase;
}
