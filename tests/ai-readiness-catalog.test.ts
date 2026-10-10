import { before, after, test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { projectSchema } from './support/project-schema.ts'
import { catalogFixture, legacyCatalogFixture } from './support/ai-catalog-fixture.ts'
import { createBobToolSession } from '../supabase/functions/_shared/project-tools/bob-tools.ts'
import { createProjectLookup } from '../supabase/functions/_shared/project-lookup.ts'
import { createProjectWriter } from '../supabase/functions/_shared/project-write.ts'
import { EXPERT_TOOLS } from '../supabase/functions/_shared/project-expert-tools.ts'
import { DESIGN_INTENT_SCHEMA } from '../supabase/functions/_shared/project-design-intent.ts'
import seed from '../supabase/functions/_shared/project-tools/catalog-seed.json' with { type: 'json' }

let pg: Awaited<ReturnType<typeof projectSchema>>
let previous: any
let current: any
before(async () => {
  pg = await projectSchema(async (db, filename) => {
    // Compare this publication at its own boundary. Later publications may
    // legitimately change other model capabilities without changing its history.
    if (previous && !current) {
      current = (await db.query<any>("select shared.resolve_ai_catalog('bob',null) manifest")).rows[0].manifest
    }
    if (filename.endsWith('_ai_design_readiness_catalog.sql')) {
      previous = (await db.query<any>("select shared.resolve_ai_catalog('bob',null) manifest")).rows[0].manifest
    }
  })
  current ??= (await pg.query<any>("select shared.resolve_ai_catalog('bob',null) manifest")).rows[0].manifest
})
after(async () => pg?.close())
const row = (manifest: any, key: string) => manifest.definitions.find((item: any) => item.prompt_key === key)

test('the publication changes the advisory contract without changing tiers, models or pinned earlier versions', async () => {
  assert(previous)
  assert.notEqual(current.manifest_id, previous.manifest_id)
  const replay = (await pg.query<any>('select shared.resolve_ai_catalog($1,$2) manifest', ['bob', previous.manifest_id])).rows[0].manifest
  assert.deepEqual(replay, previous)
  const publishedReplay = (await pg.query<any>('select shared.resolve_ai_catalog($1,$2) manifest', ['bob', current.manifest_id])).rows[0].manifest
  assert.deepEqual(publishedReplay, current)
  assert.notEqual(row(current, 'bob.persona').id, row(previous, 'bob.persona').id)
  assert.equal(row(current, 'bob.persona').version, row(previous, 'bob.persona').version + 1)
  assert.deepEqual(current.models, previous.models)
  for (const key of ['tier.nano', 'tier.mini', 'tier.standard', 'profile.ask-bob', 'profile.cad-designer', 'role.ask-bob']) {
    assert.deepEqual(row(current, key), row(previous, key), key + ' remains on its existing definition')
  }
  assert.equal(row(previous, 'tools.save_project_solution').definition.envelope.schema_version, 1)
  assert.equal(row(current, 'tools.save_project_solution').definition.envelope.schema_version, 2)
  assert(!('design_intent' in row(previous, 'tools.save_project_solution').definition.parameters.properties))
})

test('fresh catalog tools have the exact executable schema and policy; original manifests retain the original shape', async () => {
  const tool = EXPERT_TOOLS.find(item => item.function.name === 'save_project_solution')!
  const catalog = catalogFixture()
  assert.deepEqual(catalog.tool('save_project_solution').function.parameters, tool.function.parameters)
  const properties = catalog.tool('save_project_solution').function.parameters.properties as any
  assert.deepEqual(properties.design_intent.anyOf[0], DESIGN_INTENT_SCHEMA)
  assert.deepEqual(properties.design_intent.anyOf[1], { type: 'null' })
  assert((catalog.tool('save_project_solution').function.parameters.required as string[]).includes('source_media_id'))
  const legacy = legacyCatalogFixture()
  assert(!('design_intent' in (legacy.tool('save_project_solution').function.parameters.properties as object)))
  assert.equal(legacy.definition('tools.save_project_solution').version, 1)
  assert.equal(catalog.definition('tools.save_project_solution').version, 2)
  const hosted = row(current, 'tools.save_project_solution')
  assert.deepEqual(hosted.definition.parameters, tool.function.parameters)
  const policy = (await pg.query<any>("select schema_version,how_to from bob.tool_catalog where name='save_project_solution'")).rows[0]
  assert.equal(policy.schema_version, hosted.definition.envelope.schema_version)
  assert.equal(policy.how_to, hosted.definition.additional_description)
})

test('a previous manifest cannot offer or execute the changed solution writer against its new policy', async () => {
  let writes = 0
  const lookup = createProjectLookup('A', async () => ({ data: { records: [], related: [], truncated: false }, error: null }))
  const writer = createProjectWriter('A', 'Spara en lösning.', async () => { writes++; return { data: null, error: null } }, async () => ({ data: [], error: null }))
  const options = { lookup, writer, message: 'Spara en lösning.', readPolicy: async () => ({ phase: 'design', tools: seed }) }
  const fresh = createBobToolSession({ ...options, aiCatalog: catalogFixture() })
  const offered = await fresh.prepare()
  assert(offered.some(item => item.function.name === 'save_project_solution'))
  assert(!('request_quote' in (offered.find(item => item.function.name === 'save_project_solution')!.function.parameters.properties as object)), 'server provenance remains outside the model input')
  const old = createBobToolSession({ ...options, aiCatalog: legacyCatalogFixture() })
  assert(!(await old.prepare()).some(item => item.function.name === 'save_project_solution'))
  assert.equal((await old.execute('save_project_solution', {})).status, 'unavailable')
  assert.equal(writes, 0)
})

test('materialised callers include concise guidance and keep Bob’s expert role a compact second-person story', () => {
  const catalog = catalogFixture()
  const persona = catalog.text('bob.persona')
  assert(persona.trim().split(/\s+/).length <= 250)
  assert(persona.startsWith('Du är Bob,'))
  assert.doesNotMatch(persona, /ALDRIG|ALLTID|NEVER|ALWAYS/)
  for (const role of ['ask-bob', 'cad-designer', 'cad-research', 'cad-reviewer']) {
    assert(catalog.role(role,{stage:'layout',remaining_calls:2,first_layout_instruction:'',repair_instruction:'',remaining_reads:1,input_corrections:'',renders:0,requirement_keys:''}).systemMessage.includes(catalog.text('communication.concise')))
  }
  assert.notEqual(legacyCatalogFixture().text('bob.persona'), persona)
})

test('the immutable publication is reproducible from current executable declarations', () => {
  const result = execFileSync(process.execPath, ['--import', 'tsx', 'scripts/build-ai-readiness-catalog.ts', '--check'], { encoding: 'utf8' })
  assert.match(result, /Verified readiness catalog: 10 immutable definition revisions/)
})
