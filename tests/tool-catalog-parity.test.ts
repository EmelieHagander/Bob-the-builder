import {test} from 'node:test'
import assert from 'node:assert/strict'
import {projectSchema} from './support/project-schema.ts'
import seed from '../supabase/functions/_shared/project-tools/catalog-seed.json' with {type:'json'}
test('complete migrated catalog equals the offline runtime policy, including inactive rows and phase preloads',async()=>{
 const pg=await projectSchema()
 try{const {rows}=await pg.query('select name,description,how_to,schema_version,always_load,preload_phases,active from bob.tool_catalog order by name');assert.deepEqual(rows,[...seed].sort((a,b)=>a.name.localeCompare(b.name)))}finally{await pg.close()}
})
