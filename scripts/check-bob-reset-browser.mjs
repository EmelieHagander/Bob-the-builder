// Drive the real built drawer/data seam; only HTTP is a fixture. Database/cursor
// deletion and authority are independently covered by bob-reset.test.ts.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright-core'
import { bobHistoryRows } from './bob-history-fixture.mjs'

const base = 'http://127.0.0.1:4181/Bob-the-builder/'
const api = 'https://pwa-proof.invalid'
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--base', '/Bob-the-builder/', '--host', '127.0.0.1', '--port', '4181', '--strictPort'], { stdio: 'ignore' })
const user = { id: '00000000-0000-0000-0000-000000000003', email: 'reset@example.test', aud: 'authenticated', role: 'authenticated', app_metadata: { provider: 'email' }, user_metadata: {}, created_at: '2026-09-17T00:00:00Z' }
const expiresAt = Math.floor(Date.now() / 1000) + 3600
const token = [JSON.stringify({ alg: 'HS256', typ: 'JWT' }), JSON.stringify({ sub: user.id, exp: expiresAt, role: 'authenticated' }), 'fixture'].map(p => Buffer.from(p).toString('base64url')).join('.')
const projects = ['A', 'B'].map(id => ({ id, slug: id.toLowerCase(), name: `Reset project ${id}`, description: 'Keep project data', theme: 'birch', phase: 'concept', location: '', type: 'Renovation', start_label: '', start_date: null, end_date: null }))
const cache = id => `bob:ask-bob-history:v1:${id}:member${id}`
const contextTooLarge = 'This request contains too much material to process at once. Saved work and conversation history are preserved. Ask Bob to work on a smaller part.'
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
    const touch = viewport.width < 860
    const context = await browser.newContext({ viewport, hasTouch: touch, isMobile: touch, serviceWorkers: 'block' })
    const histories = new Map(['A', 'B'].map(id => [id, { id: crypto.randomUUID(), next_seq: 3, messages: [{ role: 'user', text: `OLD CHAT ${id}`, turn_id: 'initial-turn', delivery_state: 'completed', seq: 1 }, { role: 'assistant', text: `OLD ANSWER ${id}`, turn_id: 'initial-turn', delivery_state: 'completed', seq: 2 }] }]))
    const errors = []
    let resetMode = 'success', authMode = 'member', resetCalls = 0
    let sendMode = 'normal', answerCalls = 0, releaseAnswer, offline = false
    let cancelMode = 'success', renewMode = 'success', cancelCalls = 0
    const sentTurns=[]
    let pauseHistory = false, historyPaused, releaseHistory
    let pauseMembership = false, statusMode = 'normal'
    let pauseNotices = true, noticesPaused, releaseNotices
    const firstNotices = new Promise(resolve => { noticesPaused = resolve })
    const heldMembership = []
    let historyReads = 0, statusReads = 0
    let releaseReset
    await context.route('https://fonts.googleapis.com/**', route => route.abort())
    await context.route(`${api}/**`, async route => {
      const req = route.request(), url = new URL(req.url())
      const respond = options => route.fulfill({ ...options, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info, x-supabase-api-version, accept-profile, content-profile', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' } })
      const who = { ...user, id: authMode === 'other' ? '00000000-0000-0000-0000-000000000099' : user.id, email: authMode === 'guest' ? 'guest@bob.local' : user.email }
      if (req.method() === 'OPTIONS') return respond({ status: 204 })
      if (offline && url.pathname.startsWith('/rest/v1/')) return route.abort('internetdisconnected')
      if (url.pathname === '/rest/v1/rpc/drawing_work_list') return respond({ json: { items: [], next_cursor: null } })
      if (url.pathname === '/functions/v1/ask-bob' && req.postDataJSON()?.action === 'renew_requests') {
        if (renewMode === 'unavailable') return respond({status:503,json:{ok:false,error:'service_unavailable'}})
        let renewed = 0
        for (const history of histories.values()) for (const row of history.messages) if (row.jobStatus === 'paused') { row.jobStatus = 'running'; renewed++ }
        return respond({ json: { ok: true, renewed } })
      }
      if (url.pathname === '/functions/v1/ask-bob' && req.postDataJSON()?.action === 'cancel') {
        cancelCalls++
        const body = req.postDataJSON()
        assert.deepEqual(Object.keys(body).sort(), ['action','jobId','projectId'])
        assert.equal(req.headers().authorization, `Bearer ${token}`)
        const history = histories.get(body.projectId)
        const row = history?.messages.find(row => row.jobId === body.jobId)
        assert(row, 'Stop uses the exact owned durable job')
        if (cancelMode === 'unavailable') return respond({status:503,json:{ok:false,error:'service_unavailable'}})
        if (row.jobStatus !== 'cancelled') history.messages.push({role:'assistant',text:'Stopped at your request. Changes already saved remain in the project. The request was not completed.',turn_id:row.turn_id,delivery_state:'completed',seq:history.next_seq++,evidence:{kind:'ai_assessment',sources:[],partial:true,writes:row.writes??[]}})
        row.delivery_state = 'completed'; row.jobStatus = 'cancelled'; row.error = 'user_cancelled'
        if (cancelMode === 'lost') return route.abort('failed')
        return respond({json:{ok:true,status:'cancelled',projectId:body.projectId,jobId:body.jobId}})
      }
      if (new URL(route.request().url()).pathname === '/rest/v1/rpc/project_plan_read') return respond({json:{record:null}})
      if (url.pathname === '/rest/v1/rpc/read_construction_draft') return respond({json:{status:'ok',projectId:route.request().postDataJSON().p_project,items:[],truncated:false,next_cursor:null}})
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
        if (pauseNotices) { pauseNotices = false; noticesPaused(); await new Promise(resolve => { releaseNotices = resolve }) }
        const h=[...histories.values()].find(h=>h.id===url.searchParams.get('thread_id')?.replace('eq.',''))
        return respond({json:(h?.messages??[]).filter(m=>m.background).map(m=>({turn_id:m.turn_id,text:'Jag har skickat ritningen till designern. Jag återkommer här när resultatet är granskat.'}))})
      }
      if (url.pathname === '/rest/v1/rpc/bob_job_status') {
        statusReads++
        if (statusMode === 'offline') return respond({ status: 503, json: { message: 'Status unavailable fixture' } })
        const body = req.postDataJSON()
        const row = histories.get(body.p_project)?.messages.find(m => m.turn_id === body.p_turn && m.role === 'user')
        return respond({ json: row?.background ? { jobId:row.jobId, status: row.jobStatus ?? (row.delivery_state === 'pending' ? 'running' : row.delivery_state), error: row.error, progress:row.progress, screen: row.screen??null, writes:row.writes, expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(), drawingRecovery: row.drawingRecovery } : null })
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
        if (pauseMembership && url.searchParams.has('auth_user_id')) await new Promise(resolve => { heldMembership.push(resolve) })
        const id = url.searchParams.get('project_id')?.replace('eq.', '') ?? 'A'
        return respond({ json: [{ id: `member${id}`, name: 'Fixture member', initials: 'FM', color: '#41513f', role: 'Organiser', diet: '', person_skills: [] }] })
      }
      if (url.pathname === '/rest/v1/bob_threads') {
        const h = histories.get(url.searchParams.get('project_id')?.replace('eq.', ''))
        const row = authMode !== 'other' && h?.id ? { id: h.id, next_seq: h.next_seq } : null
        return respond({ json: (req.headers().accept ?? '').includes('application/vnd.pgrst.object+json') ? row : row ? [row] : [] })
      }
      if (url.pathname === '/rest/v1/bob_messages') {
        historyReads++
        // The latest window joins the active thread by project; older pages and
        // the latest-user read address the thread directly.
        const project = url.searchParams.get('bob_threads.project_id')?.replace('eq.', '')
        const h = project ? histories.get(project) : [...histories.values()].find(h => h.id === url.searchParams.get('thread_id')?.replace('eq.', ''))
        assert(url.searchParams.get('limit'), 'Transcript queries are bounded')
        const snapshot = structuredClone(bobHistoryRows(h?.id ? h.messages : [], url).map(row => ({ ...row, thread_id: h.id, bob_threads: { id: h.id } })))
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
        if (sendMode === 'context-too-large') {
          h.messages.push({ role: 'user', text: body.message, turn_id: body.clientTurnId, screen: body.screen,
            delivery_state: 'failed', background: true, jobId: crypto.randomUUID(), jobStatus: 'failed', error: 'context_input_too_large',
            updated_at: new Date().toISOString(), seq: h.next_seq++ })
          return respond({ status: 503, json: { ok: false, error: 'context_input_too_large' } })
        }
        if (sendMode !== 'normal') {
          const pending = { role: 'user', text: body.message, turn_id: body.clientTurnId, screen:body.screen, delivery_state: 'pending', updated_at: new Date().toISOString(), seq: h.next_seq++ }
          if (sendMode === 'background' || sendMode === 'background-context-too-large') { pending.background = true; pending.jobId = crypto.randomUUID(); pending.updated_at = new Date(Date.now() - 6 * 60_000).toISOString() }
          h.messages.push(pending)
          const finish = () => {
            pending.delivery_state = 'completed'
            h.messages.push({ role: 'assistant', text: 'RECOVERED ANSWER', turn_id: body.clientTurnId, delivery_state: 'completed', seq: h.next_seq++, evidence: { kind: 'ai_assessment', sources: [], partial: false } })
          }
          if (sendMode === 'background' || sendMode === 'background-context-too-large') {
            releaseAnswer = sendMode === 'background-context-too-large' ? () => {
              pending.delivery_state = 'failed'; pending.jobStatus = 'failed'; pending.error = 'context_input_too_large'
            } : finish
            return respond({ status: 202, json: { ok: true, status: 'accepted', projectId: body.projectId, jobId: pending.jobId, expiresAt: new Date(Date.now() + 15 * 60_000).toISOString() } })
          }
          if (sendMode === 'lost' || sendMode === 'busy' || sendMode === 'offline') {
            releaseAnswer = finish
            if (sendMode === 'offline') offline = true
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
    await page.getByRole('heading', { name: 'Home', exact: true }).waitFor()
    await page.locator('.account-project-row').filter({hasText:'Reset project A'}).getByRole('button',{name:'Open project Reset project A',exact:true}).click()
    let drawer = await open()
    await drawer.getByText('OLD ANSWER A', { exact: true }).waitFor()
    if (touch) assert(await drawer.getByRole('button', { name: 'Close Ask bob', exact: true }).evaluate(node => node === document.activeElement), 'Opening a touch conversation does not raise the keyboard')
    await firstNotices
    await drawer.getByRole('textbox').fill('Visible before work status')
    assert(await drawer.getByRole('button', {name:'Send',exact:true}).isDisabled(), 'Fresh text is visible before status, but cannot authorize sending')
    await page.screenshot({path:`test-results/bob-early-history-${viewport.width}.png`})
    releaseNotices()
    await drawer.locator('button:enabled', {hasText:'New conversation'}).waitFor()
    await drawer.getByRole('textbox').fill('')
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
    await other.goto(base+'#/project'); const otherDrawer = await open(other)
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
      // This reload intentionally opens only the recent window. Read the older
      // page before checking that all earlier recovered replies remain intact.
      if (mode === 'background') {
        await drawer.getByRole('button', { name: 'Show older messages', exact: true }).click()
        await drawer.getByText('Pending delayed', { exact: true }).waitFor()
      }
      assert.equal(await drawer.getByText('RECOVERED ANSWER', { exact: true }).count(), ['delayed','lost','busy','background'].indexOf(mode) + 1)
      assert.equal(answerCalls, before + 1)
      assert.equal(await drawer.getByRole('button', { name: 'Retry request', exact: true }).count(), 0)
    }
    // A phone that sleeps right after sending loses the reply and the first
    // checks. The drawer keeps checking instead of asking to resend the work.
    sendMode = 'offline'
    const beforeOffline = answerCalls
    await drawer.getByRole('textbox').fill('Pending offline')
    await drawer.getByRole('button', { name: 'Send', exact: true }).click()
    await drawer.getByText('Connection interrupted. Checking for Bob’s answer…', { exact: true }).first().waitFor({ timeout: 25000 })
    assert.equal(await drawer.getByRole('button', { name: 'Retry request', exact: true }).count(), 0)
    assert.equal(await drawer.getByText('I could not retrieve an answer for this project. Please try again.', { exact: true }).count(), 0)
    offline = false
    await drawer.getByText('Bob is working on the project…', { exact: true }).waitFor()
    releaseAnswer()
    await drawer.getByText('Bob is working on the project…', { exact: true }).waitFor({ state: 'hidden' })
    await drawer.getByText('Pending offline', { exact: true }).waitFor()
    assert.equal(answerCalls, beforeOffline + 1)
    assert.equal(await drawer.getByRole('button', { name: 'Retry request', exact: true }).count(), 0)
    // Stop is reachable during a durable job, survives a lost reply, and keeps saved receipts.
    sendMode = 'background'
    await drawer.getByRole('textbox').fill('Continue until the planning brief is saved')
    await drawer.getByRole('button', {name:'Send',exact:true}).click()
    await drawer.getByRole('button', {name:'Stop',exact:true}).waitFor()
    const activeHistory = histories.get('A')
    const activeJob = activeHistory.messages.at(-1)
    activeJob.writes = [{projectId:'A',dataset:'tasks',recordId:'saved-task',label:'Saved planning brief',operation:'updated',savedAt:new Date().toISOString()}]
    await drawer.getByRole('textbox').fill('Keep my next instruction')
    const stopBounds = await drawer.getByRole('button',{name:'Stop',exact:true}).boundingBox()
    assert(stopBounds && stopBounds.height >= 44 && stopBounds.x >= 0 && stopBounds.x + stopBounds.width <= viewport.width && stopBounds.y + stopBounds.height <= viewport.height)
    await page.screenshot({path:`test-results/bob-stop-${viewport.width}.png`})
    cancelMode = 'unavailable'
    await drawer.getByRole('button',{name:'Stop',exact:true}).click()
    await drawer.getByRole('alert').filter({hasText:'Could not confirm the stop'}).waitFor()
    assert(await drawer.getByRole('button',{name:'Send',exact:true}).isDisabled())
    cancelMode = 'lost'
    await drawer.getByRole('button',{name:'Stop',exact:true}).click()
    await drawer.getByText('Stopped at your request. Changes already saved remain in the project. The request was not completed.',{exact:true}).waitFor()
    assert.equal(await drawer.getByRole('button',{name:'Stop',exact:true}).count(),0)
    assert.equal(await drawer.getByRole('textbox').inputValue(),'Keep my next instruction')
    await drawer.getByText('Saved planning brief',{exact:false}).waitFor()
    await page.reload(); drawer = await open()
    await drawer.getByText('Stopped at your request. Changes already saved remain in the project. The request was not completed.',{exact:true}).waitFor()
    assert.equal(await drawer.getByRole('button',{name:'Retry request',exact:true}).count(),0)

    // Expired authority resumes the same job, with no new owner message or model turn.
    renewMode = 'unavailable'; cancelMode = 'success'
    const pausedJob = {role:'user',text:'Resume this exact planning request',turn_id:crypto.randomUUID(),jobId:crypto.randomUUID(),jobStatus:'paused',background:true,error:'authentication_expired',delivery_state:'pending',updated_at:new Date().toISOString(),seq:activeHistory.next_seq++}
    activeHistory.messages.push(pausedJob)
    const beforeRenew = answerCalls
    await page.reload(); drawer = await open()
    await drawer.getByText('Paused: session expired',{exact:true}).waitFor()
    assert.equal(await drawer.locator('.bob-hammer').count(),0)
    await drawer.getByRole('button',{name:'Reconnect',exact:true}).click()
    await drawer.getByRole('alert').filter({hasText:'Bob could not reconnect'}).waitFor()
    renewMode = 'success'
    await drawer.getByRole('button',{name:'Reconnect',exact:true}).click()
    await drawer.getByRole('button',{name:'Reconnect',exact:true}).waitFor({state:'hidden'})
    assert.equal(answerCalls,beforeRenew)
    await drawer.getByRole('button',{name:'Stop',exact:true}).click()
    await drawer.getByRole('button',{name:'Stop',exact:true}).waitFor({state:'hidden'})
    assert.equal(cancelCalls,3)
    sendMode = 'normal'
    // Stop queues a project refresh on close. Start with a fully loaded drawer
    // so the following race pauses a reopening read, not its initial history load.
    await page.reload(); drawer = await open()
    await drawer.locator('button:enabled', {hasText:'New conversation'}).waitFor()
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
    assert.equal(await drawer.getByText('Stopped at your request. Changes already saved remain in the project. The request was not completed.',{exact:true}).count(),2,'owner stops stay in history after a new instruction')
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
    const budgetTurn = '6aa673cd-5d1f-4f6f-94b5-611d404969cb'
    const recoveryRequest = '3bc79294-7c78-4ca0-a97a-0e5dea4f672b'
    const stopped = {role:'user',text:'Budget-limited drawing',turn_id:budgetTurn,delivery_state:'failed',background:true,error:'turn_budget_exhausted',updated_at:new Date().toISOString(),seq:h.next_seq++}
    h.messages.push(stopped)
    const beforeBudgetReload=answerCalls
    await page.reload();drawer=await open()
    await drawer.getByText('Bob stopped because this request reached its AI spending or call limit. Review what was saved before starting a new request.',{exact:true}).waitFor()
    assert.equal(await drawer.getByRole('button',{name:'Retry request',exact:true}).count(),0)
    assert.equal(answerCalls,beforeBudgetReload)
    await page.screenshot({path:`test-results/bob-budget-stop-${viewport.width}.png`})
    // The real bed regression: a completed event has its own turn ID. Only the
    // exact-origin server projection settles the stale CAD spending notice.
    await drawer.getByRole('textbox').fill('Keep this unsent recovery draft')
    stopped.drawingRecovery={scope:'drawing',status:'completed',requestIds:[recoveryRequest]}
    h.messages.push({role:'assistant',text:'Ritningen är sparad.',turn_id:'75d8631f-44f1-4fda-b1d0-188b2cec2d1c',delivery_state:'completed',seq:h.next_seq++,evidence:{kind:'ai_assessment',sources:[],partial:false,writes:[{projectId:'A',dataset:'artifacts',recordId:'2ba8576b-c4c3-4136-9b7f-f31ecb6caa7d',revision:1,areaId:null,label:'Recovered drawing',operation:'created',savedAt:new Date().toISOString()}]}})
    await page.evaluate(()=>window.dispatchEvent(new Event('bob:inbox-changed')))
    await drawer.getByText('Ritningen är sparad.',{exact:true}).waitFor()
    assert.equal(await drawer.getByText('Bob stopped because this request reached its AI spending or call limit. Review what was saved before starting a new request.',{exact:true}).count(),0)
    assert.equal(await drawer.getByRole('button',{name:'Retry request',exact:true}).count(),0)
    assert.equal(await drawer.getByRole('textbox').inputValue(),'Keep this unsent recovery draft')
    assert.equal(answerCalls,beforeBudgetReload,'Idle event delivery never sends another owner/model turn')
    await drawer.getByText('The drawing was saved after the earlier interruption.',{exact:true}).waitFor()
    await page.screenshot({path:`test-results/bob-drawing-recovery-${viewport.width}.png`})
    await page.reload();drawer=await open()
    await drawer.getByText('Ritningen är sparad.',{exact:true}).waitFor()
    assert.equal(await drawer.getByText('Bob stopped because this request reached its AI spending or call limit. Review what was saved before starting a new request.',{exact:true}).count(),0)
    assert.equal(await drawer.getByRole('button',{name:'Retry request',exact:true}).count(),0)
    assert.equal(answerCalls,beforeBudgetReload)
    // A fresh delegated attempt can become active without advancing inbox seq.
    // Its own expiry/progress takes precedence over the old failed job.
    const activeRecovery={role:'user',text:'Another stopped drawing',turn_id:crypto.randomUUID(),delivery_state:'failed',background:true,error:'turn_budget_exhausted',updated_at:new Date().toISOString(),seq:h.next_seq++}
    h.messages.push(activeRecovery)
    await page.reload();drawer=await open()
    await drawer.getByText('Bob stopped because this request reached its AI spending or call limit. Review what was saved before starting a new request.',{exact:true}).waitFor()
    activeRecovery.drawingRecovery={scope:'drawing',status:'running',requestIds:[crypto.randomUUID()],expiresAt:new Date(Date.now()+10*60_000).toISOString(),progress:{stage:'tool',tool:'design_project_cad',step:6,saved:0}}
    await page.evaluate(()=>window.dispatchEvent(new Event('focus')))
    await drawer.getByText('Designing the drawing — this can take a few minutes…',{exact:true}).waitFor()
    assert.equal(await drawer.getByText('Bob stopped because this request reached its AI spending or call limit. Review what was saved before starting a new request.',{exact:true}).count(),0)
    assert.equal(await drawer.getByRole('button',{name:'Retry request',exact:true}).count(),0)
    activeRecovery.drawingRecovery={...activeRecovery.drawingRecovery,status:'completed'}
    h.messages.push({role:'assistant',text:'ACTIVE DRAWING RECOVERED',turn_id:crypto.randomUUID(),delivery_state:'completed',seq:h.next_seq++})
    await drawer.getByText('ACTIVE DRAWING RECOVERED',{exact:true}).waitFor()
    await drawer.locator('.bob-working').waitFor({state:'hidden'})
    assert.equal(answerCalls,beforeBudgetReload)
    // An unrelated saved event cannot settle a newer failed owner instruction.
    h.messages.push({role:'user',text:'Unrelated failed instruction',turn_id:crypto.randomUUID(),delivery_state:'failed',background:true,error:'turn_budget_exhausted',updated_at:new Date().toISOString(),seq:h.next_seq++})
    h.messages.push({role:'assistant',text:'UNRELATED DRAWING SAVED',turn_id:crypto.randomUUID(),delivery_state:'completed',seq:h.next_seq++})
    await page.evaluate(()=>window.dispatchEvent(new Event('bob:inbox-changed')))
    await drawer.getByText('UNRELATED DRAWING SAVED',{exact:true}).waitFor()
    await drawer.getByText('Bob stopped because this request reached its AI spending or call limit. Review what was saved before starting a new request.',{exact:true}).waitFor()
    assert.equal(answerCalls,beforeBudgetReload)
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
      await drawer.getByText('Bob is finishing earlier work, such as a drawing. Your message is kept and sends by itself when he is free.', { exact: true }).waitFor()
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
        await page.evaluate(() => {
          const key = Object.keys(localStorage).find(key => key.startsWith('sb-') && key.endsWith('-auth-token'))
          if (!key) throw new Error('Missing fixture Auth session')
          const session = JSON.parse(localStorage.getItem(key))
          session.user.id = '00000000-0000-0000-0000-000000000099'
          localStorage.setItem(key, JSON.stringify(session))
        })
        await page.reload(); drawer = await open()
        assert.equal(await drawer.getByText(complement, { exact: true }).count(), 0)
        authMode = 'member'
        await page.evaluate(id => {
          const key = Object.keys(localStorage).find(key => key.startsWith('sb-') && key.endsWith('-auth-token'))
          if (!key) throw new Error('Missing fixture Auth session')
          const session = JSON.parse(localStorage.getItem(key))
          session.user.id = id
          localStorage.setItem(key, JSON.stringify(session))
        }, user.id)
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
    // A message rejected while Bob finishes background work resends itself in
    // this tab, with the same turn id, once he is free.
    sendMode = 'collision'
    const autoBefore = answerCalls
    await drawer.getByRole('textbox').fill('Sends when Bob is free')
    const firstTry = page.waitForRequest(r => new URL(r.url()).pathname === '/functions/v1/ask-bob' && r.postDataJSON()?.message === 'Sends when Bob is free')
    await drawer.getByRole('button', { name: 'Send', exact: true }).click()
    const firstBody = (await firstTry).postDataJSON()
    await drawer.getByText('Bob is finishing earlier work, such as a drawing. Your message is kept and sends by itself when he is free.', { exact: true }).waitFor()
    sendMode = 'normal'
    const autoAnswers = await drawer.getByText('FRESH ANSWER', { exact: true }).count()
    const resent = page.waitForRequest(r => new URL(r.url()).pathname === '/functions/v1/ask-bob' && r.postDataJSON()?.message === 'Sends when Bob is free', { timeout: 20_000 })
    assert.equal((await resent).postDataJSON().clientTurnId, firstBody.clientTurnId)
    await drawer.getByText('FRESH ANSWER', { exact: true }).nth(autoAnswers).waitFor()
    assert.equal(answerCalls, autoBefore + 2)
    assert.equal(await drawer.getByRole('button', { name: 'Retry request', exact: true }).count(), 0)
    // Successful reset clears held text too; a failed reset preserves it.
    sendMode = 'collision'
    await drawer.getByRole('textbox').fill('Held before reset')
    await drawer.getByRole('button', { name: 'Send', exact: true }).click()
    await drawer.getByText('Bob is finishing earlier work, such as a drawing. Your message is kept and sends by itself when he is free.', { exact: true }).waitFor()
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
    // Oversized context is a terminal outcome for this exact input, with an
    // editable next request. Neither HTTP failure nor a failed durable job
    // should trap the owner in the same Retry request or require clearing chat.
    const beforeOversize = histories.get('A')
    beforeOversize.id ??= crypto.randomUUID()
    const savedTurn = crypto.randomUUID()
    beforeOversize.messages.push({ role: 'user', text: 'Save the earlier planning brief', turn_id: savedTurn, delivery_state: 'completed', seq: beforeOversize.next_seq++ },
      { role: 'assistant', text: 'EARLIER PLANNING BRIEF SAVED', turn_id: savedTurn, delivery_state: 'completed', seq: beforeOversize.next_seq++,
        evidence: { kind: 'ai_assessment', sources: [], partial: false, writes: [{ projectId: 'A', dataset: 'tasks', recordId: 'retained-brief',
          label: 'Preserved planning brief', operation: 'updated', savedAt: new Date().toISOString() }] } })
    const preservedPrefix = structuredClone(beforeOversize.messages)
    for (const mode of ['context-too-large', 'background-context-too-large']) {
      // A fresh read also removes the earlier mode's transient error notice
      // once its smaller follow-up has completed.
      await page.reload(); drawer = await open()
      await drawer.getByText('EARLIER PLANNING BRIEF SAVED', { exact: true }).waitFor()
      sendMode = mode
      const requestText = `Oversized material ${mode}`
      const callsBefore = answerCalls, resetBefore = resetCalls
      const arrival = page.waitForRequest(req => new URL(req.url()).pathname === '/functions/v1/ask-bob' && req.postDataJSON()?.message === requestText)
      await drawer.getByRole('textbox').fill(requestText)
      await drawer.getByRole('button', { name: 'Send', exact: true }).click()
      const failedBody = (await arrival).postDataJSON()
      if (mode === 'background-context-too-large') {
        await drawer.getByRole('button', { name: 'Stop', exact: true }).waitFor()
        await drawer.getByRole('textbox').fill('Keep this smaller follow-up draft')
        releaseAnswer()
      }
      await drawer.getByText(contextTooLarge, { exact: true }).waitFor()
      assert.equal(await drawer.getByRole('button', { name: 'Retry request', exact: true }).count(), 0)
      assert.equal(await drawer.getByRole('button', { name: 'Stop', exact: true }).count(), 0)
      assert.equal(await drawer.getByRole('textbox').inputValue(), mode === 'context-too-large' ? requestText : 'Keep this smaller follow-up draft')
      assert(await drawer.getByRole('button', { name: 'Send', exact: true }).isEnabled(), 'The owner can edit and send a smaller request')
      assert.equal(answerCalls, callsBefore + 1)
      assert.deepEqual(beforeOversize.messages.slice(0, preservedPrefix.length), preservedPrefix, 'Failure cannot alter saved history or receipts')
      await page.reload(); drawer = await open()
      await drawer.getByText(contextTooLarge, { exact: true }).waitFor()
      assert.equal(await drawer.getByRole('button', { name: 'Retry request', exact: true }).count(), 0)
      assert.equal(await drawer.getByRole('button', { name: 'Stop', exact: true }).count(), 0)
      assert.equal(answerCalls, callsBefore + 1, 'Reload never resubmits the unchanged oversized input')
      while (await drawer.getByRole('button', { name: 'Show older messages', exact: true }).count()) {
        await Promise.all([
          page.waitForResponse(response => new URL(response.url()).pathname === '/rest/v1/bob_messages'),
          drawer.getByRole('button', { name: 'Show older messages', exact: true }).click(),
        ])
        await drawer.getByRole('button', { name: 'Loading older messages…', exact: true }).waitFor({ state: 'hidden' })
      }
      await drawer.getByText('EARLIER PLANNING BRIEF SAVED', { exact: true }).waitFor()
      await drawer.getByText('Preserved planning brief', { exact: false }).waitFor()
      await drawer.getByText(contextTooLarge, { exact: true }).scrollIntoViewIfNeeded()
      await page.screenshot({ path: `test-results/bob-${mode}-${viewport.width}.png` })
      assert(await drawer.evaluate(element => element.scrollWidth <= element.clientWidth + 1), 'Context error remains readable without horizontal overflow')
      sendMode = 'normal'
      const smallerText = `Work on one smaller part after ${mode}`
      const smaller = page.waitForRequest(req => new URL(req.url()).pathname === '/functions/v1/ask-bob' && req.postDataJSON()?.message === smallerText)
      const answersBefore = await drawer.getByText('FRESH ANSWER', { exact: true }).count()
      await drawer.getByRole('textbox').fill(smallerText)
      await drawer.getByRole('button', { name: 'Send', exact: true }).click()
      assert.notEqual((await smaller).postDataJSON().clientTurnId, failedBody.clientTurnId, 'Edited scope starts a new logical request')
      await drawer.getByText('FRESH ANSWER', { exact: true }).nth(answersBefore).waitFor()
      assert.equal(answerCalls, callsBefore + 2)
      assert.equal(resetCalls, resetBefore, 'Recovering with a smaller request does not clear the conversation')
      assert.equal(sentTurns.filter(turn => turn.clientTurnId === failedBody.clientTurnId).length, 1)
      assert.deepEqual(beforeOversize.messages.slice(0, preservedPrefix.length), preservedPrefix)
    }
    // Shared guest must clear only this device; an auth failure is never guest mode.
    // A cold open fetches five messages; older pages keep the draft and scroll.
    const pagedHistory = histories.get('A')
    const backup = structuredClone(pagedHistory)
    pagedHistory.id = crypto.randomUUID()
    pagedHistory.messages = Array.from({length:20},(_,i)=>({role:i%2?'assistant':'user',text:`PAGED MESSAGE ${i+1}`,delivery_state:'completed',seq:i+1,turn_id:`page-${Math.floor(i/2)}`}))
    pagedHistory.next_seq=21
    await page.reload();drawer=await open()
    await drawer.getByText('PAGED MESSAGE 20',{exact:true}).waitFor()
    assert.equal(await drawer.getByText('PAGED MESSAGE 1',{exact:true}).count(),0)
    assert.equal(await drawer.getByText('PAGED MESSAGE 15',{exact:true}).count(),0)
    await drawer.getByRole('textbox').fill('Keep this draft while reading older messages')
    for(let i=0;i<3;i++)await drawer.getByRole('button',{name:'Show older messages',exact:true}).click()
    await drawer.getByText('PAGED MESSAGE 1',{exact:true}).waitFor()
    assert.equal(await drawer.getByText('PAGED MESSAGE 20',{exact:true}).count(),1)
    assert.equal(await drawer.getByRole('textbox').inputValue(),'Keep this draft while reading older messages')
    assert.equal(await drawer.getByRole('button',{name:'Show older messages',exact:true}).count(),0)
    await page.screenshot({path:`test-results/bob-history-pages-${viewport.width}.png`})
    // Remounting shows only the recent in-memory preview while the server read
    // is delayed. Sending remains disabled until fresh state has been checked.
    const cachedRead = new Promise(resolve=>{historyPaused=resolve})
    pauseHistory=true
    await page.evaluate(()=>window.dispatchEvent(new Event('bob:project-changed')))
    drawer=await open();await cachedRead
    await drawer.getByText('PAGED MESSAGE 20',{exact:true}).waitFor()
    assert.equal(await drawer.getByText('PAGED MESSAGE 1',{exact:true}).count(),0)
    assert(await drawer.getByRole('button',{name:'Send',exact:true}).isDisabled())
    releaseHistory()
    await drawer.locator('button:enabled',{hasText:'New conversation'}).waitFor()
    // A stalled Sidebar membership read no longer blocks server-owned history.
    pauseMembership = true
    await page.evaluate(()=>window.dispatchEvent(new Event('bob:project-changed')))
    drawer = await open()
    await drawer.locator('button:enabled',{hasText:'New conversation'}).waitFor()
    await drawer.getByRole('textbox').fill('Keep my draft through session renewal')
    assert(await drawer.getByRole('button',{name:'Send',exact:true}).isEnabled())
    assert(heldMembership.length > 0)
    pauseMembership = false
    heldMembership.splice(0).forEach(resolve=>resolve())
    // Real SDK broadcast events for a same-owner token refresh and focus sign-in.
    // Each event must revalidate project access without unmounting the drawer.
    for (const event of ['TOKEN_REFRESHED', 'SIGNED_IN']) {
      const checked = page.waitForResponse(r=>new URL(r.url()).pathname==='/rest/v1/projects')
      await page.evaluate(event => {
        const key = Object.keys(localStorage).find(key => key.startsWith('sb-') && key.endsWith('-auth-token'))
        const channel = new BroadcastChannel(key)
        channel.postMessage({event, session:JSON.parse(localStorage.getItem(key))}); channel.close()
      }, event)
      await (await checked).finished()
      await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
      assert(await drawer.isVisible(), 'Session renewal keeps the drawer mounted')
      assert.equal(await drawer.getByRole('textbox').inputValue(),'Keep my draft through session renewal')
    }
    await page.screenshot({path:`test-results/bob-session-preserved-${viewport.width}.png`})
    // An active durable job reads progress without retransferring the transcript.
    const activityAt = new Date().toISOString()
    const active={role:'user',text:'PAGED ACTIVE WORK',seq:21,turn_id:crypto.randomUUID(),jobId:crypto.randomUUID(),background:true,jobStatus:'running',delivery_state:'pending',updated_at:new Date(Date.now()-26*60_000).toISOString(),progress:{stage:'thinking',step:28,saved:3,at:activityAt}}
    pagedHistory.messages.push(active);pagedHistory.next_seq=22
    await page.reload();drawer=await open()
    await drawer.getByRole('button',{name:'Stop',exact:true}).waitFor()
    const workStatus = drawer.getByRole('status',{name:'Bob work status',exact:true})
    await workStatus.getByText('Thinking through the next step… · 3 changes saved',{exact:true}).waitFor()
    assert.equal(await workStatus.locator('time').getAttribute('datetime'),activityAt)
    await drawer.getByRole('textbox').fill('Keep my next instruction while Bob works')
    // Ten short rows can still fit within the tall phone's follow-at-end
    // threshold. Open the full older history so this is really an older read,
    // and let the pagination's scroll anchoring finish before scrolling back.
    for (const first of [12,7,2,1]) {
      await drawer.getByRole('button',{name:'Show older messages',exact:true}).click()
      await drawer.getByText(`PAGED MESSAGE ${first}`,{exact:true}).waitFor()
    }
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
    assert(await drawer.locator('.bob-history').evaluate(el=>el.scrollHeight-el.clientHeight>128),'Older-reading fixture must overflow beyond the follow-at-end threshold')
    await drawer.locator('.bob-history').evaluate(el=>{el.scrollTop=0})
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
    const workBounds = await workStatus.boundingBox(), composerBounds = await drawer.locator('.bob-composer').boundingBox()
    assert(workBounds && composerBounds && workBounds.y >= 0 && workBounds.y+workBounds.height <= composerBounds.y+1, 'Progress stays above the composer when reading older messages')
    await page.screenshot({path:`test-results/bob-live-status-${viewport.width}.png`})
    const beforeHistory=historyReads,beforeStatus=statusReads
    await page.waitForResponse(r=>new URL(r.url()).pathname==='/rest/v1/rpc/bob_job_status')
    await page.waitForResponse(r=>new URL(r.url()).pathname==='/rest/v1/rpc/bob_job_status')
    assert(statusReads>=beforeStatus+2)
    assert.equal(historyReads,beforeHistory,'progress polls never reload transcript rows')
    active.progress={stage:'tool',tool:'check_construction',step:29,saved:4,at:new Date().toISOString()}
    await workStatus.getByText('Working on the construction… · 4 changes saved',{exact:true}).waitFor()
    assert.equal(await drawer.getByRole('textbox').inputValue(),'Keep my next instruction while Bob works')
    assert(await drawer.locator('.bob-history').evaluate(el=>el.scrollTop<2),'Progress updates preserve older reading position')
    statusMode='offline'
    await workStatus.getByText('Connection interrupted. Checking for Bob’s answer…',{exact:true}).waitFor()
    statusMode='normal'
    await workStatus.getByText('Working on the construction… · 4 changes saved',{exact:true}).waitFor()
    active.delivery_state='completed';active.jobStatus='completed'
    pagedHistory.messages.push({role:'assistant',text:'PAGED WORK FINISHED',delivery_state:'completed',seq:22,turn_id:active.turn_id});pagedHistory.next_seq=23
    await drawer.getByText('PAGED WORK FINISHED',{exact:true}).waitFor()
    assert.equal(await workStatus.count(),0,'Completion replaces working status with the saved answer')
    dialog=await confirm()
    await dialog.getByRole('button',{name:'Clear chat and context',exact:true}).click()
    await drawer.getByText('New conversation started. Saved project data is unchanged.',{exact:true}).waitFor()
    assert.equal(await drawer.getByRole('button',{name:'Show older messages',exact:true}).count(),0)
    assert.equal(await drawer.getByText('PAGED MESSAGE 20',{exact:true}).count(),0)
    Object.assign(pagedHistory,backup)
    const beforeGuest = resetCalls
    authMode = 'guest'
    // Reflect the account switch in the persisted Auth session as well as the
    // mocked Auth endpoint; RLS requests and cache partition use that session.
    await page.evaluate(()=>{
      const key=Object.keys(localStorage).find(key=>key.startsWith('sb-')&&key.endsWith('-auth-token'))
      if(!key)throw new Error('Missing fixture Auth session')
      const session=JSON.parse(localStorage.getItem(key))
      session.user.email='guest@bob.local'
      localStorage.setItem(key,JSON.stringify(session))
    })
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
