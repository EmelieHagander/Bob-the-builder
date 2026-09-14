from pathlib import Path


def replace(path, old, new, count=1):
    p = Path(path)
    text = p.read_text()
    actual = text.count(old)
    if actual != count:
        raise SystemExit(f'{path}: expected {count} matches, found {actual}: {old[:120]!r}')
    p.write_text(text.replace(old, new, count))


# Data seam: one bounded account-level read for Area phase summaries across accessible Projects.
path = 'src/data/database.ts'
replace(path,
"export async function getProjects(): Promise<Project[]> {",
"export interface AccountAreaPhase { projectId: string; phase: ProjectPhase | null }\n\nexport async function getAccountAreaPhases(projectIds: string[]): Promise<AccountAreaPhase[]> {\n  const ids = [...new Set(projectIds.filter(Boolean))]\n  if (!ids.length) return []\n  if (!phaseDb) {\n    const activeProjectId = core.getActiveProjectId()\n    return activeProjectId && ids.includes(activeProjectId)\n      ? mock.areas.map(area => ({ projectId: activeProjectId, phase: area.phase ?? null }))\n      : []\n  }\n  const rows = checked(await phaseDb.from('areas').select('project_id, phase').in('project_id', ids)) as { project_id: string; phase: ProjectPhase | null }[]\n  return rows.map(row => ({ projectId: row.project_id, phase: row.phase ?? null }))\n}\n\nexport async function getProjects(): Promise<Project[]> {")

# Account Dashboard: lifecycle phase before schedule, mixed Area phase summary, schedule wording clarified.
path = 'src/pages/account/AccountDashboard.tsx'
replace(path,
"import { ProjectModal, SchedulePill } from './ProjectModal'",
"import { ProjectModal, SchedulePill } from './ProjectModal'\nimport { PhasePill } from '../../components/PhaseUI'\nimport { areaPhaseSummary } from '../../lib/projectPhase'")
replace(path,
"  const { data: notes } = useAsync(() => db.getNotes(), [notesVersion])",
"  const { data: notes } = useAsync(() => db.getNotes(), [notesVersion])\n  const projectIds = (projects ?? []).map(project => project.id)\n  const projectIdsKey = projectIds.join('|')\n  const { data: accountAreaPhases } = useAsync(() => db.getAccountAreaPhases(projectIds), [projectIdsKey, version, projectVersion])")
replace(path,
"  const buildingNow = scheduled.filter((p) => scheduleStatus(p.startDate!, p.endDate!) === 'ongoing')",
"  const happeningNow = scheduled.filter((p) => scheduleStatus(p.startDate!, p.endDate!) === 'ongoing')")
replace(path,
"    { icon: 'hammer', value: String(buildingNow.length), label: 'Building now', color: 'var(--leaf)' },",
"    { icon: 'calendar-check', value: String(happeningNow.length), label: 'Happening now', color: 'var(--leaf)' },")
replace(path,
"                {[...buildingNow, ...nextUp].slice(0, 3).map((p) => (",
"                {[...happeningNow, ...nextUp].slice(0, 3).map((p) => (")
replace(path,
"            {[...buildingNow, ...nextUp].length === 0 ? (",
"            {[...happeningNow, ...nextUp].length === 0 ? (")

old_card = '''              {projects!.map((p) => (
                <div
                  key={p.id}
                  className="card"
                  style={{ padding: 15, cursor: 'pointer' }}
                  onClick={() => setModal({ kind: 'project', project: p, editing: false })}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
                    <div style={{ width: 40, height: 40, borderRadius: 12, background: 'var(--surface-2)', border: '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: '0 0 auto' }}>
                      <Icon name="hammer" size={20} color="var(--brand)" />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                        <span style={{ fontSize: 15, fontWeight: 700 }}>{p.name}</span>
                        {active?.id === p.id && (
                          <span className="pill" style={{ background: 'var(--accent)', color: 'var(--accent-ink)' }}>Active</span>
                        )}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--ink-soft)' }}>{[p.type, p.location.split(',')[0]].filter(Boolean).join(' · ')}</div>
                    </div>
                    <SchedulePill project={p} />
                  </div>
                  <div style={{ marginTop: 11, display: 'flex', alignItems: 'center', gap: 7, fontSize: 12.5, color: 'var(--ink-soft)', fontWeight: 600 }}>
                    <Icon name="calendar-dots" size={15} color="var(--accent-2)" />
                    {p.startDate && p.endDate ? formatDateRange(p.startDate, p.endDate) : 'Not scheduled yet'}
                  </div>'''
new_card = '''              {projects!.map((p) => {
                const areaPhases = (accountAreaPhases ?? []).filter(item => item.projectId === p.id)
                return <div
                  key={p.id}
                  className="card"
                  style={{ padding: 15, cursor: 'pointer' }}
                  onClick={() => setModal({ kind: 'project', project: p, editing: false })}
                >
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 11 }}>
                    <div style={{ width: 40, height: 40, borderRadius: 12, background: 'var(--surface-2)', border: '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: '0 0 auto' }}>
                      <Icon name="hammer" size={20} color="var(--brand)" />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 15, fontWeight: 700 }}>{p.name}</span>
                        {active?.id === p.id && (
                          <span className="pill" style={{ background: 'var(--accent)', color: 'var(--accent-ink)' }}>Active</span>
                        )}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: 2 }}>{[p.type, p.location.split(',')[0]].filter(Boolean).join(' · ')}</div>
                    </div>
                  </div>
                  <div className="cluster" style={{ marginTop: 11, alignItems: 'center' }}>
                    <PhasePill phase={p.phase} />
                    <SchedulePill project={p} />
                  </div>
                  {areaPhases.length > 0 && <div style={{ marginTop: 9, fontSize: 12.5, color: 'var(--ink-soft)', fontWeight: 650 }}>
                    {areaPhases.length} {areaPhases.length === 1 ? 'Area' : 'Areas'} · {areaPhaseSummary(areaPhases)}
                  </div>}
                  <div style={{ marginTop: 9, display: 'flex', alignItems: 'center', gap: 7, fontSize: 12.5, color: 'var(--ink-soft)', fontWeight: 600 }}>
                    <Icon name="calendar-dots" size={15} color="var(--accent-2)" />
                    {p.startDate && p.endDate ? formatDateRange(p.startDate, p.endDate) : 'Not scheduled yet'}
                  </div>'''
replace(path, old_card, new_card)
replace(path,
"              ))}",
"              })}",
count=1)

# Project modal: lifecycle and schedule are visibly separate concepts.
path = 'src/pages/account/ProjectModal.tsx'
replace(path,
"import { formatDateRange } from '../../lib/format'",
"import { formatDateRange } from '../../lib/format'\nimport { PhasePill } from '../../components/PhaseUI'")
replace(path,
"  ongoing: { label: 'Building now', color: '#3d7247', bg: 'var(--leaf-bg)' },",
"  ongoing: { label: 'Happening now', color: '#3d7247', bg: 'var(--leaf-bg)' },")
replace(path,
"/** \"Upcoming / Building now / Finished\" pill — or \"Not scheduled\" when dateless. */",
"/** Schedule-only status pill — lifecycle phase is shown separately. */")
replace(path,
"      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>\n        <SchedulePill project={project} />",
"      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>\n        <PhasePill phase={project.phase} prefix=\"Project\" />\n        <SchedulePill project={project} />")

# Extend the existing phase browser proof at the account surface.
path = 'scripts/check-project-phases-browser.mjs'
replace(path,
"        const phaseOnly = (url.searchParams.get('select') ?? '') === 'id,phase'",
"        const select = url.searchParams.get('select') ?? ''\n        const phaseOnly = select === 'id,phase'\n        const accountPhaseOnly = select === 'project_id,phase'")
replace(path,
"        return respond({ json: phaseOnly ? rows.map(({ id, phase }) => ({ id, phase })) : rows })",
"        if (accountPhaseOnly) return respond({ json: rows.map(({ phase }) => ({ project_id: 'P', phase })) })\n        return respond({ json: phaseOnly ? rows.map(({ id, phase }) => ({ id, phase })) : rows })")
replace(path,
"    await page.getByRole('heading', { name: 'Phase fixture', exact: true }).waitFor()\n    await page.getByRole('button', { name: 'Open', exact: true }).click()",
"    await page.getByRole('heading', { name: 'Phase fixture', exact: true }).waitFor()\n    const projectCard = page.locator('.card').filter({ hasText: 'Renovate upstairs' }).first()\n    await projectCard.getByLabel('phase: Build').waitFor()\n    await projectCard.getByText('3 Areas · 1 Design · 1 Build · 1 Complete', { exact: true }).waitFor()\n    await page.getByText('Happening now', { exact: true }).first().waitFor()\n    await page.getByRole('button', { name: 'Open', exact: true }).click()")
replace(path,
"    console.log(`Project phases ${viewport.width}px: mixed workstreams, explicit transitions, reload and mobile Today: OK`)",
"    console.log(`Project phases ${viewport.width}px: account summary, mixed workstreams, explicit transitions, reload and mobile Today: OK`)")
