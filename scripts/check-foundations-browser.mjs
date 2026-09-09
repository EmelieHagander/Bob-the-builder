// Production React + database.ts + Supabase client; only HTTP services are fixtures.
// No AI calls. The real SQL/RLS and deployed Storage service have separate checks.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { chromium } from 'playwright-core'

const base = 'http://127.0.0.1:4173/Bob-the-builder/'
const api = 'https://pwa-proof.invalid'
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--base', '/Bob-the-builder/', '--host', '127.0.0.1', '--port', '4173', '--strictPort'], { stdio: ['ignore', 'pipe', 'pipe'] })
let logs = '', browser
server.stdout.on('data', data => { logs += data })
server.stderr.on('data', data => { logs += data })
const projects = ['A', 'B'].map(id => ({ id, slug: id.toLowerCase(), name: 'Porch ' + id, description: '', location: '', type: 'Renovation', theme: 'birch', start_label: '', start_date: null, end_date: null }))
const user = { id: '00000000-0000-0000-0000-000000000003', email: 'fixture@example.test', aud: 'authenticated', role: 'authenticated', app_metadata: { provider: 'email' }, user_metadata: {}, created_at: '2026-09-09T00:00:00Z' }
const expiry = Math.floor(Date.now() / 1000) + 3600
const token = [JSON.stringify({ alg: 'HS256', typ: 'JWT' }), JSON.stringify({ sub: user.id, exp: expiry, role: 'authenticated' }), 'fixture-signature'].map(part => Buffer.from(part).toString('base64url')).join('.')
const delay = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }
try {
  for (let tries = 0; ; tries++) {
    try { if ((await fetch(base)).ok) break } catch {}
    if (tries > 40) throw new Error('Preview did not start: ' + logs)
    await new Promise(r => setTimeout(r, 250))
  }
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] })
  await mkdir('test-results', { recursive: true })
  for (const viewport of [{ width: 320, height: 740 }, { width: 390, height: 844 }, { width: 1280, height: 900 }]) {
    const context = await browser.newContext({ viewport, serviceWorkers: 'block' })
    const errors = [], assets = new Map(), objects = new Map(), steps = []
    let imageBytes, failUpload = false, slowDownload = null
    let clock = 0
    const timestamp = () => new Date(Date.UTC(2026, 8, 9, 12, 0, ++clock)).toISOString()
    const task = { id: 'taskA', area_id: 'areaA', name: 'Prepare opening', skill: 'novice', hours: '1h', status: 'todo', materials: '0 / 0', instructions: '', updated_at: timestamp(), task_assignees: [], areas: { project_id: 'A' } }
    const area = { id: 'areaA', project_id: 'A', slug: 'entry', name: 'Entry', description: 'Entry work', icon: 'house', lead_id: null, assigned_pct: 0, materials_pct: 0, done_pct: 0, task_summary: '', area_crew: [], area_reference_images: [{ label: 'Old reference note', sort_order: 1 }] }
    await context.route('https://fonts.googleapis.com/**', route => route.abort())
    await context.route(api + '/**', async route => {
      const request = route.request(), url = new URL(request.url()), path = url.pathname, method = request.method()
      const respond = options => route.fulfill({ ...options, headers: {
        'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
      } })
      const fail = message => respond({ status: 409, json: { message } })
      const eq = key => url.searchParams.get(key)?.replace(/^eq\./, '')
      if (method === 'OPTIONS') return respond({ status: 204 })
      if (path === '/auth/v1/token') return respond({ json: { access_token: token, refresh_token: 'fixture-refresh', token_type: 'bearer', expires_in: 3600, expires_at: expiry, user } })
      if (path === '/auth/v1/user') return respond({ json: user })
      if (path === '/auth/v1/logout') return respond({ json: {} })
      if (path.startsWith('/rest/') || path.startsWith('/storage/')) assert.equal(request.headers().authorization, 'Bearer ' + token)
      if (path === '/rest/v1/rpc/claim_project_invites') return respond({ json: 0 })
      if (path === '/rest/v1/projects') return respond({ json: projects })
      if (path === '/rest/v1/account') return respond({ json: { id: 'account', name: 'Fixture account', owner_name: '', email: '' } })
      if (path === '/rest/v1/people') return respond({ json: [{ id: 'memberA', name: 'Fixture member', initials: 'FM', color: '#41513f', role: 'Organiser', diet: '', person_skills: [] }] })
      if (path === '/rest/v1/areas') return respond({ json: eq('project_id') === 'B' ? [] : [area] })
      if (path === '/rest/v1/tasks') {
        if (method === 'PATCH') {
          const update = request.postDataJSON()
          if (update.status === 'done' && steps.some(s => s.required && !s.completed_at)) return fail('Complete required checks before marking this task done.')
          Object.assign(task, update, { updated_at: timestamp() })
          return respond({ json: null })
        }
        if (eq('areas.project_id') === 'B') return respond({ json: [] })
        return respond({ json: eq('id') ? task : [task] })
      }
      if (path === '/rest/v1/task_steps') return respond({ json: eq('project_id') === 'A' ? [...steps].sort((a, b) => a.position - b.position) : [] })
      if (path === '/rest/v1/rpc/task_steps_command') {
        const { p_project, p_task, p_action, p_step, p_data: data } = request.postDataJSON()
        assert.equal(p_project, 'A'); assert.equal(p_task, 'taskA')
        const step = steps.find(s => s.id === p_step)
        if (p_action === 'instructions') { task.instructions = data.instructions; task.updated_at = timestamp() }
        else if (p_action === 'create') steps.push({ id: randomUUID(), task_id: 'taskA', project_id: 'A', title: data.title, instructions: data.instructions, position: steps.length + 1, is_checkpoint: data.is_checkpoint, required: data.required, completed_at: null, revision: 1 })
        else {
          assert(step); assert.equal(data.revision, step.revision)
          if (p_action === 'complete') step.completed_at = data.completed ? timestamp() : null
          else if (p_action === 'edit') Object.assign(step, data)
          else if (p_action === 'move') {
            const ordered = [...steps].sort((a, b) => a.position - b.position), i = ordered.findIndex(s => s.id === step.id)
            const other = ordered[i + (data.direction === 'up' ? -1 : 1)]
            if (other) { const position = step.position; step.position = other.position; other.position = position; other.revision++ }
          } else if (p_action === 'delete') {
            steps.splice(steps.indexOf(step), 1)
            for (const image of assets.values()) image.media_links = image.media_links.filter(l => l.step_id !== step.id)
          }
          step.revision++
        }
        return respond({ json: { saved: true } })
      }
      if (path === '/rest/v1/media_assets') {
        let rows = [...assets.values()].filter(a => a.project_id === eq('project_id'))
        if (eq('id')) return respond({ json: rows.find(a => a.id === eq('id')) ?? null })
        for (const field of ['area_id', 'task_id', 'step_id']) {
          const id = eq('target.' + field)
          if (id) rows = rows.filter(a => a.media_links.some(link => link[field] === id))
        }
        rows.sort((a, b) => b.created_at.localeCompare(a.created_at))
        const offset = Number(url.searchParams.get('offset') ?? 0), limit = Number(url.searchParams.get('limit') ?? 13)
        return respond({ json: rows.slice(offset, offset + limit) })
      }
      if (path === '/rest/v1/rpc/media_command') {
        const { p_project, p_action, p_media, p_data: data } = request.postDataJSON()
        assert.equal(p_project, 'A')
        let image = assets.get(p_media)
        const link = () => {
          if (data.target_kind !== 'project') image.media_links.push({ id: randomUUID(), [data.target_kind + '_id']: data.target_id })
        }
        if (p_action === 'reserve') {
          image = { ...data, id: p_media, project_id: p_project, bucket_id: 'bob-project-media', object_path: p_project + '/' + p_media, state: 'pending', created_at: timestamp(), media_links: [] }
          assets.set(p_media, image); link()
        } else {
          assert(image)
          if (p_action === 'finalize') { if (!objects.has(image.object_path)) return fail('Upload incomplete. Remove this entry and choose the image again.'); image.state = 'ready' }
          else if (p_action === 'begin_delete') image.state = 'deleting'
          else if (p_action === 'finish_delete') { assert(!objects.has(image.object_path)); assets.delete(p_media); return respond({ json: { removed: true } }) }
          else if (p_action === 'link') link()
          else if (p_action === 'unlink') image.media_links = image.media_links.filter(l => l.id !== data.link_id)
          else throw new Error('Unexpected media command')
        }
        return respond({ json: image })
      }
      if (path.startsWith('/storage/v1/object/')) {
        const key = decodeURIComponent(path.split('/bob-project-media/')[1] ?? '')
        if (method === 'POST') {
          if (failUpload) { failUpload = false; return respond({ status: 400, json: { message: 'Fixture upload interrupted' } }) }
          assert(request.postDataBuffer().includes(imageBytes), 'Actual selected image bytes must reach Storage')
          assert.equal(request.headers()['x-upsert'], 'false')
          objects.set(key, imageBytes)
          return respond({ json: { Key: 'bob-project-media/' + key, Id: randomUUID() } })
        }
        if (method === 'GET') {
          if (slowDownload) { const waiting = slowDownload; slowDownload = null; await waiting.promise }
          const bytes = objects.get(key)
          return bytes ? respond({ contentType: 'image/png', body: bytes }) : respond({ status: 404, json: { message: 'Image missing' } })
        }
        if (method === 'DELETE') { for (const key of request.postDataJSON().prefixes) objects.delete(key); return respond({ json: [] }) }
      }
      if (path.startsWith('/rest/v1/') && method === 'GET') return respond({ json: [] })
      errors.push('Unexpected request: ' + method + ' ' + path)
      return respond({ status: 500, json: { message: 'Unexpected fixture request' } })
    })
    const page = await context.newPage()
    page.setDefaultTimeout(15000)
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(base + '#/signin')
    await page.getByPlaceholder('you@example.se').fill(user.email)
    await page.locator('input[type="password"]').fill('fixture-password')
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    await page.getByRole('heading', { name: 'Fixture account', exact: true }).waitFor()
    await page.locator('.card').filter({ hasText: 'Porch A' }).getByRole('button', { name: 'Open', exact: true }).click()
    imageBytes = Buffer.from(await page.evaluate(() => {
      const canvas = document.createElement('canvas'); canvas.width = 120; canvas.height = 240
      const ctx = canvas.getContext('2d'); ctx.fillStyle = '#a74632'; ctx.fillRect(0, 0, 120, 240); ctx.fillStyle = '#f4f1e6'; ctx.fillRect(35, 40, 50, 180)
      return canvas.toDataURL('image/png').split(',')[1]
    }), 'base64')
    const uploadImage = async title => {
      await page.getByRole('region', { name: 'Project images', exact: true }).getByRole('button', { name: 'Add image', exact: true }).click()
      const modal = page.getByRole('dialog', { name: 'Add image', exact: true })
      await modal.getByLabel('Image file').setInputFiles({ name: 'entry.png', mimeType: 'image/png', buffer: imageBytes })
      await modal.getByLabel('Image title').fill(title)
      await modal.getByRole('button', { name: 'Save image', exact: true }).click()
      return modal
    }
    await (await uploadImage('Entry before work')).waitFor({ state: 'hidden' })
    await page.getByRole('img', { name: 'Entry before work', exact: true }).waitFor()
    await page.reload()
    await page.getByRole('button', { name: 'Open image: Entry before work', exact: true }).click()
    const original = page.getByRole('dialog', { name: 'Entry before work', exact: true })
    await original.getByRole('img').waitFor()
    assert.deepEqual(await original.getByRole('img').evaluate(img => [img.naturalWidth, img.naturalHeight, getComputedStyle(img).objectFit]), [120, 240, 'contain'])
    await original.getByRole('button', { name: 'Close', exact: true }).click()
    await page.goto(base + '#/areas/entry')
    await page.getByRole('link', { name: 'Prepare opening', exact: true }).click()
    await page.getByRole('button', { name: 'Edit instructions', exact: true }).click()
    const instructions = page.getByRole('dialog', { name: 'Task instructions', exact: true })
    await instructions.getByLabel('Scope and instructions').fill('Keep the original opening visible until the checks are complete.')
    await instructions.getByRole('button', { name: 'Save instructions', exact: true }).click()
    await instructions.waitFor({ state: 'hidden' })
    for (const [title, required] of [['Remove trim', false], ['Check opening', true]]) {
      await page.getByRole('button', { name: 'Add step', exact: true }).click()
      const modal = page.getByRole('dialog', { name: 'Add step', exact: true })
      await modal.getByLabel('Step title', { exact: true }).fill(title)
      await modal.getByLabel('Instructions', { exact: true }).fill('Keep reusable pieces and record the result.')
      if (required) { await modal.getByLabel('This is a completion check').check(); await modal.getByLabel('Required before the task is done').check() }
      await modal.getByRole('button', { name: 'Save step', exact: true }).click()
      await modal.waitFor({ state: 'hidden' })
    }
    await page.getByRole('button', { name: 'Move Check opening up', exact: true }).click()
    await page.waitForFunction(() => document.querySelector('.task-step')?.textContent.includes('Check opening'))
    await page.getByLabel('Task status', { exact: true }).selectOption('done')
    await page.getByRole('alert').filter({ hasText: 'Complete required checks' }).waitFor()
    const check = page.locator('.task-step').filter({ hasText: 'Check opening' })
    await check.getByRole('checkbox').check()
    await check.getByText(/Completed /).waitFor()
    const work = page.locator('.task-step').filter({ hasText: 'Remove trim' })
    await work.locator('summary').click()
    await work.getByRole('button', { name: 'Attach existing', exact: true }).click()
    const chooser = page.getByRole('dialog', { name: 'Choose a project image', exact: true })
    await chooser.getByRole('button', { name: 'Use image', exact: true }).click()
    await chooser.waitFor({ state: 'hidden' })
    await work.getByRole('img', { name: 'Entry before work', exact: true }).waitFor()
    await page.getByLabel('Task status', { exact: true }).selectOption('done')
    await page.reload()
    await page.getByText('Keep the original opening visible until the checks are complete.', { exact: true }).waitFor()
    assert.equal(await page.getByLabel('Task status', { exact: true }).inputValue(), 'done')
    assert(await check.getByRole('checkbox').isChecked())
    assert((await page.locator('.task-step').first().textContent()).includes('Check opening'))
    await work.locator('summary').click()
    await work.getByRole('img', { name: 'Entry before work', exact: true }).waitFor()
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Task/media layout must fit the viewport')
    for (const button of await work.getByRole('button').all()) {
      const box = await button.boundingBox()
      assert(!box || (box.width >= 44 && box.height >= 44), 'Task/image actions need 44px targets')
    }
    await page.screenshot({ path: 'test-results/foundations-' + viewport.width + '.png', fullPage: true })
    await page.goto(base)
    failUpload = true
    const failed = await uploadImage('Interrupted upload')
    await failed.getByText(/Upload interrupted/).waitFor()
    await failed.getByRole('button', { name: 'Cancel', exact: true }).click()
    const pending = page.locator('.project-image-card').filter({ hasText: 'Interrupted upload' })
    await pending.getByText('Upload incomplete', { exact: true }).waitFor()
    await pending.getByRole('button', { name: 'Remove image', exact: true }).click()
    await page.getByRole('dialog', { name: 'Remove image?', exact: true }).getByRole('button', { name: 'Remove from project', exact: true }).click()
    await pending.waitFor({ state: 'hidden' })
    assert.equal(assets.size, 1); assert.equal(objects.size, 1)
    const waiting = delay()
    slowDownload = waiting
    const request = page.waitForRequest(r => r.url().includes('/storage/v1/object/authenticated/'))
    await page.getByRole('button', { name: 'Open image: Entry before work', exact: true }).click()
    await request
    await page.getByRole('dialog', { name: 'Entry before work', exact: true }).getByRole('button', { name: 'Close', exact: true }).click()
    await page.getByRole('link', { name: 'Account', exact: true }).click()
    await page.locator('.card').filter({ hasText: 'Porch B' }).getByRole('button', { name: 'Open', exact: true }).click()
    waiting.resolve()
    await page.getByRole('region', { name: 'Project images', exact: true }).getByText('No images here yet.', { exact: true }).waitFor()
    assert.equal(await page.getByRole('img', { name: 'Entry before work', exact: true }).count(), 0)
    assert.deepEqual(errors, [])
    console.log('Foundation UI upload/attach/original/steps/checks/reload/recovery/project-switch passed at ' + viewport.width + 'px; HTTP fixtures, no AI.')
    await context.close()
  }
} finally { await browser?.close(); server.kill() }
