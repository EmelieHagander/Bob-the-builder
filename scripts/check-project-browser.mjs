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
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
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
    const histories = new Map(['A', 'B'].map(id => [id, { thread: null, nextSeq: 1, messages: [] }]))
    let slow = deferred()
    let responseMode = 'success'
    const completedTurns = new Map()
    let writeCommits = 0
    const storeCompletedTurn = (body, response) => {
      const history = histories.get(body.projectId)
      assert(history)
      history.thread ??= `thread-${body.projectId}`
      history.messages.push({ role: 'user', text: body.message, turn_id: body.clientTurnId, evidence: null, delivery_state: 'completed', seq: history.nextSeq++ })
      history.messages.push({ role: 'assistant', text: response.summary, turn_id: body.clientTurnId, evidence: response.evidence, delivery_state: 'completed', seq: history.nextSeq++ })
    }
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
      if (new URL(route.request().url()).pathname === '/rest/v1/rpc/project_plan_read') return respond({json:{record:null}})
      if (url.pathname === '/auth/v1/token') return respond({ json: { access_token: token, refresh_token: 'fixture-refresh', token_type: 'bearer', expires_in: 3600, expires_at: expiresAt, user } })
      if (url.pathname === '/auth/v1/user') return respond({ json: user })
      if (url.pathname === '/auth/v1/logout') return respond({ json: {} })
      if (url.pathname === '/functions/v1/ask-bob') {
        assert.equal(request.headers().authorization, `Bearer ${token}`)
        const body = request.postDataJSON()
        assert.deepEqual(Object.keys(body).sort(), ['action', 'clientTurnId', 'message', 'projectId'])
        assert.equal(body.action, 'send')
        assert.match(body.clientTurnId, UUID, 'Bob turn id is a client UUID idempotency key')
        requests.push(body)
        const history = histories.get(body.projectId)
        if (history) history.thread ??= `thread-${body.projectId}`
        if (completedTurns.has(body.clientTurnId)) return respond({ json: completedTurns.get(body.clientTurnId) })
        if (body.message === 'Long conversation fixture') {
          const response = success(body.projectId, Array.from({ length: 18 }, (_, i) => `Build detail ${i + 1}: Check the position and record the result before the next step.`).join('\n\n'))
          storeCompletedTurn(body, response)
          return respond({ json: response })
        }
        if (body.message === 'Inspect project photo') {
          const response=success(body.projectId,'Project photo inspected.')
          response.evidence.sources=[{projectId:body.projectId,dataset:'image_pixels',recordId:'10000000-0000-4000-8000-000000000001',label:'Bild öppnad: Fönsteranslutning',retrievedAt:'2026-09-20T12:00:00Z',updatedAt:'2026-09-20T11:00:00Z',truth:'unknown'}]
          storeCompletedTurn(body,response)
          return respond({json:response})
        }
        if (body.message === 'Wrong receipt') {
          const response = success(body.projectId, 'FORGED SAVED ANSWER')
          response.evidence.writes = [{ projectId: 'B', dataset: 'tasks', recordId: 'foreign', label: 'FORGED SAVE', operation: 'created', savedAt: '2026-09-17T12:00:00Z' }]
          return respond({ json: response })
        }
        if (body.message === 'Save chosen plan') {
          const response = success(body.projectId, 'Saved chosen plan once.')
          response.evidence.writes = [{ projectId: body.projectId, dataset: 'tasks', recordId: 'new-task', label: 'Build 70 × 160 frame', operation: 'created', savedAt: '2026-09-17T12:00:00Z' }]
          writeCommits++
          completedTurns.set(body.clientTurnId, response)
          storeCompletedTurn(body, response)
          return route.abort('failed') // committed write; the first HTTP answer is lost
        }
        if (body.message === 'Slow question') {
          await slow.promise
          const response = success(body.projectId, 'OLD DELAYED ANSWER')
          storeCompletedTurn(body, response)
          return respond({ json: response })
        }
        if (responseMode === 'denied') return respond({ status: 403, json: { ok: false, error: 'project_denied' } })
        if (responseMode === 'unavailable') return respond({ status: 503, json: { ok: false, error: 'service_unavailable' } })
        if (responseMode === 'wrong-project') return respond({ json: success('B', 'WRONG PROJECT ANSWER') })
        const response = success(body.projectId, `Answer for Porch ${body.projectId}`)
        storeCompletedTurn(body, response)
        return respond({ json: response })
      }
      if (url.pathname === '/rest/v1/bob_threads') {
        const projectId = url.searchParams.get('project_id')?.replace(/^eq\./, '') ?? ''
        const owner = url.searchParams.get('owner_user_id')?.replace(/^eq\./, '') ?? ''
        const history = histories.get(projectId)
        const row = owner === user.id && history?.thread ? { id: history.thread } : null
        const single = (request.headers().accept ?? '').includes('application/vnd.pgrst.object+json')
        return respond({ json: single ? row : row ? [row] : [] })
      }
      if (url.pathname === '/rest/v1/bob_messages') {
        const threadId = url.searchParams.get('thread_id')?.replace(/^eq\./, '') ?? ''
        const history = [...histories.values()].find(item => item.thread === threadId)
        return respond({ json: history ? history.messages.filter(row => row.delivery_state === 'completed') : [] })
      }
      if (url.pathname === '/rest/v1/rpc/bob_job_status') return respond({ json: null })
      if (url.pathname === '/rest/v1/rpc/claim_project_invites') return respond({ json: 0 })
      if (url.pathname === '/rest/v1/rpc/project_invitations') return respond({ json: [] })
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
      await drawer.getByRole('button', { name: 'Send', exact: true }).waitFor({ state: 'visible' })
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
    await page.getByRole('button', { name: 'Continue as guest', exact: true }).click()
    await page.getByRole('heading', { name: 'Fixture account', exact: true }).waitFor()
    let drawer = await openBob('A')
    const editor = drawer.getByRole('textbox', { name: 'Question for bob' })
    assert.equal(await editor.evaluate(node => node.tagName), 'TEXTAREA')
    const shortHeight = (await editor.boundingBox()).height
    const longDraft = Array.from({ length: 14 }, (_, i) => `Rad ${i}: 70 × 160 cm, antaganden och mått.`).join('\n')
    await editor.fill(longDraft)
    await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))))
    assert((await editor.boundingBox()).height > shortHeight, 'Composer grows with multiline text')
    const beforeEnter = requests.length
    await editor.press('End'); await editor.press('Enter')
    assert.equal(requests.length, beforeEnter, 'Enter inserts a newline, never sends')
    assert((await editor.inputValue()).includes('\n'))
    const draftBeforeExpansion = await editor.inputValue()
    await drawer.getByRole('button', { name: 'Expand message editor', exact: true }).click()
    assert.equal(await editor.inputValue(), draftBeforeExpansion, 'Expansion preserves exact draft')
    assert((await editor.boundingBox()).height >= 200, 'Expanded editor has a real writing surface')
    await page.screenshot({ path: `test-results/ask-bob-editor-${viewport.width}.png`, fullPage: true })
    await drawer.getByRole('button', { name: 'Collapse message editor', exact: true }).click()
    assert.equal(await editor.inputValue(), draftBeforeExpansion, 'Collapse preserves exact draft')
    const density = drawer.getByRole('button', { name: 'Comfortable text spacing', exact: true })
    assert.equal(await density.getAttribute('aria-pressed'), 'false')
    await density.click()
    assert.equal(await density.getAttribute('aria-pressed'), 'true')
    assert.equal(await page.evaluate(() => localStorage.getItem('bob:chat-density')), 'comfortable')
    await density.click()
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
    assert.equal(await drawer.getByText("What's blocking us?", { exact: true }).count(), 0, 'Suggestion chips do not crowd an active conversation')
    await page.setViewportSize({ width: viewport.width, height: 480 })
    await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))))
    const sendBox = await drawer.getByRole('button', { name: 'Send', exact: true }).boundingBox()
    assert(sendBox && sendBox.y >= 0 && sendBox.y + sendBox.height <= 480, 'Send remains reachable with a contracted mobile viewport')
    await page.setViewportSize(viewport)


    for (const mode of ['unavailable', 'denied', 'wrong-project']) {
      responseMode = mode
      await send(`Check ${mode}`)
      await drawer.getByText('Bob is working on the project…', { exact: true }).waitFor({ state: 'hidden' })
      const message = mode === 'denied' ? 'I could not access this project. Your membership may have changed.' : 'I could not retrieve an answer for this project. Please try again.'
      await drawer.getByText(message, { exact: true }).last().waitFor()
      assert.equal(await drawer.getByText('WRONG PROJECT ANSWER', { exact: true }).count(), 0)
      assert.equal(await drawer.locator('summary').count(), 1, 'Failure must not introduce source evidence')
    }
    responseMode = 'success'
    await send('Slow question')
    await drawer.getByText('Bob is working on the project…', { exact: true }).waitFor()
    await drawer.getByRole('textbox', { name: 'Question for bob' }).fill('Unsent draft from A')
    drawer = await switchProject('B')
    assert.equal(await drawer.getByRole('textbox', { name: 'Question for bob' }).inputValue(), '')
    assert.equal(await drawer.locator('summary').count(), 0)
    assert.equal(await drawer.getByText('Answer for Porch A', { exact: true }).count(), 0)
    assert.equal(await drawer.getByText('Bob is working on the project…', { exact: true }).count(), 0)
    await send('Which boards?')
    await drawer.getByText('Answer for Porch B', { exact: true }).waitFor()
    assert.equal(requests.at(-1).projectId, 'B')
    await drawer.getByRole('textbox', { name: 'Question for bob' }).fill('Unsent draft from B')
    drawer = await switchProject('A')
    await drawer.getByText('Answer for Porch A', { exact: true }).waitFor()
    assert.equal(await drawer.getByRole('textbox', { name: 'Question for bob' }).inputValue(), '')
    assert.equal(await drawer.locator('summary').count(), 1, 'Project A restores its own server-synchronised source disclosure')
    assert.equal(await drawer.getByText('Answer for Porch B', { exact: true }).count(), 0, 'Project B history must not leak into project A')
    const lateResponse = page.waitForResponse(response => response.url() === `${api}/functions/v1/ask-bob` && response.request().postDataJSON().message === 'Slow question')
    slow.resolve()
    await (await lateResponse).finished()
    // Let the fetch continuation and React render complete before asserting absence.
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    assert.equal(await drawer.getByText('OLD DELAYED ANSWER', { exact: true }).count(), 0, 'A late A answer cannot render into a newly mounted drawer generation')
    await page.reload()
    drawer = await openBob('A')
    await drawer.getByText('Answer for Porch A', { exact: true }).waitFor()
    await drawer.getByText('OLD DELAYED ANSWER', { exact: true }).waitFor()
    assert.equal(await drawer.locator('summary').count(), 2, 'Reload restores the completed server transcript with evidence')
    assert.equal(await drawer.getByText('Answer for Porch B', { exact: true }).count(), 0, 'Reload keeps project histories isolated')

    await send('Wrong receipt')
    await drawer.getByText('I could not retrieve an answer for this project. Please try again.', { exact: true }).last().waitFor()
    assert.equal(await drawer.getByText('FORGED SAVED ANSWER', { exact: true }).count(), 0)
    assert.equal(await drawer.getByLabel('Saved project changes').count(), 0)

    await send('Save chosen plan')
    const writeTurnId = requests.at(-1).clientTurnId
    await drawer.getByText('Saved chosen plan once.', { exact: true }).waitFor()
    assert.equal(requests.at(-1).clientTurnId, writeTurnId)
    assert.equal(requests.filter(r => r.clientTurnId === writeTurnId).length, 1, 'Recover the committed answer without another model call')
    assert.equal(writeCommits, 1, 'Lost response must not lead to a second write')
    assert.equal(await drawer.getByLabel('Saved project changes').count(), 0, 'Save diagnostics are not rendered in live chat')
    assert(await drawer.evaluate(node => node.scrollWidth <= node.clientWidth + 1), 'Chat must fit a phone drawer')
    // Use actual long conversation content; scroll coverage must not depend on
    // bulky save diagnostics or transient error messages being present.
    await send('Long conversation fixture')
    await drawer.getByText('Build detail 18: Check the position and record the result before the next step.', { exact: true }).waitFor()
    while (await drawer.locator('details:not([open]) > summary').count()) await drawer.locator('details:not([open]) > summary').first().click()
    const history = drawer.locator('.bob-history')
    assert(await history.evaluate(node => node.scrollHeight - node.clientHeight > 100), 'Scroll fixture must exceed the jump threshold')
    await history.evaluate(node => { node.scrollTop = 0; node.dispatchEvent(new Event('scroll')) })
    await drawer.getByRole('button', { name: 'Jump to latest message', exact: true }).waitFor()
    assert.equal(await history.evaluate(node => node.scrollTop), 0, 'Reading older messages preserves position')
    await drawer.getByRole('button', { name: 'Jump to latest message', exact: true }).click()
    assert(await history.evaluate(node => node.scrollHeight - node.clientHeight - node.scrollTop < 100))
    await page.screenshot({ path: `test-results/ask-bob-writes-${viewport.width}.png`, fullPage: true })
    await page.getByRole('button', { name: 'Close Ask bob' }).click()
    await page.getByRole('button', { name: 'Ask bob', exact: true }).waitFor()
    drawer = await openBob('A')
    await drawer.getByText('Saved chosen plan once.', { exact: true }).waitFor()
    await page.reload()
    drawer = await openBob('A')
    await drawer.getByText('Saved chosen plan once.', { exact: true }).waitFor()

    // Production source disclosure and persistence; HTTP fixture, not vision proof.
    await send('Inspect project photo')
    await drawer.getByText('Project photo inspected.',{exact:true}).waitFor()
    await drawer.locator('details > summary').last().click()
    await drawer.getByText('Bild öppnad: Fönsteranslutning',{exact:true}).waitFor()
    await drawer.getByText('Bild öppnad: Fönsteranslutning',{exact:true}).scrollIntoViewIfNeeded()
    assert(await drawer.evaluate(node=>node.scrollWidth<=node.clientWidth+1),'Image evidence must fit the phone drawer')
    await page.screenshot({path:`test-results/ask-bob-images-${viewport.width}.png`,fullPage:true})
    await page.reload();drawer=await openBob('A')
    await drawer.getByText('Project photo inspected.',{exact:true}).waitFor()
    await drawer.locator('details > summary').last().click()
    await drawer.getByText('Bild öppnad: Fönsteranslutning',{exact:true}).waitFor()
    drawer=await switchProject('B')
    assert.equal(await drawer.getByText('Project photo inspected.',{exact:true}).count(),0)
    drawer=await switchProject('A')

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
    console.log(`Ask bob ${viewport.width}px: explicit project, server-synchronised per-project chat, sources, failures, A → B → A late response, draft reset, compact save feedback, lost-response recovery without resending and reload: OK`)
  }
} finally {
  if (browser) await browser.close()
  server.kill('SIGTERM')
}
