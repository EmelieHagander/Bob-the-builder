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
    let sendMode = 'normal', answerCalls = 0, releaseAnswer
    const sentTurns=[]
    let pauseHistory = false, historyPaused, releaseHistory
    let releaseReset
    await context.route('https://fonts.googleapis.com/**', route => route.abort())
    await context.route(`${api}/**`, async route => {
      const req = route.request(), url = new URL(req.url())
      const respond = options => route.fulfill({ ...options, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info, x-supabase-api-version, accept-profile, content-profile', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' } })
      const who = { ...user, id: authMode === 'other' ? '00000000-0000-0000-0000-000000000099' : user.id, email: authMode === 'guest' ? 'guest@bob.local' : user.email }
      if (req.method() === 'OPTIONS') return respond({ status: 204 })
      if (url.pathname === '/rest/v1/rpc/drawing_work_list') return respond({ json: { items: [], next_cursor: null } })
      if (url.pathname === '/functions/v1/ask-bob' && req.postDataJSON()?.action === 'renew_requests') return respond({ json: { ok: true, renewed: 0 } })
      if (new URL(route.request().url()).pathname === '/rest/v1/rpc/project_plan_read') return respond({json:{record:null}})
      if (new URL(route.request().url()).pathname === '/rest/v1/rpc/project_work_read') return respond({json:{project_id:route.request().postDataJSON().p_project,vocabulary_version:'2026-09-24.1',status:'not_initialized',revision:null,focus_step_id:null,areas:[],steps:[],unorganised_tasks:[]}})
      if (url.pathname === '/auth/v1/token') return respond({ json: { access_token: token, refresh_token: 'fixture', token_type: 'bearer', expires_in: 3600, expires_at: expiresAt, user: who } })
      if (url.pathname === '/auth/v1/user') return authMode === 'failure' ? respond({ status: 503, json: { message: 'Offline fixture' } }) : respond({ json: who })
      if (url.pathname === '/rest/v1/rpc/bob_chat_inbox') {
        if (authMode === 'other') return respond({ json: null })
        const h = histories.get(req.postDataJSON().p_project)
        const latestSeq = Math.max(0,...(h?.messages ?? []).filter(m=>m.role==='assistant' || m.delivery_state==='failed').map(m=>m.seq))
        return respond({json:h?.id ? {threadId:h.id,latestSeq,readSeq:h.readSeq??0,unread:latestSeq>(h.readSeq??0)} : null})
      }
      if (url.pathname === '/rest/v1/rpc/bob_mark_chat_read') {
        const body=req.postDataJSON(),h=histories.get(body.p_project)
        assert.equal(h?.id,body.p_thread)
        const latest=Math.max(0,...h.messages.filter(m=>m.role==='assistant'||m.delivery_state==='failed').map(m=>m.seq))
        assert(body.p_seq<=latest)
        h.readSeq=Math.max(h.readSeq??0,body.p_seq)
        return respond({json:null})
      }
      if (url.pathname === '/rest/v1/bob_delegation_notices') {
        const h=[...histories.values()].find(h=>h.id===url.searchParams.get('thread_id')?.replace('eq.',''))
        return respond({json:(h?.messages??[]).filter(m=>m.background).map(m=>({turn_id:m.turn_id,text:'Jag har skickat ritningen till designern. Jag återkommer här när resultatet är granskat.'}))})
      }
      if (url.pathname === '/rest/v1/rpc/bob_job_status') {
        const body = req.postDataJSON()
        const row = histories.get(body.p_project)?.messages.find(m => m.turn_id === body.p_turn && m.role === 'user')
        return respond({ json: row?.background ? { status: row.delivery_state === 'pending' ? 'running' : row.delivery_state, error: row.error, screen: row.screen??null, expiresAt: new Date(Date.now() + 15 * 60_000).toISOString() } : null })
      }
      if (url.pathname === '/rest/v1/rpc/claim_project_invites') return respond({ json: 0 })
      if (url.pathname === '/rest/v1/rpc/project_invitations') return respond({ json: [] })
      if (url.pathname === '/rest/v1/rpc/sharing_directory') return respond({ json: { households: [], friends: [] } })
      if (url.pathname === '/rest/v1/rpc/project_sharing_state') return respond({ json: {
        projectId: req.postDataJSON().p_project, householdId: null, buildingId: null,
        revision: 0, canManage: false, buildings: [], invitations: [],
      } })
      if (url.pathname === '/rest/v1/projects') return respond({ json: projects })
      if (url.pathname === '/rest/v1/account') return respond({ json: { id: 'account', name: 'Reset fixture', owner_name: '', email: '' } })
      if (url.pathname === '/rest/v1/people') {
        const id = url.searchParams.get('project_id')?.replace('eq.', '') ?? 'A'
        return respond({ json: [{ id: `member${id}`, name: 'Fixture member', initials: 'FM', color: '#41513f', role: 'Organiser', diet: '', person_skills: [] }] })
      }
      if (url.pathname === '/rest/v1/bob_threads') {
        const h = histories.get(url.searchParams.get('project_id')?.replace('eq.', ''))
        const row = authMode !== 'other' && h?.id ? { id: h.id, next_seq: h.next_seq } : null
        return respond({ json: (req.headers().accept ?? '').includes('application/vnd.pgrst.object+json') ? row : row ? [row] : [] })
      }
      if (url.pathname === '/rest/v1/bob_messages') {
        const h = [...histories.values()].find(h => h.id === url.searchParams.get('thread_id')?.replace('eq.', ''))
        const snapshot = structuredClone(h?.messages ?? [])
        if (pauseHistory) { pauseHistory = false; historyPaused(); await new Promise(resolve => { releaseHistory = resolve }) }
        return respond({ json: snapshot })
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
        h.id = null; h.next_seq = 1; h.messages = []; h.readSeq=0
        return respond({ json: { status: 'cleared', mode: 'server', projectId: body.p_project } })
      }
      if (url.pathname === '/functions/v1/ask-bob') {
        const body = req.postDataJSON(), h = histories.get(body.projectId)
        sentTurns.push(body)
        answerCalls++
        h.id ??= crypto.randomUUID()
        if (sendMode === 'collision' || sendMode === 'collision-pending') {
          // An event worker acquires the thread after the drawer's history read.
          // The new message is rejected before the server inserts any user row.
          const oldTurn = crypto.randomUUID()
          const old = { role: 'user', text: 'OLD SHELF INSTRUCTION', turn_id: oldTurn, delivery_state: sendMode === 'collision' ? 'failed' : 'pending', background: true, updated_at: new Date().toISOString(), seq: h.next_seq++ }
          h.messages.push(old)
          const finish = () => {
            old.delivery_state = 'failed'
            h.messages.push({ role: 'assistant', text: 'OLD DEPTH QUESTION', turn_id: crypto.randomUUID(), delivery_state: 'completed', seq: h.next_seq++ })
          }
          if (sendMode === 'collision') finish()
          else releaseAnswer = finish
          return respond({ status: 409, json: { error: 'turn_in_flight' } })
        }
        if (sendMode !== 'normal') {
          const pending = { role: 'user', text: body.message, turn_id: body.clientTurnId, screen:body.screen, delivery_state: 'pending', updated_at: new Date().toISOString(), seq: h.next_seq++ }
          if (sendMode === 'background') { pending.background = true; pending.updated_at = new Date(Date.now() - 6 * 60_000).toISOString() }
          h.messages.push(pending)
          const finish = () => {
            pending.delivery_state = 'completed'
            h.messages.push({ role: 'assistant', text: 'RECOVERED ANSWER', turn_id: body.clientTurnId, delivery_state: 'completed', seq: h.next_seq++, evidence: { kind: 'ai_assessment', sources: [], partial: false } })
          }
          if (sendMode === 'background') {
            releaseAnswer = finish
            return respond({ status: 202, json: { ok: true, status: 'accepted', projectId: body.projectId, jobId: crypto.randomUUID(), expiresAt: new Date(Date.now() + 15 * 60_000).toISOString() } })
          }
          if (sendMode === 'lost' || sendMode === 'busy') {
            releaseAnswer = finish
            return sendMode === 'busy' ? respond({ status: 409, json: { error: 'turn_in_flight' } }) : route.abort('failed')
          }
          await new Promise(resolve => { releaseAnswer = () => { finish(); resolve() } })
          return respond({ json: { ok: true, status: 'completed', projectId: body.projectId, summary: 'RECOVERED ANSWER', evidence: { kind: 'ai_assessment', sources: [], partial: false } } })
        }
        const response = { ok: true, status: 'completed', projectId: body.projectId, summary: 'FRESH ANSWER', evidence: { kind: 'ai_assessment', sources: [], partial: false } }
        const prior = h.messages.find(m => m.role === 'user' && m.turn_id === body.clientTurnId)
        if (prior) prior.delivery_state = 'completed'
        else h.messages.push({ role: 'user', text: body.message, turn_id: body.clientTurnId, delivery_state: 'completed', seq: h.next_seq++ })
        h.messages.push({ role: 'assistant', text: response.summary, turn_id: body.clientTurnId, evidence: response.evidence, delivery_state: 'completed', seq: h.next_seq++ })
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
    await page.locator('.card').filter({hasText:'Reset project A'}).getByRole('button',{name:'Open',exact:true}).click()
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
    // An in-flight HTTP call survives closing the drawer; lost/busy responses
    // recover by reading the transcript, never by calling the model again.
    for (const mode of ['delayed', 'lost', 'busy', 'background']) {
      sendMode = mode
      const before = answerCalls
      await drawer.getByRole('textbox').fill(`Pending ${mode}`)
      await drawer.getByRole('button', { name: 'Send', exact: true }).click()
      await drawer.getByText('Bob is working on the project…', { exact: true }).waitFor()
      await page.waitForFunction(() => !!document.querySelector('.bob-hammer'))
      const closeButton = drawer.getByRole('button', { name: 'Close Ask bob', exact: true })
      const bounds = await closeButton.boundingBox()
      assert(bounds && bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= viewport.width && bounds.y + bounds.height <= viewport.height && bounds.height >= 44)
      await closeButton.click()
      drawer = await open()
      await drawer.getByText('Bob is working on the project…', { exact: true }).waitFor()
      assert.equal(await drawer.getByRole('button', { name: 'Retry request', exact: true }).count(), 0)
      assert(await drawer.getByRole('button', { name: 'New conversation', exact: true }).isDisabled())
      assert.equal(await drawer.locator('.bob-hammer').evaluate(el => getComputedStyle(el).animationName), 'bob-hammering')
      await page.emulateMedia({ reducedMotion: 'reduce' })
      assert.equal(await drawer.locator('.bob-hammer').evaluate(el => getComputedStyle(el).animationName), 'none')
      await page.emulateMedia({ reducedMotion: 'no-preference' })
      // Wait for the fixture request to arrive before completing the server turn.
      for (let n = 0; answerCalls === before; n++) { assert(n < 40); await new Promise(r => setTimeout(r, 50)) }
      if (mode === 'background') {
        await page.reload(); drawer = await open()
        await drawer.getByText('Bob is working on the project…', { exact: true }).waitFor()
        assert.equal(await drawer.getByRole('button', { name: 'Retry request', exact: true }).count(), 0)
      }
      if (mode === 'background') {
        await drawer.getByText('Jag har skickat ritningen till designern. Jag återkommer här när resultatet är granskat.', {exact:true}).waitFor()
        await drawer.getByRole('button',{name:'Close Ask bob',exact:true}).click()
        releaseAnswer()
        await page.reload()
        await page.getByText('New from Bob',{exact:true}).waitFor()
        await page.screenshot({path:`test-results/bob-unread-${viewport.width}.png`})
        const button=await page.getByRole('button',{name:'Ask bob',exact:true}).boundingBox()
        assert(button && button.x>=0 && button.x+button.width<=viewport.width)
        drawer=await open()
        await drawer.getByText('RECOVERED ANSWER',{exact:true}).last().waitFor()
        await page.getByText('New from Bob',{exact:true}).waitFor({state:'hidden'})
      } else releaseAnswer()
      await drawer.getByText('Bob is working on the project…', { exact: true }).waitFor({ state: 'hidden' })
      assert.equal(await drawer.getByText('RECOVERED ANSWER', { exact: true }).count(), ['delayed','lost','busy','background'].indexOf(mode) + 1)
      assert.equal(answerCalls, before + 1)
      assert.equal(await drawer.getByRole('button', { name: 'Retry request', exact: true }).count(), 0)
    }
    sendMode = 'normal'
    // A slow read started by reopening must not overwrite a newly sent answer.
    const freshBefore = await drawer.getByText('FRESH ANSWER', {exact:true}).count()
    await drawer.getByRole('button', {name:'Close Ask bob',exact:true}).click()
    const paused = new Promise(resolve => { historyPaused = resolve })
    pauseHistory = true
    drawer = await open(); await paused
    await drawer.getByRole('textbox', {name:'Question for bob'}).fill('New question during history refresh')
    await drawer.getByRole('button', {name:'Send',exact:true}).click()
    await drawer.getByText('FRESH ANSWER', {exact:true}).nth(freshBefore).waitFor()
    const delivered = page.waitForResponse(r => new URL(r.url()).pathname === '/rest/v1/bob_delegation_notices')
    releaseHistory(); await (await delivered).finished()
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    assert.equal(await drawer.getByText('FRESH ANSWER', {exact:true}).count(), freshBefore + 1)
    assert.equal(await drawer.getByText('New question during history refresh', {exact:true}).count(), 1)
    // Full page reload while another device's turn is pending.
    const h = histories.get('A'), recoveringTurn = crypto.randomUUID()
    const pending = { role: 'user', text: 'Resume after reload', turn_id: recoveringTurn, delivery_state: 'pending', updated_at: new Date().toISOString(), seq: h.next_seq++ }
    h.messages.push(pending)
    const callsBeforeReload = answerCalls
    await page.reload(); drawer = await open()
    await drawer.getByText('Bob is working on the project…', { exact: true }).waitFor()
    assert.equal(await drawer.getByRole('button', { name: 'Retry request', exact: true }).count(), 0)
    await page.screenshot({ path: `test-results/bob-working-${viewport.width}.png` })
    pending.delivery_state = 'completed'
    h.messages.push({ role: 'assistant', text: 'FINISHED AFTER RELOAD', turn_id: recoveringTurn, delivery_state: 'completed', seq: h.next_seq++ })
    await drawer.getByText('FINISHED AFTER RELOAD', { exact: true }).waitFor()
    assert.equal(answerCalls, callsBeforeReload)
    // Real failures and expired leases still offer recovery; no endless spinner.
    for (const state of ['failed', 'pending']) {
      h.messages.push({ role: 'user', text: `Interrupted ${state}`, turn_id: crypto.randomUUID(), delivery_state: state, updated_at: new Date(Date.now() - 6 * 60_000).toISOString(), seq: h.next_seq++ })
      await page.reload(); drawer = await open()
      await drawer.getByRole('button', { name: 'Retry request', exact: true }).waitFor()
      assert.equal(await drawer.getByText('Bob is working on the project…', { exact: true }).count(), 0)
      const recovery = await drawer.locator('.bob-recovery').boundingBox()
      const history = await drawer.locator('.bob-history').boundingBox()
      assert(recovery && recovery.height <= 60, 'Retry uses one compact row')
      assert(history && history.height >= viewport.height * 0.45, 'Messages retain useful screen space during retry')
      assert.equal(await page.evaluate(() => document.body.style.overflow), 'hidden', 'Only the conversation scrolls while open')
      await page.screenshot({path:`test-results/mobile-chat-retry-${state}-${viewport.width}.png`})
    }
    // Recover the original turn's frozen pointer on a different page after reload.
    const focusedRetry=crypto.randomUUID()
    h.messages.push({role:'user',text:'Retry original project focus',turn_id:focusedRetry,screen:{surface:'project'},background:true,delivery_state:'failed',updated_at:new Date().toISOString(),seq:h.next_seq++})
    await page.goto(base+'#/people');await page.reload();drawer=await open()
    await drawer.getByRole('button',{name:'Retry request',exact:true}).waitFor()
    await drawer.getByText('Continuing the original request',{exact:true}).waitFor()
    const answersBeforeRetry=await drawer.getByText('FRESH ANSWER',{exact:true}).count()
    const retryArrival=page.waitForRequest(r=>new URL(r.url()).pathname==='/functions/v1/ask-bob'&&r.postDataJSON()?.action==='send')
    await drawer.getByRole('button',{name:'Retry request',exact:true}).click()
    const retryBody=(await retryArrival).postDataJSON()
    assert.equal(retryBody.clientTurnId,focusedRetry)
    assert.deepEqual(retryBody.screen,{surface:'project'},'Reload on People cannot change the original request focus')
    await drawer.getByText('FRESH ANSWER',{exact:true}).nth(answersBeforeRetry).waitFor()
    await drawer.locator('.bob-working').waitFor({state:'hidden'})
    const answersBeforeNew=await drawer.getByText('FRESH ANSWER',{exact:true}).count()
    const freshArrival=page.waitForRequest(r=>new URL(r.url()).pathname==='/functions/v1/ask-bob'&&r.postDataJSON()?.message==='New page request')
    await drawer.getByRole('textbox',{name:'Question for bob'}).fill('New page request')
    await drawer.getByRole('button',{name:'Send',exact:true}).click()
    assert.deepEqual((await freshArrival).postDataJSON().screen,{surface:'people'},'A new logical turn uses the current page')
    await drawer.getByText('FRESH ANSWER',{exact:true}).nth(answersBeforeNew).waitFor()
    await drawer.locator('.bob-working').waitFor({state:'hidden'})
    assert(sentTurns.length>0)
    await page.screenshot({path:`test-results/bob-frozen-page-retry-${viewport.width}.png`})
    await page.keyboard.press('Escape')
    await drawer.waitFor({ state: 'hidden' })
    drawer = await open()
    // A spending stop survives reload and never offers the same expensive retry.
    h.messages.push({role:'user',text:'Budget-limited drawing',turn_id:crypto.randomUUID(),delivery_state:'failed',background:true,error:'turn_budget_exhausted',updated_at:new Date().toISOString(),seq:h.next_seq++})
    const beforeBudgetReload=answerCalls
    await page.reload();drawer=await open()
    await drawer.getByText('Bob stopped because this request reached its AI spending or call limit. Review what was saved before starting a new request.',{exact:true}).waitFor()
    assert.equal(await drawer.getByRole('button',{name:'Retry request',exact:true}).count(),0)
    assert.equal(answerCalls,beforeBudgetReload)
    await page.screenshot({path:`test-results/bob-budget-stop-${viewport.width}.png`})
    // Regression: a rejected complement must survive event replies and reload,
    // and the original failed user message must remain visible in its position.
    for (const mode of ['collision', 'collision-pending']) {
      sendMode = mode
      const complement = `Depth 30 cm ${mode}`
      const before = answerCalls
      await drawer.getByRole('textbox').fill(complement)
      const arriving = page.waitForRequest(r => new URL(r.url()).pathname === '/functions/v1/ask-bob' && r.postDataJSON()?.message === complement)
      await drawer.getByRole('button', { name: 'Send', exact: true }).click()
      const originalBody = (await arriving).postDataJSON()
      await drawer.getByText('Your new message is kept in this tab, but receipt is not confirmed. Use Retry request when Bob is free.', { exact: true }).waitFor()
      assert.equal(await drawer.getByText(complement, { exact: true }).count(), 1)
      assert(!h.messages.some(m => m.text === complement), '409 did not save the new message')
      await drawer.getByText('OLD SHELF INSTRUCTION', { exact: true }).last().waitFor()
      if (mode === 'collision-pending') assert(await drawer.getByRole('button', { name: 'Retry request', exact: true }).isDisabled())
      await page.reload(); drawer = await open()
      await drawer.getByText(complement, { exact: true }).waitFor()
      assert.equal(answerCalls, before + 1, 'Reload must never resubmit held text')
      if (mode === 'collision-pending') {
        releaseAnswer()
        await drawer.locator('.bob-working').waitFor({ state: 'hidden' })
      }
      await drawer.getByText('OLD DEPTH QUESTION', { exact: true }).last().waitFor()
      assert.equal(await drawer.getByText(complement, { exact: true }).count(), 1)
      assert.equal(await drawer.getByText('OLD SHELF INSTRUCTION', { exact: true }).count(), mode === 'collision' ? 1 : 2)
      await page.screenshot({ path: `test-results/bob-${mode}-${viewport.width}.png` })
      if (mode === 'collision') {
        // Tab delivery storage must not leak to another project or account.
        await page.evaluate(() => localStorage.setItem('bob:active-project', 'B'))
        await page.reload(); drawer = await open(page, 'B')
        assert.equal(await drawer.getByText(complement, { exact: true }).count(), 0)
        await page.evaluate(() => localStorage.setItem('bob:active-project', 'A'))
        authMode = 'other'
        await page.reload(); drawer = await open()
        assert.equal(await drawer.getByText(complement, { exact: true }).count(), 0)
        authMode = 'member'
        await page.reload(); drawer = await open()
        await drawer.getByText(complement, { exact: true }).waitFor()
        assert.equal(answerCalls, before + 1)
      }
      sendMode = 'normal'
      const newerDraft = 'Next question still being composed'
      await drawer.getByRole('textbox').fill(newerDraft)
      const beforeAnswers = await drawer.getByText('FRESH ANSWER', { exact: true }).count()
      const retried = page.waitForRequest(r => new URL(r.url()).pathname === '/functions/v1/ask-bob' && r.postDataJSON()?.message === complement)
      await drawer.getByRole('button', { name: 'Retry request', exact: true }).click()
      const retryBody = (await retried).postDataJSON()
      assert.equal(retryBody.clientTurnId, originalBody.clientTurnId)
      assert.deepEqual(retryBody.screen, originalBody.screen)
      await drawer.getByText('FRESH ANSWER', { exact: true }).nth(beforeAnswers).waitFor()
      assert.equal(await drawer.getByRole('textbox').inputValue(), newerDraft, 'Retry must preserve a newer composer draft')
      await page.reload(); drawer = await open()
      await drawer.getByText(complement, { exact: true }).waitFor()
      assert.equal(await drawer.getByText(complement, { exact: true }).count(), 1)
      assert.equal(await drawer.getByRole('button', { name: 'Retry request', exact: true }).count(), 0)
      assert.equal(answerCalls, before + 2, 'Only the deliberate same-ID retry sends again')
    }
    // Successful reset clears held text too; a failed reset preserves it.
    sendMode = 'collision'
    await drawer.getByRole('textbox').fill('Held before reset')
    await drawer.getByRole('button', { name: 'Send', exact: true }).click()
    await drawer.getByText('Your new message is kept in this tab, but receipt is not confirmed. Use Retry request when Bob is free.', { exact: true }).waitFor()
    resetMode = 'unavailable'
    dialog = await confirm()
    await dialog.getByRole('button', { name: 'Clear chat and context', exact: true }).click()
    await dialog.getByText('Could not confirm the reset. Your chat is still shown; check your connection and try again.', { exact: true }).waitFor()
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    await page.reload(); drawer = await open()
    await drawer.getByText('Held before reset', { exact: true }).waitFor()
    resetMode = 'success'
    dialog = await confirm()
    await dialog.getByRole('button', { name: 'Clear chat and context', exact: true }).click()
    await drawer.getByText('New conversation started. Saved project data is unchanged.', { exact: true }).waitFor()
    await page.reload(); drawer = await open()
    assert.equal(await drawer.getByText('Held before reset', { exact: true }).count(), 0)
    assert.equal(await drawer.getByRole('button', { name: 'Retry request', exact: true }).count(), 0)
    sendMode = 'normal'
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
