import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {PGlite} from '@electric-sql/pglite'
import {stageContextPublication as spec} from '../scripts/build-bob-stage-context-catalog.ts'
import {STAGE_CONTEXT_SPEC} from '../supabase/functions/_shared/bob-stage-context.ts'
import {applyCatalogModelOptions} from '../supabase/functions/_shared/ai-catalog.ts'
import {createBobContextContinuation} from '../supabase/functions/_shared/bob-context-continuation.ts'
import type {OpenAIServiceOptions,OpenAIServiceResponse} from '../supabase/functions/_shared/openai-service.ts'
import {catalogFixture} from './support/ai-catalog-fixture.ts'

test('stage catalog publication is atomic, idempotent and leaves old versions and provider configuration intact',async()=>{
 const pg=new PGlite()
 try{
  await pg.exec(`create schema shared;
   create table shared.ai_prompts(id uuid primary key default gen_random_uuid(),app text,prompt_key text,label text,description text,content text,flow text,definition_kind text,retired_at timestamptz,active_version_id uuid,unique(app,prompt_key));
   create table shared.ai_prompt_versions(id uuid primary key default gen_random_uuid(),prompt_id uuid,version integer,definition_kind text,definition_format_version integer,metadata jsonb,content text,definition jsonb,flow text,available_variables jsonb);
   create table shared.publications(value jsonb);
   create function shared.activate_ai_catalog(text,jsonb) returns void language plpgsql as $$ begin
    update shared.ai_prompts p set active_version_id=(q.value#>>'{}')::uuid from jsonb_each($2) q where p.app=$1 and p.prompt_key=q.key;
    insert into shared.publications values($2); end $$;`)
  for(const [key,metadata] of [['agent-contract.ask-bob',{complete_request_version:1,result_reference_version:1,context_strategy_version:1}],['tools.open_project_item',{}],['tools.get_work_history',{}]] as const){
   const p=(await pg.query<any>(`insert into shared.ai_prompts(app,prompt_key,label,description,content,flow,definition_kind) values('bob',$1,$1,'','','','tool_contract') returning id`,[key])).rows[0].id
   const v=(await pg.query<any>(`insert into shared.ai_prompt_versions(prompt_id,version,definition_kind,definition_format_version,metadata,content,definition,flow,available_variables)
    values($1,1,'tool_contract',1,$2,'unchanged original content','{"parameters":{"original":true}}'::jsonb,'','[]') returning id`,[p,JSON.stringify(metadata)])).rows[0].id
   await pg.query('update shared.ai_prompts set active_version_id=$1 where id=$2',[v,p])
  }
  const old=(await pg.query('select id,metadata,content,definition from shared.ai_prompt_versions order by id')).rows
  const sql=readFileSync('supabase/migrations/20261105214237_bob_stage_context_catalog.sql','utf8')
  await pg.exec(sql)
  const rows=(await pg.query<any>('select p.prompt_key,v.* from shared.ai_prompts p join shared.ai_prompt_versions v on v.id=p.active_version_id')).rows
  assert.equal(rows.length,4)
  assert.deepEqual(rows.find(r=>r.prompt_key===spec.tool.key).definition,spec.tool.definition)
  assert.equal(rows.find(r=>r.prompt_key===spec.contract.key).metadata.stage_context_version,1)
  for(const row of rows.filter(r=>r.prompt_key!==spec.tool.key))assert.deepEqual(row.definition.parameters,{original:true},'old argument schemas stay exact')
  assert.deepEqual((await pg.query('select id,metadata,content,definition from shared.ai_prompt_versions where version=1 and prompt_id<>(select id from shared.ai_prompts where prompt_key=$1) order by id',[spec.tool.key])).rows,old)
  await pg.exec(sql)
  assert.equal((await pg.query<any>('select count(*)::integer n from shared.publications')).rows[0].n,1)
 }finally{await pg.close()}
})

test('the actual published fixture resolves the stage tool and main-chat preview capability',()=>{
 const catalog=catalogFixture()
 assert.deepEqual(catalog.tool('advance_work_stage').function,{...STAGE_CONTEXT_SPEC.function,strict:false})
 assert.equal(catalog.definition('agent-contract.ask-bob').metadata.stage_context_version,1)
 assert.match(catalog.tool('open_project_item',{include_manual:true}).function.description,/app renders them/)
 assert.match(catalog.tool('get_work_history',{include_manual:true}).function.description,/archive remains available/)
})

test('lazy main requests reach dispatch and survive a stage handoff through real catalog resolution',async()=>{
 const catalog=catalogFixture()
 const seed:OpenAIServiceOptions={app:'bob',functionName:'ask-bob',catalogRoleKey:'ask-bob',coworkerId:'bob',module:'global',
  responseItemsMode:'preserve',catalogSchemaParameters:{card:true,include_manual:false,server_quote:true,categories:[]},
  messages:[{role:'user',content:'Compare the proposal. Measurements remain preliminary.'}]}
 const broken=catalogFixture(snapshot=>{
  const row=snapshot.definitions.find(row=>row.prompt_key==='tools.advance_work_stage')!
  delete row.definition.card_description
 })
 const make=(aiCatalog:typeof catalog,callModel:(o:OpenAIServiceOptions)=>Promise<OpenAIServiceResponse>)=>
  createBobContextContinuation({version:1,mainResultReferences:1,imageInputDedupVersion:1,stageContextVersion:1,
   aiCatalog,imageSource:()=>undefined,callModel})
 await assert.rejects(make(broken,async()=>{throw Error('unexpected_dispatch')}).call(seed),
  /ai_contract_missing: tools.advance_work_stage card/)
 let dispatched=0
 const manager=make(catalog,async request=>{
  const resolved=applyCatalogModelOptions(catalog,request)
  const stage=resolved.tools!.find(tool=>tool.function.name==='advance_work_stage')!
  assert.equal(stage.function.description,catalog.definition('tools.advance_work_stage').definition.card_description)
  assert.deepEqual(stage.function.parameters,STAGE_CONTEXT_SPEC.function.parameters)
  dispatched++
  if(dispatched===1){
   const args=JSON.stringify({completed_question:'Comparison complete',findings:[],unresolved:['Measurements remain preliminary'],
    next_step:'Explain the result',keep_image_refs:[]})
   return {success:true,data:'',model:'fixture',responseId:'stage-card-1',
    usage:{input_tokens:100,output_tokens:10,total_tokens:110},
    toolCalls:[{id:'stage-card-handoff',type:'function',function:{name:'advance_work_stage',arguments:args}}],
    outputItems:[{type:'function_call',call_id:'stage-card-handoff',name:'advance_work_stage',arguments:args}]}
  }
  assert(JSON.stringify(request.messages).includes('Measurements remain preliminary'))
  return {success:true,data:'Comparison ready.',model:'fixture',responseId:'stage-card-2',
   usage:{input_tokens:90,output_tokens:10,total_tokens:100},
   outputItems:[{type:'message',role:'assistant',content:[{type:'output_text',text:'Comparison ready.'}]}]}
 })
 await manager.call(seed)
 assert.equal(dispatched,2)
})
