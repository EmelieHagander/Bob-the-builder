// Production React + database.ts + Supabase client; only HTTP services are fixtures.
// The real SQL/RLS building-context contract is covered by tests/building-context.test.ts.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright-core'

const base = 'http://127.0.0.1:4173/Bob-the-builder/'
const api = 'https://pwa-proof.invalid'
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--base', '/Bob-the-builder/', '--host', '127.0.0.1', '--port', '4173', '--strictPort'], { stdio: ['ignore', 'pipe', 'pipe'] })
let logs = '', browser, activePage
server.stdout.on('data', data => { logs += data })
server.stderr.on('data', data => { logs += data })

const projects = ['A', 'B'].map(id => ({
  id,
  slug: id.toLowerCase(),
  name: 'Porch ' + id,
  description: '',
  location: '',
  type: 'Renovation',
  theme: 'birch',
  start_label: '',
  start_date: null,
  end_date: null,
}))
const user = {
  id: '00000000-0000-0000-0000-000000000003',
  email: 'fixture@example.test',
  aud: 'authenticated',
  role: 'authenticated',
  app_metadata: { provider: 'email' },
  user_metadata: {},
  created_at: '2026-09-13T00:00:00Z',
}
const person = { id: 'memberA', name: 'Fixture member', initials: 'FM', color: '#41513f', role: 'Organiser', diet: '', person_skills: [] }
const expiry = Math.floor(Date.now() / 1000) + 3600
const token = [JSON.stringify({ alg: 'HS256', typ: 'JWT' }), JSON.stringify({ sub: user.id, exp: expiry, role: 'authenticated' }), 'fixture-signature']
  .map(part => Buffer.from(part).toString('base64url')).join('.')
const now = () => '2026-09-13T14:00:00.000Z'
const audit = () => ({ change_note: 'Manual browser fixture', actor_label: 'Fixture member', recorded_at: now(), archived: false })
const eq = (url, key) => url.searchParams.get(key)?.replace(/^eq\./, '')

try {
  for (let tries = 0; ; tries++) {
    try { if ((await fetch(base)).ok) break } catch {}
    if (tries > 40) throw new Error('Preview did not start: ' + logs)
    await new Promise(resolve => setTimeout(resolve, 250))
  }

  browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--no-sandbox'],
  })
  await mkdir('test-results', { recursive: true })

  for (const viewport of [{ width: 320, height: 740 }, { width: 390, height: 844 }, { width: 1280, height: 900 }]) {
    const context = await browser.newContext({ viewport, serviceWorkers: 'block' })
    const errors = []
    const sites = []
    const buildings = []
    const levels = []
    const spaces = []
    const elements = []
    const relationships = []
    const projectScopes = []
    let denyDetails = false

    await context.route('https://fonts.googleapis.com/**', route => route.abort())
    await context.route(api + '/**', async route => {
      const request = route.request()
      const url = new URL(request.url())
      const path = url.pathname
      const method = request.method()
      const respond = options => route.fulfill({ ...options, headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': '*',
        'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
      } })

      if (method === 'OPTIONS') return respond({ status: 204 })
      if (path === '/auth/v1/token') return respond({ json: { access_token: token, refresh_token: 'fixture-refresh', token_type: 'bearer', expires_in: 3600, expires_at: expiry, user } })
      if (path === '/auth/v1/user') return respond({ json: user })
      if (path === '/auth/v1/logout') return respond({ json: {} })
      if (path.startsWith('/rest/')) assert.equal(request.headers().authorization, 'Bearer ' + token)

      if (path === '/rest/v1/rpc/claim_project_invites') return respond({ json: 0 })
      if (path === '/rest/v1/projects') return respond({ json: projects })
      if (path === '/rest/v1/account') return respond({ json: { id: 'account', name: 'Fixture account', owner_name: '', email: '' } })
      if (path === '/rest/v1/account_notes') return respond({ json: [] })
      if (path === '/rest/v1/people') return respond({ json: [person] })
      if (path === '/rest/v1/areas' || path === '/rest/v1/tasks' || path === '/rest/v1/materials' || path === '/rest/v1/events' || path === '/rest/v1/announcements') return respond({ json: [] })

      if (path === '/rest/v1/current_sites') return respond({ json: sites })
      if (path === '/rest/v1/current_buildings') return respond({ json: buildings })
      if (path === '/rest/v1/project_buildings') {
        const projectId = eq(url, 'project_id')
        const linked = new Set(projectScopes.filter(scope => scope.project_id === projectId && scope.target_kind === 'building').map(scope => scope.building_id))
        return respond({ json: buildings.filter(building => linked.has(building.id)).map(building => ({ ...building, project_id: projectId })) })
      }
      if (path === '/rest/v1/current_levels') return respond({ json: levels.filter(level => level.building_id === eq(url, 'building_id')) })
      if (path === '/rest/v1/current_spaces') {
        if (denyDetails) return respond({ status: 403, json: { message: 'building access denied' } })
        return respond({ json: spaces.filter(space => space.building_id === eq(url, 'building_id')) })
      }
      if (path === '/rest/v1/current_elements') return respond({ json: elements.filter(element => element.building_id === eq(url, 'building_id')) })
      if (path === '/rest/v1/current_relationships') return respond({ json: relationships.filter(relation => relation.building_id === eq(url, 'building_id')) })
      if (path === '/rest/v1/building_members') return respond({ json: { building_id: eq(url, 'building_id') } })

      if (path === '/rest/v1/rpc/physical_site_command') {
        const { p_action, p_site, p_data: data } = request.postDataJSON()
        assert.equal(p_action, 'create')
        const row = { id: p_site, revision: 1, name: data.name, notes: data.notes ?? '', ...audit() }
        sites.push(row)
        return respond({ json: row })
      }
      if (path === '/rest/v1/rpc/physical_building_command') {
        const { p_action, p_building, p_data: data } = request.postDataJSON()
        assert.equal(p_action, 'create')
        const row = { id: p_building, site_id: data.site_id ?? null, revision: 1, name: data.name, notes: data.notes ?? '', ...audit() }
        buildings.push(row)
        return respond({ json: row })
      }
      if (path === '/rest/v1/rpc/physical_node_command') {
        const { p_building, p_kind, p_action, p_record, p_data: data } = request.postDataJSON()
        assert.equal(p_action, 'create')
        if (p_kind === 'space') {
          const row = {
            id: p_record,
            building_id: p_building,
            revision: 1,
            project_id: null,
            source_project_id: null,
            level_id: data.level_id ?? null,
            name: data.name,
            kind: data.kind ?? '',
            notes: data.notes ?? '',
            truth: data.truth,
            source: data.source ?? '',
            latest_revision: 1,
            has_proposal: false,
            ...audit(),
          }
          spaces.push(row)
          return respond({ json: row })
        }
        if (p_kind === 'relationship') {
          const row = {
            id: p_record,
            building_id: p_building,
            subject_space_id: data.subject_space_id,
            object_space_id: data.object_space_id,
            revision: 1,
            project_id: null,
            source_project_id: null,
            relation: data.relation,
            truth: data.truth,
            source: data.source ?? '',
            notes: data.notes ?? '',
            latest_revision: 1,
            has_proposal: false,
            ...audit(),
          }
          relationships.push(row)
          return respond({ json: row })
        }
        if (p_kind === 'level') {
          const row = { id: p_record, building_id: p_building, revision: 1, name: data.name, position: data.position ?? 0, notes: data.notes ?? '', ...audit() }
          levels.push(row)
          return respond({ json: row })
        }
        if (p_kind === 'element') {
          const row = {
            id: p_record,
            building_id: p_building,
            revision: 1,
            project_id: null,
            source_project_id: null,
            space_id: data.space_id ?? null,
            kind: data.kind,
            name: data.name,
            description: data.description ?? '',
            truth: data.truth,
            source: data.source ?? '',
            latest_revision: 1,
            has_proposal: false,
            ...audit(),
          }
          elements.push(row)
          return respond({ json: row })
        }
      }
      if (path === '/rest/v1/rpc/physical_scope_command') {
        const { p_project, p_kind, p_action, p_record, p_data: data } = request.postDataJSON()
        assert.equal(p_kind, 'project')
        assert.equal(p_action, 'link')
        projectScopes.push({ id: p_record, project_id: p_project, target_kind: data.target_kind, building_id: data.building_id })
        return respond({ json: projectScopes.at(-1) })
      }

      if (path.startsWith('/rest/v1/') && method === 'GET') return respond({ json: [] })
      errors.push('Unexpected request: ' + method + ' ' + path)
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
    await page.getByText('No building recorded yet', { exact: true }).waitFor()

    await page.getByRole('button', { name: 'Add building', exact: true }).click()
    let modal = page.getByRole('dialog', { name: 'Add building', exact: true })
    await modal.getByLabel('Name', { exact: true }).fill('Main house')
    await modal.getByRole('button', { name: 'Save', exact: true }).click()
    await modal.waitFor({ state: 'hidden' })
    await page.getByRole('heading', { name: 'Main house', exact: true }).waitFor()

    await page.getByRole('button', { name: 'Add space', exact: true }).click()
    modal = page.getByRole('dialog', { name: 'Add space', exact: true })
    await modal.getByLabel('Space name', { exact: true }).fill('Kids room')
    await modal.getByLabel('Kind', { exact: true }).fill('Bedroom')
    await modal.getByRole('button', { name: 'Save', exact: true }).click()
    await modal.waitFor({ state: 'hidden' })
    await page.getByText('Kids room', { exact: true }).waitFor()
    await page.getByText('Unknown', { exact: true }).waitFor()

    await page.getByRole('button', { name: 'Use in this project', exact: true }).click()
    modal = page.getByRole('dialog', { name: 'Use building in project', exact: true })
    await modal.getByRole('button', { name: 'Use this building', exact: true }).click()
    await modal.waitFor({ state: 'hidden' })
    await page.getByText('Used by this project', { exact: true }).waitFor()

    await page.reload()
    await page.getByText('Kids room', { exact: true }).waitFor()
    await page.getByText('Used by this project', { exact: true }).waitFor()

    await page.getByRole('button', { name: 'Add space', exact: true }).click()
    modal = page.getByRole('dialog', { name: 'Add space', exact: true })
    await modal.getByLabel('Space name', { exact: true }).fill('Landing')
    await modal.getByLabel('Kind', { exact: true }).fill('Hall')
    await modal.getByRole('button', { name: 'Save', exact: true }).click()
    await modal.waitFor({ state: 'hidden' })
    await page.getByText('Landing', { exact: true }).waitFor()

    await page.getByRole('button', { name: 'Add relationship', exact: true }).click()
    modal = page.getByRole('dialog', { name: 'Add spatial relationship', exact: true })
    await modal.getByLabel('First space', { exact: true }).selectOption({ label: 'Kids room' })
    await modal.getByLabel('Relationship', { exact: true }).selectOption('adjacent_to')
    await modal.getByLabel('Second space', { exact: true }).selectOption({ label: 'Landing' })
    await modal.getByRole('button', { name: 'Save', exact: true }).click()
    await modal.waitFor({ state: 'hidden' })
    await page.getByText(/Kids room adjacent to Landing/).waitFor()

    await page.getByRole('button', { name: 'Add building', exact: true }).click()
    modal = page.getByRole('dialog', { name: 'Add building', exact: true })
    await modal.getByLabel('Name', { exact: true }).fill('Garden shed')
    await modal.getByRole('button', { name: 'Save', exact: true }).click()
    await modal.waitFor({ state: 'hidden' })
    await page.getByRole('heading', { name: 'Garden shed', exact: true }).waitFor()
    await page.getByText('No spaces yet. Add only the room or space you know about.', { exact: true }).waitFor()
    assert.equal(await page.getByText('Kids room', { exact: true }).count(), 0, 'Spaces from another building must not remain visible after a building switch')

    const buildingPicker = page.locator('.building-context-editor > .foundation-actions select')
    await buildingPicker.selectOption({ label: 'Main house' })
    await page.getByText('Kids room', { exact: true }).waitFor()

    await page.goto(base + '#/account')
    await page.getByRole('heading', { name: 'Fixture account', exact: true }).waitFor()
    await page.locator('.card').filter({ hasText: 'Porch B' }).getByRole('button', { name: 'Open', exact: true }).click()
    await page.getByRole('link', { name: /Building & spaces/ }).click()
    await page.getByRole('heading', { name: 'Building & spaces', exact: true }).waitFor()
    await page.getByText('Not linked to this project', { exact: true }).waitFor()

    denyDetails = true
    await page.reload()
    await page.getByRole('heading', { name: /You can’t view Main house/ }).waitFor()
    assert.equal(await page.getByText('No spaces yet. Add only the room or space you know about.', { exact: true }).count(), 0, 'Denied physical details must not be rendered as an empty building')
    assert.equal(await page.getByText('Kids room', { exact: true }).count(), 0, 'Denied physical details must not leak stale room content')

    assert.deepEqual(errors, [])
    await page.screenshot({ path: `test-results/building-context-${viewport.width}.png`, fullPage: true })
    await context.close()
  }

  console.log('Building context browser verification passed.')
} finally {
  if (activePage && !activePage.isClosed()) await activePage.close().catch(() => {})
  if (browser) await browser.close().catch(() => {})
  server.kill('SIGTERM')
}
