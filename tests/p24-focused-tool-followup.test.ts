import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createToolSession, type ToolDefinition, type ToolPolicy, type ToolFollowup } from '../supabase/functions/_shared/project-tools/session.ts'

const sql = readFileSync(new URL('../supabase/migrations/20261104114600_p24_focus_tool_followup.sql', import.meta.url), 'utf8')
const match = sql.match(/extra jsonb:=\s*'([\s\S]*?)'::jsonb;/)
assert(match, 'the focus tool followup must be published in the versioned catalog')
const followups = JSON.parse(match[1]) as ToolFollowup[]
const names = (tools: { function: { name: string } }[]) => tools.map(tool => tool.function.name)

function harness(reason: string, enabled: boolean) {
  const policies: ToolPolicy[] = ['ask_structure_worker','read_plan_link_context','change_plan_focus'].map(name => ({
    name, description: name, how_to: 'Use current project data', schema_version: 1,
    always_load: false, preload_phases: [], active: true,
  }))
  const definitions: ToolDefinition[] = policies.map(p => ({
    spec: { type: 'function', function: { name: p.name, description: p.name, parameters: { type: 'object', properties: {} } } },
    version: 1, gate: () => 'available',
    execute: async () => ({ status: 'needs_verification', reason }),
  }))
  const opts = { definitions, readPolicy: async () => ({ phase: 'design', tools: policies }),
    toolInstructions: 'lazy' as const, selectiveTools: true,
    preloadTools: () => ['ask_structure_worker'],
    followups: enabled ? followups : [] }
  return { session: createToolSession(opts), policies, opts }
}

test('P2.4 offers existing focus tools after a true not_focused Konrad preflight', async () => {
  assert.deepEqual(followups, [{
    after_tool: 'ask_structure_worker', statuses: ['needs_verification'],
    when: { field: 'reason', equals: 'construction_piece_step_not_focused' },
    tools: ['read_plan_link_context','change_plan_focus'],
  }])
  const f = harness('construction_piece_step_not_focused',true)
  assert.deepEqual(names(await f.session.prepare()), ['ask_structure_worker','describe_tool'])
  assert.equal((await f.session.execute('change_plan_focus', {})).status, 'not_offered')
  assert.equal((await f.session.execute('ask_structure_worker', {})).status, 'needs_verification')
  assert.equal((await f.session.execute('change_plan_focus', {})).status, 'not_offered',
    'nothing is allowed retroactively inside the earlier model batch')
  const resumed = createToolSession(f.opts)
  resumed.restoreState(f.session.exportState())
  assert.deepEqual(names(await resumed.prepare()),
    ['ask_structure_worker','change_plan_focus','read_plan_link_context','describe_tool'])
  f.policies[2].active = false
  assert.equal((await resumed.execute('change_plan_focus', {})).status, 'not_allowed',
    'a catalog followup never overrides the live authorization fence')
  assert(!names(await resumed.prepare()).includes('change_plan_focus'))
})

test('P2.4 no focus tools on unrelated error or older manifest', async () => {
  for (const reason of ['construction_piece_gate_unavailable','construction_piece_write_conflict']) {
    const f = harness(reason, true)
    await f.session.prepare(); await f.session.execute('ask_structure_worker',{})
    assert.deepEqual(names(await f.session.prepare()), ['ask_structure_worker','describe_tool'])
  }
  const legacy = harness('construction_piece_step_not_focused', false)
  await legacy.session.prepare(); await legacy.session.execute('ask_structure_worker', {})
  assert.deepEqual(names(await legacy.session.prepare()), ['ask_structure_worker','describe_tool'])
})
