/** Offline comparison; all model replies and storage/render transports scripted.
 * node --import tsx scripts/compare-bob-tool-guides.ts > report.json
 * No production caller selects manual mode. Schemas remain exact and complete. */
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import assert from 'node:assert/strict'
import { runRuntimeAudit, type GuideDelivery } from './audit-bob-runtime.ts'

export async function compareBobToolGuides() {
  const reports = []
  // Sequential: the audit temporarily fences network/logging process-wide.
  for (const mode of ['inline', 'single', 'batch'] as GuideDelivery[]) reports.push(await runRuntimeAudit(undefined, mode))
  const baseline = reports[0]
  const summaries = reports.map(report => {
    assert.equal(report.construction.canonical_sha256, baseline.construction.canonical_sha256)
    assert.deepEqual(report.task_save, baseline.task_save)
    assert.deepEqual(report.cad, baseline.cad)
    return { mode: report.guide_delivery,
      scenarios: ['construction-repair', 'task-save-with-history'].map(scenario => {
        const calls = report.calls.filter(c => c.scenario === scenario)
        const baseCalls = baseline.calls.filter(c => c.scenario === scenario)
        const localBytes = calls.reduce((n, c) => n + c.local_input_json_bytes, 0)
        const baseBytes = baseCalls.reduce((n, c) => n + c.local_input_json_bytes, 0)
        const content = Object.fromEntries(Object.keys(calls[0].content_utf8_bytes).map(k => [k,
          calls.reduce((n, c) => n + c.content_utf8_bytes[k], 0)]))
        return { scenario, model_calls: calls.length,
          manual_calls: calls.filter(c => c.output.returned_tools.includes('read_tool_manuals')).length,
          first_call_json_bytes: calls[0].local_input_json_bytes, local_input_json_bytes_sum: localBytes,
          difference_from_inline_bytes: localBytes - baseBytes, content_utf8_bytes_sum: content,
          retained_provider_context_bytes: null, provider_tokens: null, provider_cost_usd: null, provider_latency_ms: null }
      }) }
  })
  return { report_version: 1, evidence_class: 'offline scripted mechanics, not model quality or billing',
    limits: ['Manual choices are scripted.', 'Exact parameter schemas are retained on every call.',
      'Sum measures submitted local options only; retained provider context, caching, tokens, cost and latency are unknown.',
      'CAD specialists retain inline guides; this experiment changes only Bob.',
      'Production callers omit toolGuideMode; no deployment or authenticated model acceptance.'],
    equivalent_canonical_construction_sha256: baseline.construction.canonical_sha256, summaries, reports }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  console.log(JSON.stringify(await compareBobToolGuides(), null, 2))
