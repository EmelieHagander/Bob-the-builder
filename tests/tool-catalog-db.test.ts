import { before, after, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { createToolSession, checkedToolSnapshot, type ToolDefinition } from '../supabase/functions/_shared/project-tools/session.ts'
import seed from '../supabase/functions/_shared/project-tools/catalog-seed.json' with { type: 'json' }
const pg=new PGlite(), uid='00000000-0000-4000-8000-000000000001'
let ddl=''
async function as(sql:string,params:unknown[]=[],role='authenticated',sub:string|null=uid):Promise<any>{
  return pg.transaction(async tx=>{
    await tx.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub})])
    await tx.exec('set local role '+role)
    return tx.query(sql,params)
  })
}
before(async()=>{
  await pg.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create schema bob;
    create function auth.uid() returns uuid language sql stable as $$ select (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid $$;
    grant usage on schema auth,bob to anon,authenticated,service_role;`)
  // Managed apply supplies the authoritative ledger timestamp. Before apply the
  // identical DDL lives as a proposal; never fabricate a committed migration ID.
  const dir=new URL('../supabase/migrations/',import.meta.url)
  const files=(await readdir(dir)).filter(n=>n.endsWith('_bob_tool_catalog.sql'))
  assert(files.length<=1,'One migration owns this schema')
  ddl=await readFile(files.length?new URL(files[0],dir):new URL('../supabase/proposals/bob_tool_catalog.sql',import.meta.url),'utf8')
  await pg.exec(ddl)
})
after(()=>pg.close())

test('exact SQL installs the complete bootstrap catalog with RLS, no replacement project state or executable payload',async()=>{
  const rows=(await as('select * from bob.tool_catalog order by name')).rows
  assert.equal(rows.length,15)
  assert(rows.every((r:any)=>seed.some(s=>s.name===r.name)), 'Current catalog retains each bootstrap tool identity')
  assert.equal(checkedToolSnapshot({phase:'concept',tools:rows}).tools.length,15)
  assert.equal((await pg.query("select relrowsecurity from pg_class where oid='bob.tool_catalog'::regclass")).rows[0].relrowsecurity,true)
  assert.doesNotMatch(ddl,/disable row level security|security definer|create extension|alter table bob.projects/i)
})

test('anonymous/no-identity callers cannot read catalog; authenticated users cannot change policy or self-grant',async()=>{
  await assert.rejects(as('select * from bob.tool_catalog',[],'anon',null),/permission denied/)
  assert.deepEqual((await as('select * from bob.tool_catalog',[],'authenticated',null)).rows,[])
  for(const sql of ["update bob.tool_catalog set always_load=true","delete from bob.tool_catalog","insert into bob.tool_catalog(name,description,schema_version) values('fake','Fake',1)"]){
    await assert.rejects(as(sql),/permission denied/)
  }
})

test('same SQL policy drives prepare, exact load and execution; an operator revocation reaches an already-loaded tool',async()=>{
  const name='inspect_building_projection';let executions=0
  const def:ToolDefinition={version:1,spec:{type:'function',function:{name,description:'Implemented read',parameters:{type:'object',properties:{},additionalProperties:false}}},
    gate:()=> 'available',execute:async()=>{executions++;return{status:'ok'}}}
  const reader=async()=>checkedToolSnapshot({phase:'concept',tools:(await as('select * from bob.tool_catalog order by name')).rows})
  const session=createToolSession({definitions:[def],readPolicy:reader})
  assert(!(await session.prepare()).some(t=>t.function.name===name))
  assert.equal((await session.execute('load_tool',{name})).status,'loaded')
  assert((await session.prepare()).some(t=>t.function.name===name))
  assert.equal((await session.execute(name,{})).status,'ok');assert.equal(executions,1)
  await as('update bob.tool_catalog set active=false where name=$1',[name],'service_role')
  try{assert.equal((await session.execute(name,{})).status,'unavailable');assert.equal(executions,1)}
  finally{await as('update bob.tool_catalog set active=true where name=$1',[name],'service_role')}
})

test('database rejects malformed phase loadouts and contracts before they reach a model',async()=>{
  for(const sql of ["update bob.tool_catalog set preload_phases=array['admin']","update bob.tool_catalog set preload_phases=array[null]::text[]","update bob.tool_catalog set schema_version=0","update bob.tool_catalog set description=''","update bob.tool_catalog set name='../escape'"]){
    await assert.rejects(as(sql,[],'service_role'),/check constraint/)
  }
})
