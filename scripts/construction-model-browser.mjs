import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { conceptFixture } from '../tests/support/solution-concept-fixtures.ts'
import { evaluateConcept } from '../supabase/functions/_shared/solution-concept.ts'

/** HTTP fixture only; real Three.js, React, data facade and composer. */
export function createConstructionModelFixture(timestamp, artifacts) {
  const sources=new Map(),catalog=new Map(),presentations=new Map(),feedback=[]
  const fixture={sources,catalog,presentations,feedback,presentationCalls:[],sourceCalls:[],failRead:false,
    async handle(request,url,respond) {
      const table=url.pathname.split('/').at(-1),eq=key=>url.searchParams.get(key)?.replace(/^eq\./,'')
      const reply=async options=>{await respond(options);return true}
      if(table==='artifact_construction_revisions') {
        assert(!/recipe|materials|parameters|\*/.test(url.searchParams.get('select')),'metadata queries do not load geometry')
        const rows=[...sources.values()].map(s=>({artifact_id:s.artifact_id,artifact_revision:s.revision}))
        if(eq('artifact_id')) return reply({json:rows.filter(r=>r.artifact_id===eq('artifact_id')&&r.artifact_revision===Number(eq('artifact_revision')))})
        return reply({json:rows})
      }
      if(table==='catalog_item_revisions'&&catalog.size&&url.searchParams.get('or')?.includes([...catalog.keys()][0])) {
        assert.match(url.searchParams.get('or'),/revision\.eq\.2/)
        assert.equal(url.searchParams.get('limit'),'1')
        return reply({json:[...catalog.values()]})
      }
      if(table==='read_construction_draft') {
        const b=request.postDataJSON();fixture.sourceCalls.push(b)
        if(!b.p_artifact)return reply({json:{status:'ok',projectId:b.p_project,items:[...sources.values()].map(s=>({id:s.artifact_id,title:s.title,revision:s.revision})),truncated:false,next_cursor:null}})
        if(fixture.failRead)return reply({status:503,json:{message:'Fixture source temporarily unavailable'}})
        const source=sources.get(b.p_artifact+':'+b.p_revision)
        return reply({json:source&&b.p_project==='A'?source:{status:'not_found',projectId:b.p_project}})
      }
      if(table==='record_construction_presentation') {
        const b=request.postDataJSON(),source=sources.get(b.p_artifact+':'+b.p_revision)
        assert(source&&b.p_project==='A');fixture.presentationCalls.push(b)
        const key=[b.p_artifact,b.p_revision,b.p_view].join(':'),head=artifacts.records.get(b.p_artifact)
        if(!presentations.has(key))presentations.set(key,{id:randomUUID(),project_id:'A',solution_id:source.solution_id,solution_revision:source.solution_revision,
          artifact_id:source.artifact_id,artifact_revision:source.revision,area_id:null,scope_label:'Project',representation:'construction_3d',view_id:b.p_view,
          renderer_version:'construction-boxes-v1',components:source.design_intent.model.components.map(c=>({id:c.id,label:c.label})),
          shown_by:'Fixture member',shown_at:timestamp(),can_respond:true,source_current:true,feedback:[],next_feedback_id:null})
        const p=presentations.get(key)
        return reply({json:{...p,source_current:head.revision===source.revision,feedback:feedback.filter(f=>f.artifact_id===source.artifact_id&&f.artifact_revision===source.revision).map(({artifact_id,artifact_revision,...f})=>f)}})
      }
      return false
    },
  }
  return fixture
}

export async function verifyConstructionModelBrowser(page,base,fixture,artifacts,solutions,turns,width) {
  const id=randomUUID(),solution=randomUUID(),material=randomUUID(),intent=conceptFixture('box')
  // Add both end panels to the same canonical model, then derive the saved
  // recipe once. Browser camera changes never generate another recipe.
  intent.model.nodes.push({id:'inside_width',role:'decision',unit:'mm',value:364,reason:'Synthetic only'},
    {id:'right_x',role:'decision',unit:'mm',value:582,reason:'Synthetic only'})
  for(const [key,label,x] of [['left','Left wall','zero'],['right','Right wall','right_x']])intent.model.components.push({id:key,label,kind:'solid',active:true,
    position:[x,'wall','wall'],size:['wall','inside_width','height'],features:['fixture_form'],choices:['fixture_design']})
  const boxes=evaluateConcept(intent).boxes
  assert.equal(boxes.length,5)
  const recipe={contract_version:1,units:'mm',assembly_id:'saved_box',views:['front','top','isometric'],
    definitions:boxes.map(b=>({id:b.id,primitive:'box',material_ref:null,x_mm:b.size_mm[0],y_mm:b.size_mm[1],z_mm:b.size_mm[2]})),
    instances:boxes.map(b=>({id:b.id,definition_id:b.id,placement:{x:b.min[0],y:b.min[1],z:b.min[2],rx:0,ry:0,rz:0}}))}
  const row={id,artifact_id:id,project_id:'A',area_id:null,revision:1,title:'Saved box construction',description:'Five saved panels; joinery remains unverified.',
    kind:'detail',status:'concept',assumptions:'Synthetic design values',target_revision:1,solution_id:solution,solution_revision:1,solution_title:'Box concept',
    archived:false,actor_label:'Fixture member',recorded_at:new Date().toISOString(),change_note:'Saved checkpoint',measurements:[],source_media_id:null,
    source_media_title:'',generator:null,generator_version:null,has_room_layout:false,has_stair_study:false,has_multifloor_plan:false}
  artifacts.records.set(id,row);artifacts.histories.set(id,[structuredClone(row)])
  solutions.records.set(solution,{id:solution,project_id:'A',revision:1,title:'Box concept',design_intent:intent,area_id:null,archived:false})
  const source={status:'ok',projectId:'A',artifact_id:id,revision:1,current_revision:1,area_id:null,title:row.title,archived:false,source_state:'current',
    solution_id:solution,solution_revision:1,design_intent:intent,recipe,materials:boxes.map(b=>({definition_id:b.id,material_id:material,material_revision:2})),
    joints:[],open_questions:['Joint strength and fastening details remain unverified.'],instance_policy:{version:1,instances:boxes.map(b=>({instance_id:b.id,role:'build_part',quantity_policy:'manufacture',reason:'Saved panel'}))}}
  fixture.sources.set(id+':1',source);fixture.catalog.set(material,{item_id:material,revision:2,name:'Pinned plywood',properties:{}})
  const go=revision=>page.goto(base+`#/artifacts?drawing=${id}&revision=${revision}`)
  const model=page.getByRole('region',{name:'Construction model',exact:true})
  const drawn=async(view='overview')=>{
    const viewport=model.getByRole('img',{name:`Saved construction, ${view} view`,exact:true})
    await viewport.waitFor()
    // A mounted offscreen canvas is not a shown model. Scroll as a person does
    // before expecting the visibility-gated presentation and discussion link.
    await viewport.scrollIntoViewIfNeeded()
    await model.locator('[data-instances="5"]').waitFor()
    await model.getByRole('button',{name:'Discuss this model with Bob',exact:true}).waitFor()
    await model.getByText('Model feedback history',{exact:true}).waitFor()
  }
  await go(1);await drawn()
  assert.equal(fixture.feedback.length,0)
  await model.getByText(/Pinned plywood · material version 2/).waitFor()
  await model.getByText('Neutral display finish; actual appearance unspecified.',{exact:true}).waitFor()
  const first=[...fixture.presentations.values()].find(p=>p.artifact_id===id)
  const sourceReads=fixture.sourceCalls.filter(c=>c.p_artifact===id).length,recipeBefore=JSON.stringify(recipe)
  for(const view of ['front','right','top','overview']){
    await model.getByRole('group',{name:'Construction views',exact:true}).getByRole('button',{name:view[0].toUpperCase()+view.slice(1),exact:true}).click();await drawn(view)
  }
  assert.equal(fixture.sourceCalls.filter(c=>c.p_artifact===id).length,sourceReads,'another view never rereads geometry')
  assert.equal(JSON.stringify(source.recipe),recipeBefore)
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
  for(const control of await model.getByRole('button').all()){
    const b=await control.boundingBox();assert(b&&b.width>=44&&b.height>=44,'reachable mobile controls')
  }
  await page.screenshot({path:`test-results/construction-model-${width}.png`,fullPage:true})
  const drawer=page.getByRole('complementary',{name:'Ask bob for Porch A',exact:true}),count=turns.length
  await model.getByRole('button',{name:'Discuss this model with Bob',exact:true}).click()
  await drawer.getByLabel('Question for bob').fill('Page focus question — yes, but move the front wall.')
  await drawer.getByRole('button',{name:'Close Ask bob',exact:true}).click()
  const next={...structuredClone(row),revision:2};artifacts.records.set(id,next);artifacts.histories.get(id).push(next)
  const nextSource=structuredClone(source);nextSource.revision=2;nextSource.current_revision=2;nextSource.recipe.instances.find(i=>i.id==='front').placement.y=10
  fixture.sources.set(id+':2',nextSource)
  await go(2);await drawn()
  await model.getByRole('button',{name:'Discuss this model with Bob',exact:true}).click()
  await drawer.getByRole('button',{name:'Send',exact:true}).click();await drawer.locator('.bob-working').waitFor({state:'hidden'})
  assert.equal(turns.length,count+1);assert.equal(turns.at(-1).screen.artifactRevision,1);assert.equal(turns.at(-1).screen.presentationId,first.id)
  await drawer.getByRole('button',{name:'Close Ask bob',exact:true}).click()
  fixture.feedback.push({id:randomUUID(),project_id:'A',presentation_id:first.id,artifact_id:id,artifact_revision:1,actor_label:'Fixture member',outcome:'change_requested',authority:'user',mandate_id:null,scope:'components',component_ids:['front'],area_id:null,scope_label:'Project',recorded_at:new Date().toISOString(),source_current:false,view_id:'overview'})
  await go(1);await page.reload();await drawn()
  await model.getByText('Model feedback history',{exact:true}).click();await model.getByText('Changes requested',{exact:true}).waitFor()
  // A denied source or unsupported geometry must not register a visible model.
  fixture.failRead=true;await page.reload();await model.getByRole('alert').waitFor()
  const presentations=fixture.presentationCalls.length
  assert.equal(await model.getByRole('img').count(),0)
  fixture.failRead=false;await model.getByRole('button',{name:'Retry',exact:true}).click();await drawn()
  assert(fixture.presentationCalls.length>presentations)
  source.recipe.definitions[0].cuts=[{primitive:'box',x_mm:10,y_mm:10,z_mm:10,placement:{x:0,y:0,z:0,rx:0,ry:0,rz:0}}]
  await page.reload();await model.getByText(/cannot show exactly yet/).waitFor()
  assert.equal(await model.getByRole('button',{name:'Discuss this model with Bob',exact:true}).count(),0)
  assert.equal(await model.getByRole('img').count(),0)
  await page.goto(base+'#/project')
  artifacts.records.delete(id);artifacts.histories.delete(id);solutions.records.delete(solution)
  fixture.sources.clear();fixture.catalog.clear();fixture.presentations.clear();fixture.feedback.length=0
  console.log(`FORM construction 3D: exact saved solids/materials, named views, frozen reply, history/reload, source denial and unsupported-shape recovery at ${width}px; WebGL rendered, HTTP fixtures only.`)
}
