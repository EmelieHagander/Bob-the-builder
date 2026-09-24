// Phase-aware Project Home / Areas proof against CI's production live build.
// Only HTTP responses are fixtures; routing, database facade and React are real.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright-core'

const base = 'http://127.0.0.1:4175/Bob-the-builder/'
const api = 'https://pwa-proof.invalid'
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--base', '/Bob-the-builder/', '--host', '127.0.0.1', '--port', '4175', '--strictPort'], { stdio: ['ignore', 'pipe', 'pipe'] })
let logs = ''
server.stdout.on('data', data => { logs += data })
server.stderr.on('data', data => { logs += data })
const user = { id: '00000000-0000-0000-0000-000000000301', email: 'phase@example.test', aud: 'authenticated', role: 'authenticated', app_metadata: { provider: 'email' }, user_metadata: {}, created_at: '2026-09-14T00:00:00Z' }
const expiresAt = Math.floor(Date.now() / 1000) + 3600
const token = [JSON.stringify({ alg: 'HS256', typ: 'JWT' }), JSON.stringify({ sub: user.id, exp: expiresAt, role: 'authenticated' }), 'fixture-signature'].map(part => Buffer.from(part).toString('base64url')).join('.')
let browser

try {
  for (let attempt = 0; ; attempt++) {
    try { if ((await fetch(base)).ok) break } catch { /* starting */ }
    assert(attempt < 40 && server.exitCode === null, `Preview did not start: ${logs}`)
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
  await mkdir('test-results', { recursive: true })

  for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 844 }, { width: 1280, height: 900 }]) {
    let projectPhase = 'build'
    let toolReady = false
    let toolRevision = 1
    const readinessReviewed = new Set()
    const areaPhase = new Map([['bedroom', 'complete'], ['office', 'build'], ['guestroom', 'design']])
    const archivedAreas = new Map()
    let archiveVersion = 0
    const areaStamp = () => `2026-09-24T12:00:${String(archiveVersion).padStart(2, '0')}Z`
    const errors = []
    const context = await browser.newContext({ viewport, serviceWorkers: 'block' })
    await context.route('https://fonts.googleapis.com/**', route => route.abort())
    await context.route(`${api}/**`, async route => {
      const request = route.request()
      const url = new URL(request.url())
      const respond = options => route.fulfill({ ...options, headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info, x-supabase-api-version, accept-profile, content-profile',
        'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
        'Content-Type': 'application/json',
      } })
      if (request.method() === 'OPTIONS') return respond({ status: 204, body: '' })
      if (new URL(route.request().url()).pathname === '/rest/v1/rpc/project_plan_read') return respond({json:{record:null}})
      if (new URL(route.request().url()).pathname === '/rest/v1/rpc/project_work_read') return respond({json:{project_id:route.request().postDataJSON().p_project,vocabulary_version:'2026-09-24.1',status:'not_initialized',revision:null,focus_step_id:null,areas:[...areaPhase].map(([id,phase])=>({id,slug:id,name:id==='guestroom'?'Guestroom':id[0].toUpperCase()+id.slice(1),phase,archived_at:archivedAreas.get(id)??null})),steps:[],unorganised_tasks:[]}})
      if (url.pathname === '/rest/v1/rpc/area_lifecycle_command') {
        const body = request.postDataJSON()
        assert.equal(body.p_project, 'P'); assert.equal(body.p_expected, areaStamp())
        if (body.p_action === 'archive' && body.p_area === 'office') return respond({ status: 400, json: { message: "Move or finish this Area's unfinished Steps and Tasks before archiving." } })
        assert.equal(body.p_area, 'bedroom')
        archiveVersion++
        if (body.p_action === 'archive') archivedAreas.set(body.p_area, areaStamp())
        else { assert.equal(body.p_action, 'restore'); archivedAreas.delete(body.p_area) }
        return respond({ json: { id: body.p_area, project_id: 'P', archived_at: archivedAreas.get(body.p_area) ?? null, updated_at: areaStamp() } })
      }
      if (url.pathname === '/auth/v1/token') return respond({ json: { access_token: token, refresh_token: 'fixture-refresh', token_type: 'bearer', expires_in: 3600, expires_at: expiresAt, user } })
      if (url.pathname === '/auth/v1/user') return respond({ json: user })
      if (url.pathname === '/rest/v1/rpc/claim_project_invites') return respond({ json: 0 })
      if (url.pathname === '/rest/v1/rpc/project_invitations') return respond({ json: [] })
      if (url.pathname === '/rest/v1/rpc/join_project') return respond({ json: {} })
      if (url.pathname === '/rest/v1/rpc/work_plan_command') {
        const body = request.postDataJSON()
        assert.equal(body.p_project, 'P')
        assert.equal(body.p_task, 't2')
        if (body.p_action === 'set_need_ready') {
          assert.equal(body.p_item, '96000000-0000-0000-0000-000000000100')
          assert.equal(body.p_expected, toolRevision)
          toolReady = Boolean(body.p_data.ready); toolRevision += 1; readinessReviewed.delete('t2')
          return respond({ json: { id: body.p_item, revision: toolRevision, ready: toolReady } })
        }
        if (body.p_action === 'confirm_readiness') {
          assert(toolReady, 'Tool blocker must be resolved before readiness confirmation')
          readinessReviewed.add('t2')
          return respond({ json: { id: 't2', readiness: 'ready' } })
        }
        throw new Error('Unexpected work-plan command: ' + body.p_action)
      }
      if (url.pathname === '/rest/v1/rpc/phase_command') {
        const body = request.postDataJSON()
        assert.equal(body.p_project, 'P')
        assert(body.p_reason?.trim(), 'Phase transition must include a reason')
        if (body.p_scope === 'project') projectPhase = body.p_phase
        else if (body.p_scope === 'area') areaPhase.set(body.p_area, body.p_phase)
        else throw new Error('Unexpected phase scope')
        return respond({ json: { scope: body.p_scope, areaId: body.p_area, phase: body.p_phase } })
      }
      if (url.pathname === '/rest/v1/projects') {
        const project = { id: 'P', slug: 'renovate-upstairs', name: 'Renovate upstairs', description: 'Three rooms moving at different speeds.', location: 'Djuvanäs', type: 'Renovation', theme: 'birch', phase: projectPhase, start_label: '', start_date: '2026-09-15', end_date: '2026-10-04' }
        const single = (request.headers()['accept'] ?? '').includes('application/vnd.pgrst.object+json')
        return respond({ json: single ? project : [project] })
      }
      if (url.pathname === '/rest/v1/account') return respond({ json: { id: 'account', name: 'Phase fixture', owner_name: '', email: '' } })
      if (url.pathname === '/rest/v1/account_notes') return respond({ json: [] })
      if (url.pathname === '/rest/v1/people') return respond({ json: [{ id: 'member', name: 'Fixture member', initials: 'FM', color: '#41513f', role: 'Organiser', diet: '', person_skills: [] }] })
      if (url.pathname === '/rest/v1/areas') {
        const select = url.searchParams.get('select') ?? ''
        const phaseOnly = select === 'id,phase'
        const accountPhaseOnly = select === 'project_id,phase'
        const rows = [
          { id: 'bedroom', slug: 'bedroom', name: 'Bedroom', description: 'Finished room', icon: 'bed', lead_id: 'member', assigned_pct: 100, materials_pct: 100, done_pct: 100, task_summary: '2 tasks · 2 done', phase: areaPhase.get('bedroom'), area_crew: [{ person_id: 'member' }], area_reference_images: [] },
          { id: 'office', slug: 'office', name: 'Office', description: 'Work underway', icon: 'hammer', lead_id: 'member', assigned_pct: 100, materials_pct: 75, done_pct: 50, task_summary: '2 tasks · 1 done', phase: areaPhase.get('office'), area_crew: [{ person_id: 'member' }], area_reference_images: [] },
          { id: 'guestroom', slug: 'guestroom', name: 'Guestroom', description: 'Still comparing solutions', icon: 'lamp', lead_id: 'member', assigned_pct: 0, materials_pct: 0, done_pct: 0, task_summary: 'No tasks yet', phase: areaPhase.get('guestroom'), area_crew: [{ person_id: 'member' }], area_reference_images: [] },
        ].map(row => ({ ...row, archived_at: archivedAreas.get(row.id) ?? null, updated_at: areaStamp() }))
        if (accountPhaseOnly) return respond({ json: rows.filter(row => !row.archived_at).map(({ phase }) => ({ project_id: 'P', phase })) })
        return respond({ json: phaseOnly ? rows.map(({ id, phase }) => ({ id, phase })) : rows })
      }
      if (url.pathname === '/rest/v1/tasks') {
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
      if (url.pathname === '/rest/v1/current_task_readiness') {
        const rows = [
          { task_id: 't1', project_id: 'P', area_id: 'bedroom', area_phase: areaPhase.get('bedroom'), task_status: 'done', readiness_state: 'complete', blocker_count: 0, blockers: [], reviewed_at: null, reviewed_by: '', review_note: '' },
          { task_id: 't2', project_id: 'P', area_id: 'office', area_phase: areaPhase.get('office'), task_status: 'doing', readiness_state: !toolReady ? 'blocked' : readinessReviewed.has('t2') ? 'ready' : 'unreviewed', blocker_count: toolReady ? 0 : 1, blockers: toolReady ? [] : [{ kind: 'tool', id: '96000000-0000-0000-0000-000000000100', label: 'Tool needed: Circular saw' }], reviewed_at: readinessReviewed.has('t2') ? '2026-09-15T05:00:00Z' : null, reviewed_by: readinessReviewed.has('t2') ? 'Fixture member' : '', review_note: '' },
          { task_id: 't3', project_id: 'P', area_id: 'office', area_phase: areaPhase.get('office'), task_status: 'done', readiness_state: 'complete', blocker_count: 0, blockers: [], reviewed_at: null, reviewed_by: '', review_note: '' },
          { task_id: 't4', project_id: 'P', area_id: 'guestroom', area_phase: areaPhase.get('guestroom'), task_status: 'todo', readiness_state: 'unreviewed', blocker_count: 0, blockers: [], reviewed_at: null, reviewed_by: '', review_note: '' },
        ]
        const taskId = url.searchParams.get('task_id')?.replace(/^eq\./, '')
        const selected = taskId ? rows.filter(row => row.task_id === taskId) : rows
        const single = (request.headers()['accept'] ?? '').includes('application/vnd.pgrst.object+json')
        return respond({ json: single ? selected[0] ?? null : selected })
      }
      if (url.pathname === '/rest/v1/task_dependency_status') return respond({ json: [] })
      if (url.pathname === '/rest/v1/task_material_readiness') return respond({ json: [] })
      if (url.pathname === '/rest/v1/task_needs') {
        const taskId = url.searchParams.get('task_id')?.replace(/^eq\./, '')
        return respond({ json: taskId === 't2' ? [{ id: '96000000-0000-0000-0000-000000000100', project_id: 'P', task_id: 't2', kind: 'tool', label: 'Circular saw', notes: 'Charged battery', ready: toolReady, revision: toolRevision, actor_label: 'Fixture member', created_at: '2026-09-15T04:00:00Z', updated_at: '2026-09-15T04:00:00Z' }] : [] })
      }
      if (url.pathname === '/rest/v1/today_tasks') return respond({ json: [
        { id: 't4', area_id: 'guestroom', area_name: 'Guestroom', area_phase: areaPhase.get('guestroom'), name: 'Mark proposed opening', skill: 'novice', status: 'todo', assignee_ids: ['member'], project_id: 'P' },
        { id: 't2', area_id: 'office', area_name: 'Office', area_phase: areaPhase.get('office'), name: 'Frame wall', skill: 'intermediate', status: 'doing', assignee_ids: ['member'], project_id: 'P' },
      ] })
      if (url.pathname === '/rest/v1/materials') return respond({ json: [] })
      if (url.pathname === '/rest/v1/events') return respond({ json: [] })
      if (url.pathname === '/rest/v1/announcements') return respond({ json: [] })
      if (url.pathname.startsWith('/rest/v1/') && request.method() === 'GET') return respond({ json: [] })
      errors.push(`Unexpected request: ${request.method()} ${url.pathname}`)
      return respond({ status: 500, json: { error: 'unexpected_fixture_request' } })
    })

    const page = await context.newPage()
    page.setDefaultTimeout(12000)
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(`${base}#/signin`)
    await page.getByRole('button', { name: 'Continue as guest', exact: true }).click()
    await page.getByRole('heading', { name: 'Phase fixture', exact: true }).waitFor()
    const projectCard = page.locator('.card').filter({ hasText: 'Renovate upstairs' }).first()
    await projectCard.getByLabel('phase: Build').waitFor()
    await projectCard.getByText('3 Areas · 1 Design · 1 Build · 1 Complete', { exact: true }).waitFor()
    await page.getByText('Happening now', { exact: true }).first().waitFor()
    await page.getByRole('button', { name: 'Open', exact: true }).click()

    await page.getByRole('heading', { name: 'Renovate upstairs', exact: true }).waitFor()
    await page.getByLabel('Project phase: Build').waitFor()
    const plan = page.getByRole('region', { name: 'Project plan', exact: true })
    await plan.getByRole('region', { name: 'Office', exact: true }).getByLabel('phase: Build').waitFor()
    await plan.getByRole('region', { name: 'Guestroom', exact: true }).getByLabel('phase: Design').waitFor()
    await page.getByRole('link', { name: /Guestroom/ }).first().waitFor()
    assert.equal(await plan.locator('.work-area').count(),3,'Every Area appears once in the shared Plan')

    if (viewport.width < 860) await page.getByRole('link', { name: 'Today', exact: true }).waitFor()

    await page.goto(`${base}#/today`)
    await page.getByRole('heading', { name: 'What needs doing today', exact: true }).waitFor()
    // The heading is synchronous; wait for both task and readiness data before
    // allTextContents(), which snapshots immediately rather than waiting.
    await page.getByText('Tool needed: Circular saw', { exact: true }).waitFor()
    await page.getByText('Readiness has not been confirmed yet.', { exact: true }).waitFor()
    assert.deepEqual(await page.locator('.task-title-link').allTextContents(), ['Mark proposed opening', 'Frame wall'],
      'Readiness takes priority over lifecycle phase; Design work is not hidden or blocked by its phase')
    await page.getByRole('link', { name: 'Frame wall', exact: true }).click()
    await page.getByRole('heading', { name: 'Frame wall', exact: true }).waitFor()
    await page.getByLabel('Area phase: Build').waitFor()
    await page.getByRole('region', { name: 'Task readiness', exact: true }).getByText('Blocked', { exact: true }).waitFor()
    await page.getByLabel('Available: Circular saw', { exact: true }).click()
    await page.getByRole('region', { name: 'Task readiness', exact: true }).getByText('Readiness not reviewed', { exact: true }).waitFor()
    await page.getByRole('region', { name: 'Task readiness', exact: true }).getByRole('button', { name: 'Confirm ready', exact: true }).click()
    await page.getByRole('region', { name: 'Task readiness', exact: true }).getByText('Ready to start', { exact: true }).waitFor()
    await page.goto(`${base}#/`)
    await page.getByRole('heading', { name: 'Renovate upstairs', exact: true }).waitFor()

    await page.getByRole('button', { name: 'Review phase', exact: true }).first().click()
    await page.getByLabel('Move to phase').selectOption('planning')
    await page.getByLabel('Reason for this change').fill('New evidence means we need to revisit planning')
    await page.getByRole('button', { name: 'Save phase', exact: true }).click()
    await page.getByLabel('Project phase: Planning').waitFor()
    await page.reload()
    await page.getByLabel('Project phase: Planning').waitFor()

    await page.getByRole('link', { name: 'Areas', exact: true }).first().click()
    await page.getByRole('heading', { name: 'Areas', exact: true }).waitFor()
    const office = page.locator('article').filter({ hasText: 'Office' })
    await office.getByText('Done', { exact: true }).waitFor()
    await office.getByText('Done', { exact: true }).locator('..').getByText('50%', { exact: true }).waitFor()
    assert.equal(await page.locator('article').getByText('Done', { exact: true }).count(), 1, 'Only Build Area should foreground build progress')
    assert.equal(await page.locator('article').filter({hasText:'Guestroom'}).getByText('Done', { exact: true }).count(), 0, 'Design Area keeps its phase-specific next action')
    const guest = page.locator('article').filter({ hasText: 'Guestroom' })
    await guest.getByLabel('phase: Design').waitFor()
    await guest.getByRole('button', { name: 'Review phase', exact: true }).click()
    await page.getByLabel('Move to phase').selectOption('planning')
    await page.getByLabel('Reason for this change').fill('Target selected; ready to plan')
    await page.getByRole('button', { name: 'Save phase', exact: true }).click()
    await page.locator('article').filter({ hasText: 'Guestroom' }).getByLabel('phase: Planning').waitFor()

    assert(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), 'Phase UI must not overflow horizontally')
    await page.screenshot({ path: `test-results/project-phases-${viewport.width}.png`, fullPage: true })

    await page.goto(`${base}#/areas/office`)
    await page.getByText('More tools', { exact: true }).click()
    await page.getByRole('button', { name: 'Edit Area', exact: true }).click()
    await page.getByRole('button', { name: 'Archive Area', exact: true }).click()
    await page.getByText("Move or finish this Area's unfinished Steps and Tasks before archiving.", { exact: true }).waitFor()
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    await page.goto(`${base}#/areas/bedroom`)
    await page.getByText('More tools', { exact: true }).click()
    await page.getByRole('button', { name: 'Edit Area', exact: true }).click()
    await page.getByRole('button', { name: 'Archive Area', exact: true }).click()
    await page.getByRole('region', { name: 'Archived Area', exact: true }).waitFor()
    await page.getByRole('link', { name: 'Finish trim', exact: true }).waitFor()
    await page.reload()
    await page.getByRole('region', { name: 'Archived Area', exact: true }).waitFor()
    assert.equal(await page.getByRole('button', { name: 'Add task', exact: true }).count(), 0)
    await page.goto(`${base}#/`)
    await page.getByText('Archived Areas · 1', { exact: true }).click()
    await plan.getByRole('region', { name: 'Bedroom', exact: true }).waitFor()
    await page.goto(`${base}#/areas`)
    await page.getByRole('button', { name: 'Archived Areas · 1', exact: true }).waitFor()
    assert.equal(await page.locator('article').filter({ hasText: 'Bedroom' }).count(), 0)
    await page.getByRole('button', { name: 'Archived Areas · 1', exact: true }).click()
    await page.locator('article').filter({ hasText: 'Bedroom' }).waitFor()
    await page.reload()
    await page.locator('article').filter({ hasText: 'Bedroom' }).waitFor()
    await page.getByRole('link', { name: 'Open Area', exact: true }).click()
    await page.getByRole('region', { name: 'Archived Area', exact: true }).waitFor()
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1))
    await page.locator('.page').evaluate(async el => { await Promise.all(el.getAnimations().map(animation => animation.finished)) })
    await page.screenshot({ path: `test-results/area-archive-${viewport.width}.png`, fullPage: true })
    await page.getByRole('button', { name: 'Restore Area', exact: true }).click()
    await page.getByRole('region', { name: 'Archived Area', exact: true }).waitFor({ state: 'hidden' })
    await page.reload()
    await page.getByRole('button', { name: 'Add task', exact: true }).waitFor()
    await page.getByRole('link', { name: 'Finish trim', exact: true }).waitFor()
    assert.deepEqual(errors, [], 'No runtime exceptions or unexpected API calls')
    await context.close()
    console.log(`Project phases ${viewport.width}px: account summary, mixed Areas, Today/Task field context, explicit transitions and reload: OK`)
  }
} finally {
  if (browser) await browser.close()
  server.kill('SIGTERM')
}
