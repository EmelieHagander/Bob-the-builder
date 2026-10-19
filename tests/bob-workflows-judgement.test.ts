import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { projectSchema } from './support/project-schema.ts'
import { createAiCatalogSession, type AiCatalogManifest } from '../supabase/functions/_shared/ai-catalog.ts'
import { createToolSession, type ToolPolicy } from '../supabase/functions/_shared/project-tools/session.ts'
import { TOOLBOX_SHELVES } from '../supabase/functions/_shared/project-tools/bob-tools.ts'
import { bobWorkflows, buildBobHands } from '../supabase/functions/_shared/bob-prompt.ts'
import { countContextTokens } from '../supabase/functions/_shared/bob-token-budget.ts'
import { preConstructionEditsCatalogFixture as catalogFixture } from './support/ai-catalog-fixture.ts'

// Owner request 2026-10-18: Bob reasons like a builder again within the lazy
// context strategy. Workflows group tools by delegated outcome; judgement
// lives in the base principles, not in exact rules.
let pg: Awaited<ReturnType<typeof projectSchema>>, prior: AiCatalogManifest, current: AiCatalogManifest
before(async () => {
  pg = await projectSchema(async (db, name) => {
    if (name.endsWith('_bob_workflows_judgement_catalog.sql')) prior = (await db.query<{ m: AiCatalogManifest }>("select shared.resolve_ai_catalog('bob') m")).rows[0].m
    // Compare this publication alone, before later ones are activated.
    if (name.endsWith('_bob_completion_gate_catalog.sql')) current = (await db.query<{ m: AiCatalogManifest }>("select shared.resolve_ai_catalog('bob') m")).rows[0].m
  })
  current ??= (await pg.query<{ m: AiCatalogManifest }>("select shared.resolve_ai_catalog('bob') m")).rows[0].m
})
after(() => pg?.close())
const catalog = (manifest = current) => createAiCatalogSession({ rpc: async () => { throw new Error('Pinned') } }, { app: 'bob', manifest })

test('publication adds workflows and judgement only; pinned manifests keep the old prompt', () => {
  for (const old of prior.definitions) {
    const next = current.definitions.find(d => d.prompt_key === old.prompt_key)!
    if (old.prompt_key === 'bob.context-principles') assert.equal(next.version, old.version + 1)
    else assert.deepEqual(next, old, old.prompt_key)
  }
  assert.deepEqual(current.definitions.map(d => d.prompt_key).filter(k => !prior.definitions.some(d => d.prompt_key === k)), ['bob.workflows'])
  assert.deepEqual(bobWorkflows(catalog(prior)), [])
  assert.match(catalog().text('bob.context-principles'), /builder who will stand there/)
  assert.ok(catalog().text('bob.context-principles').startsWith(catalog(prior).text('bob.context-principles')), 'existing principles are preserved')
  assert(countContextTokens(catalog().role('ask-bob').systemMessage) <= 700)
  for (const key of ['bob.workflows', 'bob.context-principles']) {
    const expected = catalog().definition(key), fixture = catalogFixture().definition(key)
    assert.deepEqual(fixture.definition, expected.definition); assert.deepEqual(fixture.metadata, expected.metadata); assert.equal(fixture.content, expected.content)
  }
})

test('every workflow is a small card over real shelved tools, without magic words', () => {
  const shelved = new Set(TOOLBOX_SHELVES.flatMap(s => s.tools))
  const workflows = bobWorkflows(catalog())
  assert(workflows.length >= 5)
  for (const w of workflows) {
    assert(countContextTokens(w.card) <= 80, w.name)
    for (const name of w.tools) assert(shelved.has(name), `${w.name}: ${name}`)
    assert.doesNotMatch(w.method + w.card, /\bsay "|säg |fortsätt/i)
  }
  const hands = buildBobHands(catalog(), [catalog().tool('describe_tool')], [{ name: 'save_construction_draft', group: 'Drawings and CAD', state: 'offered', description: 'Save a construction.', instructionLoaded: false }])
  assert.match(hands, /- workflow_construction_drawing: /)
  assert.doesNotMatch(hands, /workflow_images/, 'workflows without visible tools are not listed')
})

test('describing a workflow returns its method and loads all available member tools for the next step', async () => {
  const rows: ToolPolicy[] = ['read_construction_draft', 'save_construction_draft', 'design_project_cad', 'secret_tool'].map(name => ({ name, description: 'Card.', how_to: 'Manual.', schema_version: 1, always_load: true, preload_phases: [], active: true }))
  const session = createToolSession({ toolInstructions: 'lazy', readPolicy: async () => ({ phase: 'design', tools: rows }),
    catalogWorkflows: () => [{ name: 'workflow_construction_drawing', card: 'Card', method: 'Picture it finished.', tools: ['read_construction_draft', 'save_construction_draft', 'design_project_cad', 'not_registered'] }],
    definitions: rows.map(row => ({ version: 1, spec: { type: 'function', function: { name: row.name, description: 'x', parameters: { type: 'object', properties: {} } } },
      gate: () => row.name === 'design_project_cad' ? 'missing_context' : 'available', execute: async () => ({ status: 'ok' }) })) })
  assert.deepEqual((await session.prepare()).map(s => s.function.name), ['describe_tool'])
  const result = await session.execute('describe_tool', { name: 'workflow_construction_drawing' })
  assert.equal(result.status, 'ok'); assert.equal(result.method, 'Picture it finished.')
  assert.deepEqual(result.callable_from_next_step, ['read_construction_draft', 'save_construction_draft'])
  assert.deepEqual(result.tools.map((t: any) => t.name), ['read_construction_draft', 'save_construction_draft', 'design_project_cad'])
  assert.equal((await session.execute('save_construction_draft', {})).status, 'not_offered', 'no same-step use')
  const next = (await session.prepare()).map(s => s.function.name)
  assert(next.includes('save_construction_draft') && next.includes('read_construction_draft') && !next.includes('secret_tool') && !next.includes('design_project_cad'))
  assert.equal((await session.execute('save_construction_draft', {})).status, 'ok')
  rows[1].active = false
  await session.prepare()
  assert.equal((await session.execute('save_construction_draft', {})).status, 'unavailable', 'a workflow never preserves revoked authority')
})
