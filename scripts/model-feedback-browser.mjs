import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { conceptFixture } from '../tests/support/solution-concept-fixtures.ts'

/** Real built UI/data/composer; intercepted HTTP, no classifier/model calls. */
export async function verifyModelFeedbackBrowser(page, base, fixture, turns, width) {
  const id = randomUUID(), row = { id, solution_id:id, project_id:'A', area_id:null, revision:1, title:'Feedback bed', description:'Keep the ladder and drawers', assumptions:'Unmeasured', tradeoffs:'',
    source_media_id:null,source_media_title:'',archived:false,change_note:'Initial form',actor_label:'Fixture member',recorded_at:new Date().toISOString(),measurements:[],design_intent:conceptFixture('bed') }
  fixture.records.set(id,row); fixture.histories.set(id,[structuredClone(row)])
  const openVersion = async revision => {
    await page.getByRole('article',{ name:'Feedback bed',exact:true }).getByRole('button',{ name:'View evidence',exact:true }).click()
    const dialog = page.getByRole('dialog',{ name:`Feedback bed · Version ${revision}`,exact:true })
    const model = dialog.getByRole('region',{ name:'Concept model',exact:true })
    await model.getByRole('img',{ name:/Plan.*XY projection/ }).waitFor()
    await model.getByText('Model feedback history',{ exact:true }).waitFor()
    return { dialog,model }
  }
  const drawer = page.getByRole('complementary',{ name:'Ask bob for Porch A',exact:true })
  const openBob = async model => {
    await model.getByRole('button',{ name:'Discuss this model with Bob',exact:true }).click()
    await drawer.getByLabel('Question for bob').waitFor()
  }
  const closeBob = async () => { await drawer.getByRole('button',{ name:'Close Ask bob',exact:true }).click(); await drawer.waitFor({ state:'hidden' }) }
  const send = async expected => {
    const count = turns.length
    await drawer.getByRole('button',{ name:'Send',exact:true }).click()
    await drawer.locator('.bob-working').waitFor({ state:'hidden' })
    assert.equal(turns.length,count+1)
    assert.equal(turns.at(-1).screen.presentationId,expected)
  }
  await page.goto(base+'#/solutions')
  let { dialog,model } = await openVersion(1)
  const first = [...fixture.presentations.values()].find(p=>p.solution_id===id&&p.view_id==='plan')
  assert(first); assert.equal(fixture.modelFeedback.length,0,'viewing creates no response')
  await openBob(model)
  assert.equal(turns.length,0,'opening discussion does not send')
  await drawer.getByLabel('Question for bob').fill('Page focus question — ja, men flytta stegen. Behåll lådorna.')
  await closeBob()
  await model.getByRole('button',{ name:/Longitudinal.*XZ/ }).click()
  await model.getByText('Model feedback history',{ exact:true }).waitFor()
  await openBob(model); await send(first.id); await closeBob()
  fixture.modelFeedback.push({ id:randomUUID(),project_id:'A',presentation_id:first.id,solution_id:id,solution_revision:1,actor_label:'Fixture member',outcome:'change_requested',authority:'user',mandate_id:null,scope:'components',area_id:null,scope_label:'Project',component_ids:['ladder'],recorded_at:new Date().toISOString(),source_current:true,view_id:'plan' })
  await model.getByText('Model feedback history',{ exact:true }).click()
  await model.getByRole('button',{ name:'Refresh model feedback',exact:true }).click()
  await model.getByText('Changes requested',{ exact:true }).waitFor()
  await page.screenshot({ path:`test-results/model-feedback-${width}.png`,fullPage:true })
  await dialog.getByRole('button',{ name:'Close',exact:true }).click()
  await page.reload()
  ;({ dialog,model } = await openVersion(1))
  await model.getByText('Model feedback history',{ exact:true }).click()
  await model.getByText('Changes requested',{ exact:true }).waitFor()
  await openBob(model)
  await drawer.getByLabel('Question for bob').fill('Page focus question — svar på versionen som visades före ändringen.')
  await closeBob()
  await dialog.getByRole('button',{ name:'Close',exact:true }).click()
  const next = structuredClone(row); next.revision=2; next.design_intent.model.nodes.find(n=>n.id==='ladder_x').value=100
  fixture.records.set(id,next); fixture.histories.get(id).push(next)
  // Navigation refresh preserves the unsent composer and opens a genuinely new model.
  await page.goto(base+'#/project'); await page.getByRole('heading',{ name:'Porch A',exact:true }).waitFor()
  await page.goto(base+'#/solutions')
  ;({ dialog,model } = await openVersion(2))
  await model.getByRole('row').filter({ hasText:'Wall mounted ladder envelope' }).getByText('100 / 0',{ exact:true }).waitFor()
  await openBob(model)
  await drawer.getByLabel('Bob page context').getByText('Shown model · v1',{ exact:true }).waitFor()
  await send(first.id); await closeBob()
  fixture.rejectPresentationOnce=true
  await model.getByRole('button',{ name:/Longitudinal.*XZ/ }).click()
  await model.getByRole('button',{ name:'Retry model link',exact:true }).waitFor()
  assert.equal(await model.getByRole('img',{ name:/Longitudinal.*XZ/ }).count(),1,'link failure retains the actual drawing')
  await model.getByRole('button',{ name:'Retry model link',exact:true }).click()
  await model.getByText('Model feedback history',{ exact:true }).waitFor()
  let release,started
  const pending = new Promise(resolve=>{ started=resolve })
  fixture.holdPresentation={ promise:new Promise(resolve=>{ release=resolve }),started }
  await model.getByRole('button',{ name:'Plan · XY',exact:true }).click(); await pending
  await model.getByRole('button',{ name:/Longitudinal.*XZ/ }).click()
  await model.getByText('Model feedback history',{ exact:true }).waitFor()
  release()
  const current = [...fixture.presentations.values()].find(p=>p.solution_id===id&&p.solution_revision===2&&p.view_id==='profile')
  await openBob(model)
  await drawer.getByLabel('Question for bob').fill('Page focus question — nytt svar efter sen återkoppling.')
  await send(current.id); await closeBob()
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'model/feedback fit mobile')
  await dialog.getByRole('button',{ name:'Close',exact:true }).click()
  console.log(`FORM model feedback: visible view, no auto-send, scoped history/reload, frozen reply, recovery/late callback at ${width}px; HTTP fixtures only.`)
}
