import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createRevisionMemory,fillServerRevisions,stripServerRevisions} from '../supabase/functions/_shared/server-revisions.ts'

// Test turn 2026-11-08: a parameter_graph_v1 calculation got article_revision,
// plan_revision and revision set to null and was refused as a schema mismatch.
test('calculate_project fills only the revisions of the calculation method sent', async () => {
 const memory=createRevisionMemory()
 const graph={calculation:{method:'parameter_graph_v1',nodes:[],outputs:['h']}}
 const filled=await fillServerRevisions('calculate_project',stripServerRevisions('calculate_project',graph),memory,{})
 assert.deepEqual(filled,{args:graph})
 const id='11111111-1111-4111-8111-111111111111'
 const construction=await fillServerRevisions('calculate_project',{calculation:{method:'construction_parameters_v1',record_id:id}},memory,{construction:async()=>7})
 assert.deepEqual(construction,{args:{calculation:{method:'construction_parameters_v1',record_id:id,revision:7}}})
 memory.observe('read_material_requirement',{id,revision:3})
 const need=await fillServerRevisions('calculate_project',{calculation:{method:'material_purchase_v1',requirement_id:id}},memory,{})
 assert.deepEqual(need,{args:{calculation:{method:'material_purchase_v1',requirement_id:id,revision:3}}})
})
