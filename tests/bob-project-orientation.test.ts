import { test } from 'node:test'
import assert from 'node:assert/strict'
import { prepareProjectOrientation } from '../supabase/functions/_shared/bob-project-orientation.ts'
import { countContextTokens } from '../supabase/functions/_shared/bob-token-budget.ts'
import { ORIENTATION_DIRECTORY_LIMITS, type OrientationDirectoryReader } from '../supabase/functions/_shared/bob-orientation-directory.ts'
import type { LookupInput, LookupResult } from '../supabase/functions/_shared/project-lookup.ts'
import type { CurrentView } from '../src/domain/bobScreen.ts'

const result = (data: unknown) => ({ success: true, data: data as any, model: 'fixture', usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } })
const page = (dataset: LookupInput['dataset'], records: any[], more = false, next: string | null = null): LookupResult => ({
  status: records.length ? 'ok' : 'empty', projectId: 'A', dataset, records, related: [], truncated: more,
  next_cursor: next, partial: more, truth: 'unknown', retrievedAt: '2026-10-18T08:00:00Z',
})
function fixture() {
  const project: any = { id: 'A', name: 'Barnrum', description: 'Förbered en våningssäng. Måtten är ännu uppskattningar.',
    working_plan: { status: 'ready', current_revision: 7, current_step: { id: 's1', title: 'Legacy first active fallback' },
      pending_proposal: { record_id: '8', revision: 8, based_on_revision: 7, summary: 'Unsaved decision', created_at: 'today' } } }
  const areas = Array.from({ length: 31 }, (_, i) => ({ id: `a${i}`, name: `Arbetsområde ${i}`, description: `Beskrivning ${i}`, archived_at: i === 30 ? 'yesterday' : null }))
  const steps: any[] = [
    { id: 's1', title: 'Mätning', goal: 'Ta mått.', notes: 'Beställaren mäter.', state: 'active', phase: 'concept', area_id: 'a0',
      tasks: [{ id: 't1', name: 'Mät takhöjd', status: 'todo', project_id: 'A', primary_step_id: 's1', area_id: 'a0' },
        { id: 't2', name: 'Mät vägg', status: 'done', project_id: 'A', primary_step_id: 's1', area_id: 'a0' }],
      requirements: [{ id: 'r1', title: 'Takhöjd uppmätt', description: 'Beställaren anger ett uppmätt värde.', status: { state: 'missing' } }] },
    { id: 's2', title: 'Ritning', goal: 'Rita efter uppmätta mått.', notes: 'Kontrollera källans revision.', state: 'blocked', phase: 'design', area_id: 'a0', tasks: [],
      requirements: [{ id: 'r2', title: 'Aktuell ritning', description: 'Ritningen hänvisar till rätt underlag.', resolution: 'pending', status: { state: 'stale', evidence: [{ id: 'drawing1', revision: 2 }] } }] },
    { id: 's3', title: 'Material', goal: 'Sammanställ material.', notes: '', state: 'planned', phase: 'planning', area_id: null, tasks: [], requirements: [] },
  ]
  const plan: any = { id: 'A', project_id: 'A', revision: 7, status: 'approved', focus_step_id: 's2', steps }
  const calls: LookupInput[] = []
  const lookup = { search: async (input: LookupInput): Promise<LookupResult> => {
    calls.push(input)
    if (input.dataset === 'plan') return page('plan', [plan])
    if (input.dataset === 'areas') return input.after_id ? page('areas', areas.slice(25)) : page('areas', areas.slice(0, 25), true, 'a24')
    if (input.dataset === 'tasks') return page('tasks', [{ ...steps[0].tasks[0], instructions: 'Mät från golv till tak.' }])
    throw new Error('Unexpected dataset')
  } }
  const opts = { projectId: 'A', userId: 'owner', briefing: page('project', [project]), lookup, message: 'Fortsätt med ritningen.',
    hasAccess: async () => true, deadline: Date.now() + 100000,
    callModel: async () => { throw new Error('Short originals do not need a model') } }
  return { opts, calls, project, plan, areas, steps }
}
function view(focus: CurrentView['focus']): CurrentView {
  return { status: 'ok', projectId: 'A', surface: 'task', focus, warnings: [], sources: [], retrievedAt: 'today' }
}

test('orientation follows saved focus, all paginated peers, children and exact revision-bound completion evidence', async () => {
  const f = fixture()
  const packet = await prepareProjectOrientation(f.opts)
  assert.equal(packet.focus.origin, 'saved_plan'); assert.equal(packet.focus.card.id, 's2')
  assert.deepEqual(packet.siblings.map(card => card.id), ['s1'])
  assert.deepEqual(packet.ancestors.map(card => card.id), ['A', 'a0'])
  assert.deepEqual(packet.completionRequirements[0].record, f.steps[1].requirements[0])
  const requirementSource = packet.sources.find(source => source.id === packet.completionRequirements[0].sourceId)!
  assert.equal(requirementSource.projectId, 'A'); assert.equal(requirementSource.recordId, '7'); assert.equal(requirementSource.revision, 7)
  assert.equal(requirementSource.itemId, 'r2')
  assert.equal(packet.workingPlan.pendingProposal?.status, 'proposed')
  assert.equal(packet.workingPlan.pendingProposal?.record_id, '8')
  assert.equal(packet.overview.text, f.project.description); assert.equal(packet.overview.kind, 'original')
  assert(packet.footer.tokens <= 150)
  assert.equal(f.calls.filter(call => call.dataset === 'areas').length, 2)

  const area = await prepareProjectOrientation({ ...f.opts, currentView: view({ area: { id: 'a0', name: 'Arbetsområde 0' } }) })
  assert.equal(area.siblings.length, 30)
  assert.equal(area.siblings.at(-1)?.status, 'archived')
  assert.deepEqual(area.children.map(card => card.id), ['s1', 's2'])
  assert(area.completeness.areas)
})

test('screen task overrides saved focus and receives its parent requirements without changing plan focus', async () => {
  const f = fixture(), original = structuredClone(f.plan)
  const packet = await prepareProjectOrientation({ ...f.opts, currentView: view({ task: { id: 't1', name: 'Mät takhöjd', status: 'todo', instructions: 'truncated screen text' } }) })
  assert.equal(packet.focus.origin, 'screen'); assert.equal(packet.focus.card.id, 't1')
  assert.equal(packet.focus.description.text, 'Mät från golv till tak.')
  assert.deepEqual(packet.ancestors.map(card => card.id), ['A', 'a0', 's1'])
  assert.deepEqual(packet.siblings.map(card => card.id), ['t2'])
  assert.equal(packet.completionRequirements[0].record.id, 'r1')
  assert.deepEqual(f.plan, original)
})

test('missing explicit focus never promotes the briefing legacy first-active fallback to an assignment', async () => {
  const f = fixture(); f.plan.focus_step_id = null
  const packet = await prepareProjectOrientation(f.opts)
  assert.equal(packet.focus.origin, 'project'); assert.equal(packet.focus.card.id, 'A')
  assert.deepEqual(packet.children.map(card => card.id), [...f.areas.map(area => area.id), 's3'])
  assert.deepEqual(packet.completionRequirements, [])
})

test('only oversized descriptions use bounded advisory presentations; exact requirements and source originals stay untouched', async () => {
  const f = fixture()
  f.project.description = '🪵'.repeat(600)
  f.steps[1].goal = '未確認の寸法。'.repeat(300)
  f.steps[1].requirements[0].description = 'Exact canonical requirement '.repeat(300)
  const originals = structuredClone({ project: f.project, plan: f.plan })
  let calls = 0
  const packet = await prepareProjectOrientation({ ...f.opts, message: 'åäö'.repeat(200), callModel: async options => {
    calls++
    assert.equal(options.catalogRoleKey, 'context-presentation')
    assert.equal(options.catalogSchemaKey, 'bob_context_presentation')
    const input = JSON.parse(String(options.messages![0].content))
    assert.deepEqual(input.blocks.map((block: any) => block.key), ['overview', 'focus', 'footer'])
    return result({ presentations: input.blocks.map((block: any) => ({ key: block.key, text: 'Kompakt översikt. Måtten behöver kontrolleras.', sourceIds: block.sourceIds })) })
  } })
  assert.equal(calls, 1)
  for (const presentation of [packet.overview, packet.focus.description, packet.footer]) {
    assert.equal(presentation.kind, 'advisory_summary')
    assert.equal(presentation.tokens, countContextTokens(presentation.text))
    assert(presentation.tokens <= presentation.maxTokens)
    assert(presentation.sourceIds.every(id => packet.sources.some(source => source.id === id)))
  }
  assert.deepEqual(packet.completionRequirements[0].record, originals.plan.steps[1].requirements[0])
  assert.deepEqual(f.project, originals.project); assert.deepEqual(f.plan, originals.plan)
})

test('invalid or still oversized presentation cannot masquerade as a valid compact original', async () => {
  const f = fixture(); f.project.description = '🪵'.repeat(600)
  let calls = 0
  const packet = await prepareProjectOrientation({ ...f.opts, callModel: async options => {
    calls++
    const input = JSON.parse(String(options.messages![0].content))
    if (calls === 2) assert.equal(input.validationFeedback, 'presentation_sources')
    return result({ presentations: input.blocks.map((block: any) => ({ key: block.key, text: 'Invented fact', sourceIds: ['foreign-project'] })) })
  } })
  assert.equal(calls, 2)
  assert.equal(packet.overview.kind, 'unavailable'); assert.equal(packet.overview.text, '')
  assert(packet.warnings.includes('overview:presentation_unavailable'))
  assert(packet.overview.sourceIds.length, 'the original remains directly addressable')
  assert.equal(f.project.description, '🪵'.repeat(600))
})

test('an oversized plan or stale screen revision remains explicitly incomplete instead of choosing another step', async () => {
  const f = fixture(), search = f.opts.lookup.search
  const packet = await prepareProjectOrientation({ ...f.opts,
    currentView: view({ planStep: { id: 's1', name: 'Mätning', state: 'active', goal: 'partial', notes: '', planRevision: 6 } }),
    lookup: { search: async input => input.dataset === 'plan' ? { ...page('plan', []), status: 'record_too_large', truncated: true } : search(input) },
  })
  assert.equal(packet.focus.card.level, 'project')
  assert(!packet.completeness.plan); assert(!packet.completeness.hierarchy); assert(!packet.completeness.requirements)
  assert(packet.warnings.includes('plan:record_too_large')); assert(packet.warnings.includes('screen_step_revision_unavailable'))
  assert(packet.sources.some(source => source.dataset === 'plan'))
})

test('cross-project sources and revoked access cannot enter orientation', async () => {
  const f = fixture(), search = f.opts.lookup.search
  await assert.rejects(prepareProjectOrientation({ ...f.opts, lookup: { search: async input => ({ ...await search(input), projectId: 'B' }) } }), /context_unavailable/)
  await assert.rejects(prepareProjectOrientation({ ...f.opts, hasAccess: async () => false }), /project_denied/)
  f.plan.steps[0].tasks[0].project_id = 'B'
  await assert.rejects(prepareProjectOrientation(f.opts), /context_unavailable/)
})

async function bounded(f: ReturnType<typeof fixture>, overrides: Partial<Parameters<typeof prepareProjectOrientation>[0]> = {}, pageMaxTokens = Number(ORIENTATION_DIRECTORY_LIMITS.page)) {
  let reader: OrientationDirectoryReader | undefined
  const packet = await prepareProjectOrientation({ ...f.opts, ...overrides, directory: {
    maxTokens: ORIENTATION_DIRECTORY_LIMITS.initial, pageMaxTokens,
    ready: value => { reader = value },
  } })
  assert(reader)
  assert.equal(packet.tokenBudget?.tokens, countContextTokens(JSON.stringify(packet)))
  assert(packet.tokenBudget!.tokens <= ORIENTATION_DIRECTORY_LIMITS.initial)
  return { packet, reader }
}

test('1000 Areas fit the complete initial token bound and every deferred child is exactly discoverable', async () => {
  const f = fixture(); f.plan.focus_step_id = null
  f.areas.splice(0, f.areas.length, ...Array.from({ length: 1000 }, (_, i) => ({ id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    name: `Arbetsområde ${i}: förberedelse, material, arbetsledning, byggarbete och kontroll av projektets krav och underlag`,
    description: `Beskrivning ${i}`, archived_at: i % 20 === 0 ? 'yesterday' : null })))
  const lookup = { search: async (input: LookupInput) => {
    if (input.dataset !== 'areas') return f.opts.lookup.search(input)
    const start = input.after_id === null ? 0 : f.areas.findIndex(area => area.id === input.after_id) + 1
    const records = f.areas.slice(start, start + 25), more = start + records.length < f.areas.length
    return page('areas', records, more, more ? records.at(-1)!.id : null)
  } }
  const historical = await prepareProjectOrientation({ ...f.opts, lookup })
  const historicalTokens = countContextTokens(JSON.stringify(historical))
  assert(historicalTokens > 96_000, `reproduce the pre-fix input-ceiling failure before checking bounded delivery (${historicalTokens})`)
  const { packet, reader } = await bounded(f, { lookup })
  assert.equal(packet.focus.card.id, 'A')
  assert.equal(packet.directory!.sections.children.total, 1001)
  assert(packet.directory!.sections.children.omitted > 0, 'the initial prompt cannot include the entire directory')
  assert.equal(packet.directory!.sections.children.included, packet.children.length)
  assert.equal(packet.directory!.sections.children.omitted, 1001 - packet.children.length)
  assert(!packet.completeness.hierarchy)
  assert(packet.directory!.sections.children.sourceComplete, 'source completeness and included-prompt completeness are distinct')
  const cards = [...packet.children], sources = [...packet.sources]
  let next = packet.directory!.sections.children.next!.arguments.after_cursor
  let pages = 0
  while (next !== null) {
    const result = await reader.execute({ section: 'children', snapshot_id: packet.directory!.snapshotId, after_cursor: next }) as any
    assert.equal(result.status, 'ok'); assert.equal(result.total, 1001)
    assert.equal(result.tokenBudget.tokens, countContextTokens(JSON.stringify(result)))
    assert(result.tokenBudget.tokens <= ORIENTATION_DIRECTORY_LIMITS.page)
    cards.push(...result.records); sources.push(...result.sources); next = result.next_cursor
    assert(++pages < 100, 'pagination must make progress')
  }
  assert.deepEqual(cards.map(card => card.id), [...f.areas.map(area => area.id), 's3'])
  assert.equal(new Set(cards.map(card => card.id)).size, cards.length)
  assert(cards.every(card => sources.some(source => source.id === card.sourceId && source.projectId === 'A')))
  assert.equal(cards.find(card => card.id === f.areas[980].id)!.status, 'archived')
  assert.equal(sources.find(source => source.id === cards.at(-1)!.sourceId)!.revision, 7)
  const lastArea = f.areas.at(-1)!
  const focused = await bounded(f, { lookup, currentView: view({ area: { id: lastArea.id, name: lastArea.name } }) })
  assert.equal(focused.packet.focus.card.id, lastArea.id, 'a focus beyond the first directory page remains exact')
  assert.equal(focused.packet.focus.description.text, lastArea.description)
  assert.deepEqual(focused.packet.ancestors.map(card => card.id), ['A'])
  assert.equal(focused.packet.directory!.sections.siblings.total, 999)
  assert(!focused.packet.siblings.some(card => card.id === lastArea.id))
})

test('large peer directories preserve exact screen focus and governing requirements before optional cards', async () => {
  const f = fixture()
  f.steps.push(...Array.from({ length: 1000 }, (_, i) => ({ id: `s-extra-${i}`, title: `Extra steg ${i}`, goal: 'Spara samma mål', notes: '',
    area_id: 'a0', state: 'planned', phase: 'planning', tasks: [], requirements: [] })))
  const { packet, reader } = await bounded(f, { currentView: view({ planStep: { id: 's2', name: 'Ritning', state: 'blocked', goal: '', notes: '', planRevision: 7 } }) })
  assert.equal(packet.focus.card.id, 's2'); assert.equal(packet.focus.origin, 'screen')
  assert.deepEqual(packet.ancestors.map(card => card.id), ['A', 'a0'])
  assert.deepEqual(packet.completionRequirements[0].record, f.steps[1].requirements[0])
  assert(packet.completeness.requirements)
  assert.equal(packet.sources.find(source => source.id === packet.completionRequirements[0].sourceId)!.revision, 7)
  assert.equal(packet.directory!.sections.siblings.total, 1001)
  const first = packet.directory!.sections.siblings.next!
  const result = await reader.execute(first.arguments) as any
  assert.equal(result.records[0].id, f.steps.filter(step => step.id !== 's2' && step.area_id === 'a0')[packet.siblings.length].id)
})

for (const pageMaxTokens of [2000, ORIENTATION_DIRECTORY_LIMITS.page]) test(`oversized exact requirements and shared facts round-trip unchanged with ${pageMaxTokens}-token pages`, async () => {
  const f = fixture()
  f.steps[1].requirements[0].description = 'UNVERIFIED 🪵 exact instruction. '.repeat(4000)
  f.project.working_plan.recent_shared_facts = [{ truth: 'unknown', note: 'Preserve the owner correction. '.repeat(4000) }]
  const expected = structuredClone(f.steps[1].requirements[0])
  const { packet, reader } = await bounded(f, {}, pageMaxTokens)
  assert.equal(packet.completionRequirements.length, 0); assert(!packet.completeness.requirements)
  assert.equal(packet.directory!.sections.completionRequirements.omitted, 1)
  assert.equal(packet.directory!.sections.recentSharedFacts.omitted, 1)
  for (const section of ['completionRequirements', 'recentSharedFacts'] as const) {
    let next: string | null = packet.directory!.sections[section].next!.arguments.after_cursor, json = '', pages = 0
    while (next !== null) {
      const result = await reader.execute({ section, snapshot_id: packet.directory!.snapshotId, after_cursor: next }) as any
      assert.equal(result.status, 'partial_record')
      assert.equal(result.fragment.json_start, json.length)
      assert.equal(result.tokenBudget.tokens, countContextTokens(JSON.stringify(result)))
      assert(result.tokenBudget.tokens <= pageMaxTokens)
      json += result.fragment.content; next = result.next_cursor
      assert(++pages < 100)
    }
    const restored = JSON.parse(json)
    if (section === 'completionRequirements') assert.deepEqual(restored.record, expected)
    else assert.deepEqual(restored, f.project.working_plan.recent_shared_facts[0])
  }
})

test('directory retries are deterministic, immutable, revision-bound and recheck current access', async () => {
  const f = fixture(); let allowed = true
  const { packet, reader } = await bounded(f, { hasAccess: async () => allowed })
  const input = { section: 'completionRequirements', snapshot_id: packet.directory!.snapshotId, after_cursor: null }
  const before = await reader.execute(input)
  f.steps[1].requirements[0].description = 'Changed after preparation'
  assert.deepEqual(await reader.execute(input), before)
  const other = await bounded(f)
  assert.notEqual(other.packet.directory!.snapshotId, packet.directory!.snapshotId)
  assert.deepEqual(await other.reader.execute(input), { status: 'stale_snapshot' })
  allowed = false
  await assert.rejects(reader.execute(input), /project_denied/)
})

test('rebuilding orientation with changed transport retrieval times retains exact snapshot and continuation output', async () => {
  const f = fixture(), first = await bounded(f), search = f.opts.lookup.search
  f.steps[1].requirements[0] = Object.fromEntries(Object.entries(f.steps[1].requirements[0]).reverse())
  const rebuilt = await bounded(f, { lookup: { search: async input => ({ ...await search(input), retrievedAt: '2026-10-18T15:30:01Z' }) },
    briefing: { ...f.opts.briefing, retrievedAt: '2026-10-18T15:30:00Z' }, deadline: Date.now() + 200000 })
  assert.deepEqual(rebuilt.packet, first.packet)
  const input = { section: 'completionRequirements', snapshot_id: first.packet.directory!.snapshotId, after_cursor: null }
  assert.deepEqual(await rebuilt.reader.execute(input), await first.reader.execute(input))
})

test('snapshot identity preserves exact record keys and literal text that resemble transport metadata', async () => {
  const f = fixture()
  f.project.working_plan.recent_shared_facts = [{ retrievedAt: 'original fact timestamp', note: 'Source says: "retrievedAt":"first"' }]
  const first = await bounded(f)
  f.project.working_plan.recent_shared_facts[0].retrievedAt = 'changed fact timestamp'
  const changedKey = await bounded(f)
  assert.notEqual(changedKey.packet.directory!.snapshotId, first.packet.directory!.snapshotId)
  f.project.working_plan.recent_shared_facts[0].note = 'Source says: "retrievedAt":"second"'
  const changedText = await bounded(f)
  assert.notEqual(changedText.packet.directory!.snapshotId, changedKey.packet.directory!.snapshotId)
  assert.deepEqual(await changedText.reader.execute({ section: 'recentSharedFacts', snapshot_id: first.packet.directory!.snapshotId, after_cursor: null }), { status: 'stale_snapshot' })
})

test('pinned pure facts cut oversized blocks to their original prefix and never call a model (2026-10-26)', async () => {
  const f = fixture()
  f.project.description = 'Förbered en våningssäng med förvaring. '.repeat(120)
  f.steps[1].goal = '未確認の寸法。'.repeat(300)
  const message = 'Fortsätt med ritningen och kontrollera måtten. '.repeat(60)
  const original = f.project.description
  const packet = await prepareProjectOrientation({ ...f.opts, message, presentation: 'cut' })
  for (const presentation of [packet.overview, packet.focus.description, packet.footer]) {
    assert.equal(presentation.kind, 'cut')
    assert.equal(presentation.tokens, countContextTokens(presentation.text))
    assert(presentation.tokens <= presentation.maxTokens && presentation.tokens > 0)
  }
  assert(original.startsWith(packet.overview.text), 'the overview is an exact original prefix')
  const footer = JSON.parse(packet.footer.text)
  assert.equal(footer.currentRequestCut, true)
  assert(message.startsWith(footer.currentRequest) && footer.currentRequest.length > 0, 'only the request is cut and the footer stays JSON')
  for (const key of ['overview', 'focus', 'footer']) assert(packet.warnings.includes(`${key}:cut`))
  assert.equal(f.project.description, original)
  // Short originals are unchanged in either mode.
  const short = await prepareProjectOrientation({ ...fixture().opts, presentation: 'cut' })
  assert.equal(short.overview.kind, 'original'); assert.equal(short.footer.kind, 'original')
})
