import {test} from 'node:test'
import assert from 'node:assert/strict'
import {schemaIssues,safeSchemaPaths} from '../supabase/functions/_shared/schema-issues.ts'
import {catalogFixture} from './support/ai-catalog-fixture.ts'
test('diagnostic paths name declared fields only and never unexpected output keys or values',()=>{
 const schema={type:'object',additionalProperties:false,properties:{tools:{type:'array',maxItems:4,items:{type:'string'}}},required:['tools']}
 const issues=schemaIssues(schema,{tools:[1],secret_customer_text:'sensitive'})
 const paths=safeSchemaPaths(schema,issues);assert(paths.includes('$.tools[0]'));assert(!JSON.stringify(paths).includes('secret'))
})
test('published picker no longer requires or offers the unused reason, and coherent editor is pinned in the new manifest',()=>{
 const c=catalogFixture(),schema=c.schema('bob_tool_pick').schema
 assert.deepEqual(schema.required,['tools']);assert(!('reason' in schema.properties));assert.equal(c.definition('bob.tools','tool_contract').definition.solution_work_version,1)
 const read=c.tool('read_project_edit_context');assert(read.function.parameters.properties.resource.enum.includes('section'))
 const write=c.tool('edit_project_record');assert(write.function.parameters.properties.changes.items.anyOf.some((b:any)=>b.properties.op.enum.includes('add_choice_for_components')))
})
