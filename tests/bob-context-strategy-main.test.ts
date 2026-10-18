import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runProjectAnswer } from '../supabase/functions/_shared/project-answer.ts'
import { runClaimedProjectTurn } from '../supabase/functions/_shared/project-turn.ts'
import { createProjectLookup, type LookupInput } from '../supabase/functions/_shared/project-lookup.ts'
import type { WorkingContext } from '../supabase/functions/_shared/bob-working-context.ts'
import type { OpenAIServiceOptions, OpenAIServiceResponse } from '../supabase/functions/_shared/openai-service.ts'
import { countContextTokens } from '../supabase/functions/_shared/bob-token-budget.ts'
import { fingerprint } from '../supabase/functions/_shared/bob-job-journal.ts'
import type { ContextSurface } from '../supabase/functions/_shared/bob-context-continuation.ts'
import { catalogFixture, preContextStrategyCatalogFixture, catalogCall } from './support/ai-catalog-fixture.ts'

const usage = { input_tokens: 1, output_tokens: 1, total_tokens: 2 }
const response = (data = 'Jag fortsätter från det sparade underlaget.'): OpenAIServiceResponse<string> => ({ success: true, data, responseId: 'final', model: 'fixture', usage })
const toolResponse = (name: string, args: unknown, id: string): OpenAIServiceResponse<string> => ({ ...response(), data: null,
  responseId: id, toolCalls: [{ id: 'call-' + id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] })
const query = { dataset: 'project', query: null, status: null, area_id: null, record_id: null, after_id: null }
const names = (options: OpenAIServiceOptions) => (options.tools ?? []).map(tool => tool.function.name)
function fixture() {
  const reads: LookupInput[] = []
  const lookup = createProjectLookup('A', async (_project, input) => {
    reads.push(input)
    return { data: { records: input.dataset === 'project' ? [{ id: 'A', name: 'Barnrum', description: 'Sparad beskrivning av våningssängen.' }] : [], related: [], truncated: false }, error: null }
  }, undefined, undefined, undefined, { unlimitedWork: true })
  const context: WorkingContext = { summary: 'Ägaren vill färdigställa samma ritning; äldre antaganden är inte bekräftade mått.', throughSeq: 40,
    historyIndex: [{ seq: 32, descriptor: 'Tidigare rättelse av sängens bredd' }], memoryManagementVersion: 2,
    recent: Array.from({ length: 5 }, (_, i) => ({ seq: 41 + i, role: i % 2 ? 'assistant' as const : 'user' as const,
      text: `Oförändrat original ${41 + i}\n  Mått är inte verifierade.`, state: i === 4 ? 'pending' as const : 'completed' as const })),
    history: { remaining: Infinity, search: async () => ({ status: 'ok', messages: [] }), read: async () => ({ status: 'ok' }) } }
  return { reads, context, opts: { projectId: 'A', userId: 'owner', lookup, context,
    message: context.recent.at(-1)!.text, previousResponseId: 'old-full-conversation', hasAccess: async () => true, unlimitedWork: true } }
}

test('new main strategy sends compact memory, exact five originals, source-bound project orientation and a final data footer', async () => {
  const f = fixture(), session = catalogFixture()
  let calls = 0
  const result = await runProjectAnswer({ ...f.opts, aiCatalog: session, callModel: catalogCall(async options => {
    calls++
    assert.equal(options.previousResponseId, undefined, 'the previous full provider conversation is not replayed')
    assert.equal(options.aiDefinition?.manifestId, session.manifest().manifest_id)
    assert.deepEqual(names(options), ['describe_tool'])
    assert.equal(options.catalogSchemaParameters?.include_manual, false); assert.equal(options.catalogSchemaParameters?.card, true)
    const messages = options.messages!
    assert.equal(messages.length, 8)
    assert.equal(messages[0].role, 'user'); assert(String(messages[0].content).includes(f.context.summary))
    assert.deepEqual(messages.slice(1, 6), f.context.recent.map(message => ({ role: message.role, content: message.text })))
    assert(!String(messages[0].content).includes('Sparad beskrivning'))
    const project = JSON.parse(String(messages[6].content).split(session.text('bob.frame.briefing-label') + '\n\n')[1])
    assert.equal(project.projectId, 'A'); assert.equal(project.overview.text, 'Sparad beskrivning av våningssängen.')
    assert.equal(project.footer, undefined, 'footer is not duplicated in the project packet')
    assert(project.sources.some((source: any) => source.dataset === 'project' && source.recordId === 'A'))
    assert.equal(messages[7].role, 'user')
    assert(String(messages[7].content).startsWith(session.text('bob.note.prefix')))
    const footer = JSON.parse(String(messages[7].content).slice(session.text('bob.note.prefix').length)).orientation
    assert(footer.tokens <= 150); assert(footer.sourceIds.length > 0)
    assert(!options.systemMessage!.includes(f.context.summary)); assert(!options.systemMessage!.includes(f.opts.message))
    assert(!options.systemMessage!.includes(project.overview.text))
    return response()
  }, session) })
  assert(result.ok); assert.equal(calls, 1)
  assert.deepEqual(f.reads.map(read => read.dataset), ['project', 'plan', 'areas'])
})

test('lazy main loop preserves the just-offered fence, then reloads manuals after a compaction epoch', async () => {
  const f = fixture(), session = catalogFixture()
  let calls = 0, epoch = 0
  const result = await runClaimedProjectTurn({ ...f.opts, aiCatalog: session, contextEpoch: () => epoch,
    prepareContext: async () => f.context, fail: async () => assert.fail('successful work must not fail'),
    callModel: catalogCall(async options => {
      calls++
      if (calls === 1) { assert.deepEqual(names(options), ['describe_tool']); return toolResponse('describe_tool', { name: 'search_project_data' }, 'described') }
      if (calls === 2) {
        assert(names(options).includes('search_project_data'))
        assert.equal(JSON.parse(String(options.messages![0].content)).callable_from_next_step, true)
        epoch++
        return toolResponse('search_project_data', query, 'read')
      }
      assert.equal(calls, 3); assert.deepEqual(names(options), ['describe_tool'])
      assert.equal(JSON.parse(String(options.messages![0].content)).status, 'ok', 'the submitted call remains executable before next prepare')
      assert.equal(options.previousResponseId, 'read')
      return response()
    }, session) })
  assert(result.ok); assert.equal(calls, 3)
  assert.equal(f.reads.filter(read => read.dataset === 'project').length, 2, 'original briefing plus exactly one tool read')
})

test('an explicit internal instruction mode can compare the new strategy without changing its saved context', async () => {
  const f = fixture(), session = catalogFixture()
  const result = await runProjectAnswer({ ...f.opts, aiCatalog: session, toolInstructions: 'inline', callModel: catalogCall(async options => {
    assert(names(options).includes('search_project_data'))
    assert.equal(options.catalogSchemaParameters?.include_manual, true); assert.equal(options.catalogSchemaParameters?.card, undefined)
    assert.deepEqual(options.messages!.slice(1, 6), f.context.recent.map(message => ({ role: message.role, content: message.text })))
    return response()
  }, session) })
  assert(result.ok)
})

test('a new-strategy caller without private memory still cannot carry an untracked provider conversation into a fresh turn', async () => {
  const f = fixture(), session = catalogFixture()
  const result = await runProjectAnswer({ ...f.opts, context: undefined, aiCatalog: session, callModel: catalogCall(async options => {
    assert.equal(options.previousResponseId, undefined)
    assert.deepEqual(options.messages![0], { role: 'user', content: f.opts.message })
    assert.equal(options.messages!.length, 3, 'current owner request, project packet and server orientation')
    return response()
  }, session) })
  assert(result.ok)
})

test('atomic context refresh drops manuals before the fresh request and changes the actual execution fence', async () => {
  const f = fixture(), session = catalogFixture()
  let refresh: (() => Promise<ContextSurface>) | undefined, calls = 0, epoch = 0
  const result = await runClaimedProjectTurn({ ...f.opts, aiCatalog: session, prepareContext: async () => f.context,
    registerContextSurface: callback => { refresh = callback }, contextEpoch: () => epoch,
    fail: async () => assert.fail('successful work must not fail'), callModel: catalogCall(async options => {
      calls++
      if (calls === 1) return toolResponse('describe_tool', { name: 'search_project_data' }, 'before-rollover')
      if (calls === 2) {
        assert(names(options).includes('search_project_data'))
        const fresh = await refresh!(); epoch++
        assert.deepEqual((fresh.tools ?? []).map(tool => tool.function.name), ['describe_tool'])
        assert.equal(fresh.catalogSchemaParameters?.include_manual, false); assert.equal(fresh.catalogSchemaParameters?.card, true)
        assert(fresh.systemMessage!.includes('search_project_data'), 'the capability remains discoverable')
        // Even a bad provider response cannot execute a schema removed from
        // the newly submitted request; the handler fence changed atomically.
        return toolResponse('search_project_data', query, 'stale-schema')
      }
      if (calls === 3) {
        assert.equal(JSON.parse(String(options.messages![0].content)).status, 'not_offered')
        assert.deepEqual(names(options), ['describe_tool'])
        return toolResponse('describe_tool', { name: 'search_project_data' }, 'after-rollover')
      }
      if (calls === 4) {
        assert(names(options).includes('search_project_data'), 'the new manual survives into the next prepare despite the epoch change')
        return toolResponse('search_project_data', query, 'read-after-rollover')
      }
      assert.equal(calls, 5); assert.equal(JSON.parse(String(options.messages![0].content)).status, 'ok')
      return response()
    }, session) })
  assert(result.ok); assert.equal(calls, 5)
  assert.equal(f.reads.filter(read => read.dataset === 'project').length, 2, 'no stale-schema read was dispatched')
})

test('legacy pinned strategy retains frame order, tools and unbounded historical role text without extra orientation reads', async () => {
  const f = fixture(), session = preContextStrategyCatalogFixture()
  assert(countContextTokens(session.role('ask-bob').systemMessage) > 700)
  const result = await runProjectAnswer({ ...f.opts, aiCatalog: session, callModel: catalogCall(async options => {
    assert.equal(options.messages!.length, 6)
    // Verified against the pre-change project-answer source, using the same
    // immutable pre-strategy catalog. Timeout/read timestamps are normalized
    // by the production journal itself; every other input byte is pinned.
    assert.equal(await fingerprint(options), '587b50cf205cab7aa9a0b58c30a2e7d3033ab8a34cf31e3303f6d27f12c5bc07')
    assert(String(options.messages![0].content).startsWith(session.text('bob.frame.current') + '\n\n'))
    assert(String(options.messages![0].content).includes(JSON.stringify({ throughSeq: f.context.throughSeq, summary: f.context.summary, index: f.context.historyIndex })))
    assert.deepEqual(options.messages!.slice(1), f.context.recent.map(message => ({ role: message.role, content: message.text })))
    assert(names(options).includes('search_project_data')); assert(names(options).includes('search_conversation_history'))
    assert.deepEqual(options.catalogSchemaParameters, { server_quote: true, include_manual: true, categories: [] })
    return response()
  }, session) })
  assert(result.ok); assert.deepEqual(f.reads.map(read => read.dataset), ['project'])
})

test('oversized new base role is refused before model dispatch and survives the claimed-turn error mapping', async () => {
  const f = fixture(), session = catalogFixture(manifest => { manifest.definitions.find(row => row.prompt_key === 'bob.persona')!.content = 'Instruction '.repeat(701) })
  let paid = 0, failed = 0
  const result = await runClaimedProjectTurn({ ...f.opts, aiCatalog: session, prepareContext: async () => f.context,
    callModel: async () => { paid++; return response() }, fail: async () => { failed++ } })
  assert.deepEqual(result, { ok: false, error: 'context_input_too_large' }); assert.equal(paid, 0); assert.equal(failed, 1)
})

test('the first actual model input for a 1000-Area project is bounded and deferred orientation remains lazily callable', async () => {
  const session = catalogFixture(), f = fixture()
  const areas = Array.from({ length: 1000 }, (_, i) => ({ id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, project_id: 'A',
    name: `Arbetsområde ${i} för byggprojektet`, archived_at: null, updated_at: '2026-10-18T08:00:00Z' }))
  const lookup = createProjectLookup('A', async (_project, input) => {
    if (input.dataset === 'project') return { data: { records: [{ id: 'A', name: 'Stort projekt', description: 'Samordna arbetet.' }], related: [], truncated: false }, error: null }
    if (input.dataset === 'plan') return { data: { records: [], related: [], truncated: false }, error: null }
    const start = input.after_id ? areas.findIndex(area => area.id === input.after_id) + 1 : 0
    const records = areas.slice(start, start + 25), truncated = start + records.length < areas.length
    return { data: { records, related: [], truncated, next_cursor: truncated ? records.at(-1)!.id : null }, error: null }
  }, undefined, undefined, undefined, { unlimitedWork: true })
  let calls = 0, continuation: Record<string, unknown> | undefined
  const result = await runProjectAnswer({ ...f.opts, lookup, aiCatalog: session, callModel: catalogCall(async options => {
    if (++calls === 1) {
      const tokens = countContextTokens(JSON.stringify({ systemMessage: options.systemMessage, messages: options.messages, tools: options.tools }))
      assert(tokens < 32_000, `initial source/tool seed must leave ample room below 96k; actual ${tokens}`)
      assert(options.systemMessage!.includes('read_project_orientation'))
      const project = JSON.parse(String(options.messages![6].content).split(session.text('bob.frame.briefing-label') + '\n\n')[1])
      assert.equal(project.directory.sections.children.total, 1000)
      assert(project.directory.sections.children.omitted > 0)
      continuation = project.directory.sections.children.next.arguments
      return toolResponse('describe_tool', { name: 'read_project_orientation' }, 'orientation-described')
    }
    if (calls === 2) {
      assert(names(options).includes('read_project_orientation'))
      return toolResponse('read_project_orientation', continuation, 'orientation-read')
    }
    assert.equal(calls, 3)
    const page = JSON.parse(String(options.messages![0].content))
    assert.equal(page.status, 'ok'); assert.equal(page.total, 1000); assert(page.records.length > 0)
    assert(page.tokenBudget.tokens <= 6000)
    return response()
  }, session) })
  assert(result.ok); assert.equal(calls, 3)
})
