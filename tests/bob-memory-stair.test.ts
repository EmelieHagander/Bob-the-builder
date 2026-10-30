import { test } from 'node:test'
import assert from 'node:assert/strict'
import { catalogFixture, catalogCall } from './support/ai-catalog-fixture.ts'
import { nextStairFold, prepareMemoryStair, degradedStairText, STAIR_LIMITS, type StairStore } from '../supabase/functions/_shared/bob-memory-stair.ts'
import { restoreWorkingContext, type ContextStore, type StairMessage, type StairSummary, type MemoryStair } from '../supabase/functions/_shared/bob-working-context.ts'
import { runProjectAnswer, seedToolPolicy } from '../supabase/functions/_shared/project-answer.ts'
import { createProjectLookup } from '../supabase/functions/_shared/project-lookup.ts'
import { createProjectWriter } from '../supabase/functions/_shared/project-write.ts'
import { createConstructionTools } from '../supabase/functions/_shared/construction-draft.ts'
import { createSolutionActions } from '../supabase/functions/_shared/project-solution-actions.ts'
import { createProjectContext } from './support/colleague-catalog-fixture.ts'
import { createMediaAdapter } from '../supabase/functions/_shared/project-context/media.ts'
import { DESIGN_CAD_TOOL } from '../supabase/functions/_shared/cad-assistant.ts'
import { createBobContextContinuation } from '../supabase/functions/_shared/bob-context-continuation.ts'
import type { OpenAIServiceOptions } from '../supabase/functions/_shared/openai-service.ts'

// Owner decision 2026-10-30: the prompt is ordered by how often its parts
// change, and the conversation is a stair of summaries written once, each with
// its source range, followed by the newest messages unchanged.
const usage = { input_tokens: 1, output_tokens: 1, total_tokens: 2 }
const at = (n: number) => new Date(Date.UTC(2026, 9, 30, 8, n)).toISOString()
const words = (n: number) => Array.from({ length: n }, (_, i) => 'ord' + i).join(' ')
const msg = (seq: number, text = 'Meddelande ' + seq): StairMessage =>
  ({ seq, role: seq % 2 ? 'user' : 'assistant', text, state: 'completed', createdAt: at(seq) })
const sum = (id: string, level: 0 | 1 | 2, seqFrom: number, seqTo: number): StairSummary => ({ id, level, seqFrom, seqTo, text: `Sammanfattning ${seqFrom}–${seqTo}` })

test('the stair only appends until a budget is passed, then folds one step: a chunk, five chunks, five upper summaries', () => {
  const small = Array.from({ length: 10 }, (_, i) => msg(i + 1))
  assert.equal(nextStairFold({ summaries: [], raw: small, hasMore: false }), null, 'small raw history stays raw')
  const big = Array.from({ length: 10 }, (_, i) => msg(i + 1, words(600)))
  const chunk = nextStairFold({ summaries: [], raw: big, hasMore: false })!
  assert.equal(chunk.level, 2); assert.equal(chunk.seqFrom, 1)
  assert(chunk.seqTo <= 10 - STAIR_LIMITS.keepRecent, 'the newest messages stay raw')
  assert.deepEqual(chunk.messages.map(m => m.seq), Array.from({ length: chunk.seqTo }, (_, i) => i + 1))
  // Unread older messages after the loaded ones: every loaded one is older, so all may fold.
  assert.equal(nextStairFold({ summaries: [], raw: big.slice(0, 3), hasMore: true })!.seqTo, 3)
  const five = [sum('a', 2, 1, 2), sum('b', 2, 3, 4), sum('c', 2, 5, 6), sum('d', 2, 7, 8), sum('e', 2, 9, 10)]
  const merge = nextStairFold({ summaries: five, raw: [], hasMore: false })!
  assert.deepEqual([merge.level, merge.seqFrom, merge.seqTo, merge.supersede.map(s => s.id)], [1, 1, 10, ['a', 'b', 'c', 'd', 'e']])
  assert.equal(nextStairFold({ summaries: five.slice(0, 4), raw: [], hasMore: false }), null, 'four of a level wait')
  const upper = [sum('m', 0, 1, 10), sum('n', 1, 11, 20), sum('o', 1, 21, 30), sum('p', 1, 31, 40), sum('q', 1, 41, 50), sum('r', 2, 51, 52)]
  const top = nextStairFold({ summaries: upper, raw: [], hasMore: false })!
  assert.deepEqual([top.level, top.seqFrom, top.seqTo, top.supersede.map(s => s.id)], [0, 1, 50, ['m', 'n', 'o', 'p', 'q']])
  assert.match(degradedStairText(chunk), /inte sammanfattade/)
})

/** The database contract in memory: contiguous chunks, exact merges, nothing rewritten. */
function memoryStore(raw: StairMessage[], current: StairMessage, opts: { failSaves?: number } = {}) {
  let summaries: StairSummary[] = [], id = 0, failSaves = opts.failSaves ?? 0
  const saved: { level: number; seqFrom: number; seqTo: number; text: string }[] = []
  const frame = () => {
    const through = summaries.at(-1)?.seqTo ?? 0
    return { projectId: 'p', threadId: 't', generation: 1, snapshot: { project: { name: 'Lådan', phase: 'design' } }, snapshotLockedAt: at(0),
      summarizedThroughSeq: through, summaries: structuredClone(summaries), raw: raw.filter(m => m.seq > through), hasMore: false,
      current: { seq: current.seq, role: 'user', text: current.text, state: 'pending' }, events: [{ at: at(2), kind: 'project_phase', from: 'idea', to: 'design' }],
      recentWrites: [], recentSources: [] }
  }
  const store: ContextStore & StairStore = {
    load: async () => { throw Error('the old summary is not read') }, save: async () => { throw Error('the old summary is not written') },
    search: async () => ({ projectId: 'p', threadId: 't', messages: [], truncated: false, nextBeforeSeq: null }),
    stairLoad: async () => frame(),
    stairSave: async (level, seqFrom, seqTo, text, supersede) => {
      if (failSaves-- > 0) throw Error('lost acknowledgement')
      const through = summaries.at(-1)?.seqTo ?? 0
      if (level === 2) assert.equal(seqFrom, through + 1, 'a chunk starts right after the last summary')
      else summaries = summaries.filter(s => !supersede.includes(s.id))
      summaries = [...summaries, { id: 's' + ++id, level: level as 0 | 1 | 2, seqFrom, seqTo, text }].sort((a, b) => a.seqFrom - b.seqFrom)
      saved.push({ level, seqFrom, seqTo, text })
      return frame()
    },
  }
  return { store, saved }
}

test('preparing the stair writes each chunk once with its range; a failed summary keeps a readable pointer', async () => {
  const raw = Array.from({ length: 12 }, (_, i) => msg(i + 1, words(500))), current = { ...msg(13, 'Fortsätt'), state: 'pending' as const }
  const { store, saved } = memoryStore(raw, current)
  const inputs: any[] = []
  const session = await prepareMemoryStair({ projectId: 'p', userId: 'u', threadId: 't', generation: 1, message: 'Fortsätt', store,
    hasAccess: async () => true, deadline: Date.now() + 60000,
    callModel: async options => {
      assert.equal(options.catalogRoleKey, 'memory-stair'); assert.equal(options.catalogSchemaKey, 'bob_memory_stair'); assert.equal(options.tools, undefined)
      const input = JSON.parse(String(options.messages![0].content)); inputs.push(input)
      return { success: true, model: 'fixture', usage, data: JSON.stringify({ summary: `Del ${input.messages[0].seq}–${input.messages.at(-1).seq}.` }) }
    } })
  assert.equal(inputs[0].task, 'chunk'); assert.equal(inputs[0].budget_tokens, STAIR_LIMITS.chunkTokens)
  assert.deepEqual(inputs[0].events.map((e: any) => e.kind), ['project_phase'], 'events inside the range go along')
  assert(saved.length >= 1 && saved.every(s => s.level === 2))
  const stair = session.stair!
  assert.equal(stair.summaries.at(-1)!.seqTo, stair.raw[0].seq - 1, 'raw messages follow the last summary')
  assert(stair.raw.length >= STAIR_LIMITS.keepRecent)
  assert.deepEqual(session.recent.map(m => m.text), ['Fortsätt']); assert.equal(session.summary, '')
  // The model fails twice: the range is still written, as a pointer to its source.
  const failing = memoryStore(raw, current)
  const degraded = await prepareMemoryStair({ projectId: 'p', userId: 'u', threadId: 't', generation: 1, message: 'Fortsätt', store: failing.store,
    hasAccess: async () => true, deadline: Date.now() + 60000, callModel: async () => ({ success: false, model: 'fixture', error: 'unavailable' }) as any })
  assert.match(degraded.stair!.summaries[0].text, /Meddelanden 1–\d+ är inte sammanfattade/)
  // Access ends: nothing is written.
  const denied = memoryStore(raw, current)
  await assert.rejects(prepareMemoryStair({ projectId: 'p', userId: 'u', threadId: 't', generation: 1, message: 'Fortsätt', store: denied.store,
    hasAccess: async () => false, deadline: Date.now() + 60000, callModel: async () => { throw Error('no call') } }), /project_denied/)
  assert.equal(denied.saved.length, 0)
})

async function tieredTurn(stair: MemoryStair, message: string, seq: number, steps: ((options: OpenAIServiceOptions) => unknown)[] = []) {
  const catalog = catalogFixture(), projectId = 'p', hasAccess = async () => true
  const store = { load: async () => ({}), save: async () => ({}), search: async () => ({}) } as ContextStore
  const context = restoreWorkingContext({ version: 1, projectId, threadId: 't', searches: 0, context: { summary: '', throughSeq: stair.summaries.at(-1)?.seqTo ?? 0,
    recent: [{ seq, role: 'user', text: message, state: 'pending' }], recentWrites: [], recentSources: [], memoryManagementVersion: 2, stair } }, { projectId, threadId: 't', message, store, hasAccess })
  const lookup = createProjectLookup(projectId, async (_project, input) => ({ data: { records: input.dataset === 'project' ? [{ id: projectId, name: 'Lådan', description: 'Saved project' }] : [], related: [], truncated: false }, error: null }) as any, undefined, undefined, undefined, { unlimitedWork: true })
  const writer = createProjectWriter(projectId, message, async () => { throw Error('No write requested') }, async () => ({ data: [], error: null }), async () => ({ data: [], error: null }))
  const constructionTools = createConstructionTools({ projectId, message, writer, constructionSourceRefresh: true, hasAccess, read: async () => ({}), readSources: async () => ({ project: new Map(), physical: new Map() }) })
  const solutionActions = createSolutionActions({ projectId, writer, hasAccess, read: async () => ({ data: [], error: null }) })
  const projectContext = createProjectContext({ hasAccess, sources: lookup.sources, adapters: [createMediaAdapter(projectId, {
    count: async () => 0, list: async () => [], read: async () => null, download: async () => new Uint8Array() })] })
  const readToolPolicy = async () => {
    const policy = await seedToolPolicy(), definitions = catalog.manifest().definitions
    return { ...policy, phase: 'concept', tools: policy.tools.map(row => {
      const version = (definitions.find(d => d.prompt_key === 'tools.' + row.name)?.definition.envelope as { schema_version?: number } | undefined)?.schema_version
      return version ? { ...row, schema_version: version } : row
    }) }
  }
  const requests: OpenAIServiceOptions[] = []
  const result = await runProjectAnswer({ projectId, userId: 'owner', message, context, lookup, writer, hasAccess, constructionTools, solutionActions, projectContext, aiCatalog: catalog,
    corePreload: true, readToolPolicy, toolPicker: true, completeRequest: true,
    cadAssistant: { pending: async () => [], tools: [DESIGN_CAD_TOOL], lifecycleTools: [], remaining: 1, lifecycleRemaining: 0,
      candidate: null, partial: false, failure: null, sources: [], consult: async () => ({ status: 'invalid' }), lifecycle: async () => ({ status: 'invalid' }) } as any,
    callModel: catalogCall(async options => {
      if (options.functionName === 'completion-gate') return { success: true, model: 'fixture', usage, data: JSON.stringify({ work_remaining: false, reason: '' }) }
      if (options.functionName === 'tool-picker') return { success: true, model: 'fixture', usage, data: JSON.stringify({ tools: ['read_construction_draft'], reason: '' }) }
      requests.push(structuredClone(options))
      const step = steps[requests.length - 1]
      return (step ? step(options) : { success: true, model: 'fixture', usage, responseId: 'done' + requests.length, data: 'Klart.' }) as any
    }, catalog) } as any)
  assert.equal(result.ok, true, JSON.stringify(result))
  return requests
}
const contents = (options: OpenAIServiceOptions) => (options.messages ?? []).map(m => typeof m.content === 'string' ? m.content : JSON.stringify(m.content))

test('tiered input: locked snapshot, summaries with sources, raw messages and events, then the request and its frame; the next turn only appends', async () => {
  const summaries = [sum('s1', 2, 1, 4)]
  const raw = [msg(5, 'Gör lådan 40 cm bred'), msg(6, 'Ritningen är uppdaterad.')]
  const events = [{ at: at(5) + '1', kind: 'project_phase', from: 'design', to: 'build', reason: 'Ritningen är klar' }]
  const stair: MemoryStair = { snapshot: { project: { name: 'Lådan', phase: 'design' }, plan: { revision: 1, status: 'approved', steps: [{ position: 1, title: 'Rita', state: 'done' }] }, areas: [] },
    snapshotLockedAt: at(0), summaries, raw, events }
  const first = (await tieredTurn(stair, 'Vilka skruvar behövs?', 7))[0]
  const items = contents(first)
  assert.match(items[0], /^Projektläget på huvudnivå/); assert(items[0].includes('"locked_at"') && items[0].includes('"Rita"'), 'the checklist is in the snapshot')
  const summaryAt = items.findIndex(c => c.startsWith('Sammanfattning av tidigare meddelanden'))
  assert(summaryAt > 0 && items[summaryAt].includes('{"source":{"from_seq":1,"to_seq":4}}'), 'each summary names its source range')
  const order = ['Gör lådan 40 cm bred', '[Händelse i projektet', 'Ritningen är uppdaterad.', 'Vilka skruvar behövs?']
  const positions = order.map(text => items.findIndex(c => c.startsWith(text)))
  assert(positions.every((p, i) => p > summaryAt && (i === 0 || p > positions[i - 1])), JSON.stringify(positions))
  const request = positions.at(-1)!
  const catalog = catalogFixture()
  assert(items[request + 1].startsWith(catalog.text('bob.frame.current')), 'the turn frame follows the request')
  // Availability is not in the instructions; it is sent at the end.
  assert.doesNotMatch(first.systemMessage!, /tool_availability/)
  assert(items.some(c => c.startsWith('{"tool_availability"')), 'availability reaches Bob at the end')
  assert(items.findIndex(c => c.startsWith('{"tool_availability"')) > request)
  // Next turn: the answer and the new request are appended; everything up to the previous request is byte-identical.
  const next = { ...stair, raw: [...raw, msg(7, 'Vilka skruvar behövs?'), msg(8, 'Tolv skruvar 4×30.')] }
  const second = (await tieredTurn(next, 'Och lim?', 9))[0]
  assert.equal(second.systemMessage, first.systemMessage)
  assert.deepEqual(contents(second).slice(0, request + 1), items.slice(0, request + 1), 'the previous turn is a prefix of this one')
})

test('availability is sent again only when it changes; resumed steps keep the instructions identical', async () => {
  const stair: MemoryStair = { snapshot: { project: { name: 'Lådan' } }, snapshotLockedAt: at(0), summaries: [], raw: [], events: [] }
  const call = (id: string, name: string, args: unknown) => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } })
  const requests = await tieredTurn(stair, 'Kontrollera lådan', 1, [
    () => ({ success: true, model: 'fixture', usage, responseId: 'r1', toolCalls: [call('c1', 'use_tool', { name: 'read_construction_draft', arguments: {} })] }),
  ])
  assert(requests.length >= 2)
  const availability = (options: OpenAIServiceOptions) => contents(options).filter(c => c.startsWith('{"tool_availability"'))
  assert.equal(availability(requests[0]).length, 1)
  const state = JSON.parse(availability(requests[0])[0]).tool_availability.find((t: any) => t.name === 'read_construction_draft')
  assert.equal(state.state, 'callable', 'a picked tool reached through use_tool is callable')
  assert.deepEqual(availability(requests[1]), [], 'unchanged availability is not repeated')
  assert.equal(requests[1].systemMessage, requests[0].systemMessage)
})

test('batched compaction keeps the start of a long turn byte-identical between batches', async () => {
  const catalog = catalogFixture()
  const run = async (batch?: number) => {
    const sent: OpenAIServiceOptions[] = []
    let n = 0
    const continuation = createBobContextContinuation({ version: 1, aiCatalog: catalog, mainResultReferences: 1, resultWindowTokens: 50, resultWindowVersion: 2,
      ...(batch ? { compactionBatch: batch } : {}),
      callModel: async options => { sent.push(structuredClone(options)); n++
        return { success: true, model: 'fixture', usage, responseId: 'r' + n, outputItems: [{ type: 'reasoning', id: 'rs' + n, summary: [] }, { type: 'function_call', id: 'fc' + n, call_id: 'c' + n, name: 'open_project_item', arguments: '{}' }],
          toolCalls: [{ id: 'c' + n, type: 'function', function: { name: 'open_project_item', arguments: '{}' } }] } as any } })
    let previous: string | undefined
    for (let step = 0; step < 9; step++) {
      const response = await continuation.call({ app: 'bob', coworkerId: 'bob', functionName: 'ask-bob', catalogRoleKey: 'ask-bob', systemMessage: 'S', responseItemsMode: 'preserve',
        messages: step === 0 ? [{ role: 'user', content: 'Gör en låda' }] : [{ role: 'tool', tool_call_id: 'c' + step, content: JSON.stringify({ status: 'ok', records: [{ id: 'x' + step, text: words(80) }] }) }],
        ...(previous ? { previousResponseId: previous } : {}), tools: [] } as any)
      previous = response.responseId
    }
    return sent.map(options => JSON.stringify((options as any).input ?? options.messages))
  }
  const prefixKept = (sent: string[]) => sent.slice(1).filter((wire, i) => wire.startsWith(sent[i].slice(0, -1))).length
  const perStep = await run(), batched = await run(4)
  // Measured: per step keeps the start on 2 of 8 later steps, a batch of 4 on 7 of 8.
  assert(prefixKept(batched) >= batched.length - 2 && prefixKept(batched) > prefixKept(perStep), `batched ${prefixKept(batched)} vs per step ${prefixKept(perStep)}`)
})
