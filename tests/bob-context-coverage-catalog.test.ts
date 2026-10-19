import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { projectSchema } from './support/project-schema.ts'
import { createAiCatalogSession, type AiCatalogManifest } from '../supabase/functions/_shared/ai-catalog.ts'
import { LINK_CAD_SHELL_STEPS_TOOL } from '../supabase/functions/_shared/cad-shell.ts'
import { ORIENTATION_DIRECTORY_TOOL } from '../supabase/functions/_shared/bob-orientation-directory.ts'
// Later construction publications have their own whole-catalog parity tests.
import { preConstructionEditsCatalogFixture as catalogFixture } from './support/ai-catalog-fixture.ts'
const root = new URL('../supabase/migrations/', import.meta.url)
const publication = readdirSync(root).find(name => name.endsWith('_ai_context_coverage_catalog.sql'))!
const sql = readFileSync(new URL(publication, root), 'utf8')
const records = (tag: string) => JSON.parse(sql.match(new RegExp('\\$' + tag + '\\$([\\s\\S]+?)\\$' + tag + '\\$'))![1])
const additions = records('context_coverage_additions'), edits = records('context_coverage_edits'), policies = records('context_coverage_policies'), retired: string[] = records('context_coverage_retired')
const changed = new Set<string>(edits.map((p: any) => p.key).concat('bob.tools'))
const row = (m: AiCatalogManifest, key: string) => { const value = m.definitions.find(d => d.prompt_key === key); assert(value, key); return value }
let pg: Awaited<ReturnType<typeof projectSchema>>, prior: AiCatalogManifest, current: AiCatalogManifest
let settings: any[], models: any[], versions: any[], policyBefore: any[], otherSnapshot: any, snapshotFunction: any
before(async () => {
  pg = await projectSchema(async (db, name) => {
    if (name !== publication) return
    await db.exec(`
      insert into shared.ai_prompts(app,prompt_key,label,content,definition_kind) values('other-app','fixture.other','Other','Unchanged','prompt');
      insert into shared.ai_prompt_versions(prompt_id,version,definition_kind,definition_format_version,content,definition)
       select id,1,'prompt',1,'Unchanged','{}' from shared.ai_prompts where app='other-app';
      select shared.activate_ai_catalog('other-app',(select jsonb_object_agg(p.prompt_key,v.id) from shared.ai_prompts p join shared.ai_prompt_versions v on v.prompt_id=p.id where p.app='other-app'));
    `)
    prior = (await db.query<{ m: AiCatalogManifest }>("select shared.resolve_ai_catalog('bob') m")).rows[0].m
    settings = (await db.query('select * from shared.ai_settings order by id')).rows
    models = (await db.query('select * from shared.ai_models order by model_name')).rows
    versions = (await db.query('select * from shared.ai_prompt_versions order by id')).rows
    policyBefore = (await db.query('select * from bob.tool_catalog order by name')).rows
    otherSnapshot = (await db.query("select shared.ai_catalog_snapshot('other-app') value")).rows[0]
    snapshotFunction = (await db.query("select oid,proacl,prosecdef,proconfig from pg_proc where oid='shared.ai_catalog_snapshot(text)'::regprocedure")).rows[0]
  }, publication)
  current = (await pg.query<{ m: AiCatalogManifest }>("select shared.resolve_ai_catalog('bob') m")).rows[0].m
})
after(() => pg?.close())

test('coverage publication removes only dead active definitions and preserves every immutable historical row and pinned manifest', async () => {
  assert.equal(current.definitions.length, prior.definitions.length + additions.length - retired.length)
  assert.deepEqual((await pg.query<{ m: AiCatalogManifest }>("select shared.resolve_ai_catalog('bob',$1) m", [prior.manifest_id])).rows[0].m, prior)
  const afterVersions = (await pg.query<any>('select * from shared.ai_prompt_versions order by id')).rows
  for (const old of versions) assert.deepEqual(afterVersions.find(v => v.id === old.id), old)
  for (const old of prior.definitions) {
    if (retired.includes(old.prompt_key)) { assert(!current.definitions.some(d => d.prompt_key === old.prompt_key)); continue }
    const next = row(current, old.prompt_key)
    if (!changed.has(old.prompt_key)) { assert.deepEqual(next, old, old.prompt_key); continue }
    assert.equal(next.version, old.version + 1, old.prompt_key)
    assert.equal(next.content, old.content); assert.equal(next.flow, old.flow); assert.deepEqual(next.available_variables, old.available_variables)
  }
  assert.equal((await pg.query('select id from shared.ai_prompts where retired_at is not null')).rows.length, retired.length)
  const historic = createAiCatalogSession({ rpc: async () => { throw new Error('pinned') } }, { app: 'bob', manifest: prior })
  assert.equal(historic.definition('role.cad-designer').definition.name, 'Daisy'); assert.equal(historic.definition('role.cad-research').definition.name, 'Kjell')
})

test('retirement deletes only the two dead role settings and leaves models, prices, other apps and snapshot privileges identical', async () => {
  const dead = (s: any) => s.app === 'bob' && s.coworker_id === 'bob' && s.module_id === 'cad' && ['cad-designer', 'cad-research'].includes(s.function_name)
  assert.equal(settings.filter(dead).length, 2)
  assert.deepEqual((await pg.query('select * from shared.ai_settings order by id')).rows, settings.filter(s => !dead(s)))
  assert.deepEqual((await pg.query('select * from shared.ai_models order by model_name')).rows, models)
  assert.deepEqual((await pg.query("select shared.ai_catalog_snapshot('other-app') value")).rows[0], otherSnapshot)
  assert.deepEqual((await pg.query("select oid,proacl,prosecdef,proconfig from pg_proc where oid='shared.ai_catalog_snapshot(text)'::regprocedure")).rows[0], snapshotFunction)
})

test('all specialist cards and tools match actual callers while runtime contracts activate each audited boundary', async () => {
  const session = createAiCatalogSession({ rpc: async () => { throw new Error('pinned') } }, { app: 'bob', manifest: current })
  const contract = row(current, 'agent-contract.ask-bob').metadata
  assert.equal(contract.context_strategy_version, 1); assert.equal(contract.work_allowance_version, 1); assert.equal(contract.work_completion_version, 2)
  assert.equal(contract.specialist_tool_instructions_version, 1); assert.equal(contract.continuation_retention_version, 2)
  assert.equal(contract.orientation_directory_version, 1); assert.equal(contract.orientation_max_tokens, 12000); assert.equal(contract.orientation_page_max_tokens, 6000)
  for (const role of ['plan-compiler', 'plan-reviewer', 'cad-reviewer']) {
    const old = row(prior, 'role.' + role).definition, next = row(current, 'role.' + role).definition
    assert.deepEqual(next, { ...old, prompt_keys: [...old.prompt_keys, 'specialist.tools'], tool_keys: [...old.tool_keys, 'tools.describe_tool'] })
    assert.deepEqual(session.role(role).model, createAiCatalogSession({ rpc: async () => { throw new Error('pinned') } }, { app: 'bob', manifest: prior }).role(role).model)
  }
  const colleagues = row(current, 'bob.colleagues').definition.colleagues
  assert.deepEqual(colleagues.map((c: any) => c.role_key), ['role.plan-compiler', 'role.plan-reviewer', 'role.cad-reviewer', 'role.project-image'])
  for (const colleague of colleagues.slice(0, 2)) assert.deepEqual(colleague.invocation_tools, ['compile_project_plan', 'audit_project_plan'])
  for (const definition of current.definitions) assert(!/Daisy|Kjell|cad-designer|cad-research|finish_cad_research|render_cad_candidate|render_saved_cad_candidate|revise_cad_candidate|report_cad_blocker/.test(definition.content + JSON.stringify(definition.definition)), definition.prompt_key)
  assert.deepEqual(row(current, 'tools.link_cad_shell_steps').definition.parameters, LINK_CAD_SHELL_STEPS_TOOL.function.parameters)
  assert.deepEqual(session.tool('read_project_orientation', { server_quote: true }).function.parameters, ORIENTATION_DIRECTORY_TOOL.function.parameters)
  assert.equal(session.tool('link_cad_shell_steps', { server_quote: true }).function.parameters.required.includes('request_quote'), false, 'server-owned current-message quote remains hidden')
})

test('tool policies contain the installed shell capability and bounded orientation reader, preserving unrelated policies', async () => {
  const after = (await pg.query<any>('select * from bob.tool_catalog order by name')).rows
  const names = policies.map((p: any) => p.name).concat('read_cad_shell')
  for (const old of policyBefore) if (!names.includes(old.name)) assert.deepEqual(after.find(p => p.name === old.name), old, old.name)
  const box = row(current, 'bob.tools').definition
  for (const policy of policies) {
    const actual = after.find(p => p.name === policy.name)
    for (const key of Object.keys(policy)) assert.deepEqual(actual[key], policy[key])
    assert.deepEqual(box.catalog.find((p: any) => p.name === policy.name), policy)
    assert.equal(box.contract_keys.filter((k: string) => k === 'tools.' + policy.name).length, 1)
  }
  assert.match(after.find(p => p.name === 'read_cad_shell').how_to, /plan_summary/)
  assert(!box.contract_keys.some((key: string) => retired.includes(key)))
})

test('retired heads cannot be reactivated, restored, or referenced by a new active role', async () => {
  for (const role of ['anon', 'authenticated']) await assert.rejects(pg.transaction(async tx => {
    await tx.exec('set local role ' + role)
    await tx.query("update shared.ai_prompts set retired_at=clock_timestamp() where app='bob' and prompt_key='role.plan-compiler'")
  }), /permission denied|ai_catalog_service_required/)
  await assert.rejects(pg.query("insert into shared.ai_prompts(app,prompt_key,label,retired_at) values('other-app','hidden-insert','Invalid',clock_timestamp())"), /ai_catalog_retirement_invalid/)
  const old = row(prior, 'role.cad-designer')
  await assert.rejects(pg.query("select shared.activate_ai_catalog('bob',jsonb_build_object('role.cad-designer',$1::text))", [old.id]), /ai_catalog_definition_retired/)
  await assert.rejects(pg.query("update shared.ai_prompts set retired_at=null where app='bob' and prompt_key='role.cad-designer'"), /ai_catalog_definition_retired/)
  await assert.rejects(pg.transaction(async tx => {
    const old = row(current, 'role.plan-compiler')
    const added = (await tx.query<{ id: string }>(`insert into shared.ai_prompt_versions(prompt_id,version,definition_kind,definition_format_version,metadata,content,definition,flow,available_variables)
      select prompt_id,version+1,definition_kind,definition_format_version,metadata,content,jsonb_set(definition,'{profile_key}','"profile.cad-designer"'),flow,available_variables from shared.ai_prompt_versions where id=$1 returning id`, [old.id])).rows[0]
    await tx.query("select shared.activate_ai_catalog('bob',jsonb_build_object('role.plan-compiler',$1::text))", [added.id])
  }), /ai_catalog_reference_unavailable/)
  await assert.rejects(pg.query("update shared.ai_prompts set retired_at=clock_timestamp() where app='bob' and prompt_key='profile.plan-compiler'"), /ai_catalog_reference_unavailable/)
  assert.deepEqual((await pg.query<{ m: AiCatalogManifest }>("select shared.resolve_ai_catalog('bob') m")).rows[0].m, current)
})

test('coverage fixture matches database publication definitions and all catalog generators reproduce immutable migrations', async () => {
  const fixture = await catalogFixture().load()
  const published = new Set([...changed, ...additions.map((p: any) => p.key)])
  for (const expected of current.definitions.filter(d => published.has(d.prompt_key))) {
    const actual = row(fixture, expected.prompt_key)
    assert.deepEqual(expected.prompt_key === 'tier.image' ? { ...actual.definition, model_name: expected.definition.model_name } : actual.definition, expected.definition, expected.prompt_key)
    assert.equal(actual.content, expected.content, expected.prompt_key)
  }
  assert.match(execFileSync(process.execPath, ['--import', 'tsx', 'scripts/build-ai-context-coverage-catalog.ts', 'supabase/migrations/' + publication, '--check'], { encoding: 'utf8' }), /Verified context coverage publication/)
  for (const script of ['build-ai-intake-recovery-catalog.ts', 'build-ai-cad-revision-catalog.ts']) assert.match(execFileSync(process.execPath, ['--import', 'tsx', 'scripts/' + script, '--check'], { encoding: 'utf8' }), /Verified/)
})
