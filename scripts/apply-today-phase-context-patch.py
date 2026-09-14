from pathlib import Path


def replace(path, old, new, count=1):
    p = Path(path)
    text = p.read_text()
    actual = text.count(old)
    if actual != count:
        raise SystemExit(f'{path}: expected {count} matches, found {actual}: {old[:120]!r}')
    p.write_text(text.replace(old, new, count))


# TodayTask carries exact Area identity + lifecycle context in live mode.
path = 'src/data/types.ts'
replace(path,
'''export interface TodayTask {
  id: string
  areaName: string
  name: string
  skill: SkillLevel
  status: TaskStatus
  assigneeIds: string[]
}''',
'''export interface TodayTask {
  id: string
  areaId: string | null
  areaName: string
  areaPhase: AreaPhase | null
  name: string
  skill: SkillLevel
  status: TaskStatus
  assigneeIds: string[]
}''')

# Keep demo data typed without inventing lifecycle classification.
path = 'src/data/mockData.ts'
replace(path,
"  { id: 'td1', areaName: 'Taket', name: 'Set the ridge beam', skill: 'expert', status: 'todo', assigneeIds: ['he'] },",
"  { id: 'td1', areaId: 'a_taket', areaName: 'Taket', areaPhase: null, name: 'Set the ridge beam', skill: 'expert', status: 'todo', assigneeIds: ['he'] },")
replace(path,
"  { id: 'td2', areaName: 'Taket', name: 'Fit the roof battens', skill: 'intermediate', status: 'doing', assigneeIds: ['he', 'si'] },",
"  { id: 'td2', areaId: 'a_taket', areaName: 'Taket', areaPhase: null, name: 'Fit the roof battens', skill: 'intermediate', status: 'doing', assigneeIds: ['he', 'si'] },")
replace(path,
"  { id: 'td3', areaName: 'Köket', name: 'Fit the base cabinets', skill: 'intermediate', status: 'doing', assigneeIds: ['la'] },",
"  { id: 'td3', areaId: 'a_koket', areaName: 'Köket', areaPhase: null, name: 'Fit the base cabinets', skill: 'intermediate', status: 'doing', assigneeIds: ['la'] },")
replace(path,
"  { id: 'td4', areaName: 'Köket', name: 'Paint walls — 2 coats', skill: 'novice', status: 'doing', assigneeIds: ['ma'] },",
"  { id: 'td4', areaId: 'a_koket', areaName: 'Köket', areaPhase: null, name: 'Paint walls — 2 coats', skill: 'novice', status: 'doing', assigneeIds: ['ma'] },")
replace(path,
"  { id: 'td5', areaName: 'Verandan', name: 'Oil the decking', skill: 'novice', status: 'todo', assigneeIds: ['os'] },",
"  { id: 'td5', areaId: 'a_verandan', areaName: 'Verandan', areaPhase: null, name: 'Oil the decking', skill: 'novice', status: 'todo', assigneeIds: ['os'] },")

# Consume the additive view columns through the existing database seam.
path = 'src/data/databaseCore.ts'
replace(path,
'''type TodayTaskRow = {
  id: string; area_name: string; name: string; skill: string; status: string
  assignee_ids: string[]
}''',
'''type TodayTaskRow = {
  id: string; area_name: string; name: string; skill: string; status: string
  assignee_ids: string[]; area_id: string; area_phase: string | null
}''')
replace(path,
"      .select('id, area_name, name, skill, status, assignee_ids')",
"      .select('id, area_name, name, skill, status, assignee_ids, area_id, area_phase')")
replace(path,
'''  return rows.map((row) => ({
    id: row.id,
    areaName: row.area_name,
    name: row.name,
    skill: row.skill as SkillLevel,
    status: row.status as TaskStatus,
    assigneeIds: row.assignee_ids,
  }))''',
'''  return rows.map((row) => ({
    id: row.id,
    areaId: row.area_id,
    areaName: row.area_name,
    areaPhase: row.area_phase as Area['phase'],
    name: row.name,
    skill: row.skill as SkillLevel,
    status: row.status as TaskStatus,
    assigneeIds: row.assignee_ids,
  }))''')

# Task detail gets only lightweight workstream orientation.
path = 'src/pages/TaskDetail.tsx'
replace(path,
"import { ProjectImages } from '../components/ProjectImages'",
"import { ProjectImages } from '../components/ProjectImages'\nimport { PhasePill } from '../components/PhaseUI'")
replace(path,
"      <div className=\"foundation-actions\"><SkillPill level={task.skill} /><span>{task.hours}</span></div></div>",
"      <div className=\"foundation-actions\"><SkillPill level={task.skill} /><span>{task.hours}</span>{area && <PhasePill phase={area.phase} prefix=\"Area\" />}</div></div>")

# Today stays field-first: Build work first; explicit non-Build phases get a concise review cue.
path = 'src/pages/Today.tsx'
replace(path,
"import { AvatarStack, Icon, Loading, SkillPill, StatusPill, statusCheck, useAsync } from '../components/ui'",
"import { AvatarStack, Icon, Loading, SkillPill, StatusPill, statusCheck, useAsync } from '../components/ui'\nimport { PhasePill } from '../components/PhaseUI'\nimport { phaseLabel } from '../lib/projectPhase'")
replace(path,
"  const resolve = (ids: string[]) => ids.map((id) => byId.get(id)).filter((p): p is NonNullable<typeof p> => Boolean(p))",
"  const resolve = (ids: string[]) => ids.map((id) => byId.get(id)).filter((p): p is NonNullable<typeof p> => Boolean(p))\n  const orderedTasks = tasks ? [...tasks].sort((a, b) => Number(b.areaPhase === 'build') - Number(a.areaPhase === 'build')) : null")
replace(path,
"      {!tasks ? (",
"      {!orderedTasks ? (")
replace(path,
"          {tasks.map((t) => {\n            const chk = statusCheck(t.status)",
"          {orderedTasks.map((t) => {\n            const chk = statusCheck(t.status)\n            const phaseNeedsReview = Boolean(t.areaPhase && t.areaPhase !== 'build')")
replace(path,
'''                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8, flexWrap: 'wrap' }}>
                      <SkillPill level={t.skill} />
                      <StatusPill status={t.status} />
                      <AvatarStack people={resolve(t.assigneeIds)} max={4} size={24} />
                    </div>
                  </div>''',
'''                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8, flexWrap: 'wrap' }}>
                      <SkillPill level={t.skill} />
                      <StatusPill status={t.status} />
                      {t.areaPhase && <PhasePill phase={t.areaPhase} prefix="Area" />}
                      <AvatarStack people={resolve(t.assigneeIds)} max={4} size={24} />
                    </div>
                    {phaseNeedsReview && <p className="foundation-hint" style={{ margin: '9px 0 0' }}>Check readiness before starting — this Area is in {phaseLabel(t.areaPhase)}, not Build.</p>}
                  </div>''')

# Hosted proof: the Today projection must expose the final Area phase under ordinary RLS.
path = 'scripts/check-live-project-phases.mjs'
replace(path,
"  assert.equal(projectPointerAfter.solution_id, projectSolution.id)\n\n  console.log('Live Project/Area phases:",
"  assert.equal(projectPointerAfter.solution_id, projectSolution.id)\n\n  const today = checked(await client.from('today_tasks').select('area_id,area_phase').eq('project_id', projectId).eq('area_id', areaId))\n  assert(today.length > 0, 'The disposable Area should retain at least one open Today task')\n  assert(today.every(row => row.area_id === areaId && row.area_phase === 'complete'),\n    'Today task projection must expose the exact current Area lifecycle phase')\n\n  console.log('Live Project/Area phases:")

# Browser proof covers both Today prioritisation/review cue and TaskDetail's lightweight phase context.
path = 'scripts/check-project-phases-browser.mjs'
replace(path,
'''      if (url.pathname === '/rest/v1/tasks') return respond({ json: [
        { id: 't1', area_id: 'bedroom', name: 'Finish trim', skill: 'novice', hours: '1h', status: 'done', materials: '0 / 0', task_assignees: [{ person_id: 'member' }], areas: { project_id: 'P' } },
        { id: 't2', area_id: 'office', name: 'Frame wall', skill: 'intermediate', hours: '4h', status: 'doing', materials: '1 / 2', task_assignees: [{ person_id: 'member' }], areas: { project_id: 'P' } },
        { id: 't3', area_id: 'office', name: 'Protect floor', skill: 'novice', hours: '1h', status: 'done', materials: '0 / 0', task_assignees: [{ person_id: 'member' }], areas: { project_id: 'P' } },
      ] })''',
'''      if (url.pathname === '/rest/v1/tasks') {
        const rows = [
          { id: 't1', area_id: 'bedroom', name: 'Finish trim', skill: 'novice', hours: '1h', status: 'done', materials: '0 / 0', instructions: '', updated_at: '2026-09-14T18:00:00Z', task_assignees: [{ person_id: 'member' }], areas: { project_id: 'P' } },
          { id: 't2', area_id: 'office', name: 'Frame wall', skill: 'intermediate', hours: '4h', status: 'doing', materials: '1 / 2', instructions: 'Frame the selected wall layout.', updated_at: '2026-09-14T18:00:00Z', task_assignees: [{ person_id: 'member' }], areas: { project_id: 'P' } },
          { id: 't3', area_id: 'office', name: 'Protect floor', skill: 'novice', hours: '1h', status: 'done', materials: '0 / 0', instructions: '', updated_at: '2026-09-14T18:00:00Z', task_assignees: [{ person_id: 'member' }], areas: { project_id: 'P' } },
          { id: 't4', area_id: 'guestroom', name: 'Mark proposed opening', skill: 'novice', hours: '1h', status: 'todo', materials: '0 / 0', instructions: 'Do not cut until the design is approved.', updated_at: '2026-09-14T18:00:00Z', task_assignees: [{ person_id: 'member' }], areas: { project_id: 'P' } },
        ]
        const id = url.searchParams.get('id')?.replace(/^eq\./, '')
        const selected = id ? rows.filter(row => row.id === id) : rows
        const single = (request.headers()['accept'] ?? '').includes('application/vnd.pgrst.object+json')
        return respond({ json: single ? selected[0] ?? null : selected })
      }
      if (url.pathname === '/rest/v1/task_steps') return respond({ json: [] })
      if (url.pathname === '/rest/v1/today_tasks') return respond({ json: [
        { id: 't4', area_id: 'guestroom', area_name: 'Guestroom', area_phase: areaPhase.get('guestroom'), name: 'Mark proposed opening', skill: 'novice', status: 'todo', assignee_ids: ['member'], project_id: 'P' },
        { id: 't2', area_id: 'office', area_name: 'Office', area_phase: areaPhase.get('office'), name: 'Frame wall', skill: 'intermediate', status: 'doing', assignee_ids: ['member'], project_id: 'P' },
      ] })''')
replace(path,
"    if (viewport.width < 860) await page.getByRole('link', { name: 'Today', exact: true }).waitFor()\n\n    await page.getByRole('button', { name: 'Review phase', exact: true }).first().click()",
'''    if (viewport.width < 860) await page.getByRole('link', { name: 'Today', exact: true }).waitFor()

    await page.goto(`${base}#/today`)
    await page.getByRole('heading', { name: 'What needs doing today', exact: true }).waitFor()
    assert.deepEqual(await page.locator('.task-title-link').allTextContents(), ['Frame wall', 'Mark proposed opening'],
      'Build-phase Today work should be foregrounded without hiding other scheduled work')
    await page.getByText('Check readiness before starting — this Area is in Design, not Build.', { exact: true }).waitFor()
    await page.getByRole('link', { name: 'Frame wall', exact: true }).click()
    await page.getByRole('heading', { name: 'Frame wall', exact: true }).waitFor()
    await page.getByLabel('Area phase: Build').waitFor()
    await page.goto(`${base}#/`)
    await page.getByRole('heading', { name: 'Renovate upstairs', exact: true }).waitFor()

    await page.getByRole('button', { name: 'Review phase', exact: true }).first().click()''')
replace(path,
"    console.log(`Project phases ${viewport.width}px: account summary, mixed workstreams, explicit transitions, reload and mobile Today: OK`)",
"    console.log(`Project phases ${viewport.width}px: account summary, mixed workstreams, Today/Task field context, explicit transitions and reload: OK`)")
