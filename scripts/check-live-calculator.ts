/** Actual Bob/provider probe in a disposable public-test-account project.
 * Read-only AI request; operator removes the printed project after inspecting
 * content-free execution_events. Never use a named member's real project. */
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {createClient} from '@supabase/supabase-js'

const url=process.env.VITE_SUPABASE_URL?.trim()
const key=process.env.VITE_SUPABASE_ANON_KEY?.trim()
assert.equal(url,'https://yuobtgoidmmmwfqenkau.supabase.co');assert(key)
const client=createClient(url,key,{db:{schema:'bob'},auth:{persistSession:false,autoRefreshToken:false}})
function checked<T>(result:{data:T;error:{message:string}|null}):T{if(result.error)throw new Error(result.error.message);return result.data}
let signedIn=false
try{
 const auth=checked(await client.auth.signInWithPassword({email:'guest@bob.local',password:'bob-guest-2026'}));assert(auth.user);signedIn=true
 const project=checked(await client.rpc('create_project',{p_input:{name:'Bob calculator verification '+randomUUID(),description:'Disposable calculator verification; synthetic specification only, no real project data.',type:'Verification'}}))
 assert(project.id);console.log('CALCULATOR_SMOKE_PROJECT_ID='+project.id)
 const measurement=randomUUID()
 checked(await client.rpc('evidence_command',{p_project:project.id,p_kind:'measurement',p_action:'create',p_record:measurement,p_expected:0,
  p_data:{subject:'Synthetic clear span',value:'1.001',unit:'m',truth:'provided_spec',source:'Explicit synthetic calculator fixture; not measured site fit.',required:true,area_id:null}}))
 const turn=randomUUID();console.log('CALCULATOR_SMOKE_TURN_ID='+turn)
 const reply=checked(await client.functions.invoke('ask-bob',{body:{action:'send',projectId:project.id,clientTurnId:turn,
  message:`Detta är en tillfällig beräkningsförhandsvisning. Använd calculate_project med parameter_graph_v1. Läs källvärdet från mätning ${measurement} revision 1 genom dess källreferens; kopiera inte det till en konstant. Dra av två valda sidstycken på 18 mm och en vald frigång på 5 mm. Dessa två värden är uttryckliga konstruktionsval. Räkna med exakt avrundning och svara med den fria bredden i mm. Spara inget, ändra inget och skicka inget till CAD.`}}))
 assert.equal(reply.backend,'openai');assert.equal(reply.projectId,project.id);assert.match(reply.summary,/960/)
 const after=checked(await client.from('current_measurements').select('id,revision,value,unit,truth').eq('project_id',project.id).eq('id',measurement))
 assert.equal(after.length,1);assert.equal(after[0].revision,1);assert.equal(after[0].unit,'m');assert.equal(after[0].truth,'provided_spec')
 assert.equal(Number(after[0].value),1.001)
 const artifacts=checked(await client.from('artifacts').select('id').eq('project_id',project.id));assert.equal(artifacts.length,0)
 const needs=checked(await client.from('material_requirements').select('id').eq('project_id',project.id));assert.equal(needs.length,0)
 console.log('Actual Bob response: 960 mm; exact source revision/unit preserved; no Artifact or requirement created. Inspect execution_events for calculated calculate_project before claiming tool selection.')
}finally{if(signedIn)await client.auth.signOut()}
