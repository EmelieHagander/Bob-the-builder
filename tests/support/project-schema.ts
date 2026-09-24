import { readFile, readdir } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { setupSharedSocial } from './shared-social.ts'

/** Full Bob schema with isolated fake Auth/Storage/shared-app contracts. */
export async function projectSchema(beforeMigration?: (pg: PGlite, name: string) => Promise<void>) {
  const pg = new PGlite()
  await pg.exec(`
    create role anon; create role authenticated; create role service_role bypassrls; create role authenticator;
    create schema auth;
    create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
    create function auth.uid() returns uuid language sql stable as $$
      select (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid $$;
    create function auth.email() returns text language sql stable as $$
      select nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'email' $$;
    grant usage on schema auth to anon,authenticated;
    create schema storage;
    create table storage.buckets(id text primary key,name text,public boolean default false,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text,metadata jsonb,unique(bucket_id,name));
    alter table storage.buckets enable row level security; alter table storage.objects enable row level security;
    grant usage on schema storage to anon,authenticated;
    grant all on storage.objects,storage.buckets to anon,authenticated;
  `)
  for (const directory of ['../../db/migrations/', '../../supabase/migrations/']) {
    if (directory.includes('supabase')) await setupSharedSocial(pg)
    const root = new URL(directory, import.meta.url)
    for (const name of (await readdir(root)).filter(f => f.endsWith('.sql')).sort()) {
      await beforeMigration?.(pg, name)
      await pg.exec(await readFile(new URL(name, root), 'utf8'))
    }
  }
  return pg
}

export async function asProjectUser(pg: PGlite, uid: string | null, sql: string, values: unknown[] = [], role = 'authenticated') {
  return pg.transaction(async tx => {
    await tx.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: uid })])
    await tx.exec('set local role ' + role)
    return tx.query(sql, values)
  })
}
