import { before, after, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { setupSharedSocial } from './support/shared-social.ts'

const pg = new PGlite()
const schema = new URL('../supabase/migrations/20261009144206_ai_definition_catalog.sql', import.meta.url)
const capabilities = { provider_adapter: 'openai-responses-v1', reasoning_efforts: ['low','medium','high'], supports_functions: true, supports_json_schema: true }
async function as<T = any>(role: string, sql: string, parameters: any[] = []): Promise<T> {
  return pg.transaction(async tx => {
    await tx.exec('set local role ' + role)
    return (await tx.query(sql, parameters)).rows[0] as T
  })
}
async function version(key: string, kind: string, definition: any = {}, content = '', app = 'catalog-test', metadata = {}) {
  const { id: promptId } = (await pg.query<any>(`insert into shared.ai_prompts(app,prompt_key,label,definition_kind)
    values($1,$2,$2,$3) on conflict(app,prompt_key) do update set updated_at=clock_timestamp() returning id`,[app,key,kind])).rows[0]
  const { id } = (await pg.query<any>(`insert into shared.ai_prompt_versions(prompt_id,version,definition_kind,definition,content,metadata)
    select $1,coalesce(max(version),0)+1,$2,$3,$4,$5 from shared.ai_prompt_versions where prompt_id=$1 returning id`,
    [promptId,kind,definition,content,metadata])).rows[0]
  return id as string
}
async function activate(versions: Record<string,string>, app = 'catalog-test') {
  await as('service_role','select shared.activate_ai_catalog($1,$2)',[app,versions])
}
async function resolve(app = 'catalog-test', manifest: string | null = null) {
  return (await as('service_role','select shared.resolve_ai_catalog($1,$2) result',[app,manifest])).result
}
let original: any
before(async () => {
  await pg.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key);`)
  await setupSharedSocial(pg)
  await pg.exec(await readFile(schema,'utf8'))
  await pg.query('update shared.ai_models set capabilities=$1',[capabilities])
  const versions = {
    'tier.mini': await version('tier.mini','tier_binding',{tier:'mini',model_name:'gpt-5.4-mini'}),
    'profile.worker': await version('profile.worker','execution_profile',{
      tier:'mini',reasoning_effort:'low',max_output_tokens:3000,
      requirements:{images:true,functions:true,json_schema:true},
    }),
    'worker.persona': await version('worker.persona','prompt',{},'Du är testkollegan.'),
    'worker.contract': await version('worker.contract','agent_contract',{input:{},output:{}}),
    'worker.route': await version('worker.route','routing_policy',{default_profile_key:'profile.worker'}),
    'worker.role': await version('worker.role','role',{
      prompt_keys:['worker.persona'],profile_key:'profile.worker',contract_key:'worker.contract',routing_key:'worker.route',
    },'','catalog-test',{name:'Kollegan',title:'Testare',purpose:'Pröva katalogen.'}),
  }
  await activate(versions)
  original = await resolve()
})
after(() => pg.close())

test('service-only catalog resolution captures typed definitions, models and stable hashes', async () => {
  assert.equal(original.format_version,1)
  assert.equal(original.app,'catalog-test')
  assert.equal(original.models[0].model_name,'gpt-5.4-mini')
  assert.equal(original.definitions.length,6)
  assert.match(original.payload_hash,/^[a-f0-9]{64}$/)
  for (const def of original.definitions) assert.match(def.payload_hash,/^[a-f0-9]{64}$/)
  assert.equal((await resolve()).manifest_id,original.manifest_id,'same exact definitions reuse the persisted manifest')
  for (const role of ['anon','authenticated']) {
    await assert.rejects(as(role,'select shared.resolve_ai_catalog($1,null)',['catalog-test']),/permission denied/)
    await assert.rejects(as(role,'select * from shared.ai_prompt_versions'),/permission denied/)
    await assert.rejects(as(role,'select * from shared.ai_catalog_manifests'),/permission denied/)
    await assert.rejects(as(role,'select shared.activate_ai_catalog($1,$2)',['catalog-test',{}]),/permission denied/)
  }
})

test('versions and recorded manifests remain immutable even for their owner', async () => {
  const id = original.definitions[0].id
  await assert.rejects(pg.query('update shared.ai_prompt_versions set content=$1 where id=$2',['changed',id]),/ai_catalog_version_immutable/)
  await assert.rejects(pg.query('delete from shared.ai_prompt_versions where id=$1',[id]),/ai_catalog_version_immutable/)
  await assert.rejects(pg.query('update shared.ai_catalog_manifests set payload=$1 where id=$2',[{},original.manifest_id]),/ai_catalog_manifest_immutable/)
  await assert.rejects(pg.query('delete from shared.ai_catalog_manifests where id=$1',[original.manifest_id]),/ai_catalog_manifest_immutable/)
  const persona = original.definitions.find((d:any) => d.prompt_key==='worker.persona')
  await assert.rejects(pg.query('update shared.ai_prompts set content=$1 where id=$2',['changed',persona.prompt_id]),/ai_catalog_projection_read_only/)
  await assert.rejects(pg.query('update shared.ai_prompts set definition_kind=$1 where id=$2',['role',persona.prompt_id]),/ai_catalog_identity_immutable/)
})

test('active versions must belong to the exact register row and type', async () => {
  const role = original.definitions.find((d:any) => d.prompt_key==='worker.role')
  const persona = original.definitions.find((d:any) => d.prompt_key==='worker.persona')
  await assert.rejects(activate({'worker.role':persona.id}),/ai_catalog_active_version_scope/)
  await assert.rejects(pg.query('update shared.ai_prompts set active_version_id=$1 where id=$2',[persona.id,role.prompt_id]),/ai_catalog_active_version_scope/)
  await assert.rejects(pg.query('insert into shared.ai_prompt_versions(prompt_id,version,definition_kind) values($1,2,$2)',[persona.prompt_id,'role']),/ai_catalog_kind_mismatch/)
  const other = await version('foreign','prompt',{},'another app','other-app')
  await assert.rejects(activate({'worker.persona':other}),/ai_catalog_active_version_scope/)
  await assert.rejects(resolve('other-app',original.manifest_id),/ai_catalog_manifest_unavailable/)
})

test('activation validates same-app references and rolls back the whole change', async () => {
  const wrong = await version('worker.role','role',{profile_key:'profile.worker',prompt_keys:['missing.persona']})
  const persona = await version('worker.persona','prompt',{},'This should roll back.')
  await assert.rejects(activate({'worker.role':wrong,'worker.persona':persona}),/ai_catalog_reference_unavailable/)
  assert.equal((await resolve()).manifest_id,original.manifest_id)
  const wrongType = await version('worker.role','role',{profile_key:'worker.persona',prompt_keys:['worker.persona']})
  await assert.rejects(activate({'worker.role':wrongType}),/ai_catalog_reference_unavailable/)
  const role = original.definitions.find((d:any) => d.prompt_key==='worker.role')
  await assert.rejects(pg.query('update shared.ai_prompts set active_version_id=$1 where id=$2',[wrong,role.prompt_id]),/ai_catalog_reference_unavailable/,'direct pointer updates receive deferred graph validation')
  assert.equal((await resolve()).manifest_id,original.manifest_id)
})

test('activation refuses a role without prompts or an unusable provider profile', async () => {
  const empty = await version('worker.role','role',{profile_key:'profile.worker',prompt_keys:[]})
  await assert.rejects(activate({'worker.role':empty}),/ai_catalog_prompt_required/)
  const bad = await version('profile.worker','execution_profile',{
    tier:'mini',reasoning_effort:'low',max_output_tokens:3000,provider_parameters:{max_output_tokens:1000000},
  })
  await assert.rejects(activate({'profile.worker':bad}),/ai_catalog_provider_parameters_invalid/)
  assert.equal((await resolve()).manifest_id,original.manifest_id)
})

test('one tier revision upgrades every dependent role while existing jobs replay their original model', async () => {
  await pg.query(`insert into shared.ai_models(model_name,model_type,capabilities)
    values('future-mini','mini',$1)`,[capabilities])
  const upgrade = await version('tier.mini','tier_binding',{tier:'mini',model_name:'future-mini'})
  await activate({'tier.mini':upgrade})
  const next = await resolve()
  assert.notEqual(next.manifest_id,original.manifest_id)
  assert.equal(next.models[0].model_name,'future-mini')
  const oldRole = original.definitions.find((d:any) => d.prompt_key==='worker.role')
  assert.deepEqual(next.definitions.find((d:any) => d.prompt_key==='worker.role'),oldRole)
  const replay = await resolve('catalog-test',original.manifest_id)
  assert.deepEqual(replay,original)
  const binding = original.definitions.find((d:any) => d.prompt_key==='tier.mini')
  await activate({'tier.mini':binding.id})
  assert.equal((await resolve()).manifest_id,original.manifest_id,'rollback restores the exact original snapshot')
  assert.equal((await pg.query<any>(`select is_current_for_type from shared.ai_models where model_name='gpt-5.4-mini'`)).rows[0].is_current_for_type,true,'other apps global catalog flag was not changed')
})

test('incompatible or inactive model replacement fails closed without default fallback', async () => {
  const badCaps = {...capabilities,supports_functions:false}
  await pg.query(`insert into shared.ai_models(model_name,model_type,capabilities) values('bad-mini','mini',$1)`,[badCaps])
  const bad = await version('tier.mini','tier_binding',{tier:'mini',model_name:'bad-mini'})
  await assert.rejects(activate({'tier.mini':bad}),/ai_catalog_model_incompatible/)
  assert.equal((await resolve()).manifest_id,original.manifest_id)
  await pg.exec(`update shared.ai_models set is_active=false where model_name='bad-mini'`)
  await assert.rejects(activate({'tier.mini':bad}),/ai_catalog_model_unavailable|ai_catalog_model_incompatible/)
  const unknown = await version('tier.mini','tier_binding',{tier:'mini',model_name:'does-not-exist'})
  await assert.rejects(activate({'tier.mini':unknown}),/ai_catalog_provider_unsupported|ai_catalog_model_unavailable/)
  assert.equal((await resolve()).manifest_id,original.manifest_id)
})

test('revision hash includes content, metadata, schemas, variables and flow; legacy fields follow activation', async () => {
  const persona = original.definitions.find((d:any) => d.prompt_key==='worker.persona')
  const id = (await pg.query<any>(`insert into shared.ai_prompt_versions
    (prompt_id,version,definition_kind,metadata,content,definition,available_variables,flow,payload_hash)
    select $1,coalesce(max(version),0)+1,'prompt',$2,$3,$4,$5,$6,'forged' from shared.ai_prompt_versions where prompt_id=$1 returning id,payload_hash`,
    [persona.prompt_id,{label:'New name',purpose:'New purpose'},'Du är testkollegan.',{schema:{type:'object'}},['task'],'Current flow'])).rows[0]
  assert.notEqual(id.payload_hash,persona.payload_hash)
  assert.notEqual(id.payload_hash,'forged')
  await activate({'worker.persona':id.id})
  const row = (await pg.query<any>('select content,label,description,available_variables,flow from shared.ai_prompts where id=$1',[persona.prompt_id])).rows[0]
  assert.deepEqual(row,{content:'Du är testkollegan.',label:'New name',description:'New purpose',available_variables:['task'],flow:'Current flow'})
  await activate({'worker.persona':persona.id})
})

test('unversioned prompts in other apps retain their editable legacy behavior', async () => {
  await pg.exec(`insert into shared.ai_prompts(app,prompt_key,label,content) values('legacy-app','legacy','Legacy','Before');
    update shared.ai_prompts set app='renamed-app',prompt_key='renamed',content='After' where app='legacy-app' and prompt_key='legacy';`)
  const row = (await pg.query<any>(`select content,active_version_id,catalog_managed from shared.ai_prompts where app='renamed-app' and prompt_key='renamed'`)).rows[0]
  assert.deepEqual(row,{content:'After',active_version_id:null,catalog_managed:false})
  const inactive = await version('inactive-history','prompt',{},'Historical','history-app')
  const prompt = (await pg.query<any>('select prompt_id from shared.ai_prompt_versions where id=$1',[inactive])).rows[0].prompt_id
  await assert.rejects(pg.query('update shared.ai_prompts set app=$1 where id=$2',['moved-history',prompt]),/ai_catalog_identity_immutable/)
  await assert.rejects(pg.query('update shared.ai_prompts set catalog_managed=false where id=$1',[prompt]),/ai_catalog_identity_immutable/)
})

test('direct graph validation is invalidated by each pointer change within one transaction', async () => {
  const persona = original.definitions.find((d:any) => d.prompt_key==='worker.persona')
  const role = original.definitions.find((d:any) => d.prompt_key==='worker.role')
  const valid = await version('worker.persona','prompt',{},'A valid changed persona.')
  const bad = await version('worker.role','role',{profile_key:'missing-profile',prompt_keys:['worker.persona']})
  await assert.rejects(pg.transaction(async tx => {
    await tx.exec('set constraints shared.ai_prompts_active_graph immediate')
    await tx.query('update shared.ai_prompts set active_version_id=$1 where id=$2',[valid,persona.prompt_id])
    await tx.query('update shared.ai_prompts set active_version_id=$1 where id=$2',[bad,role.prompt_id])
  }),/ai_catalog_reference_unavailable/)
  assert.equal((await resolve()).manifest_id,original.manifest_id)
})

test('JSON-schema capability is checked in the same adapter metadata used by runtime', async () => {
  await pg.query(`insert into shared.ai_models(model_name,model_type,capabilities,supports_json_schema)
    values('no-schema-mini','mini',$1,true)`,[{...capabilities,supports_json_schema:false}])
  const incompatible = await version('tier.mini','tier_binding',{tier:'mini',model_name:'no-schema-mini'})
  await assert.rejects(activate({'tier.mini':incompatible}),/ai_catalog_model_incompatible/)
  assert.equal((await resolve()).manifest_id,original.manifest_id)
})
