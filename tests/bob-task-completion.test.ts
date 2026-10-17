import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runProjectAnswer } from '../supabase/functions/_shared/project-answer.ts'
import { runClaimedProjectTurn } from '../supabase/functions/_shared/project-turn.ts'
import { createProjectLookup } from '../supabase/functions/_shared/project-lookup.ts'
import { createProjectWriter } from '../supabase/functions/_shared/project-write.ts'
import { createWorkRecords, type WorkSnapshot } from '../supabase/functions/_shared/project-work-records.ts'
import { createBobJournal, BobContinuation, type JournalEntry } from '../supabase/functions/_shared/bob-job-journal.ts'
import { catalogFixture, preTaskWorkflowCatalogFixture } from './support/ai-catalog-fixture.ts'

const usage = { input_tokens: 1, output_tokens: 1, total_tokens: 2 }
const reply = (data: string | null, phase: 'commentary'|'final_answer'|'refusal'|'legacy' = 'final_answer', toolCalls?: any[]) => ({ success: true, data, model: 'fixture', responseId: 'resp-' + phase, usage, outputPhase: phase, toolCalls })
const tool = (name: string, args: unknown) => ({ id: name, type: 'function' as const, function: { name, arguments: JSON.stringify(args) } })
const lookup = () => createProjectLookup('A', async (_p, input) => ({ data: { records: input.dataset === 'project' ? [{ id: 'A', name: 'Fixture' }] : [], related: [], truncated: false }, error: null }), 1000, 32)
const base = () => ({ aiCatalog: catalogFixture(), projectId: 'A', userId: 'u', message: 'Read the task', lookup: lookup(), hasAccess: async () => true })

test('new contract follows commentary through tools to final in the same response chain', async () => {
  let calls = 0
  const result = await runProjectAnswer({ ...base(), callModel: async options => {
    assert.equal(options.responsePhaseMode, 'aware'); assert.equal(options.tool_choice, undefined)
    calls++
    if (calls === 1) return { ...reply(null, 'commentary'), responseId: 'progress' }
    if (calls === 2) {
      assert.equal(options.previousResponseId, 'progress'); assert(options.tools?.length)
      return { ...reply(null, 'final_answer', [tool('search_project_data', { dataset: 'tasks', query: null, status: null, area_id: null, record_id: null, after_id: null })]), responseId: 'read' }
    }
    assert.equal(options.previousResponseId, 'read')
    return reply('The task is still todo.')
  } })
  assert(result.ok); assert.equal(result.answer, 'The task is still todo.'); assert.equal(calls, 3)
})

test('pure information, genuine owner question and refusal need no completion call', async () => {
  for (const [answer, phase] of [['Fixture.', 'final_answer'], ['Which wall do you mean?', 'final_answer'], ['I cannot do that.', 'refusal']] as const) {
    let calls = 0
    const result = await runProjectAnswer({ ...base(), callModel: async () => { calls++; return reply(answer, phase) } })
    assert(result.ok); assert.equal(result.answer, answer); assert.equal(calls, 1)
  }
})

test('repeated commentary closes tools then stops without presenting the preamble as a result', async () => {
  let calls = 0; const observations: any[] = []
  const result = await runProjectAnswer({ ...base(), observe: value => observations.push(value), callModel: async options => {
    calls++
    if (calls < 3) assert(options.tools?.length)
    else assert.equal(options.tools, undefined)
    return reply('I will continue now.', 'commentary')
  } })
  assert.deepEqual(result, { ok: false, error: 'commentary_limit' }); assert.equal(calls, 3)
  assert.equal(observations.at(-1).end, 'commentary_limit')
})

test('last commentary request can deliver a final blocker without reopening tools', async () => {
  let calls = 0
  const result = await runProjectAnswer({ ...base(), callModel: async options => {
    if (++calls < 3) return reply(null, 'commentary')
    assert.equal(options.tools, undefined)
    return reply('I need the actual wall measurement to finish this task.')
  } })
  assert(result.ok); assert.match(result.answer, /measurement/); assert.equal(calls, 3)
})

test('older pinned contracts retain their exact call options and completion behavior', async () => {
  for (const version of [undefined, 2, '1']) {
    let calls = 0
    const aiCatalog = preTaskWorkflowCatalogFixture(snapshot => { snapshot.definitions.find(row => row.prompt_key === 'agent-contract.ask-bob')!.metadata.work_completion_version = version })
    const result = await runProjectAnswer({ ...base(), aiCatalog, callModel: async options => {
      calls++; assert.equal(Object.hasOwn(options, 'responsePhaseMode'), false)
      return reply('Legacy answer.', 'commentary')
    } })
    assert(result.ok); assert.equal(result.answer, 'Legacy answer.'); assert.equal(calls, 1)
  }
})

test('completion checks saved task content/status once and replays unchanged after another save', async () => {
  const message = 'Integrate the instructions and mark this planning task as in progress.'
  const task: WorkSnapshot = { project_id: 'A', resource: 'tasks', key: 'task', scope_label: 'Planning task',
    record: { id: 'task', area_id: 'area', primary_step_id: null, name: 'Planning task', instructions: 'Existing requirement.', status: 'todo', updated_at: '2026-10-17T00:00:00Z' },
    relations: { people: [], instructions: [], needs: [], dependencies: [], readiness: { readiness_state: 'ready', blocker_count: 0 } } }
  const ledger: any[] = [], entries: JournalEntry[] = [], observations: any[] = []
  let writes = 0, calls = 0, yielded = false, freshRef = ''
  const segment = async () => {
    const journal = createBobJournal({ entries, save: async entry => { entries.push(structuredClone(entry)) } }, Date.now() + 300000)
    const writer = createProjectWriter('A', message, payload => journal.run('write', payload, async () => {
      writes++
      const domain: any = payload.data.domain
      if (domain.kind === 'task') task.record.instructions = domain.data.instructions
      else if (domain.kind === 'task_work') task.record.status = domain.data.status
      else assert.fail('Unexpected domain ' + domain.kind)
      task.record.updated_at = `2026-10-17T00:00:0${writes}Z`
      const receipt = { projectId: 'A', dataset: 'tasks', recordId: 'task', label: 'Planning task', operation: 'updated', savedAt: task.record.updated_at, record: structuredClone(task.record) }
      ledger.push(receipt)
      return { data: receipt, error: null }
    }), async () => ({ data: structuredClone(ledger), error: null }), async () => ({ data: { generation: 2, receipts: [ledger.at(-1)] }, error: null }))
    const workRecords = createWorkRecords({ projectId: 'A', writer, hasAccess: async () => true,
      read: input => journal.run('read-work', input, async () => ({ data: [structuredClone(task)], error: null })),
      readSnapshot: input => journal.run('snapshot', input, async () => ({ data: structuredClone(task), error: null })) })
    return runClaimedProjectTurn({ ...base(), message, writer, workRecords, resume: true, generation: 1, fail: async () => {}, observe: value => observations.push(value),
      callModel: options => journal.run('model', options, async () => {
        calls++
        if (calls === 1) return reply(null, 'final_answer', [tool('read_work_context', { resource: 'tasks', query: null, next_ref: null })])
        if (calls === 2) {
          const read = JSON.parse(String(options.messages![0].content))
          return reply(null, 'final_answer', [tool('edit_work_record', { ref: read.entries[0].ref, changes: [{ op: 'set', path: '/instructions', value: 'Existing requirement. Integrated update.' }], reason: 'Requested instruction update' })])
        }
        if (calls === 3) {
          const saved = JSON.parse(String(options.messages![0].content))
          assert.equal(saved.status, 'saved'); assert.equal(saved.current.content.status, 'todo'); freshRef = saved.current.ref
          return reply('The instructions are saved.')
        }
        if (calls === 4) {
          const review = String(options.messages![0].content)
          assert.match(review, /Integrate the instructions/); assert.match(review, /"status":"todo"/); assert(review.includes(freshRef)); assert.match(review, /"operation":"updated"/)
          return reply(null, 'final_answer', [tool('change_work_state', { ref: freshRef, action: 'status', value: 'doing', reason: 'The planning work is in progress' })])
        }
        if (!yielded) { yielded = true; throw new BobContinuation('yield') }
        const saved = JSON.parse(String(options.messages![0].content))
        assert.equal(saved.current.content.status, 'doing')
        return reply('The instructions are integrated and the planning task is now in progress.')
      }) })
  }
  await assert.rejects(segment, BobContinuation)
  assert.equal(writes, 2); assert.equal(task.record.status, 'doing')
  const result = await segment()
  assert(result.ok); assert.match(result.answer, /now in progress/); assert.equal(writes, 2, 'replay does not write twice')
  assert.equal(calls, 6, 'four durable model results, one yielded dispatch, one final dispatch')
  assert.equal(observations.at(-1).completion_checks, 1)
})

test('attempted edits get one review, but uncertain writes and refusals never provoke another write', async () => {
  for (const outcome of ['invalid', 'unknown', 'refusal'] as const) {
    let calls = 0, writes = 0
    const message = 'Update the planning task.'
    const writer = createProjectWriter('A', message, async () => {
      writes++
      return { data: null, error: outcome === 'unknown' ? { code: '08006', message: 'connection lost' } : { code: '22023', message: 'invalid_task_status' } }
    }, async () => ({ data: [], error: null }), async () => ({ data: { generation: 2, receipts: [] }, error: null }))
    const result = await runProjectAnswer({ ...base(), message, writer, callModel: async options => {
      calls++
      if (calls === 1) return reply(null, 'final_answer', [tool('save_project_task', { record_id: 'task', area_id: 'area', step_id: null, name: 'Planning task', instructions: 'Requested update.', expected_updated_at: '2026-10-17T00:00:00Z' })])
      if (calls === 2) return reply('The change could not be confirmed.', outcome === 'refusal' ? 'refusal' : 'final_answer')
      assert.equal(outcome, 'invalid')
      assert.match(String(options.messages![0].content), /"status":"invalid"/)
      return reply('Which task result should this change represent?')
    } })
    assert(result.ok); assert.equal(writes, 1); assert.equal(calls, outcome === 'invalid' ? 3 : 2)
    assert.equal(result.evidence.partial, true)
  }
})

test('validation diagnostics reach the tool observer only under the new pinned contract', async () => {
  for (const enabled of [false, true]) {
    let calls = 0
    const events: any[] = [], message = 'Update the planning task.'
    const writer = createProjectWriter('A', message, async () => { throw Error('Invalid fields cannot reach the database') }, async () => ({ data: [], error: null }))
    const result = await runProjectAnswer({ ...base(), message, writer,
      aiCatalog: enabled ? catalogFixture() : preTaskWorkflowCatalogFixture(),
      onTool: value => events.push(value), callModel: async () => {
        if (++calls === 1) return reply(null, 'final_answer', [tool('save_project_task', { record_id: 'task', area_id: 'area', step_id: null, name: 'Planning task', instructions: 'Requested update.', expected_updated_at: null })])
        return reply('The task needs a fresh read before this update can be saved.')
      } })
    assert(result.ok); assert.equal(events.length, 1); assert.equal(events[0].status, 'invalid')
    if (enabled) assert.equal(events[0].validation_code, 'field_value')
    else assert.equal(Object.hasOwn(events[0], 'validation_code'), false)
  }
})
