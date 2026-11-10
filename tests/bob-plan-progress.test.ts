import { test } from 'node:test'
import assert from 'node:assert/strict'
import { catalogFixture } from './support/ai-catalog-fixture.ts'
import { runProjectAnswer } from '../supabase/functions/_shared/project-answer.ts'
import { createProjectWriter } from '../supabase/functions/_shared/project-write.ts'
import { createProjectLookup } from '../supabase/functions/_shared/project-lookup.ts'

test('a build step reaches the picker and completion gate even when the project is in concept', async () => {
  const projectId = 'bunk-bed', message = 'Fortsätt med monteringen.'
  const step = {
    id: 'assemble', title: 'Montera och kontrollera', phase: 'build', state: 'active',
    tasks: [{ id: 't', name: 'Montera stegen', status: 'todo', primary_step_id: 'assemble' }],
    requirements: [{ id: 'r', title: 'Kontroll på plats', status: { state: 'missing' }, responsible_kind: 'person' }],
  }
  const lookup = createProjectLookup(projectId, async (_, { dataset }) => {
    const records = dataset === 'project' ? [{ id: projectId, name: 'Våningssäng', phase: 'concept' }]
      : dataset === 'plan' ? [{ id: projectId, status: 'approved', revision: 3, focus_step_id: step.id, steps: [step] }] : []
    return { data: { records, related: [], truncated: false }, error: null }
  }, 1000, 100)
  const calls: string[] = []
  const catalog = catalogFixture()
  const usage = { input_tokens: 1, output_tokens: 1, total_tokens: 2 }
  const writer = createProjectWriter(projectId, message, async () => assert.fail('physical check requires evidence'), async () => ({ data: [], error: null }))
  const result = await runProjectAnswer({
    aiCatalog: catalog, projectId, userId: 'owner', hasAccess: async () => true, deadline: Infinity, unlimitedWork: true,
    message, lookup, writer, toolPicker: true,
    callModel: async options => {
      calls.push(options.functionName)
      if (options.functionName === 'ask-bob') {
        return { success: true, model: 'fixture', usage, responseId: 'answer', outputPhase: 'final_answer', data: 'Kontrollen på plats återstår.' }
      }
      const input = JSON.parse(String(options.messages![0].content))
      assert.deepEqual(input.plan_at_turn_start, {
        revision: 3, origin: 'saved_plan', step: { title: step.title, state: 'active', phase: 'build' },
        requirements: [{ title: 'Kontroll på plats', state: 'missing', responsible: 'person' }], all_requirements_listed: true,
      })
      const data = options.functionName === 'tool-picker' ? { tools: [], reason: '' } : { work_remaining: false, reason: '' }
      return { success: true, model: 'fixture', usage, data: JSON.stringify(data) }
    },
  })
  assert(result.ok)
  assert.deepEqual(calls, ['tool-picker', 'ask-bob', 'completion-gate'])
})

test('the migrated catalog publishes the same plan instructions and pin used by the runtime', async () => {
  const { projectSchema } = await import('./support/project-schema.ts')
  const { createAiCatalogSession } = await import('../supabase/functions/_shared/ai-catalog.ts')
  const pg = await projectSchema(undefined, '20261110131100_plan_progress_v2_catalog.sql')
  try {
    const { rows } = await pg.query<any>("select shared.resolve_ai_catalog('bob') m")
    const actual = createAiCatalogSession({ rpc: async () => assert.fail('pinned') }, { app: 'bob', manifest: rows[0].m })
    const expected = catalogFixture()
    assert.equal(actual.definition('agent-contract.ask-bob').metadata.plan_progress_version, 2)
    for (const role of ['ask-bob', 'completion-gate']) {
      assert.equal(actual.role(role).systemMessage, expected.role(role).systemMessage)
    }
    assert.match(actual.role('ask-bob').systemMessage, /move the saved focus/)
    assert.match(actual.role('completion-gate').systemMessage, /plan_at_turn_start/)
  } finally {
    await pg.close()
  }
})
