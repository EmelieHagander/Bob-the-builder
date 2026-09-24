// Production React and Supabase RPC client, with synthetic HTTP data only.
// The SQL tests separately prove that no auth.users account is created.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright-core'

const base = 'http://127.0.0.1:4173/Bob-the-builder/', api = 'https://pwa-proof.invalid'
const invitation = 'c'.repeat(64), otherInvitation = 'd'.repeat(64)
const drawingIds = ['81000000-0000-4000-8000-000000000001', '81000000-0000-4000-8000-000000000002', '81000000-0000-4000-8000-000000000003']
const drawingTitles = ['Bench assembly CAD', 'Storage box construction', 'Saved drawing image']
const savedSvg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="400" viewBox="0 0 800 400"><rect width="800" height="400" fill="white"/><rect x="80" y="100" width="640" height="160" fill="none" stroke="black" stroke-width="3"/><text x="310" y="300" font-size="28">800 × 200 mm</text></svg>').toString('base64')
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--base', '/Bob-the-builder/', '--host', '127.0.0.1', '--port', '4173', '--strictPort'], { stdio: ['ignore', 'pipe', 'pipe'] })
let logs = '', browser, activePage
server.stdout.on('data', chunk => { logs += chunk }); server.stderr.on('data', chunk => { logs += chunk })

async function fixture(viewport) {
  const context = await browser.newContext({ viewport, serviceWorkers: 'block' })
  const state = { joined: false, secret: '', food: false, name: '', allergies: null, profileRevision: 1, mine: false, status: 'todo', taskRevision: 1, checkRevision: 1, checked: false, going: false, revoked: false, unavailable: false, drawingsLinked: true, drawingRevision: 1, drawingSource: 'current', writes: [], errors: [] }
  const profileTime = () => `2026-09-14T06:00:${String(state.profileRevision).padStart(2, '0')}Z`
  const taskTime = () => `2026-09-14T06:01:${String(state.taskRevision).padStart(2, '0')}Z`
  const project = { name: 'The community garden and long workshop renovation', description: 'Help make a place for everyone.', location: 'The garden', theme: 'birch', startLabel: 'Saturday', startDate: null, endDate: null }
  const snapshot = () => ({ projectId: 'A', linkId: 'L', project, person: { id: 'v-Kim', name: state.name, allergies: state.food ? state.allergies : null, updatedAt: profileTime() }, hasFood: state.food, expiresAt: '2099-01-01T00:00:00Z' })
  const task = () => ({ projectId: 'A', id: 'T', name: 'Paint the bench', area: 'Garden', status: state.status, instructions: 'Prepare the surface before painting.', updatedAt: taskTime(), mine: state.mine, images: [{id: '80000000-0000-4000-8000-000000000001', title: 'Primary Step assembly guide'}], steps: [{ id: 'S', title: 'Check the surface', instructions: 'Ask the crew before starting if you are unsure.', required: true, isCheckpoint: true, completedAt: state.checked ? taskTime() : null, revision: state.checkRevision }] })
  const drawingSummary = index => ({id:drawingIds[index],title:drawingTitles[index],revision:state.drawingRevision,status:'concept',stepId:'work-step',stepTitle:'Assemble the bench',sourceState:state.drawingSource,sourceReasons:state.drawingSource==='current'?[]:['target_changed']})
  await context.route('https://fonts.googleapis.com/**', route => route.abort())
  await context.route(api + '/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname
    const respond = options => route.fulfill({ ...options, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'POST,OPTIONS' } })
    if (request.method() === 'OPTIONS') return respond({ status: 204 })
    if (path === '/functions/v1/volunteer-media') {
      const body = request.postDataJSON()
      assert.deepEqual(body, {session: state.secret, taskId: 'T', mediaId: '80000000-0000-4000-8000-000000000001', ...(body.drawingId ? {drawingId:drawingIds[2],revision:state.drawingRevision} : {})})
      if (body.drawingId) assert(state.drawingsLinked && state.drawingSource !== 'unavailable')
      assert(!state.revoked)
      return route.fulfill({status:200,contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=','base64'),headers:{'Access-Control-Allow-Origin':'*'}})
    }
    assert(!path.startsWith('/auth/'), 'The volunteer journey must never call Auth')
    assert(path.startsWith('/rest/v1/rpc/volunteer_'), 'Guest must not query raw tables, account or shared-app APIs')
    const body = request.postDataJSON(), name = path.split('/').at(-1)
    if (state.unavailable) return respond({ status: 404, json: { code: 'PGRST202', message: 'Not installed' } })
    if (state.revoked) return respond({ status: 403, json: { code: '42501', message: 'Volunteer access is unavailable. Ask the organiser for a new link.' } })
    if (name === 'volunteer_preview') return respond({ json: { linkId: body.p_secret === otherInvitation ? 'OTHER' : 'L', projectId: body.p_secret === otherInvitation ? 'B' : 'A', projectName: body.p_secret === otherInvitation ? 'A different project' : project.name, hasFood: state.food, expiresAt: '2099-01-01T00:00:00Z' } })
    if (name === 'volunteer_join') {
      assert.equal(body.p_invite, invitation)
      assert.match(body.p_session, /^[0-9a-f]{64}$/)
      assert.notEqual(body.p_session, invitation)
      assert.equal(body.p_allergies, null, 'No allergy collection without food')
      state.secret = body.p_session; state.name = body.p_name; state.joined = true
      state.writes.push(name)
      return respond({ json: snapshot() })
    }
    assert(state.joined)
    assert.equal(body.p_secret, state.secret)
    if (name === 'volunteer_state') return respond({ json: snapshot() })
    if (name === 'volunteer_profile') {
      assert.equal(body.p_expected, profileTime())
      assert(state.food || body.p_allergies === null)
      state.profileRevision++; state.name = body.p_name; state.allergies = body.p_allergies
      return respond({ json: snapshot() })
    }
    if (name === 'volunteer_feed') {
      const items = body.p_section === 'tasks' ? [{ id: 'T', name: 'Paint the bench', area: 'Garden', status: state.status, mine: state.mine, skill: 'novice', hours: '1h' }]
        : body.p_section === 'events' ? [{ id: 'E', title: 'Build Saturday', day: 'Saturday', time: '10:00', place: 'The garden', food: state.food ? 'Lunch together' : '', going: state.going }]
        : body.p_section === 'meals' ? [{ id: 'M', meal: 'Lunch', time: '12:00', dish: 'Soup', notes: 'Meet at the big table' }]
        : [{ id: 'U', text: 'Welcome to the build day!', pinned: true, createdAt: '2026-09-14T00:00:00Z' }]
      return respond({ json: { projectId: 'A', items, nextCursor: null } })
    }
    if (name === 'volunteer_drawings') {
      assert.equal(body.p_task, 'T'); assert.equal(body.p_after, null)
      return respond({json:{projectId:'A',taskId:'T',items:state.drawingsLinked?drawingIds.map((_,index)=>drawingSummary(index)):[],nextCursor:null}})
    }
    if (name === 'volunteer_drawing') {
      assert.equal(body.p_task, 'T')
      const index=drawingIds.indexOf(body.p_drawing);assert(index>=0)
      if (!state.drawingsLinked || body.p_revision!==state.drawingRevision) return respond({status:403,json:{message:'Drawing unavailable or changed. Refresh the task to see its current drawings.'}})
      const content={imageId:null,cad:null,parametricRecipe:null,generation:null,roomLayout:null,multifloorPlan:null,stairStudy:null}
      if(index===0)content.cad={recipe:{definitions:[{id:'seat',primitive:'box',x_mm:800,y_mm:200,z_mm:18}]},files:{front:savedSvg},source_changed:state.drawingSource==='changed'}
      if(index===1)content.parametricRecipe={generator:'storage_box_v1',version:1,width_mm:800,height_mm:350,depth_mm:600,thickness_mm:18}
      if(index===2)content.imageId='80000000-0000-4000-8000-000000000001'
      return respond({json:{...drawingSummary(index),projectId:'A',taskId:'T',kind:'detail',description:'Saved construction for this work step.',assumptions:'Confirm site fit with the organiser.',content:state.drawingSource==='unavailable'?null:content}})
    }
    if (name === 'volunteer_task') { assert.equal(body.p_task, 'T'); return respond({ json: task() }) }
    if (name === 'volunteer_task_action') {
      assert.equal(body.p_task, 'T')
      if (body.p_action === 'claim') state.mine = true
      else if (body.p_action === 'release') state.mine = false
      else if (body.p_action === 'check') { assert.equal(body.p_data.revision, state.checkRevision); state.checked = body.p_data.completed; state.checkRevision++ }
      else { assert.equal(body.p_data.expectedUpdatedAt, taskTime()); assert(state.checked || body.p_data.status !== 'done'); state.status = body.p_data.status; state.taskRevision++ }
      return respond({ json: task() })
    }
    if (name === 'volunteer_rsvp') { assert.equal(body.p_event, 'E'); state.going = body.p_going; return respond({ json: { projectId: 'A', eventId: 'E', going: state.going } }) }
    state.errors.push('Unexpected request ' + name)
    return respond({ status: 500, json: { message: 'Unexpected request' } })
  })
  const page = await context.newPage(); activePage = page; page.setDefaultTimeout(15000)
  page.on('pageerror', error => state.errors.push(error.message))
  return { context, page, state }
}
async function layout(page, viewport, label) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), label + ': no horizontal overflow')
  for (const button of await page.getByRole('button').all()) {
    if (!(await button.isVisible())) continue
    const bounds = await button.boundingBox()
    assert(bounds && bounds.width >= 44 && bounds.height >= 44, label + ': 44px touch targets')
  }
  await page.screenshot({ path: `test-results/volunteer-${label}-${viewport.width}.png`, fullPage: true })
}
try {
  for (let tries = 0; ; tries++) {
    try { if ((await fetch(base)).ok) break } catch {}
    assert(tries < 40 && server.exitCode === null, 'Preview did not start: ' + logs)
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] })
  await mkdir('test-results', { recursive: true })
  for (const viewport of [{ width: 320, height: 740 }, { width: 390, height: 844 }, { width: 1280, height: 900 }]) {
    const { context, page, state } = await fixture(viewport)
    await page.goto(base + '#/volunteer/' + invitation)
    await page.getByLabel('Your name', { exact: true }).waitFor()
    assert.equal(await page.locator('input[type="email"],input[type="password"]').count(), 0)
    assert.equal(await page.getByLabel('Allergies (optional)', { exact: true }).count(), 0)
    await page.getByLabel('Your name', { exact: true }).fill('Alexandra Longname')
    await layout(page, viewport, 'join')
    await page.getByRole('button', { name: 'Join as volunteer', exact: true }).click()
    await page.getByRole('button', { name: 'View task', exact: true }).waitFor()
    assert.equal(state.name, 'Alexandra Longname')
    await page.reload()
    await page.getByRole('button', { name: 'View task', exact: true }).waitFor()
    assert.equal(state.writes.filter(name => name === 'volunteer_join').length, 1, 'Reload restores the same participant without registering again')
    await page.getByRole('button', { name: 'View task', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Paint the bench', exact: true })
    await dialog.getByText('Prepare the surface before painting.', { exact: true }).waitFor()
    await dialog.getByRole('heading',{name:'Task, step & area images',exact:true}).waitFor()
    await dialog.getByRole('button',{name:'View image',exact:true}).click()
    await dialog.getByRole('img',{name:'Primary Step assembly guide',exact:true}).waitFor()
    assert(await dialog.getByRole('img',{name:'Primary Step assembly guide',exact:true}).evaluate(img=>img.complete && img.naturalWidth>0),'Original image bytes render')

    await dialog.getByRole('button',{name:'View drawing: Bench assembly CAD',exact:true}).click()
    let reader=dialog.getByRole('article',{name:'Drawing reader',exact:true})
    const cad=reader.getByRole('img',{name:'Bench assembly CAD — Front',exact:true})
    await cad.waitFor();assert(await cad.evaluate(img=>img.complete&&img.naturalWidth>0),'Saved CAD SVG renders as an image')
    assert.equal(await reader.getByRole('link',{name:'Download 3D model',exact:true}).count(),0)
    await cad.scrollIntoViewIfNeeded()
    await layout(page,viewport,'drawing-cad')
    state.drawingSource='changed'
    await reader.getByRole('button',{name:'Refresh drawing',exact:true}).click()
    await reader.getByText(/Sources changed after this version was saved/).waitFor()
    state.drawingSource='unavailable'
    await reader.getByRole('button',{name:'Refresh drawing',exact:true}).click()
    await reader.getByText(/The sources are no longer available/).waitFor()
    assert.equal(await reader.getByRole('img').count(),0,'Unavailable source removes previous geometry')
    state.drawingSource='current'
    await dialog.getByRole('button',{name:'View drawing: Storage box construction',exact:true}).click()
    await reader.getByRole('region',{name:'Parametric storage box drawing',exact:true}).waitFor()
    await reader.getByRole('button',{name:'Plan · open top',exact:true}).click()
    await reader.getByLabel('Plan · open top. Scroll to read the full drawing.',{exact:true}).scrollIntoViewIfNeeded()
    await layout(page,viewport,'drawing-box')
    await dialog.getByRole('button',{name:'View drawing: Saved drawing image',exact:true}).click()
    const savedImage=reader.getByRole('img',{name:'Saved drawing image — saved drawing',exact:true})
    await savedImage.waitFor();assert(await savedImage.evaluate(img=>img.complete&&img.naturalWidth>0),'Drawing image bytes render through the exact revision proxy')
    state.drawingRevision=2
    await reader.getByRole('button',{name:'Refresh drawing',exact:true}).click()
    await dialog.getByText('Drawing unavailable or changed. Refresh the task to see its current drawings.',{exact:true}).waitFor()
    assert.equal(await dialog.getByRole('article',{name:'Drawing reader',exact:true}).count(),0)
    await dialog.getByRole('button',{name:'Refresh task',exact:true}).click()
    await dialog.getByRole('button',{name:'View drawing: Bench assembly CAD',exact:true}).click()
    await reader.getByRole('heading',{name:'Bench assembly CAD · v2',exact:true}).waitFor()
    state.drawingsLinked=false
    await reader.getByRole('button',{name:'Refresh drawing',exact:true}).click()
    await dialog.getByRole('button',{name:'Refresh task',exact:true}).click()
    await dialog.getByText(/No drawings linked to this task’s current step yet/).waitFor()
    state.drawingsLinked=true
    await page.reload()
    await page.getByRole('button',{name:'View task',exact:true}).click()
    await dialog.getByRole('button',{name:'View drawing: Bench assembly CAD',exact:true}).click()
    await reader.getByRole('heading',{name:'Bench assembly CAD · v2',exact:true}).waitFor()

    await dialog.getByRole('button', { name: 'Join this task', exact: true }).click()
    await dialog.getByLabel('Task progress').selectOption('doing')
    await dialog.getByRole('button', { name: 'Complete instruction', exact: true }).click()
    await dialog.getByRole('button', { name: 'Reopen instruction', exact: true }).waitFor()
    await dialog.getByLabel('Task progress').selectOption('done')
    await dialog.getByText('Garden · Done', { exact: true }).waitFor()
    await layout(page, viewport, 'task')
    await dialog.getByRole('button', { name: 'Done', exact: true }).click()
    await page.getByRole('button', { name: 'Build days', exact: true }).click()
    await page.getByRole('button', { name: 'I’m coming', exact: true }).click()
    await page.getByRole('button', { name: 'Cancel my attendance', exact: true }).waitFor()
    assert(state.going)
    state.food = true
    await page.getByRole('button', { name: 'Refresh project', exact: true }).click()
    await page.getByRole('button', { name: 'My details', exact: true }).click()
    await page.getByLabel('Allergies (optional)', { exact: true }).fill('Peanuts')
    await layout(page, viewport, 'allergies')
    await page.getByRole('button', { name: 'Save my details', exact: true }).click()
    await page.getByText('Your project profile is saved.', { exact: true }).waitFor()
    assert.equal(state.allergies, 'Peanuts')
    assert(!await page.evaluate(() => JSON.stringify(localStorage).includes('Peanuts') || JSON.stringify(localStorage).includes('Alexandra')), 'Browser persistence contains capabilities, not name or allergy notes')
    await page.getByRole('button', { name: 'Food', exact: true }).click()
    await page.getByText('Soup', { exact: true }).waitFor()
    await page.reload()
    await page.getByRole('button', { name: 'My details', exact: true }).click()
    assert.equal(await page.getByLabel('Allergies (optional)').inputValue(), 'Peanuts')
    state.food = false
    const refreshedProfile = page.waitForResponse(response => response.url().endsWith('/rpc/volunteer_state'))
    await page.getByRole('button', { name: 'Refresh project', exact: true }).click()
    assert.equal((await (await refreshedProfile).json()).hasFood, false)
    await page.getByLabel('Allergies (optional)').waitFor({ state: 'detached' })
    await page.getByRole('button', { name: 'My details', exact: true }).waitFor()
    assert.equal(await page.getByLabel('Allergies (optional)').count(), 0)
    assert.equal(await page.getByRole('button', { name: 'Food', exact: true }).count(), 0)
    await page.goto(base + '#/volunteer/' + otherInvitation)
    await page.getByRole('heading', { name: 'A different project', exact: true }).waitFor()
    await page.getByRole('button', { name: 'Join as volunteer', exact: true }).waitFor()
    assert.equal(await page.getByRole('button', { name: 'View task', exact: true }).count(), 0, 'A different invitation must not reuse the old project session')
    await page.goto(base + '#/volunteer/' + invitation)
    await page.getByRole('button', { name: 'Refresh project', exact: true }).waitFor()
    await page.getByRole('button',{name:'Tasks',exact:true}).click()
    await page.getByRole('button',{name:'View task',exact:true}).click()
    await page.getByRole('button',{name:'View drawing: Bench assembly CAD',exact:true}).click()
    await page.getByRole('article',{name:'Drawing reader',exact:true}).waitFor()
    state.revoked = true
    await page.getByRole('button',{name:'Refresh drawing',exact:true}).click()
    await page.getByRole('alert').getByText('Volunteer access is unavailable. Ask the organiser for a new link.', { exact: true }).waitFor()
    assert.equal(await page.getByRole('button', { name: 'View task', exact: true }).count(), 0)
    assert.deepEqual(state.errors, [])
    await context.close()
    console.log(`Volunteer ${viewport.width}px: name-only/no Auth, optional food allergies, persistent participant, own task/check/attendance, current drawings/CAD/image bytes, source loss, revision/step changes, exact project route and reader revocation: OK`)
  }
} finally {
  if (activePage && !activePage.isClosed()) await activePage.screenshot({ path: 'test-results/volunteer-last-state.png', fullPage: true }).catch(() => {})
  if (browser) await browser.close().catch(() => {})
  server.kill('SIGTERM')
}
