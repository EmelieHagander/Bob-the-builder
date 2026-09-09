import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright-core'

const live = process.argv.includes('--public-only')
const base = 'http://127.0.0.1:4173/Bob-the-builder/'
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--base', '/Bob-the-builder/', '--host', '127.0.0.1', '--port', '4173', '--strictPort'], { stdio: ['ignore', 'pipe', 'pipe'] })
let logs = ''
server.stdout.on('data', (data) => { logs += data })
server.stderr.on('data', (data) => { logs += data })
let browser
try {
  for (let attempt = 0; ; attempt++) {
    try { if ((await fetch(base)).ok) break } catch { /* server starting */ }
    assert(attempt < 40 && server.exitCode === null, `Preview did not start: ${logs}`)
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
  const context = await browser.newContext()
  let projectReads = 0
  await context.route('https://pwa-proof.invalid/**', async (route) => {
    if (route.request().url().includes('/rest/')) projectReads++
    await route.fulfill({ json: [] })
  })
  // Do not let an optional web font determine whether CI has network access.
  await context.route('https://fonts.googleapis.com/**', (route) => route.abort())
  const page = await context.newPage()
  page.setDefaultTimeout(12000)
  page.setDefaultNavigationTimeout(12000)
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(`${base}#/install`)
  await page.getByRole('heading', { name: 'Installera appen', exact: true }).waitFor()
  assert.equal(projectReads, 0, 'Public guide must not wait for a project query or login')

  for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 568 }, { width: 1280, height: 900 }]) {
    await page.setViewportSize(viewport)
    if (live) {
      await page.goto(`${base}#/signin`)
      await page.getByRole('heading', { name: 'Sign in', exact: true }).waitFor()
    } else {
      await page.goto(`${base}#/account`)
      // Follow the user's actual route from the account screen.
      await page.getByRole('link', { name: /Settings/ }).click()
      await page.getByRole('heading', { name: 'Account settings', exact: true }).waitFor()
    }
    const entry = page.getByRole('link', { name: 'Installera appen', exact: true })
    await entry.waitFor({ state: 'visible' })
    await page.evaluate(async () => {
      await document.fonts.ready
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    })
    const box = await entry.boundingBox()
    assert(box && box.height >= 44 && box.y >= 0 && box.y + box.height < viewport.height, 'Installation entry must be visible without scrolling')
    await entry.click()
    await page.waitForURL('**/#/install')
    await page.getByRole('heading', { name: 'Installera appen', exact: true }).waitFor()
    await page.getByRole('button', { name: 'Android', exact: true }).click()
    await page.getByText('Öppna den här sidan i Chrome.', { exact: true }).waitFor()
    await page.getByRole('button', { name: 'iPhone / iPad', exact: true }).click()
    await page.getByText('Välj Lägg till på hemskärmen.', { exact: true }).waitFor()
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'No horizontal overflow')
    console.log(`${live ? 'Sign-in' : 'Account → Settings'} → phone guide: ${viewport.width}px, entry height ${box.height}px`)
    if (!live && viewport.width === 390) {
      await mkdir('test-results', { recursive: true })
      await page.screenshot({ path: 'test-results/install-mobile.png', fullPage: true })
    }
  }

  // Capture a prompt on another route, then consume it from the public guide.
  await page.goto(`${base}#/${live ? 'signin' : 'account/settings'}`)
  await page.getByRole('link', { name: 'Installera appen', exact: true }).waitFor()
  await page.evaluate(() => {
    window.installPromptCalls = 0
    const event = new Event('beforeinstallprompt', { cancelable: true })
    event.prompt = async () => { window.installPromptCalls++ }
    event.userChoice = Promise.resolve({ outcome: 'accepted' })
    window.dispatchEvent(event)
  })
  await page.getByRole('link', { name: 'Installera appen', exact: true }).click()
  await page.getByRole('button', { name: 'Installera appen', exact: true }).click()
  await page.getByRole('status').filter({ hasText: 'Du har godkänt installationen' }).waitFor()
  assert.equal(await page.evaluate(() => window.installPromptCalls), 1)
  assert.equal(await page.getByText('Klart! Bob är installerad på den här enheten.', { exact: true }).count(), 0)
  await page.evaluate(() => window.dispatchEvent(new Event('appinstalled')))
  await page.getByRole('status').filter({ hasText: 'Klart!' }).waitFor()
  if (!live) {
    await page.getByRole('link', { name: 'Fortsätt till Bob', exact: false }).click()
    await page.goto(`${base}#/account/settings`)
    // A reload cannot know whether an app is installed elsewhere; simulate
    // iOS standalone before the next document starts, not a persistent flag.
    await page.addInitScript(() => Object.defineProperty(navigator, 'standalone', { value: true }))
    await page.reload()
    await page.getByRole('link', { name: 'Installationshjälp', exact: true }).waitFor()
  }
  console.log('Early native prompt and accepted/installed/standalone presentation: OK')

  await page.goto(`${base}#/install`)
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready
    if (!navigator.serviceWorker.controller) await new Promise((resolve) => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }))
  })
  const cached = await page.evaluate(async () => {
    const keys = await caches.keys()
    return (await Promise.all(keys.map(async (key) => (await (await caches.open(key)).keys()).map((req) => req.url)))).flat()
  })
  assert.deepEqual(cached, [`${base}offline.html`])
  await context.setOffline(true)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.getByRole('heading', { name: 'Bob behöver internet', exact: true }).waitFor()
  await context.setOffline(false)
  await page.getByRole('link', { name: 'Försök igen', exact: true }).click()
  await page.getByRole('heading', { name: live ? /^Sign in$/ : /^God morgon/ }).waitFor()
  assert.deepEqual(errors, [], 'No runtime exceptions in the installation flow')
  console.log('Real service worker: offline help, retry online and isolated cache: OK')
} finally {
  if (browser) await browser.close()
  server.kill('SIGTERM')
}
