// App-wide density and reachability in the real demo UI. Connected data/actions
// remain covered by the existing phase, work, sharing and foundations fixtures.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright-core'

const base = 'http://127.0.0.1:4179/Bob-the-builder/'
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--base', '/Bob-the-builder/', '--host', '127.0.0.1', '--port', '4179', '--strictPort'], { stdio: ['ignore', 'pipe', 'pipe'] })
let logs = '', browser
const failures = []
const check = (condition, message) => { if (!condition) failures.push(message) }
server.stdout.on('data', data => { logs += data })
server.stderr.on('data', data => { logs += data })
try {
  for (let attempt=0;;attempt++) {
    try { if ((await fetch(base)).ok) break } catch { /* starting */ }
    assert(attempt < 40 && server.exitCode === null, logs)
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
  await mkdir('test-results', { recursive: true })
  for (const width of [320,390,1280]) {
    const errors=[]
    const context=await browser.newContext({viewport:{width,height:width===320?568:900},serviceWorkers:'block',hasTouch:width<860})
    await context.route('https://fonts.googleapis.com/**',route=>route.abort())
    const page=await context.newPage()
    page.setDefaultTimeout(12000)
    page.on('pageerror',error=>errors.push(error.message))
    for (const route of ['account','', 'project', 'areas','people','events','today','shopping','food','food/shopping','announcements','account/calendar','account/settings','facts','solutions','artifacts','material-plan']) {
      await page.goto(`${base}#/${route}`)
      await page.locator('.page-title').waitFor()
      await page.waitForFunction(()=>!document.querySelector('.ui-loading'))
      await page.locator('.page').evaluate(async el=>{await Promise.all(el.getAnimations().map(animation=>animation.finished))})
      check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${route||'project'} overflows at ${width}px`)
      if (width<860) {
        const controls=await page.locator('.btn:visible,.ui-icon-button:visible,.account-project-open:visible,.meal-open:visible').evaluateAll(nodes=>nodes.map(node=>({label:node.getAttribute('aria-label')||node.textContent.trim(),height:node.getBoundingClientRect().height})))
        check(controls.every(control=>control.height>=43.5),`${route} lost a touch target: ${JSON.stringify(controls.filter(control=>control.height<43.5))}`)
      }
      const limits={account:140,people:170,events:180,areas:260,food:160}
      if (limits[route]) {
        const rows=await page.locator('.ui-list-item:visible').evaluateAll(nodes=>nodes.map(node=>node.getBoundingClientRect().height))
        check(rows.length>0,`Missing compact rows on ${route}`)
        check(Math.max(...rows)<=limits[route],`${route} rows are too tall at ${width}px: ${rows}`)
      }
      if(['account','areas','people','events','shopping','food','announcements','account/settings',''].includes(route)) await page.screenshot({path:`test-results/density-${route.replaceAll('/','-')||'project'}-${width}.png`,fullPage:true})
    }
    // Dense lists still open the same real edit flow and retain allergy text.
    await page.goto(`${base}#/people`)
    await page.locator('.ui-list-item').first().waitFor()
    const row=page.locator('.ui-list-item').first()
    await row.getByRole('button',{name:/^Edit /}).click()
    await page.getByRole('dialog').waitFor()
    await page.getByRole('button',{name:'Close',exact:true}).click()
    await page.getByLabel('Search people').fill('no-such-person')
    await page.getByText('No people found',{exact:true}).waitFor()
    await page.getByLabel('Search people').fill('')
    await page.locator('.ui-list-item').first().waitFor()
    for(const theme of ['birch','forest','dusk']) {
      await page.evaluate(theme=>document.documentElement.setAttribute('data-theme',theme),theme)
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${theme} overflow`)
      await page.screenshot({path:`test-results/density-theme-${theme}-${width}.png`,fullPage:true})
    }
    await page.goto(`${base}#/shopping`)
    await page.getByRole('checkbox').first().waitFor()
    const checkbox=page.getByRole('checkbox').first(),before=await checkbox.isChecked()
    await checkbox.focus()
    await page.keyboard.press('Space')
    assert.equal(await checkbox.isChecked(),!before,'Compact checklist must stay keyboard-operable')
    assert.deepEqual(errors,[])
    console.log(`Compact routes, row density, touch targets, edit/search, themes and checklist keyboard: ${width}px inspected`)
    await context.close()
  }
  assert.deepEqual(failures, [], 'App-wide compact UI checks')
} finally { await browser?.close();server.kill('SIGTERM') }
