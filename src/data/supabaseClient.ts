import { createClient } from '@supabase/supabase-js'

function resolveSupabaseUrl(raw: string | undefined): string | null {
  const value = raw?.trim()
  if (!value) return null
  const url = /^[a-z0-9]{16,}$/.test(value) ? `https://${value}.supabase.co` : value
  try { new URL(url); return url } catch { return null }
}

export const SUPABASE_URL = resolveSupabaseUrl(import.meta.env.VITE_SUPABASE_URL)
export const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim()

// One account Auth owner for project reads, phases and Bob. Separate clients
// sharing this storage key race session refresh and duplicate auth events.
export const accountClient = SUPABASE_URL && SUPABASE_ANON_KEY
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      db: { schema: 'bob' },
      // Keep magic-link tokens out of the HashRouter's fragment.
      auth: { flowType: 'pkce' },
    })
  : null
