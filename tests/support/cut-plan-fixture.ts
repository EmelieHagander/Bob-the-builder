import { designIntent } from './design-intent-fixture.ts'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { projectSchema, asProjectUser } from './project-schema.ts'
import { parameterPlan } from './cad-parameter-fixture.ts'
import { compileCadParameters } from '../../supabase/functions/_shared/cad-parameters.ts'
import { constructionLists } from '../../supabase/functions/_shared/construction-lists.ts'
import { constructionCutFit } from '../../supabase/functions/_shared/construction-cut-fit.ts'

export async function cutPlanFixture(t: any) {
 const pg=await projectSchema();t.after(()=>pg.close()); const user=randomUUID(),other=randomUUID(),message='Save a cut plan for the existing blanks. Keep stock, needs and Shopping unchanged.'
 await pg.query('insert into auth.users values($1,$2,now()),($3,$4,now())',[user,'cut-plan@test.example',other,'outsider@test.example'])
 const rpc=async(name:string,args:any[],uid:string|null=user,role='authenticated'):Promise<any>=>(await asProjectUser(pg,uid,`select ${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) result`,args,role)).rows[0].result
 const project=(await rpc('bob.create_project',[JSON.stringify({name:'Cut plan isolated fixture'})])).id, solution=randomUUID()
 await rpc('bob.solution_command',[project,'create',solution,0,JSON.stringify({area_id:null,title:'Concept bracket',description:'Fixture',assumptions:'Product unknown',tradeoffs:'Synthetic',measurements:[],design_intent:designIntent()})])
 await rpc('bob.solution_command',[project,'select',solution,0,JSON.stringify({solution_revision:1,reason:'Fixture'})])
 const turn=randomUUID(),claim=await rpc('bob.bob_claim_turn',[project,user,turn,message],null,'service_role')
 const write=(p:any,uid=user)=>rpc('bob.bob_project_write_v15',[project,claim.thread_id,turn,claim.generation,JSON.stringify(p)],uid)
 const base={record_id:null,expected_revision:0,expected_updated_at:null,request_quote:'Save a cut plan'}
 const material=await write({...base,kind:'catalog',data:{action:'ensure',key:'material',kind:'material',name:'Plywood 18',aliases:[],profile_code:'sheet_stock',profile_revision:1,categories:['wood.plywood','sheet'],properties:{thickness:{value:'18',unit:'mm',truth:'provided_spec',parameter:null,note:''}},material_id:null,material_revision:null,notes:'',source_kind:'design_choice',source_quote:'existing blanks',source_seq:null}})
 const placement=(x:number,z:number)=>({x,y:0,z,rx:0,ry:0,rz:0})
 const recipe:any={contract_version:1,units:'mm',assembly_id:'bracket',definitions:[{id:'base',primitive:'box',material_ref:null,x_mm:200,y_mm:100,z_mm:18},{id:'upright',primitive:'box',material_ref:null,x_mm:18,y_mm:100,z_mm:100}],instances:[{id:'foot',definition_id:'base',placement:placement(0,0)},{id:'back',definition_id:'upright',placement:placement(0,18)}],views:['front']}
 const constructionData:any={key:'construction',title:'Two-part bracket',description:'Concept',area_id:null,target_revision:1,change_note:'Fixture',recipe,parameters:compileCadParameters(project,recipe,parameterPlan(recipe),new Map(),new Map()),materials:recipe.definitions.map((d:any)=>({definition_id:d.id,material_id:material.recordId,material_revision:1,part_id:null,part_revision:null})),joints:[{id:'join',method:'glued_butt',first:{instance_id:'foot',face:'z_max'},second:{instance_id:'back',face:'z_min'},reason:'Concept'}],open_questions:['Hardware/access unknown']}
 const construction=await write({...base,kind:'construction',data:constructionData})
 const needs=[]
 for(const definition_id of ['base','upright']){
  const fields={name:definition_id+' blank',category:'Timber',area_id:null,task_id:null,waste_percent:'0',purchase_increment:'1',assumptions:'Concept',artifact_id:construction.recordId,artifact_revision:1,target_revision:1,definition_id,quantity_mode:'pieces',stock_allocations:[],component_allocations:[],change_note:'Counted blank'}
  needs.push(await write({...base,kind:'operational',data:{resource:'cad_requirement',action:'create',fields}}))
 }
 const draft=await rpc('bob.read_construction_draft',[project,construction.recordId,1,null]),catalogRecord=(await rpc('bob.catalog_read',[project,JSON.stringify({action:'read',id:material.recordId,revision:1,kind:null,query:null,after:null,profile_code:null,categories:[],properties:{}})])).record
 const catalog=new Map([[material.recordId+'@1',catalogRecord]])
 const candidates:any[]=[{id:'sheet',material_id:material.recordId,material_revision:1,length_mm:2440,width_mm:1220,thickness_mm:18,count:1,kerf_mm:3,trim_mm:5,grain:'length',basis:'provided_spec',note:'Explicit hypothetical test format, not measured stock or a verified product'}]
 const blank_grain=[{definition_id:'base',axis:'x'},{definition_id:'upright',axis:'z'}]
 const fit:any=constructionCutFit(constructionLists(draft,catalog,[]),candidates,blank_grain);assert.equal(fit.status,'feasible')
 const layout=Object.fromEntries(['placements','cuts','offcuts','used_sheets'].map(k=>[k,fit[k]]))
 const fields:any={key:'cut',artifact_id:construction.recordId,artifact_revision:1,requirements:needs.map(r=>({id:r.recordId,revision:r.revision})),candidates,blank_grain,candidate_sources:[{candidate_id:'sheet',kind:'hypothetical',record_id:null,revision:null}],layout,change_note:'Checked hypothetical layout'}
 const payload:any={...base,kind:'cut_plan',data:fields}
 const read=(id:string,rev:number|null=null)=>rpc('bob.read_material_cut_plan',[project,id,rev])
 return{pg,rpc,project,user,other,message,write,read,payload,draft,catalog,material,construction,constructionData,candidates,blank_grain,needs,base,turn,claim}
}

