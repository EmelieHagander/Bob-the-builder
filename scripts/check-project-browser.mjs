// Run against the production build with CI's dummy live configuration. Only
// HTTP responses are fixtures: sign-in, navigation, database.ts and React are real.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright-core'

const base = 'http://127.0.0.1:4173/Bob-the-builder/'
const api = 'https://pwa-proof.invalid'
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--base', '/Bob-the-builder/', '--host', '127.0.0.1', '--port', '4173', '--strictPort'], { stdio: ['ignore', 'pipe', 'pipe'] })
let logs = ''
server.stdout.on('data', data => { logs += data })
server.stderr.on('data', data => { logs += data })
const projects = ['A', 'B'].map(id => ({ id, slug: id.toLowerCase(), name: `Porch ${id}`, description: '', location: '', type: 'Renovation', theme: 'birch', start_label: '', start_date: null, end_date: null }))
const user = { id: '00000000-0000-0000-0000-000000000003', email: 'fixture@example.test', aud: 'authenticated', role: 'authenticated', app_metadata: { provider: 'email' }, user_metadata: {}, created_at: '2026-09-09T00:00:00Z' }
const expiresAt = Math.floor(Date.now() / 1000) + 3600
const token = [JSON.stringify({ alg: 'HS256', typ: 'JWT' }), JSON.stringify({ sub: user.id, exp: expiresAt, role: 'authenticated' }), 'fixture-signature'].map(part => Buffer.from(part).toString('base64url')).join('.')
const success = (projectId, summary) => ({ ok: true, backend: 'openai', status: 'completed', projectId, summary, evidence: { kind: 'ai_assessment', partial: true, sources: [{ projectId, dataset: 'materials', recordId: `${projectId}_${'long-record-id-'.repeat(8)}`, label: `Boards for Porch ${projectId}`, retrievedAt: '2026-09-09T18:00:00Z', updatedAt: null, truth: 'unknown' }] } })
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }
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
    const context = await browser.newContext({ viewport, serviceWorkers: 'block' })
    const errors = []
    const requests = []
    let slow = deferred()
    let responseMode = 'success'
    await context.route('https://fonts.googleapis.com/**', route => route.abort())
    await context.route(`${api}/**`, async route => {
      const respond = options => route.fulfill({ ...options, headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info, x-supabase-api-version, accept-profile, content-profile',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      } })
      const request = route.request()
      const url = new URL(request.url())
      if (request.method() === 'OPTIONS') return respond({ status: 204 })
      if (url.pathname === '/auth/v1/token') return respond({ json: { access_token: token, refresh_token: 'fixture-refresh', token_type: 'bearer', expires_in: 3600, expires_at: expiresAt, user } })
      if (url.pathname === '/auth/v1/user') return respond({ json: user })
      if (url.pathname === '/auth/v1/logout') return respond({ json: {} })
      if (url.pathname === '/functions/v1/ask-bob') {
        assert.equal(request.headers().authorization, `Bearer ${token}`)
        const body = request.postDataJSON()
        assert.deepEqual(Object.keys(body).sort(), ['action', 'message', 'projectId'])
        assert.equal(body.action, 'send')
        requests.push(body)
        if (body.message === 'Slow question') {
          await slow.promise
          return respond({ json: success(body.projectId, 'OLD DELAYED ANSWER') })
        }
        if (responseMode === 'denied') return respond({ status: 403, json: { ok: false, error: 'project_denied' } })
        if (responseMode === 'unavailable') return respond({ status: 503, json: { ok: false, error: 'service_unavailable' } })
        if (responseMode === 'wrong-project') return respond({ json: success('B', 'WRONG PROJECT ANSWER') })
        return respond({ json: success(body.projectId, `Answer for Porch ${body.projectId}`) })
      }
      if (url.pathname === '/rest/v1/rpc/claim_project_invites') return respond({ json: 0 })
      if (url.pathname === '/rest/v1/projects') return respond({ json: projects })
      if (url.pathname === '/rest/v1/account') return respond({ json: { id: 'account', name: 'Fixture account', owner_name: '', email: '' } })
      if (url.pathname === '/rest/v1/people') {
        const pid = url.searchParams.get('project_id')?.replace('eq.', '') ?? 'A'
        return respond({ json: [{ id: `member${pid}`, name: 'Fixture member', initials: 'FM', color: '#41513f', role: 'Organiser', diet: '', person_skills: [] }] })
      }
      if (url.pathname.startsWith('/rest/v1/') && request.method() === 'GET') return respond({ json: [] })
      errors.push(`Unexpected request: ${request.method()} ${url.pathname}`)
      return respond({ status: 500, json: { error: 'unexpected_fixture_request' } })
    })
    const page = await context.newPage()
    page.setDefaultTimeout(12000)
    page.setDefaultNavigationTimeout(12000)
    page.on('pageerror', error => errors.push(error.message))
    const openBob = async id => {
      await page.getByRole('button', { name: 'Ask bob', exact: true }).click()
      const drawer = page.getByRole('complementary', { name: `Ask bob for Porch ${id}` })
      await drawer.waitFor()
      return drawer
    }
    const send = async text => {
      const arrival = page.waitForRequest(request => request.url() === `${api}/functions/v1/ask-bob` && request.method() === 'POST')
      await page.getByRole('textbox', { name: 'Question for bob' }).fill(text)
      await page.getByRole('button', { name: 'Send', exact: true }).click()
      return arrival
    }
    const switchProject = async id => {
      await page.getByRole('button', { name: 'Close Ask bob' }).click()
      await page.getByRole('link', { name: 'Account', exact: true }).click()
      await page.locator('.card').filter({ hasText: `Porch ${id}` }).getByRole('button', { name: 'Open', exact: true }).click()
      return openBob(id)
    }
    await page.goto(`${base}#/signin`)
    await page.getByRole('heading', { name: 'Sign in', exact: true }).waitFor()
    await page.getByPlaceholder('you@example.se').fill(user.email)
    await page.locator('input[type="password"]').fill('fixture-password')
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    await page.getByRole('heading', { name: 'Fixture account', exact: true }).waitFor()
    let drawer = await openBob('A')
    await send('Which boards?')
    await drawer.getByText('Answer for Porch A', { exact: true }).waitFor()
    assert.equal(requests.at(-1).projectId, 'A')
    await drawer.locator('summary').click()
    await drawer.getByText('Bob’s assessment', { exact: true }).waitFor()
    await drawer.getByText('Stored project information; measurements and specifications are not verified.', { exact: true }).waitFor()
    await drawer.getByText('Some results were limited or unavailable.', { exact: true }).waitFor()
    await drawer.getByText('Boards for Porch A', { exact: true }).waitFor()
    assert(await drawer.evaluate(node => node.scrollWidth <= node.clientWidth + 1), 'Drawer must not overflow horizontally with long source ids')
    for (const name of ['Close Ask bob', 'Send']) {
      const box = await drawer.getByRole('button', { name, exact: true }).boundingBox()
      assert(box && box.width >= 44 && box.height >= 44 && box.x >= 0 && box.x + box.width <= viewport.width && box.y >= 0 && box.y + box.height <= viewport.height, `${name} must be reachable with a 44px target`)
    }
    await page.screenshot({ path: `test-results/ask-bob-${viewport.width}.png`, fullPage: true })

    for (const mode of ['unavailable', 'denied', 'wrong-project']) {
      responseMode = mode
      await send(`Check ${mode}`)
      await drawer.getByText('Bob is checking the project…', { exact: true }).waitFor({ state: 'hidden' })
      const message = mode === 'denied' ? 'I could not access this project. Your membership may have changed.' : 'I could not retrieve an answer for this project. Please try again.'
      await drawer.getByText(message, { exact: true }).last().waitFor()
      assert.equal(await drawer.getByText('WRONG PROJECT ANSWER', { exact: true }).count(), 0)
      assert.equal(await drawer.locator('summary').count(), 1, 'Failure must not introduce source evidence')
    }
    responseMode = 'success'
    await send('Slow question')
    await drawer.getByText('Bob is checking the project…', { exact: true }).waitFor()
    await drawer.getByRole('textbox', { name: 'Question for bob' }).fill('Unsent draft from A')
    drawer = await switchProject('B')
    assert.equal(await drawer.getByRole('textbox', { name: 'Question for bob' }).inputValue(), '')
    assert.equal(await drawer.locator('summary').count(), 0)
    assert.equal(await drawer.getByText('Answer for Porch A', { exact: true }).count(), 0)
    assert.equal(await drawer.getByText('Bob is checking the project…', { exact: true }).count(), 0)
    await send('Which boards?')
    await drawer.getByText('Answer for Porch B', { exact: true }).waitFor()
    assert.equal(requests.at(-1).projectId, 'B')
    await drawer.getByRole('textbox', { name: 'Question for bob' }).fill('Unsent draft from B')
    drawer = await switchProject('A')
    const lateResponse = page.waitForResponse(response => response.url() === `${api}/functions/v1/ask-bob` && response.request().postDataJSON().message === 'Slow question')
    slow.resolve()
    await (await lateResponse).finished()
    // Let the fetch continuation and React render complete before asserting absence.
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    assert.equal(await drawer.getByRole('textbox', { name: 'Question for bob' }).inputValue(), '')
    assert.equal(await drawer.locator('summary').count(), 0)
    assert.equal(await drawer.getByText(/OLD DELAYED ANSWER|Answer for Porch [AB]/).count(), 0)
    await page.reload()
    drawer = await openBob('A')
    assert.equal(await drawer.locator('summary').count(), 0, 'Reload keeps project selection without reviving chat')

    if (viewport.width === 1280) {
      slow = deferred()
      await send('Slow question')
      await page.getByRole('button', { name: 'Close Ask bob' }).click()
      await page.getByRole('button', { name: 'Sign out', exact: true }).click()
      await page.getByRole('heading', { name: 'Sign in', exact: true }).waitFor()
      const signedOutResponse = page.waitForResponse(response => response.url() === `${api}/functions/v1/ask-bob`)
      slow.resolve()
      await (await signedOutResponse).finished()
      assert.equal(await page.getByText('OLD DELAYED ANSWER', { exact: true }).count(), 0)
      assert.equal(await page.getByRole('button', { name: 'Ask bob', exact: true }).count(), 0)
    }
    assert.deepEqual(errors, [], 'No runtime exceptions or unexpected API calls')
    await context.close()
    console.log(`Ask bob ${viewport.width}px: explicit project, sources, failures, A → B → A late response, draft reset and reload: OK`)
  }
} finally {
  if (browser) await browser.close()
  server.kill('SIGTERM')
}
