import {test} from 'node:test'
import assert from 'node:assert/strict'
import {splitDimensionBindings,bindPhysicalDimensions} from '../supabase/functions/_shared/cad-physical-lineage.ts'
import {buildCadLineage} from '../supabase/functions/_shared/cad-lineage.ts'
import {handoff} from './support/cad-review-fixture.ts'

const snapshotId='30000000-0000-4000-8000-000000000041'
const spaceId='30000000-0000-4000-8000-000000000042'
const buildingId='30000000-0000-4000-8000-000000000043'
const measureId='30000000-0000-4000-8000-000000000044'
const snapshot={id:snapshotId,space_id:spaceId,building_id:buildingId,space_revision:3,measurement_id:measureId,measurement_revision:2,
 subject:'Room width',value:'1.001',unit:'m',truth:'measured',source:'Accepted room snapshot; tape between marked walls'}
const recipe={contract_version:1 as const,units:'mm' as const,assembly_id:'physical-fixture',
 definitions:[{id:'panel',primitive:'box' as const,material_ref:null,x_mm:800,y_mm:300,z_mm:18}],
 instances:[{id:'panel',definition_id:'panel',placement:{x:0,y:0,z:0,rx:0,ry:0,rz:0}}],views:['front' as const,'top' as const]}
const binding={definition_id:'panel',dimension:'x_mm',space_measurement_id:snapshotId,space_revision:3}


test('P1b: two source kinds cannot claim the same geometric parameter',()=>{
 const projectBinding={definition_id:'panel',dimension:'x_mm',measurement_id:measureId,revision:2}
 assert.throws(()=>splitDimensionBindings([projectBinding,binding]),/duplicate_dimension_binding/)
 const l=buildCadLineage('destination',recipe,[],new Map(),handoff.coordinates)
 const r=structuredClone(recipe),records=new Map([[snapshotId,snapshot]])
 bindPhysicalDimensions(r,[binding],records,l)
 assert.throws(()=>bindPhysicalDimensions(r,[binding],records,l),/invalid_physical_binding/)
})
