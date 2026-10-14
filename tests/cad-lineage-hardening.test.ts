import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildCadLineage, inheritCadLineage } from '../supabase/functions/_shared/cad-lineage.ts'
import {handoff} from './support/cad-review-fixture.ts'

const id='30000000-0000-4000-8000-000000000071'
const parentId='30000000-0000-4000-8000-000000000072'
const record={id,project_id:'A',revision:2,value:'600',unit:'mm',truth:'measured',source:'Measured fixture width',archived:false}
const recipe={contract_version:1 as const,units:'mm' as const,assembly_id:'hardening',
 definitions:[{id:'panel',primitive:'box' as const,material_ref:null,x_mm:600,y_mm:300,z_mm:18}],
 instances:[{id:'panel',definition_id:'panel',placement:{x:0,y:0,z:0,rx:0,ry:0,rz:0}}],views:['front' as const,'top' as const]}
const binding={definition_id:'panel',dimension:'x_mm',measurement_id:id,revision:2}

for(const [label,mutate] of [
 ['truth',(l:any)=>{l.bindings[0].source.truth='unknown'}],
 ['value',(l:any)=>{l.bindings[0].source.value='601'}],
 ['identity',(l:any)=>{l.bindings[0].source.id='not-an-id'}],
 ['coordinates',(l:any)=>{l.coordinates.positive_x={untrusted:'object'}}],
 ['duplicate',(l:any)=>{l.bindings.push(structuredClone(l.bindings[0]))}],
 ['state',(l:any)=>{delete l.bindings}],
] as const){
 test(`P1 hardening: saved-source ${label} is validated before paid rendering`,()=>{
  const lineage=buildCadLineage('A',recipe,[binding],new Map([[id,record]]),handoff.coordinates)
  mutate(lineage)
  assert.throws(()=>inheritCadLineage('A',{lineage},recipe,parentId,1),/invalid_source_lineage/)
 })
}

test('P1 hardening: explicit missing tracked metadata is not a legacy source',()=>{
 assert.throws(()=>inheritCadLineage('A',{lineage:null,lineage_state:'partial'},recipe,parentId,1),/invalid_source_lineage/)
})
