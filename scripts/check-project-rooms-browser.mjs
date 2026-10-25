// Project rooms, Area rooms and building choice at project creation.
// Production React + database.ts + Supabase client; HTTP is fixture-only and
// mirrors the physical_scope_command contract. SQL/RLS authority is tested
// against the real migration separately.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright-core'

const settleVisual = page => page.evaluate(async () => {
  await document.fonts.ready
  await Promise.all(document.getAnimations().filter(animation => Number.isFinite(animation.effect?.getComputedTiming().endTime)).map(animation => animation.finished.catch(() => {})))
})

const base = 'http://127.0.0.1:4174/Bob-the-builder/'
const api = 'https://pwa-proof.invalid'
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--base', '/Bob-the-builder/', '--host', '127.0.0.1', '--port', '4174', '--strictPort'], { stdio: ['ignore', 'pipe', 'pipe'] })
let logs = '', browser, activePage
server.stdout.on('data', chunk => { logs += chunk })
server.stderr.on('data', chunk => { logs += chunk })

const user = { id: '00000000-0000-0000-0000-000000000003', email: 'fixture@example.test', aud: 'authenticated', role: 'authenticated', app_metadata: { provider: 'email' }, user_metadata: {}, created_at: '2026-10-25T00:00:00Z' }
const expiry = Math.floor(Date.now() / 1000) + 3600
const token = [JSON.stringify({ alg: 'HS256', typ: 'JWT' }), JSON.stringify({ sub: user.id, exp: expiry, role: 'authenticated' }), 'fixture-signature'].map(part => Buffer.from(part).toString('base64url')).join('.')
const audit = { change_note: 'Room scope fixture', actor_label: 'Fixture member', recorded_at: '2026-10-25T10:00:00.000Z', archived: false }
const eq = (url, key) => url.searchParams.get(key)?.replace(/^eq\./, '')
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS' }

function freshState() {
  const room = (id, building_id, name, kind) => ({ ...audit, id, building_id, revision: 1, latest_revision: 1, project_id: null, source_project_id: null, level_id: null, name, kind, notes: '', truth: 'unknown', source: '', has_proposal: false })
  return {
    projects: [{ id: 'A', slug: 'a', name: 'Porch A', description: '', location: '', type: 'Renovation', theme: 'birch', start_label: '', start_date: null, end_date: null }],
    buildings: [
      { ...audit, id: 'house', site_id: null, revision: 1, name: 'Main house', notes: '' },
      { ...audit, id: 'barn', site_id: null, revision: 1, name: 'Neighbour barn', notes: '' },
    ],
    canEdit: { house: true, barn: false },
    spaces: [room('kids', 'house', 'Kids room', 'Bedroom'), room('landing', 'house', 'Landing', 'Hall'), room('kitchen', 'house', 'Kitchen', 'Kitchen'), room('hayloft', 'barn', 'Hayloft', 'Loft')],
    areas: [{ id: 'area-bunk', project_id: 'A', slug: 'bunk-bed', name: 'Bunk bed', description: 'Build a bunk bed', icon: 'bed', lead_id: null, assigned_pct: 0, materials_pct: 0, done_pct: 0, task_summary: 'No tasks yet', phase: 'design', archived_at: null, area_crew: [], area_reference_images: [] }],
    scopes: [], targets: [], creates: [], failLink: false, failRoomRead: false,
  }
}

// The command behaviour the owner contract promises (2026-10-25).
function scopeCommand(state, body) {
  const { p_project: project, p_kind: kind, p_action: action, p_record: record, p_data: data } = body
  if (!state.projects.some(row => row.id === project)) return { status: 403, json: { code: '42501', message: 'project_denied' } }
  const whole = buildingId => state.scopes.some(row => row.project_id === project && row.target_kind === 'building' && row.building_id === buildingId)
  if (action === 'unlink') {
    if (kind === 'area') { state.targets = state.targets.filter(row => row.id !== record); return { json: { id: record, removed: true } } }
    const removed = state.scopes.find(row => row.id === record && row.project_id === project)
    state.scopes = state.scopes.filter(row => row !== removed)
    let rooms = 0, targets = 0
    if (removed?.target_kind === 'building' && !whole(removed.building_id)) {
      rooms = state.scopes.filter(row => row.project_id === project && row.target_kind === 'space' && row.building_id === removed.building_id).length
      state.scopes = state.scopes.filter(row => !(row.project_id === project && row.target_kind === 'space' && row.building_id === removed.building_id))
      targets = state.targets.filter(row => row.project_id === project && row.building_id === removed.building_id).length
      state.targets = state.targets.filter(row => !(row.project_id === project && row.building_id === removed.building_id))
    }
    return { json: { id: record, removed: true, removed_rooms: rooms, removed_area_targets: targets } }
  }
  if (kind === 'project' && data.target_kind === 'building') {
    if (state.failLink || !state.canEdit[data.building_id]) return { status: 403, json: { code: '42501', message: 'building_denied' } }
  } else if (!whole(data.building_id)) return { status: 400, json: { code: '22023', message: 'building_not_linked' } }
  const rows = kind === 'project' ? state.scopes : state.targets
  const existing = rows.find(row => row.project_id === project && row.target_kind === data.target_kind && row.building_id === data.building_id
    && (row.space_id ?? null) === (data.space_id ?? null) && (kind === 'project' || row.area_id === data.area_id))
  if (existing) return { json: { id: existing.id, target_kind: existing.target_kind, existing: true } }
  rows.push({ id: record, project_id: project, target_kind: data.target_kind, site_id: null, building_id: data.building_id, space_id: data.space_id ?? null, element_id: null, ...(kind === 'area' ? { area_id: data.area_id } : {}) })
  return { json: { id: record, target_kind: data.target_kind } }
}

async function fixture(viewport) {
  const state = freshState(), errors = []
  const context = await browser.newContext({ viewport, serviceWorkers: 'block' })
  await context.route('https://fonts.googleapis.com/**', route => route.abort())
  await context.route(api + '/**', async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname, method = request.method()
    const respond = options => route.fulfill({ ...options, headers: cors })
    if (method === 'OPTIONS') return respond({ status: 204 })
    if (path === '/auth/v1/token') return respond({ json: { access_token: token, refresh_token: 'fixture-refresh', token_type: 'bearer', expires_in: 3600, expires_at: expiry, user } })
    if (path === '/auth/v1/user') return respond({ json: user })
    if (path === '/auth/v1/logout') return respond({ json: {} })
    if (path.startsWith('/rest/')) assert.equal(request.headers().authorization, 'Bearer ' + token)
    if (path === '/functions/v1/ask-bob') return respond({ json: { ok: true, renewed: 0 } })
    if (path === '/rest/v1/rpc/drawing_work_list') return respond({ json: { items: [], next_cursor: null } })
    if (['/rest/v1/rpc/bob_chat_inbox', '/rest/v1/rpc/bob_mark_chat_read', '/rest/v1/rpc/bob_job_status'].includes(path)) return respond({ json: null })
    if (path === '/rest/v1/rpc/project_plan_read') return respond({ json: { record: null } })
    if (path === '/rest/v1/rpc/project_work_read') return respond({ json: { project_id: request.postDataJSON().p_project, vocabulary_version: '2026-09-24.1', status: 'not_initialized', revision: null, focus_step_id: null, areas: [], steps: [], unorganised_tasks: [] } })
    if (path === '/rest/v1/rpc/claim_project_invites') return respond({ json: 0 })
    if (path === '/rest/v1/rpc/project_invitations') return respond({ json: [] })
    if (path === '/rest/v1/rpc/sharing_directory') return respond({ json: { households: [], friends: [] } })
    if (path === '/rest/v1/rpc/building_sharing_state') return respond({ json: { buildingId: request.postDataJSON().p_building, householdId: null, revision: 0, canManage: true, projects: [] } })
    if (path === '/rest/v1/projects') return respond({ json: state.projects })
    if (path === '/rest/v1/account') return respond({ json: { id: 'account', name: 'Fixture account', owner_name: '', email: '' } })
    if (path === '/rest/v1/people') return respond({ json: [{ id: 'memberA', name: 'Fixture member', initials: 'FM', color: '#41513f', role: 'Organiser', diet: '', person_skills: [] }] })
    if (path === '/rest/v1/areas' && method === 'GET') return respond({ json: state.areas.filter(row => row.project_id === eq(url, 'project_id')) })
    if (path === '/rest/v1/rpc/create_project') {
      const input = request.postDataJSON().p_input
      const created = { ...input, id: 'P' + (state.projects.length + 1), slug: input.name.toLowerCase().replace(/\W+/g, '-') }
      state.projects.push(created); state.creates.push(input.name)
      return respond({ json: created })
    }
    if (path === '/rest/v1/current_sites') return respond({ json: [] })
    if (path === '/rest/v1/current_buildings') return respond({ json: state.buildings })
    if (path === '/rest/v1/rpc/can_edit_building') return respond({ json: !!state.canEdit[request.postDataJSON().p_building] })
    if (path === '/rest/v1/rpc/physical_building_command') {
      const { p_action, p_building, p_data: data } = request.postDataJSON()
      assert.equal(p_action, 'create')
      const row = { ...audit, id: p_building, site_id: data.site_id ?? null, revision: 1, name: data.name, notes: data.notes ?? '' }
      state.buildings.push(row); state.canEdit[p_building] = true
      return respond({ json: row })
    }
    if (path === '/rest/v1/project_physical_scope') return respond({ json: state.scopes.filter(row => row.project_id === eq(url, 'project_id')) })
    if (path === '/rest/v1/area_physical_targets') return respond({ json: state.targets.filter(row => row.project_id === eq(url, 'project_id')) })
    if (path === '/rest/v1/project_buildings') {
      const filter = url.searchParams.get('project_id') ?? ''
      const projects = filter.startsWith('in.') ? filter.slice(4, -1).split(',') : [filter.replace(/^eq\./, '')]
      return respond({ json: state.scopes.filter(row => projects.includes(row.project_id) && row.target_kind !== 'site')
        .flatMap(row => state.buildings.filter(building => building.id === row.building_id).map(building => ({ ...building, project_id: row.project_id })))
        .filter((row, index, rows) => rows.findIndex(other => other.id === row.id && other.project_id === row.project_id) === index) })
    }
    if (path === '/rest/v1/project_spaces') {
      if (state.failRoomRead) return respond({ status: 503, json: { message: 'Rooms temporarily unavailable' } })
      const project = eq(url, 'project_id'), mine = state.scopes.filter(row => row.project_id === project)
      const rows = state.spaces.filter(room => mine.some(row => (row.target_kind === 'building' && row.building_id === room.building_id) || (row.target_kind === 'space' && row.space_id === room.id)))
      return respond({ json: rows.map(room => ({ ...room, project_id: project })) })
    }
    if (path === '/rest/v1/current_spaces') return respond({ json: state.spaces.filter(row => row.building_id === eq(url, 'building_id')) })
    if (path === '/rest/v1/rpc/physical_scope_command') return respond(scopeCommand(state, request.postDataJSON()))
    if (path.startsWith('/rest/v1/') && method === 'GET') return respond({ json: [] })
    errors.push(method + ' ' + path)
    return respond({ status: 500, json: { message: 'Unexpected fixture request' } })
  })
  const page = await context.newPage()
  activePage = page
  page.setDefaultTimeout(15000)
  page.on('pageerror', error => errors.push(error.message))
  return { context, page, state, errors }
}

async function assertPhoneLayout(page, viewport, label) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  assert(overflow <= 1, `${label}: no horizontal page scroll at ${viewport.width}px (overflow ${overflow})`)
}
async function assertReachable(locator, label) {
  await locator.evaluate(node => node.scrollIntoView({ block: 'center' }))
  const box = await locator.boundingBox()
  assert(box && box.height >= 44, `${label}: touch target is at least 44px high`)
  assert(await locator.evaluate(node => { const r = node.getBoundingClientRect(); return node.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)) }), `${label}: not covered by fixed controls`)
}

try {
  for (let tries = 0; ; tries++) {
    try { if ((await fetch(base)).ok) break } catch {}
    if (tries > 40) throw new Error('Preview did not start: ' + logs)
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] })
  await mkdir('test-results', { recursive: true })

  for (const viewport of [{ width: 320, height: 740 }, { width: 390, height: 844 }, { width: 1280, height: 900 }]) {
    const { context, page, state, errors } = await fixture(viewport)
    const shot = async name => { await settleVisual(page); await page.screenshot({ path: `test-results/${name}-${viewport.width}.png`, fullPage: true }) }

    await page.goto(base + '#/signin')
    await page.getByPlaceholder('you@example.se').fill(user.email)
    await page.locator('input[type="password"]').fill('fixture-password')
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    await page.getByRole('heading', { name: 'Home', exact: true }).waitFor()
    await page.locator('.account-project-row').filter({ hasText: 'Porch A' }).getByRole('button', { name: 'Open project Porch A', exact: true }).click()
    await page.waitForURL('**/#/project')

    // 1. A building the user can only read is not offered for linking.
    await page.goto(base + '#/building')
    await page.getByRole('heading', { name: 'Building & spaces', exact: true }).waitFor()
    const picker = page.locator('.building-context-editor > .foundation-actions select')
    await picker.selectOption({ label: 'Neighbour barn' })
    await page.getByText('Only someone who can edit Neighbour barn can link it to this project.', { exact: false }).waitFor()
    assert.equal(await page.getByRole('button', { name: 'Use in this project', exact: true }).count(), 0, 'Read-only building has no link action')
    assert.equal(await page.getByRole('checkbox').count(), 0, 'Rooms cannot be marked before the whole building is linked')

    // 2. An editable building links, then rooms are marked and read back.
    await picker.selectOption({ label: 'Main house' })
    await page.getByText('Kids room', { exact: true }).waitFor()
    await page.getByRole('button', { name: 'Use in this project', exact: true }).click()
    let modal = page.getByRole('dialog', { name: 'Use building in project', exact: true })
    await modal.getByRole('button', { name: 'Use this building', exact: true }).click()
    await modal.waitFor({ state: 'hidden' })
    await page.getByText('Used by this project', { exact: true }).waitFor()
    await page.getByText('None marked yet. Tick the rooms this project covers below.', { exact: true }).waitFor()
    const summary = page.locator('.room-scope-summary')
    const toggle = name => page.getByRole('checkbox', { name: `${name}: in this project`, exact: true })
    await assertReachable(page.locator('.room-scope-toggle').filter({ has: toggle('Kids room') }), 'Room toggle')
    for (const name of ['Kids room', 'Landing']) {
      await toggle(name).check()
      await page.waitForFunction(() => [...document.querySelectorAll('.room-scope-toggle input')].every(input => !input.disabled))
    }
    await summary.getByText('Kids room, Landing', { exact: true }).waitFor()
    await toggle('Landing').uncheck()
    await page.waitForFunction(() => [...document.querySelectorAll('.room-scope-toggle input')].every(input => !input.disabled))
    await summary.getByText('Kids room', { exact: true }).waitFor()
    assert.deepEqual(state.scopes.filter(row => row.target_kind === 'space').map(row => row.space_id), ['kids'])
    await page.reload()
    await summary.getByText('Kids room', { exact: true }).waitFor()
    assert.equal(await toggle('Kids room').isChecked(), true, 'Room mark survives reload')
    assert.equal(await toggle('Landing').isChecked(), false)
    await assertPhoneLayout(page, viewport, 'Building rooms')
    await shot('project-rooms-building')

    // 3. An Area maps to rooms of the linked building.
    await page.goto(base + '#/areas/bunk-bed')
    const rooms = page.getByRole('region', { name: 'Rooms', exact: true })
    await rooms.getByLabel('Add a room', { exact: true }).waitFor()
    await rooms.getByText('No rooms chosen for this Area yet.', { exact: true }).waitFor()
    assert.equal(await rooms.getByRole('option', { name: /Hayloft/ }).count(), 0, 'Rooms of unlinked buildings are not offered')
    await rooms.getByLabel('Add a room', { exact: true }).selectOption({ label: 'Kids room (in project)' })
    await rooms.getByRole('button', { name: 'Add', exact: true }).click()
    await rooms.getByRole('button', { name: 'Remove Kids room from this Area', exact: true }).waitFor()
    await rooms.getByLabel('Add a room', { exact: true }).selectOption({ label: 'Kitchen' })
    await rooms.getByRole('button', { name: 'Add', exact: true }).click()
    await rooms.getByRole('button', { name: 'Remove Kitchen from this Area', exact: true }).click()
    await rooms.getByRole('button', { name: 'Remove Kitchen from this Area', exact: true }).waitFor({ state: 'detached' })
    assert.deepEqual(state.targets.map(row => [row.area_id, row.space_id]), [['area-bunk', 'kids']])
    await page.reload()
    await rooms.locator('.area-room-row').getByText('Kids room', { exact: true }).waitFor()
    await assertReachable(rooms.getByRole('button', { name: 'Remove Kids room from this Area', exact: true }), 'Remove room')
    await assertPhoneLayout(page, viewport, 'Area rooms')
    await shot('project-rooms-area')
    // A failed read is not an empty Area.
    state.failRoomRead = true
    await page.reload()
    await rooms.getByText('Rooms could not be loaded. Nothing shown here is current.', { exact: true }).waitFor()
    assert.equal(await rooms.getByText('No rooms chosen for this Area yet.').count(), 0)
    state.failRoomRead = false
    await rooms.getByRole('button', { name: 'Retry', exact: true }).click()
    await rooms.getByText('Kids room', { exact: true }).waitFor()

    // 4. Unlinking explains and removes room marks and Area rooms.
    await page.goto(base + '#/building')
    await page.getByText('Used by this project', { exact: true }).waitFor()
    await page.getByRole('button', { name: 'Unlink from this project', exact: true }).click()
    modal = page.getByRole('dialog', { name: 'Unlink from this project', exact: true })
    await modal.getByText('This project’s 1 room mark is removed.', { exact: true }).waitFor()
    await modal.getByText('Areas lose the rooms they were mapped to in this building.', { exact: true }).waitFor()
    await shot('project-rooms-unlink')
    await modal.getByRole('button', { name: 'Unlink building', exact: true }).click()
    await modal.waitFor({ state: 'hidden' })
    await page.getByText('Main house is no longer used by this project. Removed 1 room mark and 1 Area room.', { exact: true }).waitFor()
    await page.getByText('Not linked to this project', { exact: true }).waitFor()
    assert.equal(state.scopes.length, 0)
    assert.equal(state.targets.length, 0)
    await page.goto(base + '#/areas/bunk-bed')
    await rooms.getByText('This project has no building linked yet. Link one to choose the rooms this Area covers.', { exact: true }).waitFor()
    await rooms.getByRole('link', { name: 'Building & spaces', exact: true }).waitFor()
    await shot('project-rooms-area-empty')
    assert.deepEqual(errors, [])

    // 5. Project creation: existing building, new building, skip, failed link.
    const create = async (name, building, buildingName) => {
      await page.goto(base + '#/')
      await page.getByRole('button', { name: 'New project', exact: true }).click()
      const dialog = page.getByRole('dialog', { name: 'New project', exact: true })
      await dialog.getByLabel('Project name *', { exact: true }).fill(name)
      const select = dialog.getByLabel('Building (optional)', { exact: true })
      await dialog.locator('option', { hasText: 'Choose later' }).waitFor({ state: 'attached' })
      if (building) await select.selectOption({ label: building })
      if (buildingName) await dialog.getByLabel('Building name *', { exact: true }).fill(buildingName)
      return dialog
    }
    let dialog = await create('Loft', 'Main house')
    const offered = await dialog.getByLabel('Building (optional)', { exact: true }).locator('option').allTextContents()
    assert.deepEqual(offered, ['Choose later', 'Main house', 'New building…'], 'Only editable buildings are offered')
    await assertReachable(dialog.getByRole('button', { name: 'Create project', exact: true }), 'Create project')
    await shot('new-project-building')
    await dialog.getByRole('button', { name: 'Create project', exact: true }).click()
    await page.waitForURL('**/#/project')
    await page.getByRole('heading', { name: 'Loft', exact: true }).waitFor()
    const loft = state.projects.find(row => row.name === 'Loft').id
    assert.deepEqual(state.scopes.filter(row => row.project_id === loft).map(row => [row.target_kind, row.building_id]), [['building', 'house']])
    await page.goto(base + '#/building')
    await page.getByText('Used by this project', { exact: true }).waitFor()

    dialog = await create('Shed build', 'New building…', 'Garden shed')
    await dialog.getByRole('button', { name: 'Create project', exact: true }).click()
    await page.getByRole('heading', { name: 'Shed build', exact: true }).waitFor()
    const shed = state.buildings.find(row => row.name === 'Garden shed')
    assert(shed, 'New building is saved')
    assert.deepEqual(state.scopes.filter(row => row.project_id === state.projects.at(-1).id).map(row => row.building_id), [shed.id])

    await page.goto(base + '#/')
    await page.locator('.account-building-group').filter({ hasText: 'Garden shed' }).getByRole('button', { name: 'Open project Shed build', exact: true }).waitFor()
    await page.locator('.account-building-group').filter({ hasText: 'Main house' }).getByRole('button', { name: 'Open project Loft', exact: true }).waitFor()

    dialog = await create('Name only')
    await dialog.getByRole('button', { name: 'Create project', exact: true }).click()
    await page.getByRole('heading', { name: 'Name only', exact: true }).waitFor()
    assert.equal(state.scopes.filter(row => row.project_id === state.projects.at(-1).id).length, 0, 'Skipping links nothing')

    state.failLink = true
    dialog = await create('Fail case', 'Main house')
    await dialog.getByRole('button', { name: 'Create project', exact: true }).click()
    await dialog.getByRole('alert').getByText('“Fail case” was created.', { exact: true }).waitFor()
    await dialog.getByRole('alert').getByText(/Main house could not be linked: Only someone who can edit this building can link it to a project\./).waitFor()
    assert.equal(await dialog.getByRole('button', { name: 'Cancel', exact: true }).count(), 0, 'The created project is not cancelled away')
    await shot('new-project-link-failed')
    state.failLink = false
    await dialog.getByRole('button', { name: 'Try again', exact: true }).click()
    await page.getByRole('heading', { name: 'Fail case', exact: true }).waitFor()
    assert.equal(state.creates.filter(name => name === 'Fail case').length, 1, 'Retry links without creating the project again')
    assert.equal(state.scopes.filter(row => row.project_id === state.projects.at(-1).id && row.building_id === 'house').length, 1)
    assert.deepEqual(errors, [])
    await context.close()
  }
  console.log('Project rooms browser verification passed.')
} catch (error) {
  if (activePage && !activePage.isClosed()) {
    console.error('UI at failure: ' + (await activePage.locator('body').innerText()).slice(0, 6000))
    await activePage.screenshot({ path: 'test-results/project-rooms-failure.png', fullPage: true })
  }
  throw error
} finally {
  if (activePage && !activePage.isClosed()) await activePage.close().catch(() => {})
  if (browser) await browser.close().catch(() => {})
  server.kill('SIGTERM')
}
