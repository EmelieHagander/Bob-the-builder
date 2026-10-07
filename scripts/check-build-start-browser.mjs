// Start this build: with a build day ahead, Project Home leads with the large
// start action; without one, a small start appears once the project reaches
// Planning. Starting switches to Build mode and Today. Demo data, real UI.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright-core'

const base = 'http://127.0.0.1:4181/Bob-the-builder/'
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--base', '/Bob-the-builder/', '--host', '127.0.0.1', '--port', '4181', '--strictPort'], { stdio: ['ignore', 'pipe', 'pipe'] })
let logs = '', browser
server.stdout.on('data', data => { logs += data })
server.stderr.on('data', data => { logs += data })
try {
  for (let attempt = 0; ; attempt++) {
    try { if ((await fetch(base)).ok) break } catch { /* starting */ }
    assert(attempt < 40 && server.exitCode === null, logs)
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
  await mkdir('test-results', { recursive: true })
  for (const width of [320, 390, 1280]) {
    const errors = []
    const context = await browser.newContext({ viewport: { width, height: width === 320 ? 568 : 900 }, serviceWorkers: 'block', hasTouch: width < 860 })
    await context.route('https://fonts.googleapis.com/**', route => route.abort())
    const page = await context.newPage()
    page.setDefaultTimeout(12000)
    page.on('pageerror', error => errors.push(error.message))
    // Today (real date): the demo build days in July are past, so no build day.
    await page.goto(`${base}#/project`)
    await page.locator('.page-title').waitFor()
    await page.getByText('Nothing scheduled yet.', { exact: false }).waitFor()
    assert.equal(await page.getByRole('button', { name: /Start this build/i }).count(), 0, 'No start before Planning without a build day')
    await page.getByRole('button', { name: /Set project phase|Review phase/ }).first().click()
    await page.getByLabel('Move to phase').selectOption('planning')
    await page.getByLabel('Reason for this change').fill('Plan is ready')
    await page.getByRole('dialog').getByRole('button', { name: 'Save phase', exact: true }).click()
    await page.getByLabel('Project phase: Planning').waitFor()
    const small = page.locator('.page-head').getByRole('button', { name: 'Start this build', exact: true })
    await small.waitFor()
    assert.equal(await page.getByRole('region', { name: 'Ready to build?' }).count(), 0, 'Without a build day the start stays small')
    await page.screenshot({ path: `test-results/build-start-small-${width}.png` })
    assert.deepEqual(errors, [])
    await context.close()

    // Before the first July build day, the same project leads with the large start.
    const dated = await browser.newContext({ viewport: { width, height: width === 320 ? 568 : 900 }, serviceWorkers: 'block', hasTouch: width < 860 })
    await dated.route('https://fonts.googleapis.com/**', route => route.abort())
    const datedPage = await dated.newPage()
    await datedPage.clock.setFixedTime(new Date('2026-06-20T09:00:00'))
    await run(datedPage, dated)
  }
  async function run(page, context) {
    const width = page.viewportSize().width
    const errors = []
    page.setDefaultTimeout(12000)
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(`${base}#/project`)
    const start = page.getByRole('region', { name: 'Ready to build?' })
    const button = start.getByRole('button', { name: 'Start this build', exact: true })
    await button.waitFor()
    const box = await button.boundingBox()
    assert(box && box.height >= 56, `Start this build is the large main action at ${width}px`)
    assert(box.y < (width === 320 ? 568 : 900), `Start this build is on the opening screen at ${width}px`)
    assert.equal(await page.locator('.page-head .btn-primary').count(), 0, 'Only one primary action competes with Start this build')
    await page.screenshot({ path: `test-results/build-start-${width}.png` })
    await button.click()
    await page.waitForURL(/#\/today/)
    await page.goto(`${base}#/project`)
    await page.getByLabel('Project phase: Build').waitFor()
    const focus = page.getByRole('region', { name: /./ }).filter({ has: page.getByText('Build mode', { exact: true }) })
    await focus.getByRole('link', { name: 'What needs doing', exact: true }).waitFor()
    assert.equal(await page.getByRole('button', { name: 'Start this build' }).count(), 0, 'Start disappears once building')
    const tools = page.locator('details.planning-tools')
    assert.equal(await tools.getAttribute('open'), null, 'Planning tools are folded in Build mode')
    await tools.locator(':scope > summary').click()
    await tools.getByRole('link', { name: 'Measurements & existing parts' }).waitFor()
    if (width >= 860) {
      const labels = await page.locator('.sidebar nav a').allTextContents()
      assert.deepEqual(labels.slice(1, 3).map(label => label.trim()), ['Project', 'Today'], `Today follows Project in Build: ${labels}`)
    }
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `No horizontal scroll at ${width}px`)
    await page.screenshot({ path: `test-results/build-mode-${width}.png` })
    assert.deepEqual(errors, [])
    await context.close()
    console.log(`Start this build ${width}px: small start in Planning, large start with a build day, Build mode, folded planning tools, Today first: OK`)
  }
} finally {
  await browser?.close()
  server.kill()
}
