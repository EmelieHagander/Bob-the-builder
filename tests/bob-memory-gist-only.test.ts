import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { projectSchema } from './support/project-schema.ts'
import { createAiCatalogSession, applyCatalogModelOptions, type AiCatalogManifest } from '../supabase/functions/_shared/ai-catalog.ts'
import { prepareWorkingContext, type ContextFrame, type ContextStore } from '../supabase/functions/_shared/bob-working-context.ts'
import type { ModelCall } from '../supabase/functions/_shared/project-answer.ts'
import { catalogFixture } from './support/ai-catalog-fixture.ts'

let pg: Awaited<ReturnType<typeof projectSchema>>, prior: AiCatalogManifest, current: AiCatalogManifest
before(async () => {
  pg = await projectSchema(async (db, name) => {
    if (name.endsWith('_bob_memory_gist_only.sql')) prior = (await db.query<{ m: AiCatalogManifest }>("select shared.resolve_ai_catalog('bob') m")).rows[0].m
    // Later publications change other definitions; compare against the catalog just before them.
    if (name.endsWith('_bob_workflows_judgement_catalog.sql')) current = (await db.query<{ m: AiCatalogManifest }>("select shared.resolve_ai_catalog('bob') m")).rows[0].m
  })
})
after(() => pg?.close())
const catalog = (manifest = current) => createAiCatalogSession({ rpc: async () => { throw new Error('Pinned') } }, { app: 'bob', manifest })
const keys = ['context-summary.contract', 'schema.bob_conversation_brief_v2']

test('publication changes only the memory contract/schema to a gist without pointers', async () => {
  assert.deepEqual((await pg.query<{ m: AiCatalogManifest }>("select shared.resolve_ai_catalog('bob',$1) m", [prior.manifest_id])).rows[0].m, prior)
  assert.deepEqual(current.models, prior.models)
  assert.equal(current.definitions.length, prior.definitions.length)
  for (const old of prior.definitions) {
    const next = current.definitions.find(d => d.prompt_key === old.prompt_key)!
    if (keys.includes(old.prompt_key)) assert.equal(next.version, old.version + 1)
    else assert.deepEqual(next, old, old.prompt_key)
  }
  const schema = catalog().definition('schema.bob_conversation_brief_v2')
  assert.deepEqual(schema.definition.required, ['gist'])
  assert.deepEqual(Object.keys(schema.definition.properties as object), ['gist'])
  assert.equal(schema.metadata.memory_gist_only_version, 1)
  assert.equal(schema.metadata.memory_pointer_scope_version, undefined)
  assert.doesNotMatch(catalog().text('context-summary.contract'), /availableSequences|pointer index/)
  assert.equal(catalog(prior).definition('schema.bob_conversation_brief_v2').metadata.memory_pointer_scope_version, 1, 'pinned journals keep their schema')
  // The bound schema carries no sequence enum and needs no sequence parameters.
  const bound = catalog().schema('bob_conversation_brief_v2').schema as any
  assert.equal(bound.properties.index, undefined)
  for (const key of keys) {
    const expected = catalog().definition(key), fixture = catalogFixture().definition(key)
    assert.deepEqual(fixture.definition, expected.definition)
    assert.deepEqual(fixture.metadata, expected.metadata)
    assert.equal(fixture.content, expected.content)
  }
})

// Incident shape: history through 44, recent originals 45–49, current request 49.
function incident() {
  const old = { gist: 'Earlier construction decisions, still requiring verification.', index: [{ seq: 38, descriptor: 'Earlier decision' }] }
  let state: ContextFrame = { projectId: 'A', threadId: 'private', generation: 1,
    summary: JSON.stringify(old), lastFoldedSeq: 40, foldThroughSeq: 44, hasMore: false,
    older: [41, 42, 43, 44].map(seq => ({ seq, role: 'assistant', state: 'completed', text: 'Earlier original ' + seq })),
    recent: [45, 46, 47, 48, 49].map(seq => ({ seq, role: seq === 49 ? 'user' : 'assistant', state: seq === 49 ? 'pending' : 'completed', text: seq === 49 ? 'Try the drawing again' : 'Original ' + seq })) }
  const saves: string[] = []
  const store: ContextStore = { load: async () => structuredClone(state), search: async () => null,
    save: async (expected, through, summary) => {
      assert.equal(expected, 40); assert.equal(through, 44)
      saves.push(summary)
      state = { ...state, summary, lastFoldedSeq: through, older: [] }
      return { lastFoldedSeq: through }
    } }
  return { store, saves }
}
const run = (store: ContextStore, callModel: ModelCall) => prepareWorkingContext({ projectId: 'A', threadId: 'private', userId: 'owner', generation: 1,
  message: 'Try the drawing again', memoryManagementVersion: 2, memoryPointerScopeVersion: 1, memoryGistOnlyVersion: 1,
  store, hasAccess: async () => true, deadline: Date.now() + 60000, callModel })
const usage = { input_tokens: 1, output_tokens: 1, total_tokens: 2 }

test('the model writes only a gist; the server keeps coverage and an empty pointer list', async () => {
  const { store, saves } = incident()
  let calls = 0
  const ready = await run(store, async options => {
    calls++
    const input = JSON.parse(String(options.messages![0].content))
    assert.equal(input.availableSequences, undefined)
    assert.deepEqual(input.currentRequest, { text: 'Try the drawing again' })
    assert.equal(options.catalogSchemaParameters, undefined)
    const bound = applyCatalogModelOptions(catalog(), options) as any
    assert.deepEqual(bound.schema.required, ['gist'])
    return { success: true, data: { gist: 'Construction still needs verification.' }, model: 'fixture', usage }
  })
  assert.equal(calls, 1); assert.equal(ready.throughSeq, 44)
  assert.equal(ready.summary, 'Construction still needs verification.')
  assert.deepEqual(ready.historyIndex, [])
  assert.deepEqual(JSON.parse(saves[0]), { gist: 'Construction still needs verification.', index: [] })
})

test('two invalid or failed summaries keep the earlier gist and still answer', async () => {
  for (const reply of [
    { success: true, data: { gist: '' }, model: 'fixture', usage },
    { success: true, data: { gist: 'x', index: [{ seq: 49, descriptor: 'current' }] }, model: 'fixture', usage },
    { success: false, error: 'ai_unavailable', model: 'fixture' },
  ]) {
    const { store, saves } = incident()
    let calls = 0
    const ready = await run(store, async () => { calls++; return reply as any })
    assert.equal(calls, reply.success && (reply.data as any).index ? 1 : 2, JSON.stringify(reply))
    assert.equal(ready.throughSeq, 44)
    if (calls === 2) {
      assert.match(ready.summary, /^Earlier construction decisions/)
      assert.match(ready.summary, /Messages 41–44 are not included in this summary; search the conversation history/)
      assert.deepEqual(ready.historyIndex, [])
      assert.equal(saves.length, 1)
    }
  }
})

test('an exhausted turn budget still stops instead of degrading', async () => {
  const { store } = incident()
  await assert.rejects(run(store, async () => ({ success: false, error: 'turn_budget_exhausted', model: 'fixture' } as any)), /turn_budget_exhausted/)
})
