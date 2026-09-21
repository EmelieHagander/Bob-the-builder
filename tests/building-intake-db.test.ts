import { domainToolLoadout } from './support/tool-loadout.ts'
import { setupSharedSocial } from './support/shared-social.ts'
import { before, after, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { parseProjectWrite, createProjectWriter } from '../supabase/functions/_shared/project-write.ts'
import { createProjectLookup } from '../supabase/functions/_shared/project-lookup.ts'
import { runClaimedProjectTurn } from '../supabase/functions/_shared/project-turn.ts'

const pg = new PGlite()
const one = '00000000-0000-4000-8000-000000000001'
const two = '00000000-0000-4000-8000-000000000002'
const both = '00000000-0000-4000-8000-000000000003'
const guest = '00000000-0000-4000-8000-000000000004'
const id = (n: number) => '70000000-0000-4000-8000-' + String(n).padStart(12, '0')
async function as(uid: string | null, sql: string, params: unknown[] = [], role = 'authenticated'): Promise<any> {
  return pg.transaction(async tx => {
    await tx.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: uid })])
    await tx.exec('set local role ' + role)
    return tx.query(sql, params)
  })
}
const json = (v: unknown) => JSON.stringify(v)
before(async () => {
  await pg.exec(`
    create role anon; create role authenticated; create role service_role bypassrls; create role authenticator;
    create schema auth; create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
    create function auth.uid() returns uuid language sql stable as $$ select (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid $$;
    create function auth.email() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'email' $$;
    grant usage on schema auth to anon,authenticated;
    create schema storage;
    create table storage.buckets(id text primary key,name text,public boolean default false,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text,metadata jsonb,unique(bucket_id,name));
    alter table storage.buckets enable row level security; alter table storage.objects enable row level security;
    grant usage on schema storage to anon,authenticated; grant all on storage.objects,storage.buckets to anon,authenticated;
  `)
  for (const [i, uid] of [one,two,both,guest].entries()) await pg.query('insert into auth.users values($1,$2,now())', [uid,uid===guest?'guest@bob.local':`write${i}@example.test`])
  const legacy = new URL('../db/migrations/', import.meta.url)
  for (const f of (await readdir(legacy)).filter(f => f.endsWith('.sql')).sort()) await pg.exec(await readFile(new URL(f, legacy), 'utf8'))
  await pg.exec("insert into bob.projects(id,slug,name) values('A','a','Porch A'),('B','b','Private B')")
  await pg.query("insert into bob.people(id,project_id,name,initials,auth_user_id) values('oneA','A','One','OA',$1),('twoB','B','Two','TB',$2)", [one,two])
  await setupSharedSocial(pg)
  const dir = new URL('../supabase/migrations/', import.meta.url)
  for (const f of (await readdir(dir)).filter(f => f.endsWith('.sql')).sort()) await pg.exec(await readFile(new URL(f, dir), 'utf8'))
  await pg.query("insert into bob.people(id,project_id,name,initials,auth_user_id) values('bothA','A','Both','BA',$1),('bothB','B','Both','BB',$1),('guestA','A','Guest','G',$2)", [both,guest])
  await pg.exec("insert into bob.areas(id,project_id,slug,name) values('areaA','A','entry','Entry'),('areaB','B','private','Private'); insert into bob.tasks(id,area_id,name,hours) values('taskA','areaA','Original','2h'),('taskB','areaB','Private work','')")
})
after(() => pg.close())

// Synthetic description: deliberately not a user's address or real house survey.
const story='Spara Testhuset: en stuga på 8 × 6 meter med entré i norr. Två våningar. Kök och matplats är öppna zoner med bara en bänk mellan. Köket i sydost och matplatsen i nordost. Sovrum över matplatsen, kontor över köket. Sovrummet är cirka 3,2 meter brett. Flytta senare trappan, det är bara ett förslag.'
const op=(key:string,kind:string,fields:Record<string,unknown>,quote:string,extra={})=>({key,kind,record_id:null,expected_revision:0,mode:'existing',source_quote:quote,source_seq:null,fields,...extra})
const initial={building_id:null,expected_building_revision:0,new_building_name:'Testhuset',new_building_notes:'User-described 8 × 6 m, entrance north. Interior coordinates and wall thickness unknown.',request_quote:'Spara Testhuset',operations:[
  op('ground','level',{name:'Bottenvåning',position:0},'Två våningar'),
  op('upper','level',{name:'Övervåning',position:1},'Två våningar'),
  op('width','measurement',{subject:'Sovrum invändig bredd',value:'3.2',unit:'m',truth:'estimated',notes:'Approximately; not a verified outline.'},'Sovrummet är cirka 3,2 meter brett'),
  op('kitchen','space',{name:'Kök',kind:'kitchen_zone',level_id:'@ground',notes:'Southeast; open toward dining. No partition inferred.'},'Kök och matplats är öppna zoner med bara en bänk mellan'),
  op('dining','space',{name:'Matplats',kind:'dining_zone',level_id:'@ground',notes:'Northeast; open connection.'},'Köket i sydost och matplatsen i nordost'),
  op('bedroom','space',{name:'Sovrum',kind:'bedroom',level_id:'@upper',notes:'Above dining; exact footprint unknown.',measurements:[{id:'@width',revision:1}]},'Sovrum över matplatsen'),
  op('office','space',{name:'Kontor',kind:'office',level_id:'@upper'},'kontor över köket'),
  op('bench','element',{name:'Avdelande bänk',kind:'bench',space_id:'@dining',description:'Divider, not a wall.'},'bara en bänk mellan'),
  op('open','relationship',{subject_space_id:'@kitchen',object_space_id:'@dining',relation:'connects_to',notes:'Open passage; not an inferred door.'},'Kök och matplats är öppna zoner'),
  op('above_dining','relationship',{subject_space_id:'@bedroom',object_space_id:'@dining',relation:'above'},'Sovrum över matplatsen'),
  op('above_kitchen','relationship',{subject_space_id:'@office',object_space_id:'@kitchen',relation:'above'},'kontor över köket'),
]}
let turn=900
async function claim(message=story,uid=one,project='A'){
  const tid=id(turn++)
  const c=(await as(null,'select bob.bob_claim_turn($1,$2,$3,$4) result',[project,uid,tid,message],'service_role')).rows[0].result
  assert.equal(c.status,'claimed');return{binding:[project,c.thread_id,tid,c.generation],uid,message}
}
async function finish(c:Awaited<ReturnType<typeof claim>>){await as(null,'select bob.bob_fail_turn_v2($1,$2,$3,$4,$5)',[c.binding[0],c.uid,...c.binding.slice(1)],'service_role')}
async function save(c:Awaited<ReturnType<typeof claim>>,args:any=initial){
  const payload=parseProjectWrite('save_building_context',args,String(c.binding[0]),c.message)
  assert(payload,'valid tool arguments expected')
  return (await as(c.uid,'select bob.bob_project_write_v4($1,$2,$3,$4,$5) result',[...c.binding,json(payload)])).rows[0].result
}
const query=async(dataset:string,record:string|null=null,uid=one,project='A',after:string|null=null)=>(await as(uid,'select bob.search_bob_project_data_v5($1,$2,null,null,null,$3,$4) result',[project,dataset,record,after])).rows[0].result
let building:string,ids:Record<string,string>={}
const amend=(operations:any[],extra={})=>({...initial,building_id:building,expected_building_revision:1,new_building_name:null,new_building_notes:null,operations,...extra})

test('one chat request creates linked canonical levels/zones/relations and keeps an estimate distinct from geometry',async t=>{
  const c=await claim();t.after(()=>finish(c));const r=await save(c)
  building=r.recordId;ids=Object.fromEntries(r.record.changes.map((x:any)=>[x.key,x.id]))
  assert.equal(r.dataset,'building_context');assert.equal(r.operation,'created');assert.equal(r.record.geometry_ready,false)
  assert.equal((await query('physical_buildings',building)).records[0].name,'Testhuset')
  assert.equal((await query('physical_levels')).records.length,2)
  const spaces=(await query('physical_spaces')).records
  assert.equal(spaces.length,4);assert.equal(spaces.find((s:any)=>s.id===ids.kitchen).level_id,ids.ground)
  assert.equal(spaces.find((s:any)=>s.id===ids.kitchen).kind,'kitchen_zone')
  assert.equal((await query('physical_elements')).records[0].kind,'bench','no wall inferred from a divider')
  const relations=(await query('physical_relationships')).records
  assert(relations.some((x:any)=>x.subject_space_id===ids.kitchen&&x.object_space_id===ids.dining&&x.relation==='connects_to'))
  assert(relations.some((x:any)=>x.subject_space_id===ids.bedroom&&x.object_space_id===ids.dining&&x.relation==='above'))
  assert(!relations.some((x:any)=>x.relation==='shares_boundary_with'),'above and an open passage do not imply a shared wall')
  const measurements=(await query('physical_space_measurements')).records
  assert.equal(measurements[0].truth,'estimated');assert.equal(Number(measurements[0].value),3.2);assert.equal(measurements[0].unit,'m')
  assert.match(measurements[0].source,/cirka/)
  assert.deepEqual(await save(c),r,'same claimed-turn retry returns original IDs, not duplicate rooms')
})

test('patch updates preserve room identity, parent, kind, old revisions and exact measurement snapshots',async t=>{
  const c=await claim('Spara rättelsen: sovrummet har ett snedtak.');t.after(()=>finish(c))
  await save(c,amend([op('fix','space',{notes:'Sloped ceiling; clearance unknown.'},'sovrummet har ett snedtak',{record_id:ids.bedroom,expected_revision:1})],{request_quote:'Spara rättelsen'}))
  const room=(await query('physical_spaces',ids.bedroom)).records[0]
  assert.equal(room.revision,2);assert.equal(room.name,'Sovrum');assert.equal(room.level_id,ids.upper);assert.equal(room.kind,'bedroom')
  const snaps=(await query('physical_space_measurements')).records
  assert.equal(snaps[0].measurement_id,ids.width);assert.equal(snaps[0].measurement_revision,1);assert.equal(snaps[0].space_revision,2)
  assert.match((await as(one,'select notes from bob.space_revisions where space_id=$1 and revision=1',[ids.bedroom])).rows[0].notes,/Above dining/)
})

test('remodel ideas remain proposals and cannot be silently accepted by a subsequent factual patch',async t=>{
  const c=await claim('Föreslå att kontoret flyttar, men ändra inte nuläget.');t.after(()=>finish(c))
  await save(c,amend([op('proposal','space',{notes:'Proposed move, not built.',truth:'ai_assessment'},'kontoret flyttar',{record_id:ids.office,expected_revision:1,mode:'proposed'})],{request_quote:'Föreslå'}))
  const accepted=(await query('physical_spaces',ids.office)).records[0],proposed=(await query('physical_proposals',ids.office)).records[0]
  assert.equal(accepted.revision,1);assert.equal(accepted.has_proposal,true);assert.equal(proposed.revision,2);assert.equal(proposed.truth,'ai_assessment')

})

test('stale revisions, attempted proposal acceptance and later invalid operations roll back the entire batch',async t=>{
  const c=await claim('Spara rättelsen.');t.after(()=>finish(c))
  await assert.rejects(save(c,amend([op('fix','space',{notes:'Bad stale update'},'Spara rättelsen',{record_id:ids.bedroom,expected_revision:1})],{request_quote:'Spara rättelsen'})),/changed/)
  await assert.rejects(save(c,amend([op('fix','space',{notes:'Attempt implicit acceptance'},'Spara rättelsen',{record_id:ids.office,expected_revision:2})],{request_quote:'Spara rättelsen'})),/pending proposal/)
  await assert.rejects(save(c,amend([
    op('temp','space',{name:'Must roll back',level_id:ids.ground},'Spara rättelsen'),
    op('bad','element',{name:'Broken parent',kind:'wall',space_id:id(999999)},'Spara rättelsen'),
  ],{request_quote:'Spara rättelsen'})),/Parent space unavailable/)
  assert(!(await query('physical_spaces')).records.some((s:any)=>s.name==='Must roll back'))
  assert.equal((await as(one,'select bob.bob_read_write_receipts($1,$2,$3,$4) result',c.binding)).rows[0].result.length,0)
})

test('current consent can cite a real older user message, never an assistant answer or unrelated conversation',async t=>{
  const c=await claim('Spara uppgiften från min tidigare beskrivning.');t.after(()=>finish(c))
  const seq=(await pg.query("select min(seq)::int seq from bob.bob_messages where thread_id=$1 and text=$2",[c.binding[1],story])).rows[0].seq
  await save(c,amend([op('bench_fix','element',{description:'Retain the open-zone divider.'},'bara en bänk mellan',{record_id:ids.bench,expected_revision:1,source_seq:seq})],{request_quote:'Spara uppgiften'}))
  assert.equal((await query('physical_elements',ids.bench)).records[0].revision,2)

})

test('source forgery and hidden/foreign references are rejected at SQL boundary, not just by the prompt',async t=>{
  const c=await claim('Spara ändringen.');t.after(()=>finish(c))
  const values=amend([op('bad','space',{name:'Fake source'},'An assistant invented this',{source_seq:1})],{request_quote:'Spara ändringen'})
  await assert.rejects(save(c,values),/source_quote_required/)
  const parsed=parseProjectWrite('save_building_context',amend([op('bad','space',{name:'Unsafe'},'Spara ändringen')],{request_quote:'Spara ändringen'}),'A',c.message)!
  for(const change of [{archived:true},{project_id:'B'},{recorded_by:two},{state:'accepted'},{svg:'<script/>'}]){
    const payload=structuredClone(parsed);(payload.data.operations as any[])[0].fields={name:'Unsafe',...change}
    await assert.rejects(as(one,'select bob.bob_project_write_v4($1,$2,$3,$4,$5)',[...c.binding,json(payload)]),/invalid_intake_operation/)
  }
})

test('physical authority is separate from project membership; another project cannot read or edit this building',async t=>{
  const c=await claim('Spara rum.',both);t.after(()=>finish(c))
  await assert.rejects(save(c,amend([op('bad','space',{name:'No direct authority'},'Spara rum')],{request_quote:'Spara rum'})),/building_edit_denied/)
  assert.equal((await query('physical_spaces',null,both,'B')).records.length,0)
  assert.equal((await query('physical_buildings',null,both,'B')).records.length,0)
  await assert.rejects(as(null,'select bob.search_bob_project_data_v5(\'A\',\'physical_spaces\')',[],'anon'),/permission denied/)
  // Project members may submit a labelled proposal through the canonical boundary.
  await save(c,amend([op('idea','space',{name:'Possible alcove',level_id:ids.upper,truth:'ai_assessment'},'Spara rum',{mode:'proposed'})],{request_quote:'Spara rum'}))
  assert(!(await query('physical_spaces')).records.some((r:any)=>r.name==='Possible alcove'))
  assert((await query('physical_proposals')).records.some((r:any)=>r.name==='Possible alcove'))
})

test('the actual Bob orchestration can research and save the canonical building using a deterministic provider fixture',async()=>{
  const message='Spara en testbod med ett förråd.'
  const c=await claim(message)
  const args={...initial,new_building_name:'Testbod',new_building_notes:'Synthetic test fixture.',request_quote:'Spara en testbod',operations:[op('store','space',{name:'Förråd',kind:'storage'},'ett förråd')]}
  const transport=(payload:any)=>as(one,'select bob.bob_project_write_v4($1,$2,$3,$4,$5) result',[...c.binding,json(payload)]).then((r:any)=>({data:r.rows[0].result,error:null}))
  const read=(rpc:string)=>async()=>{const r=await as(one,`select bob.${rpc}($1,$2,$3,$4) result`,c.binding);return{data:r.rows[0].result,error:null}}
  const writer=createProjectWriter('A',message,transport,read('bob_read_write_receipts'),read('bob_settle_project_writes'))
  const lookup=createProjectLookup('A',async(project,input)=>({data:(await as(one,'select bob.search_bob_project_data_v5($1,$2,$3,$4,$5,$6,$7) result',[project,input.dataset,input.query,input.status,input.area_id,input.record_id,input.after_id??null])).rows[0].result,error:null}),10000,12)
  let calls=0
  const usage={input_tokens:1,output_tokens:1,total_tokens:2}
  const result=await runClaimedProjectTurn({readToolPolicy:domainToolLoadout('save_building_context'),projectId:'A',userId:one,message,generation:Number(c.binding[3]),writer,lookup,hasAccess:async()=>true,fail:async()=>{},
    callModel:async options=>{
      calls++;assert(options.tools?.some(t=>t.function.name==='save_building_context'))
      if(calls===1)return{success:true,data:null,model:'fixture',responseId:'intake-read',usage,toolCalls:[{id:'read',type:'function',function:{name:'search_project_data',arguments:json({dataset:'physical_buildings',query:null,status:null,area_id:null,record_id:null,after_id:null})}}]}
      if(calls===2)return{success:true,data:null,model:'fixture',responseId:'intake-write',usage,toolCalls:[{id:'save',type:'function',function:{name:'save_building_context',arguments:json(args)}}]}
      const output=JSON.parse(String(options.messages![0].content));assert.equal(output.status,'saved');assert.equal(output.receipt.record.geometry_ready,false)
      return{success:true,data:'Byggnaden och förrådet är sparade. Geometrin är ännu okänd.',model:'fixture',responseId:'intake-done',usage}
    },commit:async(_r,generation)=>{c.binding[3]=generation;await finish(c)},
  })
  assert.equal(result.ok,true);assert.equal(calls,3)
  if(result.ok)assert.equal(result.evidence.writes![0].dataset,'building_context')
  assert((await query('physical_buildings')).records.some((r:any)=>r.name==='Testbod'))
})

test('accepted snapshot sources survive an unrelated patch even after donor-project access is removed',async t=>{
  const ref=id(340),room=id(341)
  await as(two,"select bob.evidence_command('B','measurement','create',$1,0,$2)",[ref,json({subject:'Donor width',value:'2500',unit:'mm',truth:'provided_spec',source:'Earlier user specification',notes:'',required:false})])
  await pg.query('insert into bob.building_members(building_id,auth_user_id,member_label) values($1,$2,$3)',[building,both,'Fixture editor'])
  await as(both,"select bob.physical_node_command($1,'space','create',$2,0,$3)",[building,room,json({name:'Imported measurement room',truth:'provided_spec',source:'Imported evidence',measurements:[{id:ref,revision:1}]})])
  const c=await claim('Spara anteckningen om förrådet.');t.after(()=>finish(c))
  await save(c,amend([op('room','space',{notes:'Preserve evidence without reaching into donor project.'},'Spara anteckningen',{record_id:room,expected_revision:1})],{request_quote:'Spara anteckningen'}))
  const snapshots=(await as(one,'select * from bob.space_measurement_details where space_id=$1 and space_revision=2',[room])).rows
  assert.equal(snapshots.length,1);assert.equal(snapshots[0].measurement_id,ref);assert.equal(Number(snapshots[0].value),2500)
  await pg.query('delete from bob.building_members where building_id=$1 and auth_user_id=$2',[building,both])
})

test('full-building scope is required even when the caller can directly edit the Building from another project',async t=>{
  await pg.query("insert into bob.people(id,project_id,name,initials,auth_user_id) values('oneB','B','One B','OB',$1)",[one])
  await as(one,"select bob.physical_scope_command('B','project','link',$1,$2)",[id(351),json({target_kind:'space',building_id:building,space_id:ids.bedroom})])
  const c=await claim('Spara rummet.',one,'B');t.after(()=>finish(c))
  await assert.rejects(save(c,amend([op('new','space',{name:'Must not broaden scope'},'Spara rummet')],{request_quote:'Spara rummet'})),/building_scope_denied/)
})

test('research is paged without losing the rest of a larger building; settlement rejects delayed intake writes',async t=>{
  const c=await claim('Spara testutrymmena.');t.after(()=>finish(c))
  const r=await save(c,amend(Array.from({length:28},(_,i)=>op('space_'+i,'space',{name:`Synthetic zone ${i}`,level_id:ids.ground},'Spara testutrymmena')),{request_quote:'Spara testutrymmena'}))
  assert.equal(r.record.changes.length,28)
  let cursor=null as string|null;const seen=new Set<string>()
  for(let page=0;page<4;page++){
    const p=await query('physical_spaces',null,one,'A',cursor)
    assert(p.records.length<=25);for(const row of p.records){assert(!seen.has(row.id));seen.add(row.id)}
    if(!p.truncated){assert.equal(p.next_cursor,null);break}
    assert(p.next_cursor);cursor=p.next_cursor
  }
  assert(r.record.changes.every((x:any)=>seen.has(x.id)))
  const settled=(await as(one,'select bob.bob_settle_project_writes($1,$2,$3,$4) result',c.binding)).rows[0].result
  await assert.rejects(save(c,amend([op('late','space',{name:'Late write'},'Spara testutrymmena')],{request_quote:'Spara testutrymmena'})),/turn_not_claimed/)
  c.binding[3]=settled.generation
})

test('new facts about an existing Building append without erasing earlier context or silently changing its identity',async t=>{
  const c=await claim('Spara att taket är av plåt.');t.after(()=>finish(c))
  const before=(await query('physical_buildings',building)).records[0]
  const r=await save(c,amend([op('house','building',{notes_append:'Roof material: sheet metal (user description).'},'taket är av plåt',{record_id:building,expected_revision:1})],{request_quote:'Spara'}))
  assert.equal(r.recordId,building);assert.equal(r.record.building_revision,2)
  const after=(await query('physical_buildings',building)).records[0]
  assert.equal(after.name,before.name);assert(after.notes.startsWith(before.notes));assert.match(after.notes,/Roof material/)
  assert.equal((await as(one,'select notes from bob.building_revisions where building_id=$1 and revision=1',[building])).rows[0].notes,before.notes)
})
