import { test } from 'node:test'
import assert from 'node:assert/strict'
import { planTestConfig, requirePlanTestMember } from '../scripts/check-live-plan-assistant.mjs'

const id='00000000-0000-4000-8000-000000000001'
const token=(role:string)=>'fixture.'+Buffer.from(JSON.stringify({role})).toString('base64url')+'.not-a-real-token'
const env={VITE_SUPABASE_URL:'https://yuobtgoidmmmwfqenkau.supabase.co',VITE_SUPABASE_ANON_KEY:'sb_publishable_fixture',
  BOB_PLAN_LIVE_CONFIRM:'disposable-fixtures-only',BOB_TEST_MEMBER_ID:id,BOB_TEST_MEMBER_ACCESS_TOKEN:token('authenticated')}

test('live plan probe requires an explicit named-member session before network or fixture writes',()=>{
  assert.equal(planTestConfig(env).memberId,id)
  for(const bad of [undefined,token('anon'),token('service_role')])
    assert.throws(()=>planTestConfig({...env,BOB_TEST_MEMBER_ACCESS_TOKEN:bad}),/named test member session/)
  assert.throws(()=>planTestConfig({...env,BOB_PLAN_LIVE_CONFIRM:undefined}),/disposable-fixture/)
  assert.throws(()=>planTestConfig({...env,VITE_SUPABASE_ANON_KEY:token('service_role')}),/Publishable/)
})

test('Auth readback rejects the public guest, anonymous, unverified and mismatched users',async()=>{
  const valid={id,email:'synthetic@example.test',email_confirmed_at:'2026-09-23T00:00:00Z',is_anonymous:false}
  const client=(user:any)=>({auth:{getUser:async supplied=>{assert.equal(supplied,env.BOB_TEST_MEMBER_ACCESS_TOKEN);return {data:{user},error:null}}}})
  await requirePlanTestMember(client(valid),env.BOB_TEST_MEMBER_ACCESS_TOKEN,id)
  for(const invalid of [{...valid,email:'guest@bob.local'},{...valid,is_anonymous:true},
    {...valid,email_confirmed_at:null},{...valid,id:'another-user'},null])
    await assert.rejects(requirePlanTestMember(client(invalid),env.BOB_TEST_MEMBER_ACCESS_TOKEN,id),/Verified named test member required/)
})
