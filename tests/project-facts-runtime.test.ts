// Pure project facts at turn start (owner decision 2026-10-26): one pinned,
// journaled read before the first step, placed in the briefing as data.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { projectFactsPacket, PROJECT_FACTS_MAX_CHARS } from '../supabase/functions/_shared/project-facts.ts'

test('only an ok version 1 packet for this project is used; anything else is unavailable', () => {
  const ok = { status: 'ok', version: 1, project_id: 'A', rooms: { status: 'not_linked', total: 0, included: 0, omitted: 0, items: [] } }
  assert.deepEqual(projectFactsPacket(ok, false, 'A'), ok)
  for (const [data, failed, project] of [[ok, true, 'A'], [ok, false, 'B'], [{ ...ok, version: 2 }, false, 'A'], [null, false, 'A'], [[ok], false, 'A'], [{ ...ok, status: 'denied' }, false, 'A']] as const)
    assert.deepEqual(projectFactsPacket(data, failed, project), { status: 'unavailable' })
  const huge = { ...ok, rooms: { ...ok.rooms, items: [{ name: 'x'.repeat(PROJECT_FACTS_MAX_CHARS) }] } }
  assert.deepEqual(projectFactsPacket(huge, false, 'A'), { status: 'unavailable', reason: 'too_large' })
})

test('facts are pinned per job, read once before the first step, never on a checkpoint resume, and join the briefing', async () => {
  const code = await readFile(new URL('../supabase/functions/_shared/ask-openai.ts', import.meta.url), 'utf8')
  const identity = code.slice(code.indexOf("memo('execution:identity'"), code.indexOf('modelBudget = createBobModelBudget'))
  assert.match(identity, /projectFactsVersion: 1 as const,/)
  assert.match(code, /execution\.projectFactsVersion !== 1\) throw new Error\('project_facts_version_invalid'\)/)
  assert.match(code, /execution\.projectFactsVersion === 1 && !restart\n    \? await readRpc\('read_project_facts', \{ p_project: opts\.projectId \}\)/)
  assert.match(code, /execution\.projectFactsVersion === 1 \? \{ constructionTable: true \} : \{\}/)
  assert.match(code, /execution\.projectFactsVersion === 1 \? \{ pureFacts: true, \.\.\.\(projectFacts \? \{ projectFacts \} : \{\}\) \} : \{\}/)
  const answer = await readFile(new URL('../supabase/functions/_shared/project-answer.ts', import.meta.url), 'utf8')
  assert.match(answer, /text\('briefing-label'\), JSON\.stringify\(orientation\),\n      \.\.\.\(opts\.projectFacts \? \[JSON\.stringify\(\{ project_facts: opts\.projectFacts \}\)\] : \[\]\),/)
  assert.match(answer, /opts\.pureFacts \? \{ presentation: 'cut' as const \} : \{\}/)
})
