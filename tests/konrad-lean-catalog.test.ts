// Konrad's lean construction publication (2026-11-01, texts approved by the
// owner): the catalog the model reads and the code that validates agree, the
// publication is reproducible, and pinned manifests keep their former tools.
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {catalogFixture,preKonradLeanCatalogFixture} from './support/ai-catalog-fixture.ts'
import {createConstructionTools} from '../supabase/functions/_shared/construction-draft.ts'
import {CATALOG_FASTENER_TOOL,CATALOG_FIND_TOOL} from '../supabase/functions/_shared/material-catalog.ts'
import {catalogWorkers} from '../supabase/functions/_shared/bob-workers.ts'
import seedPolicy from '../supabase/functions/_shared/project-tools/catalog-seed.json' with {type:'json'}

const opts={projectId:'p',message:'Build',writer:{} as any,hasAccess:async()=>true,read:async()=>({}),readSources:async()=>({project:new Map(),physical:new Map()})}
// The runtime's flags for a manifest (ask-openai.ts reads the same metadata).
function codeTools(session:ReturnType<typeof catalogFixture>){
 const meta=(key:string)=>session.manifest().definitions.find(row=>row.prompt_key===key)?.metadata??{}
 return createConstructionTools({...opts,
  constructionRepeats:meta('tools.save_construction_draft').construction_repeat_version===1,
  formRefinement:meta('tools.save_construction_draft').form_refinement_version===1,
  defaultZero:meta('tools.save_construction_draft').default_zero_version===1,
  repeatStart:meta('tools.save_construction_draft').repeat_start_version===1,
  chosenJointFasteners:meta('tools.save_construction_draft').joint_fastener_version===2,
  coherentWork:meta('tools.read_construction_draft').construction_work_version===1,
  creationPreparation:meta('tools.read_construction_draft').creation_preparation_version===1,
  constructionText:meta('tools.change_construction_parameters').construction_text_version===1,
  constructionSourceRefresh:meta('tools.change_construction_parameters').construction_source_refresh_version===1,
  formEvidence:meta('tools.check_construction_draft').construction_evidence_version===1,
  writeState:meta('tools.save_construction_draft').write_state_version===1,
  constructionViews:meta('tools.read_construction_draft').construction_view_version===1} as any).tools
}

test('the model reads the schema code validates: save and edit, before and after the publication',()=>{
 for(const session of [catalogFixture(),preKonradLeanCatalogFixture()]){
  const tools=codeTools(session)
  for(const name of ['save_construction_draft','edit_construction_parts'])
   assert.deepEqual(session.tool(name).function.parameters,tools.find(t=>t.function.name===name)!.function.parameters,name)
 }
 const joints=(s:any)=>Object.keys(s.tool('save_construction_draft').function.parameters.properties.joints.items.properties)
 assert.deepEqual(joints(catalogFixture()),['id','first','second','reason','fasteners'])
 assert.deepEqual(joints(preKonradLeanCatalogFixture()),['id','method','first','second','reason','fastener'])
})

test('Konrad gets the finder and the add tool and loses the two lookups; Bob keeps his reads; the reason code is on',()=>{
 const after=catalogFixture(),box=after.definition('bob.tools').definition as any
 const konrad=(catalogWorkers(after) as any).structure
 assert(konrad.tools.includes('add_catalog_fastener'));assert(konrad.reads.includes('find_catalog_materials'))
 assert(!konrad.reads.includes('search_material_catalog')&&!konrad.reads.includes('read_material_catalog'))
 assert.equal(box.rejection_reason_version,1)
 assert.deepEqual(after.tool('find_catalog_materials').function.parameters,CATALOG_FIND_TOOL.function.parameters)
 assert.deepEqual(after.tool('add_catalog_fastener').function.parameters,CATALOG_FASTENER_TOOL.function.parameters)
 assert(!('request_quote' in (after.tool('add_catalog_fastener',{server_quote:true}).function.parameters.properties as object)),'the quote is filled by the server')
 for(const name of ['find_catalog_materials','add_catalog_fastener']){
  const live=(seedPolicy as any[]).find(r=>r.name===name),policy=box.catalog.find((c:any)=>c.name===name)
  assert.deepEqual(live,policy,name+' tool policy row equals the toolbox entry')
 }
 const role=after.role('material-finder')
 assert.equal(role.model.model_name.includes('nano')||role.profile?.tier==='nano'||JSON.stringify(role).includes('nano'),true)
 const pinned=(catalogWorkers(preKonradLeanCatalogFixture()) as any).structure
 assert(pinned.reads.includes('search_material_catalog')&&!pinned.tools.includes('add_catalog_fastener'))
})

test('the finder schema binds its references to the list, and only to it',()=>{
 const schema=catalogFixture().schema('bob_material_find',{item_refs:['m1','m2']})
 assert.deepEqual((schema.schema as any).properties.needs.items.properties.item_refs.items.enum,['m1','m2'])
})

test('the publication is generated and reproducible',()=>{
 execFileSync(process.execPath,['--import','tsx','scripts/build-ai-konrad-lean-catalog.ts','--check'])
})
