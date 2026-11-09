/**
 * Public Supabase settings. The publishable (anon) key is designed to ship to the
 * browser: access is governed by Row Level Security. Never put the service-role or
 * secret key in a NEXT_PUBLIC_* variable.
 */
export const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const supabasePublishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
export const isSupabaseConfigured = Boolean(supabaseUrl && supabasePublishableKey);
