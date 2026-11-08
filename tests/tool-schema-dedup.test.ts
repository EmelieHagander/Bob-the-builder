import {test} from 'node:test'
import assert from 'node:assert/strict'
import {dedupSchema,inlineSchema,schemaChars} from '../supabase/functions/_shared/tool-schema-dedup.ts'
import {anthropicRequestBody,type AnthropicCallContext} from '../supabase/functions/_shared/anthropic-service.ts'
import {catalogFixture} from './support/ai-catalog-fixture.ts'

// Owner decision 2026-11-06: Bob's write tools repeat the same sub-schemas inline
// (one placement block seven times; 72 % of edit_construction_parts is copies).
// Claude counted 44,096 -> 34,561 tokens for the five write tools (measured).
const stable=(v:unknown)=>JSON.stringify(v,(_k,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x)

test('every catalog tool schema round-trips losslessly through $defs and no shared block is sent twice',()=>{
 // The bound tool is what the model receives; the stored row is only the recipe.
 const catalog=catalogFixture(),names=catalog.manifest().definitions.filter(d=>d.definition_kind==='tool_contract'&&d.definition.parameters).map(d=>String(d.definition.name??d.prompt_key.slice(6)))
 const bound=names.flatMap(n=>{try{return [catalog.tool(n)]}catch{return []}})
 assert(bound.length>40)
 let before=0,after=0
 for(const t of bound){
  const inline=t.function.parameters,compact=dedupSchema(inline)
  assert.equal(stable(inlineSchema(compact)),stable(inline),t.function.name)
  assert.equal(stable(dedupSchema(compact)),stable(compact),'idempotent: '+t.function.name)
  before+=schemaChars(inline);after+=schemaChars(compact)
 }
 // Measured 2026-11-06: 210,378 -> 185,188 chars across the bench; the five
 // write tools alone 95,024 -> 73,924 (Claude: 44,096 -> 34,561 tokens).
 assert(after<before*0.9,`expected a real reduction, got ${after}/${before}`)
 const writes=['edit_construction_parts','save_construction_draft','change_construction_parameters','edit_project_record','calculate_project'].map(n=>catalog.tool(n).function.parameters)
 const wb=writes.reduce((n,p)=>n+schemaChars(p),0),wa=writes.reduce((n,p)=>n+schemaChars(dedupSchema(p)),0)
 assert(wa<wb*0.8,`write tools: ${wa}/${wb}`)
 const edit=dedupSchema(catalog.tool('edit_construction_parts').function.parameters) as any
 const defs=Object.keys(edit.$defs);assert(defs.length>=10)
 // A def body may use smaller defs (placement inside shape), never itself.
 for(const [name,body] of Object.entries(edit.$defs))assert(!JSON.stringify(body).includes('#/$defs/'+name+'"'),name)
 // Two placement blocks exist in the source with different bounds; each is written once.
 assert(JSON.stringify(edit).split('"rx"').length-1<=2,'each distinct placement block is written once')
})

test('small or unique schemas are returned unchanged and refs are refused when missing or cyclic',()=>{
 const small={type:'object',properties:{a:{type:'string'}},required:['a']}
 assert.deepEqual(dedupSchema(small),small)
 assert.throws(()=>inlineSchema({type:'object',properties:{a:{$ref:'#/$defs/nope'}},$defs:{}}),/schema_ref_missing/)
 assert.throws(()=>inlineSchema({type:'object',properties:{a:{$ref:'#/$defs/x'}},$defs:{x:{type:'object',properties:{b:{$ref:'#/$defs/x'}}}}}),/schema_ref_cycle/)
})

const ctx=(over:Partial<AnthropicCallContext>={}):AnthropicCallContext=>({apiKey:'k',model:{model_name:'claude-opus-5-5',input_cost_per_1m_tokens:4,output_cost_per_1m_tokens:20,cached_input_cost_per_1m_tokens:0.2,supports_images:true,capabilities:{}},
 systemMessage:'Du är Bob.',maxOutputTokens:16000,effort:'high',timeoutMs:5000,log:async()=>{},sleep:async()=>{},...over})
const base={app:'bob',module:'global',aiFunction:'ask-bob',coworkerId:'bob',functionName:'ask-bob'}

test('the Claude request carries $defs only for executions pinned to tool schema dedup',async()=>{
 const spec=catalogFixture().tool('edit_construction_parts')
 const inline:any=await anthropicRequestBody({...base,prompt:'x',tools:[spec]},ctx())
 const compact:any=await anthropicRequestBody({...base,prompt:'x',tools:[spec],toolSchemaDedup:1},ctx())
 assert.equal(inline.tools[0].input_schema.$defs,undefined)
 assert(Object.keys(compact.tools[0].input_schema.$defs).length>=10)
 assert.equal(compact.tools[0].name,inline.tools[0].name);assert.equal(compact.tools[0].description,inline.tools[0].description)
 assert(JSON.stringify(compact.tools[0]).length<JSON.stringify(inline.tools[0]).length*0.8)
 assert.equal(stable(inlineSchema(compact.tools[0].input_schema)),stable(inline.tools[0].input_schema),'the model sees the same contract')
})
