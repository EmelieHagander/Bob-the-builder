// Production React + database.ts + Supabase client; HTTP is fixture-only.
// SQL/RLS/authority are covered separately by tests/building-context.test.ts.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright-core'
import { createBuildingIntakeFixture, verifyBuildingIntakeBrowser } from './building-intake-browser.mjs'

const base = 'http://127.0.0.1:4173/Bob-the-builder/'
const api = 'https://pwa-proof.invalid'
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--base', '/Bob-the-builder/', '--host', '127.0.0.1', '--port', '4173', '--strictPort'], { stdio: ['ignore', 'pipe', 'pipe'] })
let logs = '', browser, activePage
server.stdout.on('data', chunk => { logs += chunk })
server.stderr.on('data', chunk => { logs += chunk })

const user = { id: '00000000-0000-0000-0000-000000000003', email: 'fixture@example.test', aud: 'authenticated', role: 'authenticated', app_metadata: { provider: 'email' }, user_metadata: {}, created_at: '2026-09-13T00:00:00Z' }
const projects = ['A', 'B'].map(id => ({ id, slug: id.toLowerCase(), name: 'Porch ' + id, description: '', location: '', type: 'Renovation', theme: 'birch', start_label: '', start_date: null, end_date: null }))
const expiry = Math.floor(Date.now() / 1000) + 3600
const token = [JSON.stringify({ alg: 'HS256', typ: 'JWT' }), JSON.stringify({ sub: user.id, exp: expiry, role: 'authenticated' }), 'fixture-signature'].map(part => Buffer.from(part).toString('base64url')).join('.')
const audit = { change_note: 'Manual browser fixture', actor_label: 'Fixture member', recorded_at: '2026-09-13T14:00:00.000Z', archived: false }
const eq = (url, key) => url.searchParams.get(key)?.replace(/^eq\./, '')

try {
  for (let tries = 0; ; tries++) {
    try { if ((await fetch(base)).ok) break } catch {}
    if (tries > 40) throw new Error('Preview did not start: ' + logs)
    await new Promise(resolve => setTimeout(resolve, 250))
  }

  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] })
  await mkdir('test-results', { recursive: true })

  for (const viewport of [{ width: 320, height: 740 }, { width: 390, height: 844 }, { width: 1280, height: 900 }]) {
    const state = { buildings: [], spaces: [], relationships: [], scopes: [], deny: false }
    const context = await browser.newContext({ viewport, serviceWorkers: 'block' })
    const errors = []
    const intake = createBuildingIntakeFixture(state, audit)

    await context.route('https://fonts.googleapis.com/**', route => route.abort())
    await context.route(api + '/**', async route => {
      const request = route.request(), url = new URL(request.url()), path = url.pathname, method = request.method()
      const respond = options => route.fulfill({ ...options, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS' } })
      if (method === 'OPTIONS') return respond({ status: 204 })
      if (new URL(route.request().url()).pathname === '/rest/v1/rpc/project_plan_read') return respond({json:{record:null}})
      if (path === '/auth/v1/token') return respond({ json: { access_token: token, refresh_token: 'fixture-refresh', token_type: 'bearer', expires_in: 3600, expires_at: expiry, user } })
      if (path === '/auth/v1/user') return respond({ json: user })
      if (path === '/auth/v1/logout') return respond({ json: {} })
      if (path.startsWith('/rest/')) assert.equal(request.headers().authorization, 'Bearer ' + token)

      if (path === '/rest/v1/rpc/claim_project_invites') return respond({ json: 0 })
      if (path === '/rest/v1/rpc/project_invitations') return respond({ json: [] })
      if (path === '/rest/v1/rpc/sharing_directory') return respond({ json: { households: [], friends: [] } })
      if (path === '/rest/v1/rpc/building_sharing_state') return respond({ json: {
        buildingId: request.postDataJSON().p_building, householdId: null, revision: 0, canManage: true, projects: [],
      } })
      if (path === '/rest/v1/projects') return respond({ json: projects })
      if (path === '/rest/v1/account') return respond({ json: { id: 'account', name: 'Fixture account', owner_name: '', email: '' } })
      if (path === '/rest/v1/people') return respond({ json: [{ id: 'memberA', name: 'Fixture member', initials: 'FM', color: '#41513f', role: 'Organiser', diet: '', person_skills: [] }] })
      if (path === '/rest/v1/account_notes' || path === '/rest/v1/areas' || path === '/rest/v1/tasks' || path === '/rest/v1/materials' || path === '/rest/v1/events' || path === '/rest/v1/announcements') return respond({ json: [] })

      if (await intake.handle(request, url, respond)) return

      if (path === '/rest/v1/current_sites') return respond({ json: [] })
      if (path === '/rest/v1/current_buildings') return respond({ json: state.buildings })
      if (path === '/rest/v1/project_buildings') {
        const projectId = eq(url, 'project_id')
        const linked = new Set(state.scopes.filter(scope => scope.project_id === projectId).map(scope => scope.building_id))
        return respond({ json: state.buildings.filter(row => linked.has(row.id)).map(row => ({ ...row, project_id: projectId })) })
      }
      if (path === '/rest/v1/current_levels' || path === '/rest/v1/current_elements') return respond({ json: [] })
      if (path === '/rest/v1/current_spaces') {
        if (state.deny) return respond({ status: 403, json: { message: 'building access denied' } })
        return respond({ json: state.spaces.filter(row => row.building_id === eq(url, 'building_id')) })
      }
      if (path === '/rest/v1/current_relationships') return respond({ json: state.relationships.filter(row => row.building_id === eq(url, 'building_id')) })
      if (path === '/rest/v1/building_members') return respond({ json: { building_id: eq(url, 'building_id') } })
      if (path === '/rest/v1/rpc/can_edit_building') return respond({ json: true })

      if (path === '/rest/v1/rpc/physical_building_command') {
        const { p_action, p_building, p_data: data } = request.postDataJSON()
        assert.equal(p_action, 'create')
        const row = { id: p_building, site_id: data.site_id ?? null, revision: 1, name: data.name, notes: data.notes ?? '', ...audit }
        state.buildings.push(row)
        return respond({ json: row })
      }
      if (path === '/rest/v1/rpc/physical_node_command') {
        const { p_building, p_kind, p_action, p_record, p_data: data } = request.postDataJSON()
        assert.equal(p_action, 'create')
        if (p_kind === 'space') {
          const row = { id: p_record, building_id: p_building, revision: 1, project_id: null, source_project_id: null, level_id: null, name: data.name, kind: data.kind ?? '', notes: data.notes ?? '', truth: data.truth, source: data.source ?? '', latest_revision: 1, has_proposal: false, ...audit }
          state.spaces.push(row)
          return respond({ json: row })
        }
        if (p_kind === 'relationship') {
          const row = { id: p_record, building_id: p_building, subject_space_id: data.subject_space_id, object_space_id: data.object_space_id, revision: 1, project_id: null, source_project_id: null, relation: data.relation, truth: data.truth, source: data.source ?? '', notes: data.notes ?? '', latest_revision: 1, has_proposal: false, ...audit }
          state.relationships.push(row)
          return respond({ json: row })
        }
      }
      if (path === '/rest/v1/rpc/physical_scope_command') {
        const { p_project, p_action, p_record, p_data: data } = request.postDataJSON()
        assert.equal(p_action, 'link')
        state.scopes.push({ id: p_record, project_id: p_project, building_id: data.building_id })
        return respond({ json: state.scopes.at(-1) })
      }

      if (path.startsWith('/rest/v1/') && method === 'GET') return respond({ json: [] })
      errors.push(method + ' ' + path)
      return respond({ status: 500, json: { message: 'Unexpected fixture request' } })
    })

    const page = await context.newPage()
    activePage = page
    page.setDefaultTimeout(15000)
    page.on('pageerror', error => errors.push(error.message))

    await page.goto(base + '#/signin')
    await page.getByPlaceholder('you@example.se').fill(user.email)
    await page.locator('input[type="password"]').fill('fixture-password')
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    await page.getByRole('heading', { name: 'Fixture account', exact: true }).waitFor()
    await page.locator('.card').filter({ hasText: 'Porch A' }).getByRole('button', { name: 'Open', exact: true }).click()
    await page.getByRole('link', { name: /Building & spaces/ }).click()
    await page.getByRole('heading', { name: 'Building & spaces', exact: true }).waitFor()

    await page.getByRole('button', { name: 'Add building', exact: true }).click()
    let modal = page.getByRole('dialog', { name: 'Add building', exact: true })
    await modal.getByLabel('Name', { exact: true }).fill('Main house')
    await modal.getByRole('button', { name: 'Save', exact: true }).click()
    await modal.waitFor({ state: 'hidden' })

    await page.getByRole('button', { name: 'Add space', exact: true }).click()
    modal = page.getByRole('dialog', { name: 'Add space', exact: true })
    await modal.getByLabel('Space name', { exact: true }).fill('Kids room')
    await modal.getByLabel('Kind', { exact: true }).fill('Bedroom')
    await modal.getByRole('button', { name: 'Save', exact: true }).click()
    await modal.waitFor({ state: 'hidden' })
    await page.getByText('Kids room', { exact: true }).waitFor()

    await page.getByRole('button', { name: 'Use in this project', exact: true }).click()
    modal = page.getByRole('dialog', { name: 'Use building in project', exact: true })
    await modal.getByRole('button', { name: 'Use this building', exact: true }).click()
    await modal.waitFor({ state: 'hidden' })
    await page.reload()
    await page.getByText('Used by this project', { exact: true }).waitFor()
    await page.getByText('Kids room', { exact: true }).waitFor()

    await page.getByRole('button', { name: 'Add space', exact: true }).click()
    modal = page.getByRole('dialog', { name: 'Add space', exact: true })
    await modal.getByLabel('Space name', { exact: true }).fill('Landing')
    await modal.getByRole('button', { name: 'Save', exact: true }).click()
    await modal.waitFor({ state: 'hidden' })
    await page.getByRole('button', { name: 'Add relationship', exact: true }).click()
    modal = page.getByRole('dialog', { name: 'Add spatial relationship', exact: true })
    await modal.getByLabel('First space').selectOption({ label: 'Kids room' })
    await modal.getByLabel('Second space').selectOption({ label: 'Landing' })
    await modal.getByRole('button', { name: 'Save', exact: true }).click()
    await modal.waitFor({ state: 'hidden' })
    await page.getByText(/Kids room adjacent to Landing/).waitFor()

    await page.getByRole('button', { name: 'Add building', exact: true }).click()
    modal = page.getByRole('dialog', { name: 'Add building', exact: true })
    await modal.getByLabel('Name', { exact: true }).fill('Garden shed')
    await modal.getByRole('button', { name: 'Save', exact: true }).click()
    await modal.waitFor({ state: 'hidden' })
    await page.getByText('No spaces yet. Add only the room or space you know about.', { exact: true }).waitFor()
    assert.equal(await page.getByText('Kids room', { exact: true }).count(), 0)

    const picker = page.locator('.building-context-editor > .foundation-actions select')
    await picker.selectOption({ label: 'Main house' })
    await page.getByText('Kids room', { exact: true }).first().waitFor()

    await verifyBuildingIntakeBrowser(page, base, intake, state, viewport.width)

    await page.goto(base + '#/account')
    await page.locator('.card').filter({ hasText: 'Porch B' }).getByRole('button', { name: 'Open', exact: true }).click()
    await page.getByRole('link', { name: /Building & spaces/ }).click()
    await page.getByText('Not linked to this project', { exact: true }).waitFor()
    state.deny = true
    await page.reload()
    await page.getByRole('heading', { name: /You can’t view Main house/ }).waitFor()
    assert.equal(await page.getByText('Kids room', { exact: true }).count(), 0)
    assert.equal(await page.getByText('No spaces yet. Add only the room or space you know about.', { exact: true }).count(), 0)
    assert.deepEqual(errors, [])

    await page.screenshot({ path: `test-results/building-context-${viewport.width}.png`, fullPage: true })
    await context.close()
  }

  console.log('Building context browser verification passed.')
} catch (error) {
  if (activePage && !activePage.isClosed()) {
    console.error('Building UI at failure: ' + (await activePage.locator('body').innerText()).slice(0, 9000))
    await activePage.screenshot({ path: 'test-results/building-intake-failure.png', fullPage: true })
  }
  throw error
} finally {
  if (activePage && !activePage.isClosed()) await activePage.close().catch(() => {})
  if (browser) await browser.close().catch(() => {})
  server.kill('SIGTERM')
}
