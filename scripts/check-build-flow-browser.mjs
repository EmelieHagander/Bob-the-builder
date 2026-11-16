// Build mode front page (2026-11-15): with a finished build guide the project
// offers "Start this build"; in Build mode it opens on 1 Shopping list,
// 2 Cut list, 3 Build guide. Ticks are saved per exact drawing version and
// come back after reload; the guide opens at the first page not done.
// Production React/data paths with HTTP fixtures. BUILD_FLOW_FIXTURE=<dir>
// swaps in a real snapshot (drawing.json, pages.json, catalog.json,
// materials.json, construction.json) for a local look; CI uses the bench below.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir, readFile } from 'node:fs/promises'
import { chromium } from 'playwright-core'

const base = 'http://127.0.0.1:4183/Bob-the-builder/', api = 'https://pwa-proof.invalid'
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--base', '/Bob-the-builder/', '--host', '127.0.0.1', '--port', '4183', '--strictPort'], { stdio: ['ignore', 'pipe', 'pipe'] })
let logs = '', browser
server.stdout.on('data', d => logs += d); server.stderr.on('data', d => logs += d)
const user = { id: '00000000-0000-4000-8000-000000000001', email: 'build@example.test', aud: 'authenticated', role: 'authenticated', app_metadata: { provider: 'email' }, user_metadata: {}, created_at: '2026-09-24T00:00:00Z' }
const expiresAt = Math.floor(Date.now() / 1000) + 3600
const token = [{ alg: 'HS256', typ: 'JWT' }, { sub: user.id, exp: expiresAt, role: 'authenticated' }, 'fixture'].map(p => Buffer.from(typeof p === 'string' ? p : JSON.stringify(p)).toString('base64url')).join('.')
const construction = '11111111-1111-4111-8111-111111111111', drawing = '22222222-2222-4222-8222-222222222222', guideId = 'a'.repeat(64)
const board = '33333333-3333-4333-8333-333333333333'

async function fixture() {
  const dir = process.env.BUILD_FLOW_FIXTURE
  if (dir) {
    const json = async name => JSON.parse(await readFile(`${dir}/${name}`, 'utf8'))
    const [[cad], pages, catalog, materials, source] = await Promise.all(['drawing.json', 'pages.json', 'catalog.json', 'materials.json', 'construction.json'].map(json))
    cad.manifest.build_guide.construction = { artifact_id: construction, revision: 27 }
    cad.manifest.build_guide.guide_id = guideId
    return { revision: 27, title: 'Bunk bed', recipe: cad.recipe, manifest: cad.manifest, pages: Object.fromEntries(pages.map(p => [p.page_key, p.svg])),
      catalog, materials, bindings: source.materials, policy: source.instance_policy }
  }
  const svg = n => `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect x="5" y="5" width="390" height="290" fill="#fff" stroke="#000"/><text x="20" y="40">Page ${n}</text></svg>`
  const definitions = [{ id: 'leg_45x45x400', primitive: 'box', x_mm: 45, y_mm: 45, z_mm: 400, material_ref: 'pine' }, { id: 'seat_45x95x1200', primitive: 'box', x_mm: 45, y_mm: 95, z_mm: 1200, material_ref: 'pine' }]
  const instances = [...[1, 2, 3, 4].map(n => ({ id: `leg_${n}`, definition_id: 'leg_45x45x400' })), ...[1, 2, 3].map(n => ({ id: `seat_${n}`, definition_id: 'seat_45x95x1200' }))]
  const pages = Array.from({ length: 5 }, (_, n) => ({ key: `guide-${n}`, kind: n === 0 ? 'parts' : n === 4 ? 'done' : 'step', step: n, section: n && n < 4 ? 'Bench' : undefined, sha256: String(n).repeat(64) }))
  const manifest = { annotations: { views: { front: { parts: instances.map((item, i) => ({ number: `P${i + 1}`, definition_id: item.definition_id })) } } },
    build_guide: { version: 1, status: 'generated', basis: 'proposed_order', store: 'pages', guide_id: guideId, construction: { artifact_id: construction, revision: 3 }, pages } }
  return { revision: 3, title: 'Garden bench', recipe: { units: 'mm', contract_version: 1, definitions, instances }, manifest,
    pages: Object.fromEntries(pages.map((p, n) => [p.key, svg(n)])),
    catalog: [{ item_id: board, revision: 1, name: 'Pine 45×95', profile_code: 'sawn_timber', properties: { thickness: { value: 45 }, width: { value: 95 } } }],
    materials: [{ id: 'screws', name: 'Wood screw 5×70', qty: '24 pcs', area_label: '', supplier: '', status: 'needed', cost: '', category: 'material', category_icon: 'package' },
      { id: 'glue', name: 'Wood glue', qty: '1 pcs', area_label: '', supplier: '', status: 'delivered', cost: '', category: 'material', category_icon: 'package' }],
    bindings: definitions.map(d => ({ definition_id: d.id, material_id: board, material_revision: 1, part_id: null, part_revision: null })), policy: null }
}

try {
  for (let i = 0; ; i++) {
    try { if ((await fetch(base)).ok) break } catch { /* starting */ }
    assert(i < 40 && server.exitCode === null, logs); await new Promise(r => setTimeout(r, 250))
  }
  const data = await fixture()
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium/chrome' })
  await mkdir('test-results', { recursive: true })
  for (const width of [320, 390, 1280]) {
    const project = { id: 'P', slug: 'bench', name: data.title, description: '', location: '', type: 'Build', theme: 'birch', phase: 'concept', start_label: '', start_date: null, end_date: null }
    const checks = new Set(), materials = data.materials.map(m => ({ ...m })), errors = [], writes = []
    let failNextCheck = false
    const context = await browser.newContext({ viewport: { width, height: width === 320 ? 640 : 900 }, serviceWorkers: 'block', hasTouch: width < 860 })
    await context.route('https://fonts.googleapis.com/**', r => r.abort())
    await context.route(`${api}/**`, async route => {
      const req = route.request(), url = new URL(req.url()), path = url.pathname, q = name => url.searchParams.get(name)
      const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS' }
      const respond = (json, status = 200) => route.fulfill({ status, json, headers })
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers })
      const body = () => req.postDataJSON()
      if (path === '/auth/v1/token') return respond({ access_token: token, refresh_token: 'fixture', expires_in: 3600, expires_at: expiresAt, token_type: 'bearer', user })
      if (path === '/auth/v1/user') return respond(user)
      if (path === '/rest/v1/projects') return respond(req.headers().accept?.includes('object+json') ? project : [project])
      if (path === '/rest/v1/account') return respond({ id: 'account', name: 'Fixture', owner_name: '', email: '' })
      if (path === '/rest/v1/rpc/phase_command') { project.phase = body().p_phase ?? 'build'; return respond({ ok: true }) }
      if (path === '/rest/v1/rpc/project_work_read') return respond({ project_id: 'P', vocabulary_version: '2026-09-24.1', status: 'approved', revision: 1, focus_step_id: 's1', areas: [],
        steps: [{ id: 's1', title: 'Check the drawing', area_id: null, phase: 'design', position: 1, goal: '', notes: '', state: 'active', responsible_kind: 'bob', responsible_person_id: null, tasks: [], related_tasks: [], requirements: [] }], unorganised_tasks: [] })
      if (path === '/rest/v1/rpc/read_construction_draft') {
        const b = body()
        if (!b.p_artifact) return respond({ status: 'ok', projectId: 'P', items: [{ id: construction, title: data.title, revision: data.revision }], truncated: false, next_cursor: null })
        return respond({ status: 'ok', projectId: 'P', artifact_id: construction, revision: data.revision, current_revision: data.revision, area_id: null, title: data.title, archived: false, source_state: 'current',
          solution_id: 's', solution_revision: 1, recipe: data.recipe, materials: data.bindings, joints: [], open_questions: [], instance_policy: data.policy })
      }
      if (path === '/rest/v1/current_artifacts') return respond([{ id: construction, area_id: null, recorded_at: '2026-11-14T15:00:00Z' }])
      if (path === '/rest/v1/catalog_item_revisions') return respond(data.catalog.filter(row => (q('or') ?? '').includes(`item_id.eq.${row.item_id},revision.eq.${row.revision}`)))
      if (path === '/rest/v1/artifact_cad_revisions') {
        assert.equal(q('manifest->build_guide->construction->>artifact_id'), `eq.${construction}`)
        assert.equal(q('manifest->build_guide->construction->>revision'), `eq.${data.revision}`)
        return respond([{ artifact_id: drawing, artifact_revision: 10, recipe: data.recipe, manifest: data.manifest }])
      }
      if (path === '/rest/v1/cad_guide_pages') {
        const keys = (q('page_key') ?? '').replace(/^in\.\(|\)$/g, '').split(',').map(k => k.replace(/"/g, ''))
        return respond(keys.filter(k => data.pages[k]).map(k => ({ page_key: k, svg: data.pages[k] })))
      }
      if (path === '/rest/v1/build_checks') {
        if (req.method() === 'GET') { assert.equal(q('artifact_id'), `eq.${drawing}`); assert.equal(q('revision'), 'eq.10'); return respond([...checks].map(item => ({ item }))) }
        if (failNextCheck) { failNextCheck = false; return respond({ message: 'offline' }, 503) }
        if (req.method() === 'POST') { const row = body(); assert.equal(row.revision, 10); checks.add(row.item); writes.push('+' + row.item); return route.fulfill({ status: 201, headers }) }
        if (req.method() === 'DELETE') { const item = q('item').replace(/^eq\./, ''); checks.delete(item); writes.push('-' + item); return route.fulfill({ status: 204, headers }) }
      }
      if (path === '/rest/v1/materials') {
        if (req.method() === 'PATCH') { const m = materials.find(row => 'eq.' + row.id === q('id')); Object.assign(m, body()); writes.push('material:' + m.id); return route.fulfill({ status: 204, headers }) }
        if (req.method() === 'POST') { const row = { id: 'stock-' + materials.length, area_label: '', supplier: '', cost: '', category_icon: 'package', ...body() }; row.area_label ??= ''; materials.push(row); writes.push('material:new'); return respond([row], 201) }
        return respond(materials)
      }
      if (['/rest/v1/rpc/claim_project_invites'].includes(path)) return respond(0)
      if (['/rest/v1/rpc/join_project', '/rest/v1/rpc/bob_chat_inbox', '/rest/v1/rpc/bob_mark_chat_read'].includes(path)) return respond(null)
      if (path === '/rest/v1/rpc/project_invitations' || path === '/rest/v1/rpc/drawing_work_list') return respond(path.endsWith('work_list') ? { items: [], next_cursor: null } : [])
      if (path === '/functions/v1/ask-bob') return respond({ ok: true, renewed: 0 })
      if (path.startsWith('/rest/v1/') && req.method() === 'GET') return respond([])
      if (path.startsWith('/rest/v1/rpc/')) return respond(null)
      errors.push(`${req.method()} ${path}`); return respond({ error: 'unexpected_request' }, 500)
    })
    const page = await context.newPage(); page.setDefaultTimeout(15000); page.on('pageerror', e => errors.push(e.message))
    await page.goto(base + '#/signin'); await page.getByRole('button', { name: 'Continue as guest', exact: true }).click()
    await page.getByRole('heading', { name: 'Home', exact: true }).waitFor()
    await page.getByRole('button', { name: `Open project ${data.title}`, exact: true }).click()

    // A finished guide makes the build startable, even without a build day.
    const ready = page.getByRole('region', { name: 'Ready to build?' })
    await ready.getByRole('button', { name: 'Start this build', exact: true }).click()
    await page.getByLabel('Project phase: Build').waitFor()
    assert(!page.url().includes('/today'), 'Starting from a guide stays on the project')

    const stages = page.locator('.build-stage')
    await stages.first().waitFor()
    assert.deepEqual((await page.locator('.build-stage-title').allTextContents()), ['Shopping list', 'Cut list', 'Build guide'])
    assert.notEqual(await stages.nth(0).getAttribute('open'), null, 'Shopping opens first')
    assert.equal(await stages.nth(1).getAttribute('open'), null)
    assert.equal(await page.locator('details.build-plan').getAttribute('open'), null, 'The plan is folded in Build mode')
    const shopBox = await stages.nth(0).boundingBox()
    assert(shopBox && shopBox.y < 400, `Shopping list is on the opening screen at ${width}px`)
    await page.screenshot({ path: `test-results/build-flow-shop-${width}.png`, fullPage: true })

    // Tick every shopping row: hardware rows and counted boards.
    for (const box of await stages.nth(0).locator('input[type="checkbox"]').all()) if (!(await box.isChecked())) await box.check()
    await page.waitForFunction(() => document.querySelector('.build-stage')?.getAttribute('data-state') === 'done')

    // A finished stage folds and the next one opens by itself.
    assert.equal(await stages.nth(0).getAttribute('open'), null, 'Done shopping folds')
    assert.notEqual(await stages.nth(1).getAttribute('open'), null, 'Cutting opens next')
    // Cut list: a failed save puts the tick back and says so; a retry saves it.
    const firstCut = stages.nth(1).locator('input[type="checkbox"]').first()
    failNextCheck = true
    await firstCut.check()
    await page.getByRole('alert').filter({ hasText: 'Could not save' }).waitFor()
    assert.equal(await firstCut.isChecked(), false, 'A failed tick is put back')
    await firstCut.check()
    await page.waitForFunction(() => document.querySelectorAll('.build-stage')[1].getAttribute('data-state') === 'started')
    assert(await stages.nth(1).locator('.build-row-name').first().textContent().then(t => /^P\d/.test(t ?? '')), 'Cut rows carry the drawing P numbers')
    await page.screenshot({ path: `test-results/build-flow-cut-${width}.png`, fullPage: true })
    for (const box of await stages.nth(1).locator('input[type="checkbox"]').all()) if (!(await box.isChecked())) await box.check()

    // Guide: finish two pages, reload, and it opens on the third.
    await page.waitForFunction(() => document.querySelectorAll('.build-stage')[2].open)
    const viewer = page.getByRole('group', { name: /build guide pages/ })
    await viewer.getByText('Page 1 of', { exact: false }).waitFor()
    await viewer.getByRole('button', { name: 'Done, next page' }).click()
    await viewer.getByText('Page 2 of', { exact: false }).waitFor()
    await viewer.getByRole('button', { name: 'Done, next page' }).click()
    await viewer.getByText('Page 3 of', { exact: false }).waitFor()
    await page.screenshot({ path: `test-results/build-flow-guide-${width}.png` })
    await page.reload()
    await page.locator('.build-stage').first().waitFor()
    assert.equal(await page.locator('.build-stage').nth(0).getAttribute('data-state'), 'done', 'Bought rows come back after reload')
    assert.equal(await page.locator('.build-stage').nth(1).getAttribute('data-state'), 'done', 'Cut ticks come back after reload')
    assert.notEqual(await page.locator('.build-stage').nth(2).getAttribute('open'), null, 'With buying and cutting done, the guide opens')
    await page.getByRole('group', { name: /build guide pages/ }).getByText('Page 3 of', { exact: false }).waitFor()
    await page.getByRole('group', { name: /build guide pages/ }).getByRole('button', { name: 'Previous' }).click()
    await page.getByRole('group', { name: /build guide pages/ }).getByRole('button', { name: 'Done', pressed: true }).waitFor()
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `No horizontal scroll at ${width}px`)
    await page.screenshot({ path: `test-results/build-flow-reload-${width}.png` })
    assert(writes.includes('+page:guide-0') && writes.includes('+page:guide-1'), writes.join(' '))
    assert.deepEqual(errors, [])
    await context.close()
    console.log(`Build flow ${width}px: start from guide, shop → cut → guide, failed tick put back, ticks and guide page back after reload: OK`)
  }
} finally {
  await browser?.close()
  server.kill()
}
