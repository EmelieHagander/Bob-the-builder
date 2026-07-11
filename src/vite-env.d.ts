/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Supabase project URL — leave unset to run on the in-memory mock data. */
  readonly VITE_SUPABASE_URL?: string
  /** Supabase anon (public) key — leave unset to run on the in-memory mock data. */
  readonly VITE_SUPABASE_ANON_KEY?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
