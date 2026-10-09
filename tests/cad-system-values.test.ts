import {test} from 'node:test'
import assert from 'node:assert/strict'
import {prepareIntakeAssessment,INTAKE_SCHEMA,intakeGaps} from '../supabase/functions/_shared/cad-intake.ts'
import {createCadAssistant} from './support/cad-parameter-fixture.ts'
import {collectCadResearch} from './support/colleague-catalog-fixture.ts'
import {catalogFixture} from './support/ai-catalog-fixture.ts'
import {handoff,reviewReply} from './support/cad-review-fixture.ts'
import {createProjectLookup} from '../supabase/functions/_shared/project-lookup.ts'

const assessment={checks:handoff.requirements.map(r=>({id:r.id,status:'known',blocking:false,source_refs:['requirement:'+r.id],action:'none',detail:'Requested concept'})),additional_needs:[]}
const refs=new Set(handoff.requirements.map(r=>'requirement:'+r.id))
const need={status:'assumption',blocking:false,source_refs:[],action:'bob_decision',detail:'Choose concept dimensions for bookshelf, drawers and filled end panel'}
const recipe={contract_version:1 as const,units:'mm' as const,assembly_id:'concept',definitions:[{id:'panel',primitive:'box' as const,material_ref:null,x_mm:800,y_mm:600,z_mm:18}],instances:[{id:'panel',definition_id:'panel',placement:{x:0,y:0,z:0,rx:0,ry:0,rz:0}}],views:['front' as const,'top' as const]}
const reply=(name:string,args:unknown)=>({success:true,data:null,model:'fixture',responseId:'cursor',usage:{input_tokens:1,output_tokens:1,total_tokens:2},toolCalls:[{id:'call',type:'function' as const,function:{name,arguments:JSON.stringify(args)}}]})

for(const legacy of [undefined,2,999])test(`render uses database target 7 with model target ${legacy}`,async()=>{
 let renders=0
 const assistant=createCadAssistant({projectId:'A',userId:'u',research:false,available:true,deadline:Date.now()+200000,hasAccess:async()=>true,
  makeLookup:()=>createProjectLookup('A',async(_p,q)=>({data:{records:q.dataset==='target'?[{id:'project',revision:7,solution_id:'selected'}]:[],related:[],truncated:false},error:null}),1000,40),
  readArtifact:async()=>null,render:async r=>{renders++;return {recipe:r,manifest:{},files:{},previews:{front:'pixels',top:'pixels'}}},
  callModel:async o=>{
   if(o.functionName==='cad-reviewer')return reviewReply()
   for(const name of ['render_cad_candidate','render_saved_cad_candidate']){
    const schema=o.tools!.find(t=>t.function.name===name)!.function.parameters as any
    assert(!Object.hasOwn(schema.properties,'target_revision'));assert(!schema.required.includes('target_revision'))
   }
   return reply('render_cad_candidate',{recipe,purpose:'project',title:'Concept',description:'Requested concept',assumptions:'Site fit remains unverified',measurements:[],...(legacy===undefined?{}:{target_revision:legacy})})
  }})
 assert.equal((await assistant.consult({handoff,brief:'Draw the requested concept',area_id:null,component_id:null,step_id:null,artifact_id:null})).status,'ready')
 assert.equal(renders,1);assert.equal(assistant.candidate?.target_revision,7);assert.equal(assistant.candidate?.expected_revision,0)
})

test('new intake needs receive stable server IDs; existing persisted identities are reused',async()=>{
 const first=await prepareIntakeAssessment({...assessment,additional_needs:[need]},handoff,refs)
 assert(first);assert.match(first.additional_needs[0].id,/^need_[a-f0-9]{32}$/)
 const legacy=await prepareIntakeAssessment({...assessment,additional_needs:[{...need,id:'detail_dimensions_bookshelf_drawers_gable'}]},handoff,refs)
 assert.deepEqual(legacy,first,'a 41-character model ID is no longer a system input')
 const persisted={...first,additional_needs:[{...first.additional_needs[0],id:'existing_database_need'}]}
 const resumed=await prepareIntakeAssessment({...assessment,additional_needs:[{...need,status:'missing',blocking:true,action:'measurement'}]},handoff,refs,persisted)
 assert.equal(resumed?.additional_needs[0].id,'existing_database_need')
 assert.equal(resumed?.additional_needs[0].blocking,true)
 assert(!Object.hasOwn(INTAKE_SCHEMA.properties.additional_needs.items.properties,'id'))
})

test('system IDs do not relax requirement identity, citations or readiness validation',async()=>{
 for(const invalid of [
  {...assessment,checks:assessment.checks.map(c=>({...c,id:'invented'}))},
  {...assessment,additional_needs:[{...need,source_refs:['invented source']}]},
  {...assessment,additional_needs:[{...need,status:'known'}]},
  {...assessment,additional_needs:[{...need,blocking:true,action:'none'}]},
  {...assessment,additional_needs:[{...need,status:'conflict',blocking:false}]},
  {...assessment,additional_needs:[need,need]},
  {...assessment,additional_needs:[{...need,unexpected:'field'}]},
 ])assert.equal(await prepareIntakeAssessment(invalid,handoff,refs),null)
})

test('a cited canonical choice uses its database ID and only its own explicit deferral',async()=>{
 const sourceRefs=new Set([...refs,'saved_choice']),choices=new Set(['saved_choice'])
 const value={...assessment,additional_needs:[{...need,action:'owner_decision',source_refs:['saved_choice']}]}
 const result=await prepareIntakeAssessment(value,handoff,sourceRefs,null,choices)
 assert(result);assert.equal(result.additional_needs[0].id,'saved_choice')
 assert.equal(intakeGaps(result,new Set(['saved_choice'])).length,0)
 assert.equal(intakeGaps(result,new Set(['different_choice'])).length,1)
 const physical=await prepareIntakeAssessment({...value,additional_needs:[{...value.additional_needs[0],status:'missing',blocking:true,action:'measurement'}]},handoff,sourceRefs,null,choices)
 assert(physical);assert.match(physical.additional_needs[0].id,/^need_/)
 assert.equal(intakeGaps(physical,new Set(['saved_choice'])).length,1)
})

test('research binds exact known check IDs and accepts new needs in one call without model IDs',async()=>{
 let calls=0
 const result=await collectCadResearch({handoff,userId:'u',messages:[],tools:()=>[],execute:async()=>null,hasAccess:async()=>true,deadline:Date.now()+200000,
  callModel:async o=>{
   calls++
   const schema=o.tools!.find(t=>t.function.name==='finish_cad_research')!.function.parameters as any
   assert.deepEqual(schema.properties.checks.items.properties.id.enum,handoff.requirements.map(r=>r.id))
   assert(!Object.hasOwn(schema.properties.additional_needs.items.properties,'id'))
   return reply('finish_cad_research',{...assessment,additional_needs:[need]})
  }})
 assert.equal(calls,1);assert.equal(result.truncated,false);assert.match(result.assessment!.additional_needs[0].id,/^need_[a-f0-9]{32}$/)
 assert(!Object.hasOwn((catalogFixture().tool('render_cad_candidate').function.parameters as any).properties,'target_revision'))
})
