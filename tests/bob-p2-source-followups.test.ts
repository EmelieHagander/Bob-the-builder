import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createToolSession, type ToolDefinition, type ToolGate, type ToolPolicy, type ToolFollowup } from '../supabase/functions/_shared/project-tools/session.ts'
import { projectSchema } from './support/project-schema.ts'

const MIGRATION = '20261104085031_bob_p2_source_tool_followups.sql'
const SQL = readFileSync(new URL('../supabase/migrations/' + MIGRATION, import.meta.url), 'utf8')
const additionMatch = SQL.match(/additions constant jsonb := '([\s\S]*?)'::jsonb;/)
assert(additionMatch, 'the published followup list must be data, not just a prompt')
const additions = JSON.parse(additionMatch[1]) as ToolFollowup[]

const NAMES = ['read_solution_context', 'read_project_edit_context', 'change_solution_evidence', 'edit_project_record']
const policy = (name: string): ToolPolicy => ({
  name, description: name, how_to: 'Use this current and authorized tool.',
  schema_version: 1, always_load: false, preload_phases: [], active: true,
})
const offered = (tools: { function: { name: string } }[]) => tools.map(tool => tool.function.name)

function harness(followups: ToolFollowup[] = additions) {
  const gates = new Map<string, ToolGate>()
  const resultStatus = new Map<string, string>()
  const writes: string[] = []
  const rows = NAMES.map(policy)
  const defs: ToolDefinition[] = NAMES.map(name => ({
    spec: { type: 'function', function: { name, description: name, parameters: { type: 'object', properties: {} } } },
    version: 1,
    gate: () => gates.get(name) ?? 'available',
    execute: async () => {
      if (name === 'change_solution_evidence' || name === 'edit_project_record') writes.push(name)
      return { status: resultStatus.get(name) ?? 'ok' }
    },
  }))
  const options = { definitions: defs, readPolicy: async () => ({ phase: 'design', tools: rows }),
    toolInstructions: 'lazy' as const, selectiveTools: true,
    preloadTools: () => ['read_solution_context'], followups }
  return { session: createToolSession(options), options, gates, resultStatus, writes, rows }
}

test('P2 source followups load adjacent tools only after successful, authorized reads', async () => {
  assert.deepEqual(additions, [
    { after_tool: 'read_solution_context', statuses: ['ok'], tools: ['change_solution_evidence'] },
    { after_tool: 'read_project_edit_context', statuses: ['ok'], tools: ['edit_project_record'] },
  ])
  const f = harness()
  assert.deepEqual(offered(await f.session.prepare()), ['read_solution_context', 'describe_tool'])
  assert.equal((await f.session.execute('change_solution_evidence', {})).status, 'not_offered')
  assert.equal((await f.session.execute('read_solution_context', {})).status, 'ok')
  assert.equal((await f.session.execute('read_project_edit_context', {})).status, 'not_offered',
    'a read cannot grant another tool inside the same model batch')
  assert.equal((await f.session.execute('change_solution_evidence', {})).status, 'not_offered')
  assert.deepEqual(offered(await f.session.prepare()), [
    'change_solution_evidence', 'read_solution_context', 'describe_tool',
  ], 'ordinary solution reads do not preload an unrelated editor')
  assert.equal((await f.session.execute('describe_tool', { name: 'read_project_edit_context' })).status, 'ok')
  assert.deepEqual(offered(await f.session.prepare()), [
    'change_solution_evidence', 'read_project_edit_context', 'read_solution_context', 'describe_tool',
  ])
  assert.equal((await f.session.execute('read_project_edit_context', {})).status, 'ok')
  assert.equal((await f.session.execute('edit_project_record', {})).status, 'not_offered')
  const restored = createToolSession(f.options)
  restored.restoreState(f.session.exportState())
  assert.deepEqual(offered(await restored.prepare()), ['change_solution_evidence', 'edit_project_record', 'read_project_edit_context', 'read_solution_context', 'describe_tool'])
  assert.deepEqual(f.writes, [], 'tool discovery must not perform a write')
  f.gates.set('edit_project_record', 'not_allowed')
  assert.equal((await restored.execute('edit_project_record', {})).status, 'not_allowed',
    'a loaded tool never overrides a revoked permission')
  f.rows[2].active = false
  assert(!offered(await restored.prepare()).includes('change_solution_evidence'),
    'a disabled tool must disappear even after it was loaded by a followup')
  f.rows[2].active = true
  f.rows[2].schema_version = 2
  assert(!offered(await restored.prepare()).includes('change_solution_evidence'),
    'a live contract-version mismatch cannot be bypassed by old loaded state')
})

test('P2 never autoloads after a failed read; older pinned catalogs keep the old protocol', async () => {
  const failed = harness()
  failed.resultStatus.set('read_solution_context', 'unavailable')
  await failed.session.prepare()
  await failed.session.execute('read_solution_context', {})
  assert.deepEqual(offered(await failed.session.prepare()), ['read_solution_context', 'describe_tool'])

  const old = harness([])
  await old.session.prepare()
  await old.session.execute('read_solution_context', {})
  assert.deepEqual(offered(await old.session.prepare()), ['read_solution_context', 'describe_tool'])
})

test('P2 catalog release changes only the versioned Bob toolbox and is idempotent in synthetic PostgreSQL', async () => {
  let before: { version: number; definition: any; metadata: any } | undefined
  const statement = `select v.version,v.definition,v.metadata from shared.ai_prompts p
    join shared.ai_prompt_versions v on v.id=p.active_version_id
    where p.app='bob' and p.prompt_key='bob.tools'`
  const pg = await projectSchema(async (db, name) => {
    if (name === '20260924120448_bob_background_jobs.sql') {
      await db.exec(`create schema cron; create schema net;
        create function cron.schedule(text,text,text) returns bigint language sql as 'select 1::bigint';
        create function net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds integer)
          returns bigint language sql as 'select 1::bigint';`)
    }
    if (name === MIGRATION) before = (await db.query<{ version: number; definition: any; metadata: any }>(statement)).rows[0]
  }, MIGRATION)
  try {
    const current = (await pg.query<{ version: number; definition: any; metadata: any }>(statement)).rows[0]
    assert(before, 'the existing active toolbox must have been available')
    assert.equal(before.definition.operation_followups.length, 18, 'P2 migration requires the reviewed followup baseline')
    assert.equal(current.version, before.version + 1)
    assert.deepEqual(current.definition, {
      ...before.definition,
      operation_followups: [...before.definition.operation_followups, ...additions],
    })
    assert.deepEqual(current.metadata, {
      ...Object.fromEntries(Object.entries(before.metadata).filter(([k]) => !['seed_version','source_revision'].includes(k))),
      publication: 'p2-source-tool-followups-v1', p2_source_followups_version: 1,
    })
    const others = await pg.query<{ prompt_key: string }>(`select p.prompt_key from shared.ai_prompts p
       join shared.ai_prompt_versions v on v.id=p.active_version_id
       where p.app='bob' and v.metadata->>'publication'='p2-source-tool-followups-v1'`)
    assert.deepEqual(others.rows.map(row => row.prompt_key), ['bob.tools'])
    await pg.exec(SQL)
    assert.deepEqual((await pg.query(statement)).rows[0], current,
      'reapplying the same migration must not create another catalog revision')
  } finally { await pg.close() }
})
