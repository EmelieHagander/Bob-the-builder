import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseProjectWrite, WRITE_TOOLS } from '../supabase/functions/_shared/project-write.ts'
import { isBobAnswerEvidence } from '../src/data/bobEvidence.ts'

const id='20000000-0000-4000-8000-000000000001'
const message='Spara huset och våningen. Bredden är cirka 3 meter.'
const op=(key:string,kind:string,fields:Record<string,unknown>,extra={})=>({key,kind,record_id:null,expected_revision:0,mode:'existing',source_quote:'Spara huset',source_seq:null,fields,...extra})
const args={building_id:null,expected_building_revision:0,new_building_name:'Synthetic house',new_building_notes:'No measured coordinates.',request_quote:'Spara huset',operations:[
  op('level','level',{name:'Ground',position:0}),
  op('measurement','measurement',{subject:'Room width',value:'3',unit:'m',truth:'estimated'}),
  op('room','space',{name:'Room',level_id:'@level',measurements:[{id:'@measurement',revision:1}]}),
]}
const parse=(value:unknown)=>parseProjectWrite('save_building_context',value,'A',message)

test('building intake is a real offered tool with strict project-independent shape',()=>{
  assert(WRITE_TOOLS.some(t=>t.function.name==='save_building_context'))
  const payload=parse(args)!
  assert.equal(payload.kind,'building_context');assert.equal(payload.record_id,null)
  assert.equal(payload.data.project_id,undefined)
  for(const override of [{project_id:'B'},{new_building_name:null},{building_id:id},{operations:[]},{operations:Array(41).fill(args.operations[0])},{request_quote:'fabricated'}])assert.equal(parse({...args,...override}),null)
})

test('local references are dependency-ordered and kind checked; a new source cannot bind a different revision',()=>{
  for(const fields of [{level_id:'@missing'},{level_id:'@measurement'},{measurements:[{id:'@measurement',revision:2}]},
    {measurements:[{id:'@level',revision:1}]},{measurements:[{id:'@measurement',revision:1},{id:'@measurement',revision:1}]},
    {measurements:[{id:'@measurement',revision:1,project_id:'B'}]}]) {
    assert.equal(parse({...args,operations:[...args.operations.slice(0,2),op('room','space',{name:'Room',...fields})]}),null)
  }
  assert.equal(parse({...args,operations:[args.operations[2],...args.operations.slice(0,2)]}),null)
  assert.equal(parse({...args,operations:[...args.operations,op('room','space',{name:'Duplicate key'})]}),null)
  const update=op('measurement','measurement',{value:'3.1'},{record_id:id,expected_revision:4})
  assert(parse({...args,operations:[update,op('room','space',{name:'Room',measurements:[{id:'@measurement',revision:5}]})]}))
  assert.equal(parse({...args,operations:[update,op('room','space',{name:'Room',measurements:[{id:'@measurement',revision:4}]})]}),null)
})

test('unrelated fields are not sent in a patch, and proposals cannot assert accepted measured reality',()=>{
  const value={...args,building_id:id,expected_building_revision:1,new_building_name:null,new_building_notes:null,operations:[op('room','space',{notes:'Only change this note.'},{record_id:id,expected_revision:2})]}
  assert.deepEqual((parse(value)!.data.operations as any[])[0].fields,{notes:'Only change this note.'})
  for(const fields of [{archived:true},{state:'accepted'},{source:'invented'},{measurements:'all'},{notes:4},{name:''},{kind:null}])assert.equal(parse({...args,operations:[op('room','space',fields)]}),null)
  assert.equal(parse({...args,operations:[op('room','space',{name:'Proposed',truth:'measured'},{mode:'proposed'})]}),null)
  assert(parse({...args,operations:[op('room','space',{name:'Proposed',truth:'ai_assessment'},{mode:'proposed'})]}))
  assert.equal(parse({...args,operations:[op('level','level',{name:'Proposed floor'},{mode:'proposed'})]}),null)
})

test('sources must be current user text or an explicit earlier same-thread sequence checked by SQL',()=>{
  for(const extra of [{source_quote:'not in message'},{source_seq:0},{source_seq:-1},{source_seq:1.5},{source_seq:2147483648},{source_quote:''}])assert.equal(parse({...args,operations:[op('room','space',{name:'Room'},extra)]}),null)
  assert(parse({...args,operations:[op('room','space',{name:'Room'},{source_quote:'prior quote',source_seq:3})]}))
})

test('canonical relationship endpoints are immutable after creation; open connection is not a generated wall',()=>{
  const a=op('a','space',{name:'Kitchen zone'}),b=op('b','space',{name:'Dining zone'})
  const relation=op('connection','relationship',{subject_space_id:'@a',object_space_id:'@b',relation:'connects_to'})
  const p=parse({...args,operations:[a,b,relation]})!
  assert.equal((p.data.operations as any[]).length,3)
  assert.equal(parse({...args,operations:[op('self','relationship',{subject_space_id:id,object_space_id:id,relation:'above'})]}),null)
  assert.equal(parse({...args,operations:[op('edit','relationship',{subject_space_id:id},{record_id:id,expected_revision:1})]}),null)
})

test('receipt navigation requires a validated same-project Building UUID',()=>{
  const receipt={projectId:'A',dataset:'building_context',recordId:id,label:'House',operation:'created',savedAt:'2026-09-19T10:00:00Z'}
  const evidence={kind:'ai_assessment',sources:[],partial:false,writes:[receipt]}
  assert(isBobAnswerEvidence(evidence,'A'))
  for(const change of [{projectId:'B'},{recordId:'another-building'},{recordId:'javascript:bad'}])assert(!isBobAnswerEvidence({...evidence,writes:[{...receipt,...change}]},'A'))
})
