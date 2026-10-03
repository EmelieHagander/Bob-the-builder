import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runRuntimeAudit, runRuntimeComparison } from '../scripts/audit-bob-runtime.ts'
import { measureRuntimeInput, measureRuntimeOutput } from '../scripts/support/runtime-audit-metrics.ts'

test('manual strategies count real retrieval steps and preserve outcomes and domain contracts', async () => {
  const r = await runRuntimeComparison()
  assert(r.domain_names_and_schemas_equal)
  const expected = [
    { strategy: 'per_tool', steps: [3, 2], reads: ['read_construction_draft', 'save_construction_draft', 'check_construction_draft', 'search_project_data', 'save_project_task'] },
    { strategy: 'batch_all', steps: [1, 1], reads: ['read_construction_draft', 'save_construction_draft', 'check_construction_draft', 'search_project_data', 'save_project_task'] },
    { strategy: 'selective', steps: [1, 0], reads: ['save_construction_draft', 'check_construction_draft'] },
  ]
  for (const [i, candidate] of r.candidates.entries()) {
    assert.equal(candidate.manual_strategy, expected[i].strategy)
    assert(candidate.surfaces[0].schema_bytes < r.baseline.surfaces[0].schema_bytes)
    assert.deepEqual(candidate.manual_reads, expected[i].reads)
    for (const [j, scenario] of ['construction-repair', 'task-save-with-history'].entries()) {
      const before = r.baseline.scenarios.find(s => s.scenario === scenario)!
      const after = candidate.scenarios.find(s => s.scenario === scenario)!
      assert.equal(after.model_calls - before.model_calls, expected[i].steps[j])
      assert.equal(after.manual_steps, expected[i].steps[j])
      if (after.manual_calls) assert(after.summed_tool_result_bytes > before.summed_tool_result_bytes)
      else assert.equal(after.summed_tool_result_bytes, before.summed_tool_result_bytes)
    }
    const { stop: beforeStop, ...before } = r.baseline.construction
    const { stop: afterStop, ...after } = candidate.construction
    assert.deepEqual(after, before)
    assert.equal(afterStop.steps - beforeStop.steps, expected[i].steps[0])
    assert.equal(afterStop.tool_calls - beforeStop.tool_calls, i === 2 ? 2 : 3)
    assert.equal(afterStop.deferred_calls, 0, 'batched manuals fit the actual runtime budget')
    assert.deepEqual(candidate.task_save, r.baseline.task_save)
    assert.deepEqual(candidate.cad, r.baseline.cad)
    assert.deepEqual(candidate.premature, r.baseline.premature)
  }
  // Batching removes model round-trips while returning the same manual content.
  for (const scenario of ['construction-repair', 'task-save-with-history']) {
    const separate = r.candidates[0].scenarios.find(s => s.scenario === scenario)!
    const batch = r.candidates[1].scenarios.find(s => s.scenario === scenario)!
    assert.equal(batch.manual_calls, separate.manual_calls)
    assert(batch.summed_local_input_json_bytes < separate.summed_local_input_json_bytes)
  }
})

test('audit measures UTF-8 content without exposing text or pretending continuation history is local', () => {
  const privateText = 'PRIVATE å🪚'
  const options: any = { systemMessage: privateText, previousResponseId: 'PRIVATE-ID',
    tools: [{ type: 'function', function: { name: 'fixture_tool', description: privateText, parameters: { type: 'object' } } }],
    messages: [{ role: 'assistant', content: privateText }, { role: 'tool', content: privateText },
      { role: 'user', content: [{ type: 'image_url', image_url: { url: privateText } }] }] }
  const r = measureRuntimeInput(options, [privateText])
  assert.equal(r.content_utf8_bytes.system, Buffer.byteLength(privateText))
  assert.equal(r.content_utf8_bytes.history, Buffer.byteLength(privateText))
  assert.equal(r.content_utf8_bytes.tool_results, Buffer.byteLength(privateText))
  assert.equal(r.content_utf8_bytes.tool_descriptions, Buffer.byteLength(privateText))
  assert.equal(r.measured_content_bytes, Object.values(r.content_utf8_bytes).reduce((sum, n) => sum + n, 0))
  assert.equal(r.image_count, 1); assert.equal(r.retained_provider_context_bytes, null)
  assert.equal(measureRuntimeInput({} as any).retained_provider_context_bytes, 0)
  assert(!JSON.stringify(r).includes('PRIVATE'))
  const out = measureRuntimeOutput({ success: true, data: privateText, toolCalls: [{ function: { name: 'fixture_tool', arguments: privateText } }] } as any)
  assert.equal(out.tool_argument_bytes, Buffer.byteLength(privateText)); assert(!JSON.stringify(out).includes('PRIVATE'))
})

test('current audit reaches real K1/K2 handlers and CAD review with only scripted model/storage/render transports', async () => {
  const r = await runRuntimeAudit()
  assert.equal(r.report_version, 1)
  assert.equal(r.construction.status, 'scripted_loop_passed')
  assert.equal(r.construction.first_check.concept_ready, false)
  assert(r.construction.first_check.issues.includes('contact_without_joint'))
  assert.equal(r.construction.corrected_check.concept_ready, true)
  assert.equal(r.construction.corrected_check.fabrication_ready, false)
  assert.equal(r.construction.readback_revision, 2)
  assert.equal(r.construction.historical_joint_count, 5)
  assert.equal(r.task_save.writes, 1)
  assert.equal(r.cad.status, 'ready'); assert.equal(r.cad.renders, 1)
  assert(r.cad.generated_pixels_delivered); assert(!r.cad.svg_bytes_delivered)
  for (const role of ['ask-bob', 'cad-research', 'cad-designer', 'cad-reviewer']) assert(r.calls.some((c: any) => c.role === role))
  assert(r.calls.filter((c: any) => c.role === 'cad-research').every((c: any) => c.execution_metric_role === 'cad-research'))
  assert(r.execution_roles.includes('cad-research'))
  for (const surface of r.surfaces) for (const name of ['read_construction_draft', 'save_construction_draft', 'check_construction_draft', 'read_drawing_requests']) assert(surface.names.includes(name))
  assert(r.calls.some((c: any) => c.scenario === 'construction-repair' && c.previous_response && c.content_utf8_bytes.tool_results > 0))
  assert(r.calls.some((c: any) => c.scenario === 'task-save-with-history' && c.content_utf8_bytes.history > 100))
  for (const call of r.calls) {
    assert.equal(call.provider_usage, null); assert.equal(call.provider_cost_usd, null)
    if (call.previous_response) assert.equal(call.retained_provider_context_bytes, null)
    assert(Object.values(call.content_utf8_bytes).every((n: any) => n >= 0))
  }
  // A hypothetical text-only model reply is not delivery evidence. Preserve
  // this observation separately from the scripted positive loop.
  assert(r.premature.every((p: any) => p.writes === 0))
})

test('an explicitly old catalog remains old and cannot pass K2 by silently using the seed', async () => {
  const r = await runRuntimeAudit('scripts/fixtures/bob-tool-catalog-2026-09-25.json')
  assert.equal(r.construction.status, 'not_run')
  assert(r.construction.missing_tools.includes('check_construction_draft'))
  assert(r.catalog_source.startsWith('explicit caller-supplied'))
})
