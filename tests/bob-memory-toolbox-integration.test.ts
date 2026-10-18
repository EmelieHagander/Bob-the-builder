import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createBobToolSession } from '../supabase/functions/_shared/project-tools/bob-tools.ts'
import { createMemoryRetrieval } from '../supabase/functions/_shared/bob-memory-retrieval.ts'
import { createProjectLookup } from '../supabase/functions/_shared/project-lookup.ts'
import type { WorkingContext } from '../supabase/functions/_shared/bob-working-context.ts'
import type { ToolPolicy } from '../supabase/functions/_shared/project-tools/session.ts'
import { catalogFixture, preContextStrategyCatalogFixture } from './support/ai-catalog-fixture.ts'

const tools = ['read_conversation_message','search_conversation_history']
const specNames = (specs: { function: { name: string } }[]) => specs.map(s=>s.function.name)
function fixture(options: { old?: boolean; noExactReader?: boolean; noContext?: boolean } = {}) {
  const current = catalogFixture(), aiCatalog = options.old ? preContextStrategyCatalogFixture() : current
  // Current DB policy can coexist with an older durable manifest. Neither a
  // policy row nor a catalog description can invent a native handler.
  const policies = structuredClone(current.definition('bob.tools').definition.catalog as ToolPolicy[]).filter(row=>tools.includes(row.name))
  const source = { seq: 7, fingerprint: 'a'.repeat(32) }, text = '90 cm är fortfarande ett förslag; måttet måste kontrolleras.'
  const message = { seq: 7, role: 'user', text, state: 'completed' }
  const scope = { projectId: 'A', threadId: 'private-thread' }
  let access = true
  const calls: { kind: string; args: unknown[] }[] = []
  const embedding = Array.from({length:256},(_,i)=>Number(i===0))
  const retrieval = createMemoryRetrieval({ ...scope, hasAccess: async()=>access,
    store: {
      exact: async(...args)=>{calls.push({kind:'exact',args});return{...scope,status:'ok',message,source,offset:0,totalCharacters:[...text].length,nextOffset:null}},
      indexPending: async()=>({...scope,chunks:[],hasMore:false}), indexSave: async()=>{throw new Error('No backfill needed')},
      searchHybrid: async(...args)=>{calls.push({kind:'hybrid',args});return{...scope,messages:[message],sources:[source],searchMode:'hybrid',semanticCoverage:'on_demand'}},
    },
    embedder: { model: 'pinned-embedding', embed: async texts=>{calls.push({kind:'embed',args:[texts]});return texts.map(()=>embedding)} },
  })
  const context: WorkingContext = { summary: 'The proposed width still needs checking.',throughSeq:7,recent:[],history:{
    remaining:Infinity,search:value=>retrieval.search(value),...(!options.noExactReader?{read:(value:unknown)=>retrieval.read(value)}:{}),
  } }
  const session = createBobToolSession({ aiCatalog, ...(!options.noContext?{context}:{}),
    lookup:createProjectLookup('A',async()=>{throw new Error('Memory must not query project records')}),
    readPolicy:async()=>({phase:'design',tools:policies}), toolInstructions:options.old?'inline':'lazy',
  })
  return { session, calls, aiCatalog, policies, embedding, source, text, revoke:()=>{access=false} }
}

test('the assembled Bob toolbox exposes an exact-memory card, loads its database schema, and dispatches to source retrieval',async()=>{
  const f=fixture()
  assert.deepEqual(specNames(await f.session.prepare()),['describe_tool'])
  const card=f.session.toolbox.find(row=>row.name==='read_conversation_message')
  assert(card,'the actual Bob native registration must exist, not only a catalog definition')
  assert.equal(card.state,'offered'); assert.equal(card.group,'Project records and memory')
  assert.equal(card.description,f.aiCatalog.tool('read_conversation_message',{card:true}).function.description)
  const manual=await f.session.execute('describe_tool',{name:'read_conversation_message'})
  assert.equal(manual.status,'ok'); assert.equal(manual.callable_from_next_step,true)
  assert.deepEqual(manual.parameters,f.aiCatalog.tool('read_conversation_message').function.parameters)
  assert.equal((await f.session.execute('read_conversation_message',{seq:7,offset:null})).status,'not_offered')
  const specs=await f.session.prepare()
  assert(specNames(specs).includes('read_conversation_message'))
  const result=await f.session.execute('read_conversation_message',{seq:7,offset:null})
  assert.equal(result.status,'ok');assert.equal(result.message.text,f.text);assert.deepEqual(result.source,f.source)
  assert.equal(result.truth,'conversation_only');assert.deepEqual(f.calls,[{kind:'exact',args:[7,0]}])
  f.revoke()
  assert.equal((await f.session.execute('read_conversation_message',{seq:7,offset:null})).status,'denied')
  assert.equal(f.calls.length,1,'live retrieval authority is checked after manual loading')
})

test('the assembled history search takes its new catalog schema and dispatches through hybrid retrieval',async()=>{
  const f=fixture();await f.session.prepare()
  const manual=await f.session.execute('describe_tool',{name:'search_conversation_history'})
  assert.equal(manual.status,'ok');assert.deepEqual(manual.parameters,f.aiCatalog.tool('search_conversation_history').function.parameters)
  await f.session.prepare()
  const result=await f.session.execute('search_conversation_history',{query:'bekräftad bredd',before_seq:null})
  assert.equal(result.status,'ok');assert.equal(result.searchMode,'hybrid');assert.deepEqual(result.sources,[f.source])
  assert.deepEqual(f.calls,[{kind:'embed',args:[['bekräftad bredd']]},{kind:'hybrid',args:['bekräftad bredd',null,f.embedding,'pinned-embedding']}])
})

test('an old pinned catalog retains its old search surface despite a newly installed exact-read policy',async()=>{
  const f=fixture({old:true}),specs=await f.session.prepare()
  assert.deepEqual(specNames(specs),['search_conversation_history'])
  assert(!f.session.toolbox.some(row=>row.name==='read_conversation_message'))
  assert.deepEqual(specs[0].function.parameters,f.aiCatalog.tool('search_conversation_history').function.parameters)
  assert.equal((await f.session.execute('read_conversation_message',{seq:7,offset:null})).status,'unavailable')
  assert.equal(f.calls.length,0)
})

test('a catalog entry cannot make an absent exact reader callable',async()=>{
  for(const options of [{noExactReader:true},{noContext:true}]){
    const f=fixture(options);await f.session.prepare()
    const card=f.session.toolbox.find(row=>row.name==='read_conversation_message')
    assert.equal(card,undefined,'no exact-reader capability exists in this request')
    const manual=await f.session.execute('describe_tool',{name:'read_conversation_message'})
    assert.equal(manual.status,'unavailable')
    assert(!specNames(await f.session.prepare()).includes('read_conversation_message'))
    assert.equal((await f.session.execute('read_conversation_message',{seq:7,offset:null})).status,'unavailable')
    assert.equal(f.calls.length,0)
  }
})
