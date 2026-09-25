// Four theoretical real-model scenarios in NEW disposable projects, using only
// the existing public guest account. No production project access, named-user
// impersonation, private credentials or Bob-write authority. SQL/CI separately
// verifies writes. A named-member end-to-end run remains a distinct gate.
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {writeFile} from 'node:fs/promises'
import {createClient} from '@supabase/supabase-js'

assert.equal(process.env.BOB_SCENARIO_CONFIRM,'disposable-fixtures-only')
const url=process.env.VITE_SUPABASE_URL?.replace(/\/$/,'')
assert.equal(url,'https://yuobtgoidmmmwfqenkau.supabase.co')
assert(process.env.VITE_SUPABASE_ANON_KEY)
const client=createClient(url,process.env.VITE_SUPABASE_ANON_KEY,{db:{schema:'bob'},auth:{persistSession:false,autoRefreshToken:false}})
const checked=r=>{if(r.error)throw new Error(r.error.message);return r.data}
const scenarios=[
 {name:'Bunk bed with drawers',brief:'Fristående våningssäng med två lådor. Önskade madrassmått 900 × 2000 mm, valt konstruktionsmått, inte uppmätt plats. Lådornas rörelse behöver kontrolleras. Väggreglar och eventuell tippsäkring är okända. Vägg ska inte antas vara primär bärning.',query:'våningssäng lådor frigång förband',question:'Förklara nästa konkreta väg till ritning, räknade delar, lager och inköp. Skilj vad som kan ritas nu från kvarstående säkerhetskontroller.'},
 {name:'Porch',brief:'Veranda med tak önskas, preliminär designyta 3000 × 4000 mm. Inga verifierade grund-, mark- eller lastuppgifter. Befintlig fasad är en projektuppgift, ingen verifierad infästning. Två arbetsdagar planeras utan anmälda deltagare.',query:'veranda förband befintlig konstruktion',question:'Beskriv hur ritning och materialplan kan tas vidare och hur uppgifter placeras på två byggdagar. Ange undersökningar som påverkar grund och anslutning.'},
 {name:'House renovation',brief:'Husrenovering med sex områden och sex planerade steg per område, totalt 36 steg. Eldragning och möjlig ändring av bärande vägg finns bland delarna. Befintliga ritningar och konstruktion är ännu inte verifierade.',query:'husrenovering förundersökning bärande el',question:'Beskriv en hanterbar planstruktur och beroenden mellan områden. Bevara olika faser och skilj el-/konstruktionskontroller från oberoende arbete.'},
 {name:'Hen and rabbit housing',brief:'Projektet ska undersöka separata utrymmen för höns respektive kaniner. Antal, storlek, hållningsform och placering behöver fastställas. Samboende är inte ett beslut. Inga djurspecifika minimimått är sparade.',query:'hönshus kaninhus utrymme',question:'Beskriv vilka fakta som behövs för respektive utrymme och hur gemensamma CAD-/materialverktyg kan användas. Ange inga universella minimimått och blanda inte ihop djurslagen.'},
]
const results=[]
const report=()=>writeFile(process.env.BOB_SCENARIO_REPORT??'test-results/live-project-scenarios.json',JSON.stringify({scope:'real model, read-only guest, disposable fixtures',results},null,2)+'\n')
try{
 checked(await client.auth.signInWithPassword({email:'guest@bob.local',password:'bob-guest-2026'}))
 for(const scenario of scenarios){
  const project=checked(await client.rpc('create_project',{p_input:{name:`Bob scenario verification ${scenario.name} ${randomUUID()}`,description:`Synthetic disposable fixture. ${scenario.brief}`,type:'Verification'}}))
  const entry={scenario:scenario.name,projectId:project.id,checks:{},status:'created'};results.push(entry);await report()
  checked(await client.from('tasks').insert({id:`t_${randomUUID()}`,project_id:project.id,area_id:null,name:`Fixture: ${scenario.name}`,instructions:'Synthetic task; no field verification',status:'todo'}))
  const started=Date.now()
  const answer=checked(await client.functions.invoke('ask-bob',{body:{action:'send',projectId:project.id,clientTurnId:randomUUID(),
   message:`Gör en teoretisk genomgång av detta syntetiska testprojekt, cirka 250 ord. Ändra inga poster. Läs aktuella projektdata och uppgifter med read_project_work (task_work). Konsultera search_building_knowledge med svenska källor för "${scenario.query}" och redovisa källorna. ${scenario.question} Säg tydligt vad som är antaget och vad som faktiskt har verifierats; beskriv nästa genomförbara åtgärd utan att påstå att den redan är gjord.`}}))
  entry.elapsedMs=Date.now()-started;entry.answer=answer.summary;entry.evidence=answer.evidence
  entry.checks={backend:answer.backend==='openai',project:answer.projectId===project.id,noWrites:!(answer.evidence?.writes?.length),scopedSources:answer.evidence?.sources?.every(s=>s.projectId===project.id),operationalRead:answer.evidence?.sources?.some(s=>s.dataset==='task_work'),references:(answer.evidence?.references?.length??0)>0}
  entry.status=Object.values(entry.checks).every(Boolean)?'passed':'failed';await report()
  console.log(JSON.stringify({scenario:entry.scenario,projectId:project.id,status:entry.status,elapsedMs:entry.elapsedMs,checks:entry.checks}))
 }
 assert(results.every(r=>r.status==='passed'),'One or more scenario checks failed; inspect the saved report')
}catch(error){await report();console.error(`Scenario verification failed: ${error.message}`);process.exitCode=1}
finally{await client.auth.signOut({scope:'local'})}
