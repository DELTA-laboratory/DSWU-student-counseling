import { createClient, SupabaseClient } from '@supabase/supabase-js';

const DEFAULT_SUPABASE_URL = 'https://pgqfomxmsnpdubueblhq.supabase.co';
const DEFAULT_SUPABASE_ANON_KEY = 'sb_publishable_jjq1jZAzt9Fc7Z8iw6xQig_52tbvDZQ';

const envUrl = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim();
const envKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim();

const supabaseUrl =
  envUrl && envUrl.startsWith('http') && !envUrl.includes('your-project-id')
    ? envUrl
    : DEFAULT_SUPABASE_URL;

const supabaseAnonKey =
  envKey && !envKey.includes('your-supabase-anon-key')
    ? envKey
    : DEFAULT_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(
  supabaseUrl &&
    supabaseAnonKey &&
    supabaseUrl.startsWith('http') &&
    !supabaseUrl.includes('your-project-id')
);

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
      },
    })
  : null;
