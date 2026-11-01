// The material finder for the whole team (owner decision 2026-11-01): Mattias
// reads with it and keeps catalog search and read, its texts no longer name
// Konrad as the only asker, the publication is reproducible, and pinned
// manifests keep their former worker and texts.
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {catalogFixture,preMaterialFinderTeamCatalogFixture} from './support/ai-catalog-fixture.ts'
import {catalogWorkers} from '../supabase/functions/_shared/bob-workers.ts'
import {TEXTS} from '../scripts/build-ai-material-finder-team-catalog.ts'

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
 execFileSync(process.execPath,['--import','tsx','scripts/build-ai-material-finder-team-catalog.ts','--check'],{cwd:new URL('..',import.meta.url),stdio:'pipe'})
})

test('the finder policy carries the same manual as the tool',()=>{
 for(const session of [catalogFixture(),preMaterialFinderTeamCatalogFixture()]){
  const manual=session.manifest().definitions.find(row=>row.prompt_key==='tools.find_catalog_materials')!.definition.additional_description
  const policy=(session.definition('bob.tools','tool_contract').definition.catalog as any[]).find(c=>c.name==='find_catalog_materials')
  assert.equal(policy.how_to,manual)
 }
})
