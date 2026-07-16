// Browser smoke-drive of the running app (mock mode). Start `npm run dev`, then:
//   npm i -D playwright-core && node scripts/smoke.mjs
// CHROME_PATH overrides the browser binary; screenshots land in SMOKE_SHOT_DIR (/tmp).
// People/steps assume the Skogsstuga demo data on a fresh dev server.
import { chromium } from 'playwright-core'

const BASE = 'http://localhost:5173'
const SHOT_DIR = process.env.SMOKE_SHOT_DIR ?? '/tmp/'
const results = []
const step = (name, ok, note = '') => {
  results.push(`${ok ? 'OK ' : 'FAIL'} ${name}${note ? ' — ' + note : ''}`)
  console.log(results[results.length - 1])
}

const executablePath = process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const browser = await chromium.launch({ executablePath })
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
page.on('pageerror', (err) => console.log('PAGEERROR:', err.message))
page.on('console', (msg) => { if (msg.type() === 'error') console.log('CONSOLE-ERROR:', msg.text()) })
const modalGone = () => page.waitForSelector('.modal', { state: 'detached' })

try {
  // ── 1. Derived area stats ──
  await page.goto(BASE + '/#/areas')
  await page.waitForSelector('h1:has-text("Areas")')
  await page.click('button:has-text("Add area")')
  await page.fill('input[placeholder="Köket"]', 'Statistik')
  await page.click('.modal button[type="submit"]')
  await modalGone()
  await page.waitForSelector('a.card:has-text("Statistik")')
  await page.click('a.card:has-text("Statistik")')
  await page.waitForSelector('h1:has-text("Statistik")')
  for (const t of ['Task A', 'Task B']) {
    await page.click('button:has-text("Add task")')
    await page.fill('input[placeholder="Paint walls — 2 coats"]', t)
    await page.click('.modal button[type="submit"]')
    await modalGone()
    await page.waitForSelector(`.card:has-text("${t}")`)
  }
  // mark Task A done (todo → doing → done)
  await page.click('.card:has-text("Task A") button[title="Mark as doing"]')
  await page.waitForSelector('.card:has-text("Task A") button[title="Mark as done"]')
  await page.click('.card:has-text("Task A") button[title="Mark as done"]')
  await page.waitForSelector('.card:has-text("Task A") :text("Done")')
  await page.goto(BASE + '/#/areas')
  await page.waitForSelector('a.card:has-text("Statistik")')
  const summary = await page.locator('a.card:has-text("Statistik")').textContent()
  step('derived stats: 2 tasks · 1 done, Done 50%', /2 tasks · 1 done/.test(summary) && /Done50%/.test(summary.replace(/\s/g, '')), summary?.slice(-80))

  // ── 2. Edit area: rename + material label follows ──
  await page.click('a.card:has-text("Statistik")')
  await page.waitForSelector('h1:has-text("Statistik")')
  await page.click('button:has-text("Add material")')
  await page.fill('input[placeholder="Pine board 22×95mm"]', 'Stat-brädor')
  await page.click('.modal button[type="submit"]')
  await modalGone()
  await page.click('.page-head button:has-text("Edit")')
  await page.fill('.modal input[placeholder="Köket"]', 'Statistiken')
  await page.click('.modal button[type="submit"]')
  await modalGone()
  await page.waitForSelector('h1:has-text("Statistiken")')
  await page.click('button:has-text("Materials")')
  const matVisible = await page.waitForSelector('.card:has-text("Stat-brädor")', { timeout: 5000 }).then(() => true).catch(() => false)
  step('area rename keeps its materials', matVisible)

  // ── 3. Task edit + delete ──
  await page.click('button:has-text("Tasks")')
  await page.click('.card:has-text("Task B") button[title="Edit task"]')
  await page.fill('.modal input[placeholder="Paint walls — 2 coats"]', 'Task B renamed')
  await page.click('.modal button[type="submit"]')
  await modalGone()
  await page.waitForSelector('.card:has-text("Task B renamed")')
  await page.click('.card:has-text("Task B renamed") button[title="Edit task"]')
  await page.click('.modal button:has-text("Delete task")')
  await page.click('.modal button:has-text("Really delete?")')
  await modalGone()
  await page.waitForTimeout(400)
  const taskGone = (await page.locator('.card:has-text("Task B renamed")').count()) === 0
  step('task edit + delete', taskGone)

  // ── 4. Material edit + delete ──
  await page.click('button:has-text("Materials")')
  await page.click('.card:has-text("Stat-brädor") button[title="Edit material"]')
  await page.fill('.modal input[placeholder="48 st"]', '99 st')
  await page.click('.modal button[type="submit"]')
  await modalGone()
  await page.waitForSelector('.card:has-text("99 st")')
  await page.click('.card:has-text("Stat-brädor") button[title="Edit material"]')
  await page.click('.modal button:has-text("Delete")')
  await page.click('.modal button:has-text("Really delete?")')
  await modalGone()
  await page.waitForTimeout(400)
  step('material edit + delete', (await page.locator('.card:has-text("Stat-brädor")').count()) === 0)

  // ── 5. Full event: capacity 1, join, verify full pill; leave again ──
  await page.goto(BASE + '/#/events')
  await page.click('button:has-text("New event")')
  await page.fill('input[placeholder="Råbygge — walls & roof"]', 'Tiny day')
  await page.fill('input[placeholder="Sat 5 Jul"]', 'Sun 10 Aug')
  await page.fill('.modal input[type="number"]', '1')
  await page.click('.modal button[type="submit"]')
  await modalGone()
  const tiny = page.locator('.card', { hasText: 'Tiny day' })
  await tiny.locator('button:has-text("I\'m coming!")').click()
  await page.waitForSelector('.card:has-text("Tiny day") :text("You\'re going")')
  step('join capacity-1 event → going', true)
  // leave from detail page
  await tiny.locator('a:has-text("Tiny day")').click()
  await page.waitForSelector('h1:has-text("Tiny day")')
  await page.click('button:has-text("Take me off the list")')
  await page.waitForSelector('button:has-text("I\'m coming!")', { timeout: 5000 })
  step('leave event → open again', true)
  await page.click('button:has-text("I\'m coming!")')
  await page.waitForSelector('button:has-text("You\'re going")')

  // second person joining a full event is blocked — demo has one "me", so
  // instead verify the Events list shows the Full pill for others
  await page.goto(BASE + '/#/events')
  const fullPill = await page.locator('.card:has-text("Tiny day") :text("You\'re going")').count()
  step('full event still shows my going state', fullPill > 0)

  // event edit: bump capacity via detail page
  await page.click('.card:has-text("Tiny day") a:has-text("Tiny day")')
  await page.waitForSelector('h1:has-text("Tiny day")')
  await page.click('button:has-text("Edit event")')
  await page.fill('.modal input[type="number"]', '5')
  await page.click('.modal button[type="submit"]')
  await modalGone()
  await page.waitForSelector(':text("1 / 5 spots")', { timeout: 5000 })
  step('event edit changes capacity, keeps taken count', true)
  // delete event → back to list
  await page.click('button:has-text("Edit event")')
  await page.click('.modal button:has-text("Delete event")')
  await page.click('.modal button:has-text("Really delete?")')
  await page.waitForSelector('h1:has-text("Build events")', { timeout: 5000 })
  step('event delete returns to events list', (await page.locator('.card:has-text("Tiny day")').count()) === 0)

  // ── 6. Announcements: post → "just now", react, pin, delete ──
  await page.goto(BASE + '/#/announcements')
  await page.fill('textarea', 'Round two verification post')
  await page.click('button:has-text("Post update")')
  const post = page.locator('.card', { hasText: 'Round two verification post' })
  await post.waitFor()
  const timeLabel = await post.locator(':text("just now")').count()
  step('new post shows "just now"', timeLabel > 0)
  const beforeReacts = await post.locator('button[title="React"]').textContent()
  await post.locator('button[title="React"]').click()
  await page.waitForTimeout(500)
  const afterReacts = await page.locator('.card:has-text("Round two verification post") button[title="React"]').textContent()
  step('react bumps count', beforeReacts?.trim() === '0' && afterReacts?.trim() === '1', `${beforeReacts?.trim()} → ${afterReacts?.trim()}`)
  await post.locator('button[title="Pin to top"]').click()
  await page.waitForSelector('.card:has-text("Round two verification post") :text("Pinned")')
  step('pin post', true)
  await page.locator('.card:has-text("Round two verification post") button[title="Delete post"]').click()
  await page.locator('.card:has-text("Round two verification post") button:has-text("Really delete?")').click()
  await page.waitForTimeout(500)
  step('delete post', (await page.locator('.card:has-text("Round two verification post")').count()) === 0)

  // ── 7. Food: meal add/edit, diet flag toggle ──
  await page.goto(BASE + '/#/food')
  await page.waitForSelector('h1:has-text("Food")')
  await page.click('button:has-text("Add meal")')
  await page.fill('.modal input[placeholder="Lunch"]', 'Kvällsfika')
  await page.fill('.modal input[placeholder="Köttbullar & potatis"]', 'Chokladbollar')
  await page.click('.modal button[type="submit"]')
  await modalGone()
  await page.waitForSelector('.card:has-text("Kvällsfika")')
  step('add meal', true)
  await page.click('.card:has-text("Kvällsfika")')
  await page.fill('.modal input[placeholder="12:30"]', '19:00')
  await page.click('.modal button[type="submit"]')
  await modalGone()
  await page.waitForSelector('.card:has-text("19:00")')
  step('edit meal', true)
  // toggle a diet flag: Emelie x Vegan (row 1, col 2) — starts off
  const emelieVegan = page.locator('tbody tr', { hasText: 'Emelie' }).locator('td button').nth(1)
  await emelieVegan.click()
  await page.waitForTimeout(600)
  const flagged = await page.locator('tbody tr', { hasText: 'Emelie' }).locator('td button').nth(1).locator('i.ph-fill.ph-check-circle').count()
  step('diet flag toggles on', flagged > 0)
  await page.screenshot({ path: SHOT_DIR + 'food.png' })

  // ── 8. Food shopping: tick persists, add item ──
  await page.goto(BASE + '/#/food/shopping')
  await page.waitForSelector('label:has-text("Sallad & gurka")')
  await page.click('label:has-text("Sallad & gurka")')
  await page.waitForTimeout(500)
  await page.goto(BASE + '/#/food')
  await page.waitForSelector('h1:has-text("Food")')
  await page.goto(BASE + '/#/food/shopping')
  await page.waitForSelector('label:has-text("Sallad & gurka")')
  const ticked = await page.locator('label:has-text("Sallad & gurka") div[style*="line-through"]').count()
  step('food tick persists across navigation', ticked > 0)
  await page.click('button:has-text("Add item")')
  await page.fill('.modal input[placeholder="Potatis"]', 'Knäckebröd')
  await page.fill('.modal input[placeholder="Fresh & veg"]', 'Bread & dry')
  await page.click('.modal button[type="submit"]')
  await modalGone()
  await page.waitForSelector('label:has-text("Knäckebröd")')
  step('add food item into existing category', true)
  await page.screenshot({ path: SHOT_DIR + 'food-shopping.png' })

  // ── 9. People: edit skills/diet, remove person ──
  await page.goto(BASE + '/#/people')
  await page.click('.card:has-text("Tomas Vik") button[title="Edit Tomas"]')
  await page.fill('.modal input[placeholder="Carpentry"]', 'Painting')
  await page.click('.modal button:has-text("Add")')
  await page.fill('.modal input[placeholder="No restrictions"]', 'Vegetarian')
  await page.click('.modal button[type="submit"]')
  await modalGone()
  await page.waitForSelector('.card:has-text("Tomas Vik") :text("Painting")')
  const diet = await page.locator('.card:has-text("Tomas Vik")').textContent()
  step('edit person: skill + diet', /Vegetarian/.test(diet ?? ''))
  // remove a person
  await page.click('.card:has-text("Sigrid Nyström") button[title="Edit Sigrid"]')
  await page.click('.modal button:has-text("Remove from crew")')
  await page.click('.modal button:has-text("Really delete?")')
  await modalGone()
  await page.waitForTimeout(500)
  step('remove person from crew', (await page.locator('.card:has-text("Sigrid Nyström")').count()) === 0)
  // her assignments are gone from tasks too
  await page.goto(BASE + '/#/areas/taket')
  await page.waitForSelector('h1:has-text("Taket")')
  const si = await page.locator('[title="SI"]').count()
  step('removed person gone from task assignments', si === 0, `SI avatars left: ${si}`)

  // ── 10. Project details edit (theme + name) ──
  await page.goto(BASE + '/#/account')
  await page.waitForSelector('h1')
  await page.click('.card:has-text("Växthuset")')
  await page.waitForSelector('.modal')
  await page.click('.modal button:has-text("Edit details")')
  await page.fill('.modal input >> nth=1', 'A greenhouse from old windows — updated.')
  await page.click('.modal button[type="submit"]')
  await modalGone()
  await page.click('.card:has-text("Växthuset")')
  const desc = await page.locator('.modal').textContent()
  step('project details edit persists', /updated\./.test(desc ?? ''))
  await page.keyboard.press('Escape')

  // ── probes ──
  await page.goto(BASE + '/#/events')
  await page.click('button:has-text("New event")')
  await page.fill('input[placeholder="Råbygge — walls & roof"]', 'Cap zero')
  await page.fill('input[placeholder="Sat 5 Jul"]', 'X')
  await page.fill('.modal input[type="number"]', '0')
  await page.click('.modal button[type="submit"]')
  await modalGone()
  const capText = await page.locator('.card:has-text("Cap zero")').textContent()
  step('probe: capacity 0 clamps to ≥1', /0 \/ 1|0 \/ 10/.test(capText ?? ''), capText?.match(/\d+ \/ \d+/)?.[0])

  await page.screenshot({ path: SHOT_DIR + 'round2-final.png' })
} catch (err) {
  step('SCRIPT ABORTED', false, err.message)
  await page.screenshot({ path: SHOT_DIR + 'failure2.png' }).catch(() => {})
}

console.log('\n--- SUMMARY ---')
console.log(results.join('\n'))
await browser.close()
