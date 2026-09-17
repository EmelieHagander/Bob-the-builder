// Drive the real built drawer/data seam; only HTTP is a fixture. Database/cursor
// deletion and authority are independently covered by bob-reset.test.ts.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright-core'

const base = 'http://127.0.0.1:4181/Bob-the-builder/'
const api = 'https://pwa-proof.invalid'
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--base', '/Bob-the-builder/', '--host', '127.0.0.1', '--port', '4181', '--strictPort'], { stdio: 'ignore' })
const user = { id: '00000000-0000-0000-0000-000000000003', email: 'reset@example.test', aud: 'authenticated', role: 'authenticated', app_metadata: { provider: 'email' }, user_metadata: {}, created_at: '2026-09-17T00:00:00Z' }
const expiresAt = Math.floor(Date.now() / 1000) + 3600
const token = [JSON.stringify({ alg: 'HS256', typ: 'JWT' }), JSON.stringify({ sub: user.id, exp: expiresAt, role: 'authenticated' }), 'fixture'].map(p => Buffer.from(p).toString('base64url')).join('.')
const projects = ['A', 'B'].map(id => ({ id, slug: id.toLowerCase(), name: `Reset project ${id}`, description: 'Keep project data', theme: 'birch', phase: 'concept', location: '', type: 'Renovation', start_label: '', start_date: null, end_date: null }))
const cache = id => `bob:ask-bob-history:v1:${id}:member${id}`
let browser
try {
  for (let n = 0; ; n++) {
    try { if ((await fetch(base)).ok) break } catch { /* starting */ }
    assert(n < 40 && server.exitCode === null, 'Preview failed to start')
    await new Promise(r => setTimeout(r, 250))
  }
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
  await mkdir('test-results', { recursive: true })
  for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 844 }, { width: 1280, height: 900 }]) {
    const context = await browser.newContext({ viewport, serviceWorkers: 'block' })
    const histories = new Map(['A', 'B'].map(id => [id, { id: crypto.randomUUID(), next_seq: 3, messages: [{ role: 'user', text: `OLD CHAT ${id}`, delivery_state: 'completed', seq: 1 }, { role: 'assistant', text: `OLD ANSWER ${id}`, delivery_state: 'completed', seq: 2 }] }]))
    const errors = []
    let resetMode = 'success', authMode = 'member', resetCalls = 0
    let releaseReset
    await context.route('https://fonts.googleapis.com/**', route => route.abort())
    await context.route(`${api}/**`, async route => {
      const req = route.request(), url = new URL(req.url())
      const respond = options => route.fulfill({ ...options, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info, x-supabase-api-version, accept-profile, content-profile', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' } })
      const who = { ...user, email: authMode === 'guest' ? 'guest@bob.local' : user.email }
      if (req.method() === 'OPTIONS') return respond({ status: 204 })
      if (url.pathname === '/auth/v1/token') return respond({ json: { access_token: token, refresh_token: 'fixture', token_type: 'bearer', expires_in: 3600, expires_at: expiresAt, user: who } })
      if (url.pathname === '/auth/v1/user') return authMode === 'failure' ? respond({ status: 503, json: { message: 'Offline fixture' } }) : respond({ json: who })
      if (url.pathname === '/rest/v1/rpc/claim_project_invites') return respond({ json: 0 })
      if (url.pathname === '/rest/v1/rpc/project_invitations') return respond({ json: [] })
      if (url.pathname === '/rest/v1/projects') return respond({ json: projects })
      if (url.pathname === '/rest/v1/account') return respond({ json: { id: 'account', name: 'Reset fixture', owner_name: '', email: '' } })
      if (url.pathname === '/rest/v1/people') {
        const id = url.searchParams.get('project_id')?.replace('eq.', '') ?? 'A'
        return respond({ json: [{ id: `member${id}`, name: 'Fixture member', initials: 'FM', color: '#41513f', role: 'Organiser', diet: '', person_skills: [] }] })
      }
      if (url.pathname === '/rest/v1/bob_threads') {
        const h = histories.get(url.searchParams.get('project_id')?.replace('eq.', ''))
        const row = h?.id ? { id: h.id, next_seq: h.next_seq } : null
        return respond({ json: (req.headers().accept ?? '').includes('application/vnd.pgrst.object+json') ? row : row ? [row] : [] })
      }
      if (url.pathname === '/rest/v1/bob_messages') {
        const h = [...histories.values()].find(h => h.id === url.searchParams.get('thread_id')?.replace('eq.', ''))
        return respond({ json: h?.messages ?? [] })
      }
      if (url.pathname === '/rest/v1/rpc/bob_reset_conversation') {
        resetCalls++
        const body = req.postDataJSON()
        assert.deepEqual(Object.keys(body).sort(), ['p_expected_next_seq', 'p_expected_thread', 'p_project'])
        assert.equal(req.headers().authorization, `Bearer ${token}`)
        assert.notEqual(authMode, 'guest', 'shared guest must never reset server conversations')
        const h = histories.get(body.p_project)
        assert(h)
        assert.equal(body.p_expected_thread, h.id)
        assert.equal(body.p_expected_next_seq, h.id ? h.next_seq : null)
        if (resetMode === 'unavailable') return respond({ status: 503, json: { message: 'Unavailable' } })
        if (resetMode === 'denied') return respond({ status: 403, json: { code: '42501', message: 'project_denied' } })
        if (resetMode === 'busy') return respond({ status: 409, json: { code: '55000', message: 'turn_in_flight' } })
        if (resetMode === 'changed') return respond({ status: 409, json: { code: '40001', message: 'conversation_changed' } })
        if (resetMode === 'delayed') await new Promise(resolve => { releaseReset = resolve })
        h.id = null; h.next_seq = 1; h.messages = []
        return respond({ json: { status: 'cleared', mode: 'server', projectId: body.p_project } })
      }
      if (url.pathname === '/functions/v1/ask-bob') {
        const body = req.postDataJSON(), h = histories.get(body.projectId)
        h.id ??= crypto.randomUUID()
        const response = { ok: true, status: 'completed', projectId: body.projectId, summary: 'FRESH ANSWER', evidence: { kind: 'ai_assessment', sources: [], partial: false } }
        h.messages.push({ role: 'user', text: body.message, delivery_state: 'completed', seq: h.next_seq++ }, { role: 'assistant', text: response.summary, evidence: response.evidence, delivery_state: 'completed', seq: h.next_seq++ })
        return respond({ json: response })
      }
      if (url.pathname.startsWith('/rest/v1/') && req.method() === 'GET') return respond({ json: [] })
      errors.push(`${req.method()} ${url.pathname}`)
      return respond({ status: 500, json: { error: 'Unexpected request' } })
    })
    const page = await context.newPage()
    page.setDefaultTimeout(12000)
    page.on('pageerror', e => errors.push(e.message))
    const open = async (p = page, id = 'A') => {
      await p.getByRole('button', { name: 'Ask bob', exact: true }).click()
      const drawer = p.getByRole('complementary', { name: `Ask bob for Reset project ${id}` })
      await drawer.getByRole('button', { name: 'New conversation', exact: true }).waitFor()
      await drawer.evaluate(async el => { await Promise.all(el.getAnimations().map(animation => animation.finished)) })
      return drawer
    }
    const confirm = async (p = page) => {
      await p.getByRole('button', { name: 'New conversation', exact: true }).click()
      const dialog = p.getByRole('dialog', { name: 'Start a new conversation?' })
      await dialog.getByText('Saved project data and other people’s chats stay unchanged.').waitFor()
      return dialog
    }
    await page.goto(`${base}#/signin`)
    await page.getByRole('button', { name: 'Continue as guest', exact: true }).click()
    await page.getByRole('heading', { name: 'Reset fixture', exact: true }).waitFor()
    let drawer = await open()
    await drawer.getByText('OLD ANSWER A', { exact: true }).waitFor()
    const box = await drawer.getByRole('button', { name: 'New conversation', exact: true }).boundingBox()
    assert(box && box.height >= 43.99 && box.width >= 44 && box.x >= 0 && box.x + box.width <= viewport.width, JSON.stringify({ box, viewport }))
    await drawer.getByRole('textbox').fill('KEEP DRAFT')
    let dialog = await confirm()
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    assert.equal(resetCalls, 0)
    assert.equal(await drawer.getByRole('textbox').inputValue(), 'KEEP DRAFT')
    for (const mode of ['unavailable', 'denied', 'busy', 'changed']) {
      resetMode = mode
      dialog = await confirm()
      await dialog.getByRole('button', { name: 'Clear chat and context', exact: true }).click()
      await dialog.getByRole('alert').waitFor()
      assert.equal(await drawer.getByText('OLD ANSWER A', { exact: true }).count(), 1)
      assert.equal(await drawer.getByRole('textbox').inputValue(), 'KEEP DRAFT')
      await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    }
    await page.evaluate(({ a, b }) => { localStorage.setItem(a, JSON.stringify([{ from: 'user', text: 'STALE LOCAL A' }])); localStorage.setItem(b, 'KEEP B CACHE') }, { a: cache('A'), b: cache('B') })
    resetMode = 'delayed'
    dialog = await confirm()
    await dialog.evaluate(async el => { await Promise.all(el.getAnimations().map(animation => animation.finished)) })
    await page.screenshot({ path: `test-results/bob-reset-confirm-${viewport.width}.png` })
    const arrived = page.waitForRequest(r => r.url().endsWith('/rpc/bob_reset_conversation') && r.method() === 'POST')
    await dialog.getByRole('button', { name: 'Clear chat and context', exact: true }).click()
    await arrived
    await dialog.getByRole('button', { name: 'Clearing…', exact: true }).waitFor()
    assert(await dialog.getByRole('button', { name: 'Clearing…', exact: true }).isDisabled())
    assert.equal(await drawer.getByText('OLD ANSWER A', { exact: true }).count(), 1, 'no optimistic clear')
    releaseReset()
    await drawer.getByText('New conversation started. Saved project data is unchanged.', { exact: true }).waitFor()
    assert.equal(await drawer.getByText('OLD ANSWER A', { exact: true }).count(), 0)
    assert.equal(await drawer.getByRole('textbox').inputValue(), '')
    assert.deepEqual(await page.evaluate(({ a, b }) => [localStorage.getItem(a), localStorage.getItem(b)], { a: cache('A'), b: cache('B') }), [null, 'KEEP B CACHE'])
    assert.equal(histories.get('B').messages.length, 2)
    await page.reload(); drawer = await open()
    await drawer.getByRole('textbox').fill('New question')
    await drawer.getByRole('button', { name: 'Send', exact: true }).click()
    await drawer.getByText('FRESH ANSWER', { exact: true }).waitFor()
    assert.equal(await drawer.getByText('OLD ANSWER A', { exact: true }).count(), 0)
    assert.equal(histories.get('A').messages.length, 2)
    resetMode = 'success'
    // Actual second-tab reset broadcasts to the already-open first drawer.
    const other = await context.newPage()
    other.setDefaultTimeout(12000)
    other.on('pageerror', e => errors.push(e.message))
    await other.goto(base); const otherDrawer = await open(other)
    await otherDrawer.getByText('FRESH ANSWER', { exact: true }).waitFor()
    // Session restoration in a new tab legitimately closes existing auth-scoped
    // drawers. Reopen after that event, then exercise two genuinely open drawers.
    if (!await drawer.isVisible()) drawer = await open(page)
    await drawer.getByText('FRESH ANSWER', { exact: true }).waitFor()
    assert(await otherDrawer.isVisible(), 'Both drawers must be open before the reset')
    const otherDialog = await confirm(other)
    await otherDialog.getByRole('button', { name: 'Clear chat and context', exact: true }).click()
    try {
      await otherDrawer.getByText('New conversation started. Saved project data is unchanged.', { exact: true }).waitFor()
      await drawer.getByText('This conversation was cleared in another tab. Saved project data is unchanged.', { exact: true }).waitFor()
    } catch (error) {
      // Fixture-only diagnostics: never capture real users or authentication tokens.
      for (const [label, p] of [['first', page], ['second', other]]) {
        const state = await p.evaluate(() => ({
          text: document.body.innerText,
          chatStorage: Object.fromEntries(Object.keys(localStorage).filter(key => key.startsWith('bob:ask-bob-history:')).map(key => [key, localStorage.getItem(key)])),
        }))
        console.log(`Cross-tab ${label}`, JSON.stringify(state))
        await writeFile(`test-results/bob-reset-${label}-${viewport.width}.json`, JSON.stringify(state, null, 2))
        await p.screenshot({ path: `test-results/bob-reset-${label}-${viewport.width}.png` })
      }
      throw error
    }
    assert.equal(await drawer.getByText('FRESH ANSWER', { exact: true }).count(), 0)
    await other.close()
    // Shared guest must clear only this device; an auth failure is never guest mode.
    const beforeGuest = resetCalls
    authMode = 'guest'
    await page.evaluate(key => localStorage.setItem(key, JSON.stringify([{ from: 'user', text: 'LOCAL GUEST CHAT' }])), cache('A'))
    await page.reload(); drawer = await open()
    await drawer.getByText('LOCAL GUEST CHAT', { exact: true }).waitFor()
    dialog = await confirm()
    await dialog.getByRole('button', { name: 'Clear chat and context', exact: true }).click()
    await drawer.getByText('New conversation started. Saved project data is unchanged.', { exact: true }).waitFor()
    assert.equal(resetCalls, beforeGuest)
    assert.equal(await page.evaluate(key => localStorage.getItem(key), cache('A')), null)
    await page.screenshot({ path: `test-results/bob-reset-empty-${viewport.width}.png`, fullPage: true })
    assert(await drawer.evaluate(n => n.scrollWidth <= n.clientWidth + 1))
    assert.deepEqual(errors, [])
    await context.close()
    console.log(`Bob reset ${viewport.width}px: confirm/cancel, honest failures, pending state, server/local cleanup, reload, next turn and cross-tab reset OK`)
  }
} finally {
  if (browser) await browser.close()
  server.kill('SIGTERM')
}
