import { test } from 'node:test'
import assert from 'node:assert/strict'
import {bindMeasuredDimensions} from '../supabase/functions/_shared/cad-intake.ts'
import {handoff} from './support/cad-review-fixture.ts'

const measurementId='30000000-0000-4000-8000-000000000081'
const requestId='30000000-0000-4000-8000-000000000082'
const recipe={contract_version:1 as const,units:'mm' as const,assembly_id:'lineage-fixture',
 definitions:[{id:'panel',primitive:'box' as const,material_ref:null,x_mm:900,y_mm:300,z_mm:18}],
 instances:[{id:'panel-1',definition_id:'panel',placement:{x:0,y:0,z:0,rx:0,ry:0,rz:0}}],views:['front' as const,'top' as const]}
const binding={definition_id:'panel',dimension:'x_mm',measurement_id:measurementId,revision:2}
const measurement={id:measurementId,project_id:'A',area_id:null,component_id:null,revision:2,subject:'Panel width',value:'1.001',unit:'m',millimetres:'1001',truth:'measured',source:'Measured between the marked endpoints',notes:'',archived:false}

test('P1: exact finite decimal conversion must not introduce a floating-point dimension error',()=>{
 const bound=bindMeasuredDimensions(recipe,[binding],new Map([[measurementId,measurement]]))
 assert.equal(bound.definitions[0].x_mm,1001)
 assert.equal(recipe.definitions[0].x_mm,900,'the supplied design is not mutated')
})

test('P1: unknown numeric records cannot become source-backed geometry',()=>{
 assert.throws(()=>bindMeasuredDimensions(recipe,[binding],new Map([[measurementId,{...measurement,truth:'unknown'}]])))
})

// Additional contract checks; the initial four tests above were executed red
// against the unchanged production source before implementation.
import { buildCadLineage, inheritCadLineage, lineageMeasurementPins, measurementMillimetres } from '../supabase/functions/_shared/cad-lineage.ts'

test('P1: direct conversion respects the canonical decimal range and cannot mask conflicting normalization',()=>{
 for(const [value,unit,want] of [['1.001','m',1001],['0.001','mm',0.001],['12.345','cm',123.45],['1000000','m',1000000000]] as const)
  assert.equal(measurementMillimetres({value,unit,truth:'measured'}),want)
 for(const value of ['-1','1e3','1.0001','NaN','1000001'])assert.throws(()=>measurementMillimetres({value,unit:'m'}))
 assert.throws(()=>measurementMillimetres({...measurement,millimetres:'1002'}),/inconsistent/)
})

test('P1: saved details inherit source pins and original coordinates, not new guesses',()=>{
 const exact=bindMeasuredDimensions(recipe,[binding],new Map([[measurementId,measurement]]))
 const lineage=buildCadLineage('A',exact,[binding],new Map([[measurementId,measurement]]),handoff.coordinates)
 const inherited=inheritCadLineage('A',{lineage},exact,requestId,3)
 assert.deepEqual(inherited.bindings,lineage.bindings);assert.deepEqual(inherited.coordinates,lineage.coordinates)
 assert.deepEqual(lineageMeasurementPins([],inherited),[{id:measurementId,revision:2}])
 assert.throws(()=>lineageMeasurementPins([{id:measurementId,revision:3}],inherited),/conflicting/)
 assert.equal(inheritCadLineage('A',{},exact,requestId,3).coordinates,null)
 assert.equal(inheritCadLineage('A',{},exact,requestId,3).bindings.length,0)
 assert.throws(()=>inheritCadLineage('A',{lineage:{...lineage,project_id:'B'}},exact,requestId,3),/invalid/)
 assert.throws(()=>inheritCadLineage('A',{lineage},recipe,requestId,3),/invalid/)
})
