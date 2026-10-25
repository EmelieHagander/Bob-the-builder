import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createProjectLookup } from '../supabase/functions/_shared/project-lookup.ts'
import { createProjectContext } from './support/colleague-catalog-fixture.ts'
import { createMediaAdapter, type MediaRow } from '../supabase/functions/_shared/project-context/media.ts'
import { createProjectWriter } from '../supabase/functions/_shared/project-write.ts'
import { runClaimedProjectTurn } from './support/bob-model-routing.ts'
import { catalogFixture } from './support/ai-catalog-fixture.ts'
import { createGroundedModelCall } from '../supabase/functions/_shared/project-grounding.ts'
import { hasImageContent } from '../supabase/functions/_shared/openai-content.ts'
import type { ModelCall } from './support/bob-model-routing.ts'

const id = '10000000-0000-4000-8000-000000000001', time = '2026-09-21T00:00:00Z'
const usage = { input_tokens: 1, output_tokens: 1, total_tokens: 2 }
const success = { success: true, data: 'Synthetic answer. Not a model-behaviour evaluation.', model: 'fixture', responseId: 'resp_final', usage }
function fixture(model: ModelCall) {
  let downloads = 0
  const reads: string[] = []
  const row: MediaRow = { id, project_id: 'A', title: 'Old concept', purpose: 'proposal', content_type: 'image/png', byte_size: 8, width: 2, height: 2, state: 'ready', created_at: time, updated_at: time, bucket_id: 'bob-project-media', object_path: `A/${id}` }
  const lookup = createProjectLookup('A', async (project, input) => {
    assert.equal(project, 'A'); reads.push(input.dataset)
    return { data: { records: input.dataset === 'project'
      ? [{ id: 'A', name: 'Synthetic cabinet', description: 'Chosen panel is 1320 × 580 × 80 mm.', updated_at: time }]
      : [{ id: 'dimension', subject: 'Panel length', value: '1460', unit: 'mm', truth: 'provided_spec', revision: 1, updated_at: '2026-09-01T00:00:00Z' }],
      related: [], truncated: false }, error: null }
  }, 1000, 12)
  const hasAccess = async () => true
  const projectContext = createProjectContext({ hasAccess, sources: lookup.sources, adapters: [createMediaAdapter('A', {
    count: async () => 1, list: async () => [row], read: async key => key === id ? row : null,
    download: async () => { downloads++; return Uint8Array.from([137,80,78,71,13,10,26,10]) },
  })] })
  const writer = createProjectWriter('A', 'Inspect the concept', async () => { throw new Error('No write requested') },
    async () => ({ data: [], error: null }), async () => ({ data: { generation: 2, receipts: [] }, error: null }))
  const deadline = Date.now() + 200000
  const callModel = createGroundedModelCall({ groundingInstruction: catalogFixture().text('bob.grounding'), projectId: 'A', message: 'Inspect the concept', lookup, hasAccess,
    validateImages: () => projectContext.validate(), deadline, callModel: model })
  return { opts: { projectId: 'A', userId: 'userA', message: 'Inspect the concept', generation: 1,
    lookup, writer, projectContext, hasAccess, deadline, callModel, fail: async () => {} }, reads, get downloads() { return downloads } }
}

test('actual claimed visual loop delivers pixels and fresh contradictory facts together and preserves both source types through settlement', async () => {
  let calls = 0, committed: unknown
  const f = fixture(async options => {
    calls++
    assert(options.systemMessage!.startsWith(catalogFixture().text('bob.persona')))
    if (calls === 1) {
      assert(!hasImageContent(options.messages))
      return { ...success, data: null, responseId: 'resp_open', toolCalls: [{ id: 'open', type: 'function', function: {
        name: 'open_project_item', arguments: JSON.stringify({ refs: [`image:${id}`] }),
      } }] }
    }
    assert(hasImageContent(options.messages), 'Must still send the actual image, not replace it with facts')
    assert.equal(options.previousResponseId, 'resp_open')
    assert.equal(options.messages![0].role, 'tool')
    const reminder = String(options.messages!.at(-1)!.content)
    assert.match(reminder, /1320 × 580 × 80/)
    assert.match(reminder, /1460/)
    assert.match(reminder, /provided_spec/)
    assert.match(reminder, /original_request/)
    return success
  })
  const answer = await runClaimedProjectTurn({ ...f.opts, commit: async r => { committed = r } })
  assert(answer.ok); assert.equal(calls, 2); assert.equal(f.downloads, 1)
  assert.deepEqual(f.reads, ['project', 'project', 'measurements'])
  assert.equal(f.opts.lookup.remaining, 9, 'Grounding consumes the existing twelve-read budget')
  assert(answer.evidence.sources.some(s => s.dataset === 'measurements' && s.recordId === 'dimension'))
  assert(answer.evidence.sources.some(s => s.dataset === 'image_pixels' && s.recordId === id))
  assert.deepEqual(answer.evidence.writes, [])
  assert.doesNotMatch(JSON.stringify(committed), /data:image|base64|object_path/)
})

test('the same production loop can skip images without added measurement reads or a router-model call', async () => {
  const f = fixture(async o => { assert(!hasImageContent(o.messages)); assert(o.systemMessage!.startsWith(catalogFixture().text('bob.persona'))); return success })
  const answer = await runClaimedProjectTurn(f.opts)
  assert(answer.ok); assert.equal(f.downloads, 0); assert.deepEqual(f.reads, ['project'])
})

test('deployment adapter applies the policy to the main answer model, not the private history summarizer', async () => {
  const code = await readFile(new URL('../supabase/functions/_shared/ask-openai.ts', import.meta.url), 'utf8')
  assert.match(code, /callModel: createGroundedModelCall\(\{/)
  assert.match(code, /validateImages: \(\) => projectContext\.validate\(\)/)
  const summary = code.slice(code.indexOf('prepareContext:'), code.indexOf('// The main answer'))
  assert.match(summary, /callModel, hasAccess/)
  assert.doesNotMatch(summary, /createGroundedModelCall/)
  assert.match(code, /const invoke=\([^\n]+=>callOpenAIResponses<string>\(\{ \.\.\.options, timeoutMs: allowed,/)
})

test('provider cache routing key stays outside the journal, job and drawing-budget fingerprints (2026-10-22)', async () => {
  const code = await readFile(new URL('../supabase/functions/_shared/ask-openai.ts', import.meta.url), 'utf8')
  const invoke = code.slice(code.indexOf('const invoke=('), code.indexOf('result=boundDrawing'))
  assert.match(invoke, /promptCacheKey && \(options\.catalogRoleKey \?\? options\.functionName\) === 'ask-bob' \? \{ promptCacheKey \} : \{\}/)
  // Hashed call options are built before invoke; the key is never part of them.
  const dispatch = code.slice(code.indexOf('const dispatchModel'), code.indexOf('const invoke=('))
  assert.doesNotMatch(dispatch, /promptCacheKey/)
  assert.match(code, /promptCacheKey = 'bob-ask-' \+ \(await fingerprint\(\{ v: 1, scope: threadId \?\? execution\.id \}\)\)\.slice\(0, 32\)/)
  for (const file of ['project-answer.ts', 'drawing-budget.ts', 'bob-job-journal.ts', 'ai-background.ts', 'bob-context-continuation.ts']) {
    assert.doesNotMatch(await readFile(new URL('../supabase/functions/_shared/' + file, import.meta.url), 'utf8'), /promptCacheKey|prompt_cache_key/, file)
  }
})

test('larger construction pages are pinned per job and share one step budget (2026-10-22)', async () => {
  const code = await readFile(new URL('../supabase/functions/_shared/ask-openai.ts', import.meta.url), 'utf8')
  const identity = code.slice(code.indexOf("memo('execution:identity'"), code.indexOf('modelBudget = createBobModelBudget'))
  assert.match(identity, /constructionPageVersion: 1 as const,/)
  assert.match(code, /execution\.constructionPageVersion !== 1\) throw new Error\('construction_page_version_invalid'\)/)
  assert.match(code, /execution\.constructionPageVersion === 1 \? \{ viewPageTokens: \(\) => constructionViewBudget\(constructionReadsInStep\) \} : \{\}/)
  assert.match(code, /execution\.constructionPageVersion === 1 \? \{ literalResultTokens: \{ \[CONSTRUCTION_VIEW_TOOL\.function\.name\]: BOB_CONSTRUCTION_RESULT_TOKENS \} \} : \{\}/)
  assert.match(code, /onToolBatch:names=>\{ constructionReadsInStep = names\.filter\(name => name === CONSTRUCTION_VIEW_TOOL\.function\.name\)\.length \}/)
})

test('core reading tools are preloaded only for jobs pinned at start (2026-10-25)', async () => {
  const code = await readFile(new URL('../supabase/functions/_shared/ask-openai.ts', import.meta.url), 'utf8')
  const identity = code.slice(code.indexOf("memo('execution:identity'"), code.indexOf('modelBudget = createBobModelBudget'))
  assert.match(identity, /corePreloadVersion: 1 as const,/)
  assert.match(code, /execution\.corePreloadVersion !== 1\) throw new Error\('core_preload_version_invalid'\)/)
  assert.match(code, /execution\.corePreloadVersion === 1 \? \{ corePreload: true \} : \{\}/)
})
