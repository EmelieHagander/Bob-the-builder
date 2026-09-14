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
    const areaPhase = new Map([['bedroom', 'complete'], ['office', 'build'], ['guestroom', 'design']])
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
      if (url.pathname === '/auth/v1/token') return respond({ json: { access_token: token, refresh_token: 'fixture-refresh', token_type: 'bearer', expires_in: 3600, expires_at: expiresAt, user } })
      if (url.pathname === '/auth/v1/user') return respond({ json: user })
      if (url.pathname === '/rest/v1/rpc/claim_project_invites') return respond({ json: 0 })
      if (url.pathname === '/rest/v1/rpc/project_invitations') return respond({ json: [] })
      if (url.pathname === '/rest/v1/rpc/join_project') return respond({ json: {} })
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
        return respond({ json: [project] })
      }
      if (url.pathname === '/rest/v1/account') return respond({ json: { id: 'account', name: 'Phase fixture', owner_name: '', email: '' } })
      if (url.pathname === '/rest/v1/account_notes') return respond({ json: [] })
      if (url.pathname === '/rest/v1/people') return respond({ json: [{ id: 'member', name: 'Fixture member', initials: 'FM', color: '#41513f', role: 'Organiser', diet: '', person_skills: [] }] })
      if (url.pathname === '/rest/v1/areas') {
        const phaseOnly = (url.searchParams.get('select') ?? '').replaceAll('%2C', ',') === 'id,phase'
        const rows = [
          { id: 'bedroom', slug: 'bedroom', name: 'Bedroom', description: 'Finished room', icon: 'bed', lead_id: 'member', assigned_pct: 100, materials_pct: 100, done_pct: 100, task_summary: '2 tasks · 2 done', phase: areaPhase.get('bedroom'), area_crew: [{ person_id: 'member' }], area_reference_images: [] },
          { id: 'office', slug: 'office', name: 'Office', description: 'Work underway', icon: 'hammer', lead_id: 'member', assigned_pct: 100, materials_pct: 75, done_pct: 50, task_summary: '4 tasks · 2 done', phase: areaPhase.get('office'), area_crew: [{ person_id: 'member' }], area_reference_images: [] },
          { id: 'guestroom', slug: 'guestroom', name: 'Guestroom', description: 'Still comparing solutions', icon: 'lamp', lead_id: 'member', assigned_pct: 0, materials_pct: 0, done_pct: 0, task_summary: 'No tasks yet', phase: areaPhase.get('guestroom'), area_crew: [{ person_id: 'member' }], area_reference_images: [] },
        ]
        return respond({ json: phaseOnly ? rows.map(({ id, phase }) => ({ id, phase })) : rows })
      }
      if (url.pathname === '/rest/v1/tasks') return respond({ json: [
        { id: 't1', area_id: 'bedroom', name: 'Finish trim', skill: 'novice', hours: '1h', status: 'done', materials: '0 / 0', task_assignees: [{ person_id: 'member' }], areas: { project_id: 'P' } },
        { id: 't2', area_id: 'office', name: 'Frame wall', skill: 'intermediate', hours: '4h', status: 'doing', materials: '1 / 2', task_assignees: [{ person_id: 'member' }], areas: { project_id: 'P' } },
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
    await page.getByRole('button', { name: 'Open', exact: true }).click()

    await page.getByRole('heading', { name: 'Renovate upstairs', exact: true }).waitFor()
    await page.getByLabel('Project phase: Build').waitFor()
    await page.getByText('1 Design · 1 Build · 1 Complete', { exact: false }).first().waitFor()
    await page.getByRole('link', { name: /Guestroom/ }).first().waitFor()
    assert.equal(await page.getByText('50% done', { exact: true }).count(), 1, 'Only Build Area should foreground build progress')
    assert.equal(await page.getByText('0% done', { exact: true }).count(), 0, 'Design Area must not show build completion as primary meaning')

    if (viewport.width < 860) {
      await page.getByRole('link', { name: 'Today', exact: true }).waitFor()
    }

    await page.getByRole('button', { name: 'Review phase', exact: true }).first().click()
    await page.getByLabel('Move to phase').selectOption('planning')
    await page.getByLabel('Reason for this change').fill('New evidence means we need to revisit planning')
    await page.getByRole('button', { name: 'Save phase', exact: true }).click()
    await page.getByLabel('Project phase: Planning').waitFor()
    await page.reload()
    await page.getByLabel('Project phase: Planning').waitFor()

    await page.getByRole('link', { name: 'Areas', exact: true }).first().click()
    await page.getByRole('heading', { name: 'Areas', exact: true }).waitFor()
    const guest = page.locator('article').filter({ hasText: 'Guestroom' })
    await guest.getByLabel('phase: Design').waitFor()
    await guest.getByRole('button', { name: 'Review phase', exact: true }).click()
    await page.getByLabel('Move to phase').selectOption('planning')
    await page.getByLabel('Reason for this change').fill('Target selected; ready to plan')
    await page.getByRole('button', { name: 'Save phase', exact: true }).click()
    await page.locator('article').filter({ hasText: 'Guestroom' }).getByLabel('phase: Planning').waitFor()

    assert(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), 'Phase UI must not overflow horizontally')
    await page.screenshot({ path: `test-results/project-phases-${viewport.width}.png`, fullPage: true })
    assert.deepEqual(errors, [], 'No runtime exceptions or unexpected API calls')
    await context.close()
    console.log(`Project phases ${viewport.width}px: mixed workstreams, explicit transitions, reload and mobile Today: OK`)
  }
} finally {
  if (browser) await browser.close()
  server.kill('SIGTERM')
}
