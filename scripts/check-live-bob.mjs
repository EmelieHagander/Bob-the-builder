// Live release proof with the existing public guest account. Never grant this
// account access to a real project. The operator removes the printed fixture
// project afterwards; project deletion is deliberately not a client capability.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { visionFixture } from './bob-vision-fixture.mjs'
import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

const configured = process.env.VITE_SUPABASE_URL?.trim() ?? ''
const url = /^[a-z0-9]{16,}$/.test(configured) ? `https://${configured}.supabase.co` : configured.replace(/\/$/, '')
const key = process.env.VITE_SUPABASE_ANON_KEY?.trim()
assert.equal(url, 'https://yuobtgoidmmmwfqenkau.supabase.co', 'Use the explicitly configured Bob deployment')
assert(key, 'Publishable Supabase configuration is required')
const client = createClient(url, key, { db: { schema: 'bob' }, auth: { persistSession: false, autoRefreshToken: false } } )
const checked = result => { if (result.error) throw new Error(result.error.message); return result.data }
let signedIn = false, fixtureProject, fixtureImage, reserved = false
const media = (action, data={}) => client.rpc('media_command', { p_project: fixtureProject, p_action: action, p_media: fixtureImage, p_data: data })
try {
  const auth = checked(await client.auth.signInWithPassword({ email: 'guest@bob.local', password: 'bob-guest-2026' }))
  assert(auth.session, 'A real Auth session is required')
  signedIn = true
  const release=JSON.parse(await readFile(new URL('../public/bob-release.json',import.meta.url),'utf8')).release
  const marker=await fetch(url+'/functions/v1/ask-bob',{method:'POST',headers:{apikey:key,Authorization:'Bearer '+auth.session.access_token,'Content-Type':'application/json'},body:JSON.stringify({action:'release_probe'})})
  assert.equal(marker.headers.get('X-Bob-Release'),release,'Verify the exact new backend release before creating fixtures')
  assert.equal(marker.status,409)

  // The public guest is a non-member of the actual entrance project.
  assert.deepEqual(checked(await client.from('projects').select('id').eq('id', 'p_bygga_in_entren')), [])
  const denied = await client.functions.invoke('ask-bob', { body: { action: 'send', projectId: 'p_bygga_in_entren', message: 'Permission check' } })
  assert.equal(denied.error?.context?.status, 403, 'Real non-member must be denied by the edge boundary')
  const retired = await client.functions.invoke('ask-launchpad', { body: { action: 'status', taskId: 'retired-fixture' } })
  assert.equal(retired.error?.context?.status, 410, 'The legacy provider endpoint must be retired')
  checked(await client.rpc('claim_project_invites'))

  const nonce = randomUUID()
  const project = checked(await client.rpc('create_project', { p_input: { name: `Bob CI verification ${nonce}`, description: 'Disposable release verification fixture. Contains no real project data.', type: 'Verification' } }))
  assert(project?.id)
  console.log(`BOB_SMOKE_PROJECT_ID=${project.id}`)
  fixtureProject=project.id;fixtureImage=randomUUID()
  const photo=visionFixture()
  checked(await media('reserve',{ original_name:'fixture.png',title:'Kontrollbild',purpose:'reference',content_type:'image/png',byte_size:photo.bytes.length,width:photo.width,height:photo.height,target_kind:'project',target_id:null }))
  reserved=true
  checked(await client.storage.from('bob-project-media').upload(`${project.id}/${fixtureImage}`,photo.bytes,{contentType:'image/png',upsert:false}))
  checked(await media('finalize'))
  const materialId = `m_${randomUUID()}`
  const name = `Verification bolt ${nonce}`
  checked(await client.from('materials').insert({ id: materialId, project_id: project.id, name, qty: '37 pieces', status: 'needed' }))
  assert.deepEqual(checked(await client.from('materials').select('id').eq('id', materialId)), [{ id: materialId }])
  const answer = checked(await client.functions.invoke('ask-bob', { body: {
    action: 'send', projectId: project.id,
    message: `Slå upp materialet "${name}" med search_project_data. Vilket antal står registrerat? Svara kort och behandla antalet som obekräftad projektinformation.`,
  } }))
  assert.equal(answer.backend, 'openai')
  assert.equal(answer.projectId, project.id)
  assert.equal(answer.evidence?.kind, 'ai_assessment')
  assert(answer.evidence.sources.some(source => source.projectId === project.id && source.recordId === materialId), 'OpenAI must actually consult a material outside the project-only briefing')
  assert(answer.evidence.sources.every(source => source.projectId === project.id), 'Every source stays in the requested project')
  assert.match(answer.summary, /37/)
  assert(!answer.evidence.sources.some(s=>s.dataset==='image_pixels'),'A material-only question must not open the available photo')
  const ask=async message=>{
    const reply=checked(await client.functions.invoke('ask-bob',{body:{action:'send',projectId:project.id,message}}))
    assert.equal(reply.backend,'openai')
    assert(reply.evidence?.sources.some(s=>s.dataset==='image_pixels'&&s.recordId===fixtureImage&&s.projectId===project.id),'Real model must choose the image tool and receive pixels')
    assert(reply.evidence.sources.every(s=>s.projectId===project.id))
    assert.doesNotMatch(JSON.stringify(reply),/data:image|base64,|object_path|bucket_id/)
    return reply.summary
  }
  // The answer is absent from the title, metadata, materials and project description.
  const visual=await ask('Titta på projektbilden Kontrollbild. Vilken färg har figuren längst upp till vänster, och vilken färg har figuren längst upp till höger? Svara på svenska, vänster först. Gissa inte från titeln.')
  assert.match(visual,/röd|rött/i);assert.match(visual,/blå/i)
  assert(visual.search(/röd|rött/i)<visual.search(/blå/i),'Left/right order must match the pixels')
  const reopened=await ask(`Öppna samma projektbild igen, image:${fixtureImage}. Vilken form och färg har figuren underst? Kontrollera bilden, inte en tidigare beskrivning. Svara på svenska.`)
  assert.match(reopened,/grön/i);assert.match(reopened,/cirkel|rund|cirkl/i)
  console.log('Live image choice → private Storage → actual provider pixels → visual-only answer → explicit reopen: passed. Material question sent no images.')
  console.log('Live Auth → member-scoped PostgREST → OpenAI tool → source disclosure: passed. Non-member: 403. Retired endpoint: 410.')
} catch (error) {
  // Never serialize Supabase request objects, sessions, tokens or user records.
  console.error(`Live Bob verification failed: ${error.message}`)
  process.exitCode = 1
} finally {
  if(reserved) {
    try {
      checked(await media('begin_delete'))
      checked(await client.storage.from('bob-project-media').remove([`${fixtureProject}/${fixtureImage}`]))
      checked(await media('finish_delete'))
      console.log('Synthetic image and its private object removed through normal caller-authorised APIs.')
    } catch { console.error('Synthetic image cleanup failed; operator must check the printed fixture project.');process.exitCode=1 }
  }
  if (signedIn) await client.auth.signOut({ scope: 'local' })
}
