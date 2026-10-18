import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { projectSchema } from './support/project-schema.ts'
import { createAiCatalogSession, applyCatalogModelOptions, type AiCatalogManifest } from '../supabase/functions/_shared/ai-catalog.ts'
import { prepareWorkingContext, type ContextFrame, type ContextStore } from '../supabase/functions/_shared/bob-working-context.ts'

let pg: Awaited<ReturnType<typeof projectSchema>>, prior: AiCatalogManifest, current: AiCatalogManifest
before(async () => {
  pg = await projectSchema(async (db, name) => {
    if (name.endsWith('_bob_memory_pointer_scope.sql')) prior = (await db.query<{ m: AiCatalogManifest }>("select shared.resolve_ai_catalog('bob') m")).rows[0].m
    // Later publications (gist-only memory) supersede this one; pin its own result.
    if (name.endsWith('_bob_memory_gist_only.sql')) current = (await db.query<{ m: AiCatalogManifest }>("select shared.resolve_ai_catalog('bob') m")).rows[0].m
  })
  current ??= (await pg.query<{ m: AiCatalogManifest }>("select shared.resolve_ai_catalog('bob') m")).rows[0].m
})
after(() => pg?.close())
const catalog = (manifest = current) => createAiCatalogSession({ rpc: async () => { throw new Error('Pinned') } }, { app: 'bob', manifest })

test('publication changes only the memory contract/schema and preserves old pinned definitions and models', async () => {
  assert.deepEqual((await pg.query<{ m: AiCatalogManifest }>("select shared.resolve_ai_catalog('bob',$1) m", [prior.manifest_id])).rows[0].m, prior)
  assert.deepEqual(current.models, prior.models)
  assert.equal(current.definitions.length, prior.definitions.length)
  for (const old of prior.definitions) {
    const next = current.definitions.find(d => d.prompt_key === old.prompt_key)!
    if (['context-summary.contract', 'schema.bob_conversation_brief_v2'].includes(old.prompt_key)) {
      assert.equal(next.version, old.version + 1)
      assert.deepEqual(next.definition, old.definition)
    } else assert.deepEqual(next, old, old.prompt_key)
  }
  assert.equal(catalog().definition('schema.bob_conversation_brief_v2').metadata.memory_pointer_scope_version, 1)
  assert.equal(catalog(prior).definition('schema.bob_conversation_brief_v2').metadata.memory_pointer_scope_version, undefined)
  assert.match(catalog().text('context-summary.contract'), /currentRequest is relevance context only/)
  // Fixture parity with the latest publication lives in bob-memory-gist-only.test.ts.
})

test('the actual catalog seam forbids current, future and absent history pointers before model output', async () => {
  // Incident shape: history through 44, recent originals 45–49; the model
  // selected current request 49 in BOTH otherwise successful paid responses.
  const old = { gist: 'Earlier construction decisions, still requiring verification.', index: [{ seq: 38, descriptor: 'Earlier decision' }] }
  let state: ContextFrame = { projectId: 'A', threadId: 'private', generation: 1,
    summary: JSON.stringify(old), lastFoldedSeq: 40, foldThroughSeq: 44, hasMore: false,
    older: [41, 42, 43, 44].map(seq => ({ seq, role: 'assistant', state: 'completed', text: 'Earlier original ' + seq })),
    recent: [45, 46, 47, 48, 49].map(seq => ({ seq, role: seq === 49 ? 'user' : 'assistant', state: seq === 49 ? 'pending' : 'completed', text: seq === 49 ? 'Try the drawing again' : 'Original ' + seq })) }
  const originals = structuredClone(state.recent)
  const store: ContextStore = { load: async () => structuredClone(state), search: async () => null,
    save: async (expected, through, summary) => {
      assert.equal(expected, 40); assert.equal(through, 44)
      state = { ...state, summary, lastFoldedSeq: through, older: [] }
      return { lastFoldedSeq: through }
    } }
  let calls = 0
  const ready = await prepareWorkingContext({ projectId: 'A', threadId: 'private', userId: 'owner', generation: 1,
    message: 'Try the drawing again', memoryManagementVersion: 2, memoryPointerScopeVersion: 1,
    store, hasAccess: async () => true, deadline: Date.now() + 60000,
    callModel: async options => {
      calls++
      const input = JSON.parse(String(options.messages![0].content))
      assert.deepEqual(input.currentRequest, { text: 'Try the drawing again' })
      assert.deepEqual(input.availableSequences, [38, 41, 42, 43, 44])
      const bound = applyCatalogModelOptions(catalog(), options) as any
      const allowed = bound.schema.properties.index.items.properties.seq.enum
      assert.deepEqual(allowed, input.availableSequences)
      for (const forbidden of [39, 40, 45, 49, 50]) assert(!allowed.includes(forbidden))
      return { success: true, data: { gist: 'Construction still needs verification.', index: [{ seq: 44, descriptor: 'Latest older result' }] }, model: 'fixture', usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } }
    } })
  assert.equal(calls, 1); assert.equal(ready.throughSeq, 44)
  assert.deepEqual(ready.recent, originals)
  assert.deepEqual(ready.historyIndex, [{ seq: 44, descriptor: 'Latest older result' }])
})

test('missing or invalid sequence authority fails closed; an empty source set requires an empty index', () => {
  const session = catalog()
  for (const values of [undefined, null, ['41'], [0], [1.5], [41, 41], Array.from({ length: 57 }, (_, n) => n + 1)]) {
    assert.throws(() => session.schema('bob_conversation_brief_v2', { memory_sequences: values }), /memory sequences/)
  }
  const empty = session.schema('bob_conversation_brief_v2', { memory_sequences: [] }).schema as any
  assert.equal(empty.properties.index.maxItems, 0)
  const legacy = catalog(prior).schema('bob_conversation_brief_v2').schema as any
  assert.equal(legacy.properties.index.items.properties.seq.enum, undefined, 'paid old journals keep their exact schema')
})
