from pathlib import Path


def replace(path, old, new, count=1):
    p = Path(path)
    s = p.read_text()
    actual = s.count(old)
    if actual != count:
        raise SystemExit(f'{path}: expected {count} matches, found {actual}: {old[:140]!r}')
    p.write_text(s.replace(old, new, count))


# Database seam: keep every screen behind the existing database facade.
path = 'src/data/databaseCore.ts'
replace(path,
    "import { createMaterialPlanning } from './materialPlanning'\n",
    "import { createMaterialPlanning } from './materialPlanning'\nimport { createWorkPlan } from './workPlan'\n")
replace(path,
    "const materialPlanning = createMaterialPlanning(db, captureFileContext)\n",
    "const materialPlanning = createMaterialPlanning(db, captureFileContext)\nconst workPlan = createWorkPlan(db, captureFileContext)\n")
replace(path,
    "export const getMaterialShoppingSources = materialPlanning.shopping\n",
    "export const getMaterialShoppingSources = materialPlanning.shopping\nexport const getTaskReadiness = workPlan.readiness\nexport const getTaskWorkPlan = workPlan.detail\nexport const editTaskWorkPlan = workPlan.command\n")

# Task detail gets the canonical work-readiness surface next to status/instructions.
path = 'src/pages/TaskDetail.tsx'
replace(path,
    "import { TaskModal } from '../components/editors'\n",
    "import { TaskModal } from '../components/editors'\nimport { TaskReadinessPanel } from '../components/TaskReadinessPanel'\n")
replace(path,
    "    </select></Field></div>\n    <section className=\"card foundation-section\" aria-label=\"Task instructions\">",
    "    </select></Field></div>\n    <TaskReadinessPanel projectId={projectId} taskId={task.id} areaId={task.areaId} refreshKey={version} />\n    <section className=\"card foundation-section\" aria-label=\"Task instructions\">")

# Area workstream: the primary Build action now follows actual readiness, not task existence.
path = 'src/pages/AreaWorkstream.tsx'
replace(path,
    "  const { data: allMaterials } = useAsync(() => db.getMaterials(), [version])\n",
    "  const { data: allMaterials } = useAsync(() => db.getMaterials(), [version])\n  const { data: taskReadiness } = useAsync(() => db.getTaskReadiness(projectId), [projectId, version])\n")
replace(path,
    "  const next = areaNextAction(area)\n  const firstReadyTask = tasks.find(task => task.status === 'doing') ?? tasks.find(task => task.status === 'todo')\n  const primary = area.phase === 'build' && firstReadyTask\n    ? { ...next, title: `Continue: ${firstReadyTask.name}`, to: `/tasks/${firstReadyTask.id}` }\n    : next\n",
    "  const next = areaNextAction(area)\n  const readinessByTask = new Map((taskReadiness ?? []).map(item => [item.taskId, item]))\n  const readyTasks = tasks.filter(task => readinessByTask.get(task.id)?.state === 'ready')\n  const firstReadyTask = readyTasks.find(task => task.status === 'doing') ?? readyTasks.find(task => task.status === 'todo')\n  const firstBlockedTask = tasks.find(task => task.status !== 'done' && ['blocked', 'unreviewed'].includes(readinessByTask.get(task.id)?.state ?? ''))\n  const blockedState = firstBlockedTask ? readinessByTask.get(firstBlockedTask.id) : undefined\n  const primary = area.phase === 'build' && firstReadyTask\n    ? { ...next, title: `Continue: ${firstReadyTask.name}`, text: 'This task has a confirmed blocker-free work plan.', to: `/tasks/${firstReadyTask.id}` }\n    : area.phase === 'build' && firstBlockedTask\n      ? { ...next, title: `${blockedState?.state === 'unreviewed' ? 'Review' : 'Unblock'}: ${firstBlockedTask.name}`, text: blockedState?.blockers[0]?.label ?? 'Readiness has not been reviewed yet.', to: `/tasks/${firstBlockedTask.id}` }\n      : next\n")
replace(path,
    "              const materialReady = got === total\n              return <div key={task.id}",
    "              const materialReady = got === total\n              const taskPlan = readinessByTask.get(task.id)\n              return <div key={task.id}")
replace(path,
    "                    {total !== '0' && total !== '' && <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: materialReady ? 'var(--leaf)' : 'var(--clay)' }}><Icon name=\"package\" size={13} />{task.materials} materials</span>}\n                  </div>\n                </div>\n",
    "                    {total !== '0' && total !== '' && <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: materialReady ? 'var(--leaf)' : 'var(--clay)' }}><Icon name=\"package\" size={13} />{task.materials} materials</span>}\n                    {taskPlan && task.status !== 'done' && <span className=\"image-purpose\">{taskPlan.state === 'ready' ? 'Ready' : taskPlan.state === 'unreviewed' ? 'Review readiness' : `${taskPlan.blockerCount} blocker${taskPlan.blockerCount === 1 ? '' : 's'}`}</span>}\n                  </div>\n                  {taskPlan?.state === 'blocked' && <p className=\"foundation-hint\" style={{ margin: '7px 0 0' }}>{taskPlan.blockers[0]?.label}</p>}\n                  {taskPlan?.state === 'unreviewed' && <p className=\"foundation-hint\" style={{ margin: '7px 0 0' }}>Readiness has not been confirmed yet.</p>}\n                </div>\n")

# Today: ready work first; blocked tasks remain visible with the exact reason.
path = 'src/pages/Today.tsx'
replace(path,
    "export function Today() {\n  const { data: tasks } = useAsync(() => db.getTodayTasks(), [])\n",
    "export function Today() {\n  const projectId = db.getActiveProjectId() ?? ''\n  const { data: tasks } = useAsync(() => db.getTodayTasks(), [])\n  const { data: readiness } = useAsync(() => projectId ? db.getTaskReadiness(projectId) : Promise.resolve([]), [projectId])\n")
replace(path,
    "  const orderedTasks = tasks ? [...tasks].sort((a, b) => Number(b.areaPhase === 'build') - Number(a.areaPhase === 'build')) : null\n",
    "  const readinessById = new Map((readiness ?? []).map(item => [item.taskId, item]))\n  const rank = (id: string) => ({ ready: 0, unreviewed: 1, blocked: 2, complete: 3 }[readinessById.get(id)?.state ?? 'blocked'])\n  const orderedTasks = tasks ? [...tasks].sort((a, b) => rank(a.id) - rank(b.id) || Number(b.areaPhase === 'build') - Number(a.areaPhase === 'build')) : null\n")
replace(path,
    "            const chk = statusCheck(t.status)\n            const phaseNeedsReview = Boolean(t.areaPhase && t.areaPhase !== 'build')\n",
    "            const chk = statusCheck(t.status)\n            const taskPlan = readinessById.get(t.id)\n            const phaseNeedsReview = !taskPlan && Boolean(t.areaPhase && t.areaPhase !== 'build')\n")
replace(path,
    "                      {t.areaPhase && <PhasePill phase={t.areaPhase} prefix=\"Area\" />}\n                      <AvatarStack people={resolve(t.assigneeIds)} max={4} size={24} />\n                    </div>\n                    {phaseNeedsReview && <p className=\"foundation-hint\" style={{ margin: '9px 0 0' }}>Check readiness before starting — this Area is in {phaseLabel(t.areaPhase)}, not Build.</p>}\n",
    "                      {t.areaPhase && <PhasePill phase={t.areaPhase} prefix=\"Area\" />}\n                      {taskPlan && <span className=\"image-purpose\">{taskPlan.state === 'ready' ? 'Ready' : taskPlan.state === 'unreviewed' ? 'Review readiness' : `${taskPlan.blockerCount} blocker${taskPlan.blockerCount === 1 ? '' : 's'}`}</span>}\n                      <AvatarStack people={resolve(t.assigneeIds)} max={4} size={24} />\n                    </div>\n                    {taskPlan?.state === 'blocked' && <p className=\"foundation-hint\" style={{ margin: '9px 0 0' }}>{taskPlan.blockers[0]?.label}</p>}\n                    {taskPlan?.state === 'unreviewed' && <p className=\"foundation-hint\" style={{ margin: '9px 0 0' }}>Readiness has not been confirmed yet.</p>}\n                    {phaseNeedsReview && <p className=\"foundation-hint\" style={{ margin: '9px 0 0' }}>Check readiness before starting — this Area is in {phaseLabel(t.areaPhase)}, not Build.</p>}\n")

# PL/pgSQL row variable: be explicit for view row type.
path = 'supabase/migrations/20260915073000_executable_work_readiness.sql'
replace(path,
    "  current_readiness bob.current_task_readiness;\n",
    "  current_readiness bob.current_task_readiness%rowtype;\n")

# Browser fixture: exercise blocked -> resolved -> explicitly confirmed Ready on the field flow.
path = 'scripts/check-project-phases-browser.mjs'
replace(path,
    "    let projectPhase = 'build'\n    const areaPhase = new Map([['bedroom', 'complete'], ['office', 'build'], ['guestroom', 'design']])\n",
    "    let projectPhase = 'build'\n    let toolReady = false\n    let toolRevision = 1\n    const readinessReviewed = new Set()\n    const areaPhase = new Map([['bedroom', 'complete'], ['office', 'build'], ['guestroom', 'design']])\n")
replace(path,
    "      if (url.pathname === '/rest/v1/rpc/phase_command') {\n",
    "      if (url.pathname === '/rest/v1/rpc/work_plan_command') {\n        const body = request.postDataJSON()\n        assert.equal(body.p_project, 'P')\n        assert.equal(body.p_task, 't2')\n        if (body.p_action === 'set_need_ready') {\n          assert.equal(body.p_item, '96000000-0000-0000-0000-000000000100')\n          assert.equal(body.p_expected, toolRevision)\n          toolReady = Boolean(body.p_data.ready); toolRevision += 1; readinessReviewed.delete('t2')\n          return respond({ json: { id: body.p_item, revision: toolRevision, ready: toolReady } })\n        }\n        if (body.p_action === 'confirm_readiness') {\n          assert(toolReady, 'Tool blocker must be resolved before readiness confirmation')\n          readinessReviewed.add('t2')\n          return respond({ json: { id: 't2', readiness: 'ready' } })\n        }\n        throw new Error('Unexpected work-plan command: ' + body.p_action)\n      }\n      if (url.pathname === '/rest/v1/rpc/phase_command') {\n")
replace(path,
    "      if (url.pathname === '/rest/v1/task_steps') return respond({ json: [] })\n      if (url.pathname === '/rest/v1/today_tasks') return respond({ json: [\n",
    "      if (url.pathname === '/rest/v1/task_steps') return respond({ json: [] })\n      if (url.pathname === '/rest/v1/current_task_readiness') {\n        const rows = [\n          { task_id: 't1', project_id: 'P', area_id: 'bedroom', area_phase: areaPhase.get('bedroom'), task_status: 'done', readiness_state: 'complete', blocker_count: 0, blockers: [], reviewed_at: null, reviewed_by: '', review_note: '' },\n          { task_id: 't2', project_id: 'P', area_id: 'office', area_phase: areaPhase.get('office'), task_status: 'doing', readiness_state: !toolReady ? 'blocked' : readinessReviewed.has('t2') ? 'ready' : 'unreviewed', blocker_count: toolReady ? 0 : 1, blockers: toolReady ? [] : [{ kind: 'tool', id: '96000000-0000-0000-0000-000000000100', label: 'Tool needed: Circular saw' }], reviewed_at: readinessReviewed.has('t2') ? '2026-09-15T05:00:00Z' : null, reviewed_by: readinessReviewed.has('t2') ? 'Fixture member' : '', review_note: '' },\n          { task_id: 't3', project_id: 'P', area_id: 'office', area_phase: areaPhase.get('office'), task_status: 'done', readiness_state: 'complete', blocker_count: 0, blockers: [], reviewed_at: null, reviewed_by: '', review_note: '' },\n          { task_id: 't4', project_id: 'P', area_id: 'guestroom', area_phase: areaPhase.get('guestroom'), task_status: 'todo', readiness_state: 'blocked', blocker_count: 1, blockers: [{ kind: 'phase', id: 'guestroom', label: 'Area is in Design; move to Build when work is actually ready' }], reviewed_at: null, reviewed_by: '', review_note: '' },\n        ]\n        const taskId = url.searchParams.get('task_id')?.replace(/^eq\\./, '')\n        const selected = taskId ? rows.filter(row => row.task_id === taskId) : rows\n        const single = (request.headers()['accept'] ?? '').includes('application/vnd.pgrst.object+json')\n        return respond({ json: single ? selected[0] ?? null : selected })\n      }\n      if (url.pathname === '/rest/v1/task_dependency_status') return respond({ json: [] })\n      if (url.pathname === '/rest/v1/task_material_readiness') return respond({ json: [] })\n      if (url.pathname === '/rest/v1/task_needs') {\n        const taskId = url.searchParams.get('task_id')?.replace(/^eq\\./, '')\n        return respond({ json: taskId === 't2' ? [{ id: '96000000-0000-0000-0000-000000000100', project_id: 'P', task_id: 't2', kind: 'tool', label: 'Circular saw', notes: 'Charged battery', ready: toolReady, revision: toolRevision, actor_label: 'Fixture member', created_at: '2026-09-15T04:00:00Z', updated_at: '2026-09-15T04:00:00Z' }] : [] })\n      }\n      if (url.pathname === '/rest/v1/today_tasks') return respond({ json: [\n")
replace(path,
    "    await page.getByText('Check readiness before starting — this Area is in Design, not Build.', { exact: true }).waitFor()\n    await page.getByRole('link', { name: 'Frame wall', exact: true }).click()\n    await page.getByRole('heading', { name: 'Frame wall', exact: true }).waitFor()\n    await page.getByLabel('Area phase: Build').waitFor()\n",
    "    await page.getByText('Tool needed: Circular saw', { exact: true }).waitFor()\n    await page.getByText('Area is in Design; move to Build when work is actually ready', { exact: true }).waitFor()\n    await page.getByRole('link', { name: 'Frame wall', exact: true }).click()\n    await page.getByRole('heading', { name: 'Frame wall', exact: true }).waitFor()\n    await page.getByLabel('Area phase: Build').waitFor()\n    await page.getByRole('region', { name: 'Task readiness', exact: true }).getByText('Blocked', { exact: true }).waitFor()\n    await page.getByLabel('Circular saw', { exact: true }).check()\n    await page.getByRole('region', { name: 'Task readiness', exact: true }).getByText('Readiness not reviewed', { exact: true }).waitFor()\n    await page.getByRole('region', { name: 'Task readiness', exact: true }).getByRole('button', { name: 'Confirm ready', exact: true }).click()\n    await page.getByRole('region', { name: 'Task readiness', exact: true }).getByText('Ready to start', { exact: true }).waitFor()\n")

print('Executable work/readiness integration patch applied.')
