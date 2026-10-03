import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runRuntimeAudit } from '../scripts/audit-bob-runtime.ts'
import { measureRuntimeInput, measureRuntimeOutput } from '../scripts/support/runtime-audit-metrics.ts'

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
