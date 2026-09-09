// Validate a private Bob recovery snapshot without contacting production.
// Usage: node scripts/check-restore-snapshot.mjs /absolute/path/to/snapshot.json
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

const snapshot = JSON.parse(await readFile(process.argv[2], 'utf8')).schemaAndData
const tables = ['projects','people','person_emails','person_skills','areas','area_crew','area_reference_images','tasks','task_assignees','materials','events','event_attendees','meals','diet_columns','diet_flags','food_groups','food_items','announcements']
const pg = new PGlite()
const normalized = rows => rows.map(row => JSON.stringify(Object.fromEntries(Object.entries(row).sort(([a],[b]) => a.localeCompare(b))))).sort()
try {
  await pg.exec("set timezone='UTC'")
  await pg.exec(`create role anon; create role authenticated; create role service_role bypassrls; create role authenticator;
    create schema auth; create table auth.users(id uuid primary key, email text, email_confirmed_at timestamptz);
    create function auth.uid() returns uuid language sql stable as $$ select (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid $$;
    create function auth.email() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'email' $$;
    grant usage on schema auth to anon, authenticated;`)
  for (const uid of new Set(snapshot.data.people.map(p => p.auth_user_id).filter(Boolean))) {
    await pg.query('insert into auth.users(id) values($1)', [uid])
  }
  const legacy = new URL('../db/migrations/', import.meta.url)
  for (const file of (await readdir(legacy)).filter(f => f.endsWith('.sql')).sort()) {
    await pg.exec(await readFile(new URL(file, legacy), 'utf8'))
  }
  for (const table of tables) {
    assert(Array.isArray(snapshot.data[table]), `Snapshot must include ${table}`)
    await pg.query(`insert into bob.${table} overriding system value select * from jsonb_populate_recordset(null::bob.${table},$1::jsonb)`, [JSON.stringify(snapshot.data[table])])
    const restored = await pg.query(`select to_jsonb(r) as row from bob.${table} r`)
    assert.equal(JSON.stringify(normalized(restored.rows.map(r => r.row))), JSON.stringify(normalized(snapshot.data[table])), `Exact row read-back for ${table}`)
  }
  console.log(`Recovery read-back passed: ${tables.length} tables, ${tables.reduce((sum,t) => sum + snapshot.data[t].length,0)} rows; production untouched.`)
} catch (error) {
  // A recovery file can contain private project data; do not dump query params.
  console.error(`Recovery verification failed: ${error.code ?? error.message.split('\n')[0]}`)
  process.exitCode = 1
} finally { await pg.close() }
