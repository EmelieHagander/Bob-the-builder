import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createLookupReuse, createLookupTransport, lookupPin, READ_REUSE_MAX_AGE_MS, type LookupPin, type LookupReuse } from '../supabase/functions/_shared/lookup-rpc.ts'
import { createProjectLookup, type LookupInput } from '../supabase/functions/_shared/project-lookup.ts'
import { createBobJournal, BobContinuation, type JournalEntry } from '../supabase/functions/_shared/bob-job-journal.ts'
import { collectDrawingReviewEvidence } from '../supabase/functions/_shared/drawing-review.ts'
import { createGroundedModelCall } from '../supabase/functions/_shared/project-grounding.ts'

// Paid drawing turn 2026-10-29: 26 project lookups, mostly the same project,
// measurements, physical and target reads (lookupReuseVersion 1).
const reusePin = lookupPin({ roomDimensionsVersion: 1, exactLookupVersion: 1, lookupReuseVersion: 1 })
const plainPin = lookupPin({ roomDimensionsVersion: 1, exactLookupVersion: 1 })
const read = (dataset: LookupInput['dataset'], record_id: string | null = null): LookupInput => ({ dataset, query: null, status: null, area_id: null, record_id, after_id: null })
const rows = (dataset: string) => ({ data: { records: dataset.startsWith('physical') ? [] : [{ id: dataset + '-1', name: dataset, revision: 1, updated_at: '2026-10-29T10:00:00Z' }], related: [], truncated: false, next_cursor: null }, error: null })

/** A fake caller-JWT client counting RPCs, an optional real journal and one shared transport. */
function harness(pin: LookupPin, opts: { journal?: ReturnType<typeof createBobJournal>; reuse?: LookupReuse; fail?: (args: Record<string, unknown>) => boolean } = {}) {
  const calls: Record<string, unknown>[] = []
  const reuse = opts.reuse ?? createLookupReuse()
  const memo = <T>(stream: string, input: unknown, work: () => Promise<T>) => opts.journal ? opts.journal.run(stream, input, work) : work()
  const transport = Object.assign(createLookupTransport(() => pin, async (_name, args) => {
    calls.push(args)
    return opts.fail?.(args) ? { data: null, error: { code: 'XX000' } } : rows(String(args.p_dataset))
  }, memo, reuse), { checkpointed: !!opts.journal })
  // As in production, a journaled turn records each read's observation time.
  const observationTime = opts.journal ? (value: unknown) => opts.journal!.run('lookup:observed_at', { projectId: 'p1', input: value }, async () => new Date().toISOString()) : undefined
  return { calls, reuse, transport, lookup: (budget = 64) => createProjectLookup('p1', transport, pin.timeoutMs, budget, undefined, { unlimitedWork: true, ...(observationTime ? { observationTime } : {}) }) }
}

test('pins: reuse needs exact lookup and is off for every older pin', () => {
  assert.equal(reusePin.reuse, true)
  for (const pin of [lookupPin({}), lookupPin({ roomDimensionsVersion: 1 }), plainPin]) assert.equal(pin.reuse, false)
  assert.throws(() => lookupPin({ roomDimensionsVersion: 1, lookupReuseVersion: 1 }), /lookup_reuse_version_invalid/)
  assert.throws(() => lookupPin({ roomDimensionsVersion: 1, exactLookupVersion: 1, lookupReuseVersion: 2 as 1 }), /lookup_reuse_version_invalid/)
})

test('an identical read is reused across lookup instances with its original observation time', async () => {
  let now = Date.parse('2026-10-29T10:00:00Z')
  const h = harness(reusePin, { reuse: createLookupReuse(() => now) })
  const first = await h.lookup().search(read('project'))
  now += 30_000
  const second = await h.lookup().search(read('project'))
  assert.equal(h.calls.length, 1)
  assert.deepEqual(second.records, first.records)
  assert.equal(second.retrievedAt, '2026-10-29T10:00:00.000Z', 'reports when the data was read, not when it was reused')
  await h.lookup().search(read('measurements'))
  await h.lookup().search(read('artifacts', '83e8bb90-bc86-4279-a187-e094d5071af8'))
  assert.equal(h.calls.length, 3, 'different inputs are separate reads')
  assert.deepEqual(h.reuse.stats, { hits: 1, misses: 3 })
})

test('a write, an expired result or a failed read never reuses data', async () => {
  let now = 0
  const failing = new Set<string>(['measurements'])
  const h = harness(reusePin, { reuse: createLookupReuse(() => now), fail: args => failing.has(String(args.p_dataset)) })
  await h.lookup().search(read('project'))
  h.reuse.invalidate() // what writeRpc does around every write of the turn
  await h.lookup().search(read('project'))
  assert.equal(h.calls.length, 2, 'read again after the write')
  now += READ_REUSE_MAX_AGE_MS + 1
  await h.lookup().search(read('project'))
  assert.equal(h.calls.length, 3, 'read again after the maximum age')
  assert.equal((await h.lookup().search(read('measurements'))).status, 'unavailable')
  failing.clear()
  assert.equal((await h.lookup().search(read('measurements'))).status, 'ok')
  assert.equal(h.calls.length, 5, 'a failed read is not stored')
})

test('older pins never reuse, even with a store present', async () => {
  const h = harness(plainPin)
  await h.lookup().search(read('project'))
  await h.lookup().search(read('project'))
  assert.equal(h.calls.length, 2)
  assert.deepEqual(h.reuse.stats, { hits: 0, misses: 0 })
})

test('reuse never changes journal positions: a resumed worker with an empty store replays exactly', async () => {
  const entries: JournalEntry[] = []
  const store = { entries, save: async (entry: JournalEntry) => { entries.push(structuredClone(entry)) } }
  const sequence = [read('project'), read('project'), read('measurements'), read('project')]
  const first = harness(reusePin, { journal: createBobJournal(store, Infinity) })
  const original = []
  for (const input of sequence) original.push(await first.lookup().search(input))
  assert.equal(first.calls.length, 2, 'two RPCs, four recorded reads')
  const reads = (list: JournalEntry[]) => list.filter(e => e.key.startsWith('rpc:')).map(e => e.key)
  assert.deepEqual(reads(entries), [0, 1, 2, 3].map(n => 'rpc:search_bob_project_data_v10:' + n))
  // Full replay: no RPC, identical results including the reused observation time.
  const replay = harness(reusePin, { journal: createBobJournal({ entries: structuredClone(entries), save: async () => assert.fail('replay saves nothing') }, Infinity) })
  const replayed = []
  for (const input of sequence) replayed.push(await replay.lookup().search(input))
  assert.equal(replay.calls.length, 0)
  assert.deepEqual(replayed.map(r => [r.records, r.retrievedAt]), original.map(r => [r.records, r.retrievedAt]))
  // A worker that lost everything after the first read: the second read is a
  // live miss at the recorded position, never a continuation conflict.
  const partial: JournalEntry[] = structuredClone(entries.slice(0, 2))
  assert.deepEqual(partial.map(e => e.key), ['lookup:observed_at:0', 'rpc:search_bob_project_data_v10:0'])
  const resumed = harness(reusePin, { journal: createBobJournal({ entries: partial, save: async entry => { partial.push(entry) } }, Infinity) })
  for (const input of sequence) {
    try { await resumed.lookup().search(input) } catch (error) { if (error instanceof BobContinuation) assert.fail('continuation ' + error.message); throw error }
  }
  assert.equal(resumed.calls.length, 2, 'the replayed first read does not fill the store; then project and measurements are read once')
  assert.deepEqual(reads(partial), reads(entries))
})

test('a CAD design claim: review evidence and pixel grounding read the project once', async () => {
  const claim = async (pin: LookupPin) => {
    const h = harness(pin)
    const lookup = h.lookup()
    await lookup.search({ ...read('target', 'project') })
    await collectDrawingReviewEvidence(h.lookup(), false, false, { unlimitedWork: true })
    const grounded = createGroundedModelCall({ groundingInstruction: 'Ground', projectId: 'p1', message: 'Draw', lookup: h.lookup(), readOrder: 'serial',
      hasAccess: async () => true, validateImages: async () => true, deadline: Date.now() + 60_000,
      callModel: async () => ({ success: true, data: 'ok', model: 'fixture', usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } }) })
    await grounded({ app: 'bob', coworkerId: 'bob', functionName: 'cad-reviewer', aiFunction: 'cad-reviewer', module: 'global', userId: 'u',
      messages: [{ role: 'user', content: [{ type: 'image_url', image_url: 'private-image:render/front' }] as any }] })
    return h.calls.map(c => c.p_dataset)
  }
  const before = await claim(plainPin), after = await claim(reusePin)
  assert.deepEqual(before, ['target', 'project', 'measurements', 'physical_spaces', 'physical_elements', 'physical_space_measurements', 'physical_relationships', 'project', 'measurements'])
  assert.deepEqual(after, before.slice(0, 7), 'grounding reuses the review evidence read moments earlier')
})

test('the recorded drawing turn: 26 RPCs become 22 with a fresh store per claim and the write in between', async () => {
  // Fingerprint-matched sequence of job e8d467ab (2026-10-29), grouped by the
  // claim it ran in. Every Bob model call yields, so each claim starts empty.
  const review = ['project', 'measurements', 'physical_spaces', 'physical_elements', 'physical_space_measurements', 'physical_relationships']
  const claims: (LookupInput['dataset'] | 'write' | [LookupInput['dataset'], string])[][] = [
    ['project', 'plan', 'areas'],
    [['target', 'project'], ...review as any, 'project', 'measurements'],
    [['artifacts', 'a83e8bb9']],
    ['write'],
    [['artifacts', 'a57ebca9'], ['solutions', 'd7c27935']],
    [['target', 'project']],
    [['target', 'project'], ...review as any, 'project', 'measurements'],
    [['target', 'project']],
  ]
  const count = async (pin: LookupPin) => {
    let total = 0
    for (const steps of claims) {
      const h = harness(pin)
      for (const step of steps) {
        if (step === 'write') { h.reuse.invalidate(); continue }
        const [dataset, record] = Array.isArray(step) ? step : [step, null]
        await h.lookup().search(read(dataset, record))
      }
      total += h.calls.length
    }
    return total
  }
  assert.equal(await count(plainPin), 26)
  assert.equal(await count(reusePin), 22)
})

test('new executions pin lookup reuse and every write of the turn ends reuse', async () => {
  const code = await readFile(new URL('../supabase/functions/_shared/ask-openai.ts', import.meta.url), 'utf8')
  const identity = code.slice(code.indexOf("memo('execution:identity'"), code.indexOf('modelBudget = createBobModelBudget'))
  assert.match(identity, /lookupReuseVersion: 1 as const,/)
  const writing = code.slice(code.indexOf('const writing = async'), code.indexOf('const writeRpc = async'))
  assert.equal(writing.match(/lookupReuse\.invalidate\(\)/g)?.length, 2, 'before the write and after it, replayed or live')
  assert.equal(code.match(/lookupReuse\.invalidate\(\)/g)?.length, 2, 'only through writing()')
  assert.match(code, /createLookupTransport\(\(\) => lookupPinned,[\s\S]{0,120}memo, lookupReuse\)/)
  // Project writes, piece release and drawing-store writes (gap Tasks, links,
  // restore, cancel). Drawing-store reads and side tables the lookup never
  // reads (descriptions, observations, request packets) keep reuse.
  for (const site of [/return writing\(\(\) => memo\('rpc:' \+ name/, /release:ids=>writing\(async\(\)=>\{\s*const \{data,error\}=await internal\.rpc\('release_drawing_pieces'/,
    /return DRAWING_STORE_READS\.has\(name\)\?call\(\):writing\(call\)/]) assert.match(code, site)
  assert.match(code, /const DRAWING_STORE_READS = new Set\(\['project_drawing_requests', 'drawing_request_work', 'check_drawing_request'\]\)/)
  const store = await readFile(new URL('../supabase/functions/_shared/drawing-request-store.ts', import.meta.url), 'utf8')
  const called = new Set([...store.matchAll(/caller\('([a-z_]+)'/g)].map(m => m[1]))
  for (const name of ['project_drawing_requests', 'drawing_request_work', 'check_drawing_request']) assert(called.has(name) || store.includes(`'${name}'`), name)
})
