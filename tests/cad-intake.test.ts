import {test} from 'node:test'
import assert from 'node:assert/strict'
import {RENDER_CAD_TOOL,RENDER_SAVED_CAD_TOOL} from '../supabase/functions/_shared/cad-assistant.ts'
import {parseIntakeAssessment,bindMeasuredDimensions,intakeGaps} from '../supabase/functions/_shared/cad-intake.ts'
import {shapeId,handoff} from './support/cad-review-fixture.ts'
const id='30000000-0000-4000-8000-000000000001'
const measurement='30000000-0000-4000-8000-000000000002'
const check=(id:string,status='known',blocking=false)=>({id,status,blocking,source_refs:status==='known'?['requirement:'+id]:[],action:blocking?'measurement':'none',detail:'Whole construction input check: '+id})
const assessment={checks:[check(shapeId)],additional_needs:[]}
const recipe={contract_version:1 as const,units:'mm' as const,assembly_id:'bed',definitions:[{id:'panel',primitive:'box' as const,material_ref:null,x_mm:999,y_mm:600,z_mm:18}],instances:[{id:'panel',definition_id:'panel',placement:{x:0,y:0,z:0,rx:0,ry:0,rz:0}}],views:['front' as const,'top' as const]}

test('a partial or fabricated checklist cannot pass readiness',()=>{
 const refs=new Set(['requirement:'+shapeId])
 assert(parseIntakeAssessment(assessment,handoff,refs))
 assert.equal(parseIntakeAssessment({...assessment,checks:[]},handoff,refs),null)
 assert.equal(parseIntakeAssessment({...assessment,checks:[{...check(shapeId),source_refs:['imaginary']}]},handoff,refs),null)
 assert.equal(parseIntakeAssessment({...assessment,additional_needs:[check(shapeId)]},handoff,refs),null)
})
test('execution history cannot erase missing measurements or consequential owner choices',()=>{
 const refs=new Set(['requirement:'+shapeId])
 const execution_issues=[{kind:'candidate_validation',detail:'A prior candidate failed rendering.',source_refs:['requirement:'+shapeId]}]
 const inputs={checks:[check(shapeId,'missing',true)],additional_needs:[{...check('owner_choice','missing',false),action:'owner_decision'}],execution_issues}
 const parsed=parseIntakeAssessment(inputs,handoff,refs)
 assert(parsed);assert.deepEqual(parsed.execution_issues,execution_issues)
 assert.deepEqual(intakeGaps(parsed).map(c=>c.id),[shapeId,'owner_choice'])
 const ready=parseIntakeAssessment({...assessment,execution_issues},handoff,refs)
 assert(ready);assert.deepEqual(intakeGaps(ready),[])
 for(const issue of [{...execution_issues[0],source_refs:['invented']},{...execution_issues[0],source_refs:[]},{...execution_issues[0],kind:'missing_measurement'},{...execution_issues[0],blocking:false}]){
  assert.equal(parseIntakeAssessment({...assessment,execution_issues:[issue]},handoff,refs),null)
 }
 assert(parseIntakeAssessment(assessment,handoff,refs),'old pinned two-field assessments remain readable')
})
test('new geometry has no saved selection fields; saved selections have no recipe',()=>{
 const fresh=RENDER_CAD_TOOL.function.parameters.properties,saved=RENDER_SAVED_CAD_TOOL.function.parameters.properties
 assert('recipe' in fresh);assert(!('part_ids' in fresh));assert(!('source_artifact_id' in fresh));assert('part_ids' in saved);assert(!('recipe' in saved))
})
test('server binds exact measured values in mm and refuses stale, ambiguous or unpinned input',()=>{
 const records=new Map([[measurement,{id:measurement,revision:2,value:'132',unit:'cm',truth:'measured',source:'Measured fixture width'}]])
 const bindings=[{definition_id:'panel',dimension:'x_mm',measurement_id:measurement,revision:2}]
 assert.equal(bindMeasuredDimensions(recipe,bindings,records).definitions[0].x_mm,1320);assert.equal(recipe.definitions[0].x_mm,999)
 assert.throws(()=>bindMeasuredDimensions(recipe,[{...bindings[0],revision:1}],records),/unusable/)
 assert.throws(()=>bindMeasuredDimensions(recipe,bindings,new Map()),/unusable/)
 assert.throws(()=>bindMeasuredDimensions(recipe,[...bindings,...bindings],records),/unusable/)
 assert.throws(()=>bindMeasuredDimensions(recipe,bindings,new Map([[measurement,{revision:2,value:'132-135',unit:'cm'}]])),/unusable/)
})
