import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createBuildPreparation } from '../src/data/buildPreparation.ts'

test('construction source reads only exact material pins in bounded requests, preserving project guards', async () => {
  const materials = Array.from({length:33}, (_, i) => ({material_id:randomUUID(),material_revision:i+1}))
  const draft = {status:'ok',projectId:'A',artifact_id:'construction',revision:7,recipe:{definitions:[],instances:[]},materials:[...materials,materials[0]],joints:[]}
  const reads: Array<{filter:string,limit:number}> = []
  let revoked = false, wrongVersion = false
  const client = {
    rpc:async (name:string,args:any) => {assert.equal(name,'read_construction_draft');assert.deepEqual(args,{p_project:'A',p_artifact:'construction',p_revision:7,p_after:null});return {data:draft,error:null}},
    from:(table:string) => {
      assert.equal(table,'catalog_item_revisions')
      return {select:(columns:string) => {
        assert.equal(columns,'item_id,revision,name,properties')
        return {or:(filter:string) => ({limit:async (limit:number) => {
          reads.push({filter,limit})
          const exact = materials.filter(p => filter.includes(`and(item_id.eq.${p.material_id},revision.eq.${p.material_revision})`))
          return {data:exact.map(p=>({item_id:p.material_id,revision:p.material_revision+(wrongVersion?1:0),name:'Pinned',properties:{}})),error:null}
        }})}
      }}
    },
  }
  const seam = createBuildPreparation(client as any, project => {assert.equal(project,'A');return () => {if(revoked)throw Error('project_changed')}})
  const source = await seam.source('A','construction',7)
  assert.deepEqual(reads.map(r=>r.limit),[32,1]);assert.equal(source.catalog.size,33)
  for(const pin of materials)assert(source.catalog.has(pin.material_id+'@'+pin.material_revision))
  assert(reads.every(r=>r.filter.length<3000))
  wrongVersion=true
  await assert.rejects(seam.source('A','construction',7),/unexpected version/)
  wrongVersion=false;revoked=true
  const count=reads.length
  await assert.rejects(seam.source('A','construction',7),/project_changed/);assert.equal(reads.length,count)
  revoked=false;materials[0].material_id='injected),revision.gt.0'
  await assert.rejects(seam.source('A','construction',7),/unavailable material versions/);assert.equal(reads.length,count)
})
