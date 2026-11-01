// The finder for the whole team and Konrad's save fixes (owner decisions 2026-11-01): Mattias
// reads with it and keeps catalog search and read, its texts no longer name
// Konrad as the only asker, the publication is reproducible, and pinned
// manifests keep their former worker and texts.
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {catalogFixture,preMaterialFinderTeamCatalogFixture} from './support/ai-catalog-fixture.ts'
import {catalogWorkers} from '../supabase/functions/_shared/bob-workers.ts'
import {createConstructionTools} from '../supabase/functions/_shared/construction-draft.ts'
import {REPEAT_ARRAYS_TEXT,REPEAT_START_TEXT} from '../supabase/functions/_shared/cad-arrays.ts'
import {TEXTS} from '../scripts/build-ai-team-finder-save-fixes-catalog.ts'

const mattias=(session:ReturnType<typeof catalogFixture>)=>(catalogWorkers(session) as any).materials

test('Mattias reads with the finder and keeps catalog search and read; pinned manifests keep his former reads',()=>{
 const now=mattias(catalogFixture()),pinned=mattias(preMaterialFinderTeamCatalogFixture())
 assert.deepEqual(now.reads,[...pinned.reads,'find_catalog_materials'])
 assert.deepEqual(now.tools,pinned.tools)
 for(const name of ['search_material_catalog','read_material_catalog'])assert(now.tools.includes(name),name)
 assert(!pinned.reads.includes('find_catalog_materials'))
 // The finder stays a read: no worker owns it, so Bob keeps it too.
 for(const worker of Object.values(catalogWorkers(catalogFixture()) as Record<string,any>))assert(!worker.tools.includes('find_catalog_materials'))
})

test('the finder texts no longer name Konrad; pinned manifests keep the former texts',()=>{
 const text=(session:ReturnType<typeof catalogFixture>)=>{
  const def=(key:string)=>session.manifest().definitions.find(row=>row.prompt_key===key)!
  return [def('material-finder.persona').content,def('material-finder.contract').content,def('tools.find_catalog_materials').definition.card_description,
   def('tools.find_catalog_materials').definition.additional_description,def('role.material-finder').definition.purpose].join('\n')
 }
 const now=text(catalogFixture()),pinned=text(preMaterialFinderTeamCatalogFixture())
 assert(!/Konrad/.test(now),now)
 for(const t of Object.values(TEXTS)){assert(now.includes(t.new),t.new);assert(pinned.includes(t.old),t.old);assert(!now.includes(t.old),t.old)}
})

test('the publication is reproducible from the pinned catalog',()=>{
 execFileSync(process.execPath,['--import','tsx','scripts/build-ai-team-finder-save-fixes-catalog.ts','--check'],{cwd:new URL('..',import.meta.url),stdio:'pipe'})
})

test('the finder policy carries the same manual as the tool',()=>{
 for(const session of [catalogFixture(),preMaterialFinderTeamCatalogFixture()]){
  const manual=session.manifest().definitions.find(row=>row.prompt_key==='tools.find_catalog_materials')!.definition.additional_description
  const policy=(session.definition('bob.tools','tool_contract').definition.catalog as any[]).find(c=>c.name==='find_catalog_materials')
  assert.equal(policy.how_to,manual)
 }
})

const opts={projectId:'p',message:'Build',writer:undefined,hasAccess:async()=>true,read:async()=>({}),readSources:async()=>({project:new Map(),physical:new Map()})}
const flags=(session:ReturnType<typeof catalogFixture>)=>{
 const meta=session.manifest().definitions.find(row=>row.prompt_key==='tools.save_construction_draft')!.metadata
 return {decimalRounding:meta.decimal_rounding_version===1,repeatStart:meta.repeat_start_version===1}
}

test('Konrad\'s save fixes are switched on only for the new manifest, and repeats state their start there',()=>{
 assert.deepEqual(flags(catalogFixture()),{decimalRounding:true,repeatStart:true})
 assert.deepEqual(flags(preMaterialFinderTeamCatalogFixture()),{decimalRounding:false,repeatStart:false})
 const arrays=(session:ReturnType<typeof catalogFixture>)=>(session.tool('save_construction_draft').function.parameters as any).properties.recipe.properties.arrays
 const now=arrays(catalogFixture()),pinned=arrays(preMaterialFinderTeamCatalogFixture())
 assert.equal(now.description,REPEAT_ARRAYS_TEXT);assert.equal(now.items.properties.start.description,REPEAT_START_TEXT)
 assert.deepEqual(now.items.required,['id','definition_id','axis','count','start']);assert(!('start' in pinned.items.properties))
})

test('a value with too many decimals is rounded before the tool runs and named in the result; pinned turns are unchanged',async()=>{
 const change={key:'k',record_id:'00000000-0000-4000-8000-000000000001',expected_revision:1,request_quote:'Build',change_note:'Split',
  changes:[{id:'third',role:'decision',value:2000/3,unit:'mm',reason:'Split in three'}]}
 const run=(decimalRounding:boolean)=>createConstructionTools({...opts,decimalRounding} as any).execute('change_construction_parameters',structuredClone(change))
 const now:any=await run(true),pinned:any=await run(false)
 assert.deepEqual(now.rounded_values,['third']);assert(!('rounded_values' in pinned))
 assert.equal(now.status,'unavailable');assert.equal(pinned.status,'unavailable')
})

test('Bob\'s final answer past the spending stop is switched on only for the new manifest',()=>{
 const meta=(session:ReturnType<typeof catalogFixture>)=>session.manifest().definitions.find(row=>row.prompt_key==='agent-contract.ask-bob')!.metadata
 assert.equal(meta(catalogFixture()).final_answer_version,1);assert.equal(meta(catalogFixture()).turn_usd_stop,4)
 assert(!('final_answer_version' in meta(preMaterialFinderTeamCatalogFixture())))
})
