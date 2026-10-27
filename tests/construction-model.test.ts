import { test } from 'node:test'
import assert from 'node:assert/strict'
import { constructionModel } from '../src/domain/constructionModel.ts'
import type { ConstructionPreparationSource } from '../src/data/buildPreparation.ts'

function fixture(): ConstructionPreparationSource {
  return { draft: { status:'ok', projectId:'A', artifact_id:'saved-construction', revision:7, current_revision:7, area_id:null, title:'Exact solid', archived:false, source_state:'current', solution_id:'solution', solution_revision:1,
    recipe: { contract_version:1, units:'mm', assembly_id:'fixture', views:['front','top'],
      definitions:[{id:'panel',primitive:'box',material_ref:null,x_mm:600,y_mm:400,z_mm:18}],
      instances:[{id:'panel_1',definition_id:'panel',placement:{x:100,y:200,z:30,rx:0,ry:0,rz:90}}] } as any,
    materials:[{definition_id:'panel',material_id:'plywood',material_revision:2}], joints:[], open_questions:['Fit has not been checked.'], instance_policy:null },
    catalog:new Map([['plywood@2',{name:'Pinned plywood',properties:{}}],['plywood@3',{name:'Newer material must not be used',properties:{color:{truth:'provided_spec',value:'#123456'}}}]]) }
}
test('3D uses exact saved dimensions, intrinsic placement and pinned material without altering the recipe', () => {
  const source=fixture(), original=structuredClone(source.draft.recipe), result=constructionModel(source)
  assert.equal(result.status,'ready')
  if(result.status!=='ready')return
  assert.deepEqual(result.model.bounds,{min:[-300,200,30],max:[100,800,48]})
  assert.equal(result.model.revision,7)
  assert.equal(result.model.parts[0].materialName,'Pinned plywood')
  assert.equal(result.model.parts[0].materialRevision,2)
  assert.equal(result.model.parts[0].colorIsSpecification,false)
  assert.match(result.model.gaps.join(' '),/actual colour and texture have not been specified/)
  assert.deepEqual(source.draft.recipe,original)
})
test('unsupported holes and curved solids refuse the whole view rather than display misleading blanks', () => {
  const source=fixture()
  source.draft.recipe.definitions[0].cuts=[{primitive:'box',x_mm:10,y_mm:10,z_mm:18,placement:{x:0,y:0,z:0,rx:0,ry:0,rz:0}}]
  assert.equal(constructionModel(source).status,'unsupported')
  source.draft.recipe.definitions=[{id:'panel',primitive:'cylinder',material_ref:null,diameter_mm:40,length_mm:300}]
  assert.equal(constructionModel(source).status,'unsupported')
})
test('missing exact material refuses the view; only typed colour specifications affect appearance', () => {
  const source=fixture();source.catalog.delete('plywood@2')
  assert.equal(constructionModel(source).status,'unavailable')
  source.catalog.set('plywood@2',{name:'Pinned plywood',properties:{color:{truth:'ai_assessment',value:'#aabbcc'}}})
  let result=constructionModel(source)
  assert.equal(result.status,'ready');if(result.status!=='ready')return
  assert.equal(result.model.parts[0].colorIsSpecification,false)
  source.catalog.set('plywood@2',{name:'Pinned plywood',properties:{color:{truth:'provided_spec',value:'#aabbcc'}}})
  result=constructionModel(source)
  assert.equal(result.status,'ready');if(result.status!=='ready')return
  assert.equal(result.model.parts[0].color,'#aabbcc');assert.equal(result.model.parts[0].colorIsSpecification,true)
})
test('all saved instances remain in the model and unmodeled joint details remain explicit', () => {
  const source=fixture()
  source.draft.recipe.instances.push({id:'panel_2',definition_id:'panel',placement:{x:0,y:0,z:0,rx:0,ry:0,rz:0}})
  source.draft.joints=[{id:'joint',method:'screwed_butt'}]
  const result=constructionModel(source)
  assert.equal(result.status,'ready');if(result.status!=='ready')return
  assert.deepEqual(result.model.parts.map(p=>p.id),['panel_1','panel_2'])
  assert.match(result.model.gaps.join(' '),/do not add modeled screws/)
})
test('reference volumes retain their exact geometry and explicit nonphysical role', () => {
  const source=fixture()
  source.draft.instance_policy={version:1,instances:[{instance_id:'panel_1',role:'reference',quantity_policy:'exclude',reason:'Clearance envelope'}]}
  const result=constructionModel(source)
  assert.equal(result.status,'ready');if(result.status!=='ready')return
  assert.equal(result.model.parts[0].role,'reference')
  assert.deepEqual(result.model.bounds,{min:[-300,200,30],max:[100,800,48]})
  assert.match(result.model.gaps.join(' '),/not physical parts/)
})
