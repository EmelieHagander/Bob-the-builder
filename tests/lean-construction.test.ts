import {before,after,test} from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {projectSchema,asProjectUser} from './support/project-schema.ts'
import type {PGlite} from './support/pglite.ts'
import {constructionFormFixture} from './support/construction-form-fixture.ts'
import {createConstructionTools} from '../supabase/functions/_shared/construction-draft.ts'
import {createProjectWriter} from '../supabase/functions/_shared/project-write.ts'
import {createConstructionSketchStore} from '../supabase/functions/_shared/construction-sketch.ts'
import {ruleJointId} from '../supabase/functions/_shared/construction-joint-rules.ts'

// Owner decision 2026-11-07 (lean_construction_version 1), scenario "Entrén":
// Konrad writes a frame with formulas and one joint rule, adds a part with a
// part edit (the edit that was refused twice live with form_instance_unmapped),
// and a refused write stays in the sketch so only the correction is sent again.
let pg:PGlite,owner:string
const call=async(uid:string|null,name:string,args:unknown[],role='authenticated'):Promise<any>=>
 (await asProjectUser(pg,uid,`select ${name}(${args.map((_,n)=>'$'+(n+1)).join(',')}) result`,args,role)).rows[0].result
before(async()=>{
 pg=await projectSchema(async(db,name)=>{
  if(name==='20260924120448_bob_background_jobs.sql')await db.exec(`create schema cron;create schema net;
   create function cron.schedule(text,text,text) returns bigint language sql as 'select 1::bigint';
   create function net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds integer) returns bigint language sql as 'select 1::bigint';`)
 })
 owner=randomUUID();await pg.query('insert into auth.users values($1,$2,now())',[owner,'lean@test.invalid'])
})
after(()=>pg.close())

async function setup(message:string,extra:Record<string,unknown>={}){
 const project=(await call(owner,'bob.create_project',[{name:'Lean'}])).id,solution=randomUUID(),turn=randomUUID()
 const {intent}=constructionFormFixture()
 await call(owner,'bob.solution_command',[project,'create',solution,0,{title:'Ram',description:'Syntetisk',assumptions:'Ej mätt',tradeoffs:'Ej godkänd',measurements:[],design_intent:intent}])
 await call(owner,'bob.solution_command',[project,'select',solution,0,{solution_revision:1,reason:'Fixture'}])
 const c=await call(null,'bob.bob_claim_turn',[project,owner,turn,message],'service_role'),binding=[project,c.thread_id,turn,c.generation]
 const write=(p:unknown)=>call(owner,'bob.bob_project_write_v16',[...binding,p])
 const material=await write({kind:'catalog',record_id:null,expected_revision:0,expected_updated_at:null,request_quote:message,data:{action:'ensure',key:'material',kind:'material',name:'Fixture plywood',aliases:[],profile_code:'sheet_stock',profile_revision:1,categories:['wood.plywood','sheet'],properties:{thickness:{value:'18',unit:'mm',truth:'provided_spec',parameter:null,note:''}},material_id:null,material_revision:null,notes:'',source_kind:'design_choice',source_quote:message,source_seq:null}})
 const store=(fn:string)=>createConstructionSketchStore(async(action,key,expected,sketch)=>{
  try{return {data:await call(owner,'bob.'+fn,[...binding,action,key,expected,sketch===null?null:JSON.stringify(sketch)]),error:null}}catch(e:any){return {data:null,error:{code:e.code}}}})
 const tools=createConstructionTools({projectId:project,message,hasAccess:async()=>true,formRefinement:true,serverTarget:true,defaultZero:true,chosenJointFasteners:true,leanConstruction:true,
  sketches:store('construction_sketch'),newSketches:store('construction_new_sketch'),
  writer:createProjectWriter(project,message,async p=>{try{return {data:await write(p),error:null}}catch(e:any){return {data:null,error:{code:e.code,message:e.message}}}},async()=>({data:[],error:null}),async()=>({data:[],error:null})),
  read:(id,revision)=>call(owner,'bob.read_construction_draft',[project,id,revision,null]),readSources:async()=>({project:new Map(),physical:new Map()}),
  readCurrentTarget:async area=>(await call(owner,'bob.read_design_readiness',[project,area,null,'construction'])).target_revision??null,
  readConstructionReadiness:(t,area,r)=>call(owner,'bob.read_construction_readiness',[project,area,t,r]),
  readCatalog:(id,revision)=>call(owner,'bob.catalog_read',[project,{action:'read',id,revision,kind:null,query:null,after:null,profile_code:null,categories:[],properties:{}}]),
  prepareEdit:async p=>{try{return await call(owner,'bob.prepare_construction_edit',[...binding,JSON.stringify(p)])}catch(e:any){return {status:e.code==='PT409'?'conflict':e.code==='42501'?'denied':'invalid',reason:e.message}}},...extra})
 return {project,solution,tools,material:material.recordId as string,read:(id:string,revision:number|null=null)=>call(owner,'bob.read_construction_draft',[project,id,revision,null])}
}
const decision=(id:string,value:number,reason:string)=>({id,role:'decision',value,unit:'mm',reason})
const at=(x:unknown,y:unknown=0)=>({x,y,z:0,rx:0,ry:0,rz:0})
const rule={id:'horn',between:['rail','cross'],reason:'Tvärslån limmas och skruvas mot sidoslån.',fasteners:[],except:[]}
const role=(id:string)=>({instance_id:id,role:'build_part',quantity_policy:'manufacture',reason:'Syntetisk del'})
// quantity_policy follows from the role; lean writing may leave it out.
const bare=(id:string)=>({instance_id:id,role:'build_part',reason:'Syntetisk del'})
function frameSave(message:string,material:string){
 return {key:'ram',record_id:null,expected_revision:0,title:'Ram',description:'Syntetisk ram',area_id:null,change_note:'Ramen',open_questions:[],request_quote:message,mode:'save',
  recipe:{contract_version:1,units:'mm',assembly_id:'frame',views:['front','top'],
   definitions:[{id:'rail',primitive:'box',material_ref:null,x_mm:'w',y_mm:'depth',z_mm:'w'},{id:'cross',primitive:'box',material_ref:null,x_mm:'span - w - w',y_mm:'w',z_mm:'w'}],
   instances:[{id:'left',definition_id:'rail',placement:at(0)},{id:'right',definition_id:'rail',placement:at('span - w')},{id:'front',definition_id:'cross',placement:at('w')}]},
  parameter_plan:{version:1,frames:[],nodes:[decision('w',18,'Virkets tjocklek.'),decision('depth',400,'Ramens djup enligt konceptet.'),decision('span',600,'Ramens bredd enligt konceptet.')],bindings:[]},
  materials:['rail','cross'].map(d=>({definition_id:d,material_id:material,material_revision:1,part_id:null,part_revision:null})),joints:[],
  instance_policy:{version:1,instances:['left','right','front'].map(role)},
  // Only the first part is mapped; code maps the rest by the frame envelope.
  form_refinement:{version:1,mappings:[{component_id:'frame',instance_ids:['left']}]},joint_rules:[rule]}
}

test('a frame written with formulas and one joint rule saves the same graph, its joints and a completed mapping',async()=>{
 const message='Bygg ramen med formler.',{tools,material,read}=await setup(message)
 const saved=await tools.execute('save_construction_draft',frameSave(message,material))
 assert.equal(saved.status,'saved',JSON.stringify(saved))
 const draft=await read(saved.receipt.recordId)
 assert.deepEqual(draft.recipe.instances.map((i:any)=>[i.id,i.placement.x]),[['left',0],['right',582],['front',18]])
 assert.deepEqual(draft.recipe.definitions.map((d:any)=>[d.id,d.x_mm]),[['rail',18],['cross',564]])
 assert.ok(draft.parameters.nodes.some((n:any)=>n.id.startsWith('fx.')),'formula nodes are saved like any derived node')
 assert.deepEqual(draft.joints.map((j:any)=>j.id).sort(),[ruleJointId('front','left'),ruleJointId('front','right')].sort())
 assert.deepEqual(draft.joints.find((j:any)=>j.id===ruleJointId('front','left')).first,{instance_id:'left',face:'x_max'})
 assert.deepEqual(draft.form_refinement.mappings,[{component_id:'frame',instance_ids:['left','right','front']}])
})

test('a part edit adds a part by formula: its joints come from the rule and the mapping follows, where it was refused live',async()=>{
 const message='Lägg till en bakre slå.',{tools,material,read}=await setup(message)
 const id=(await tools.execute('save_construction_draft',{...frameSave(message,material),request_quote:message})).receipt.recordId
 const edit=await tools.execute('edit_construction_parts',{record_id:id,expected_revision:1,key:'bak',change_note:'Bakre tvärslå',request_quote:message,mode:'save',
  changes:{instances:{upsert:[{id:'back',definition_id:'cross',placement:at('w','depth - w')}],remove:[]},roles:{upsert:[role('back')],remove:[]}},joint_rules:[rule],form_assign:[]})
 assert.equal(edit.status,'saved',JSON.stringify(edit))
 const draft=await read(id)
 assert.equal(draft.revision,2)
 assert.deepEqual(draft.recipe.instances.find((i:any)=>i.id==='back').placement.y,382)
 assert.equal(draft.joints.length,4,JSON.stringify(draft.joints.map((j:any)=>j.id)))
 assert.deepEqual(draft.form_refinement.mappings[0].instance_ids,['left','right','front','back'])
})

test('a part edit refused for its text stays in the sketch and is checked again at commit; a construction error is not kept',async()=>{
 const message='Lägg till en slå utanför och rätta den.',{tools,material,read}=await setup(message)
 const id=(await tools.execute('save_construction_draft',{...frameSave(message,material),request_quote:message})).receipt.recordId
 // Outside every concept component is a construction error: refused, nothing kept (owner review 2026-11-07).
 const outside=await tools.execute('edit_construction_parts',{record_id:id,expected_revision:1,key:'ute',change_note:'Extra slå',request_quote:message,mode:'save',
  changes:{instances:{upsert:[{id:'extra',definition_id:'cross',placement:at('span')}],remove:[]},roles:{upsert:[role('extra')],remove:[]}},joint_rules:[],form_assign:[]})
 assert.equal(outside.status,'needs_data',JSON.stringify(outside));assert.equal(outside.sketch,undefined,'a construction error is not kept')
 assert.deepEqual(outside.issues.map((i:any)=>i.code),['form_instance_outside'])
 // A text that is not plain prose is a writing error: refused and kept.
 const back={instances:{upsert:[{id:'extra',definition_id:'cross',placement:at('w','depth - w')}],remove:[]},roles:{upsert:[role('extra')],remove:[]}}
 const text=await tools.execute('edit_construction_parts',{record_id:id,expected_revision:1,key:'in',change_note:'Bakre slå',request_quote:message,mode:'save',
  changes:back,joint_rules:[{...rule,reason:'Se save_construction_draft'}],form_assign:[]})
 assert.equal(text.status,'invalid',JSON.stringify(text));assert.equal(text.validation?.code,'human_text')
 assert.equal(text.sketch?.status,'kept',JSON.stringify(text))
 assert.equal((await read(id)).revision,1,'nothing saved')
 const early=await tools.execute('commit_construction_sketch',{record_id:id,new_key:null,action:'commit',key:'c1',change_note:'Spara',request_quote:message})
 assert.equal(early.status,'invalid');assert.equal(early.validation?.code,'human_text','the kept text is checked at commit')
 // Only the correction.
 const fixed=await tools.execute('edit_construction_parts',{record_id:id,expected_revision:1,key:'in2',change_note:'Rätt text',request_quote:message,mode:'sketch',
  changes:{},joint_rules:[rule],form_assign:[]})
 assert.equal(fixed.status,'sketched',JSON.stringify(fixed))
 assert.deepEqual(fixed.rule_joints.map((j:any)=>j.rule),['horn','horn'],'the answer lists the joints code wrote')
 const saved=await tools.execute('commit_construction_sketch',{record_id:id,new_key:null,action:'commit',key:'c2',change_note:'Spara',request_quote:message})
 assert.equal(saved.status,'saved',JSON.stringify(saved))
 const draft=await read(id)
 assert.equal(draft.revision,2);assert.equal(draft.joints.length,4)
})

test('a rule leaves a touching pair named in except unjoined; the check still names that contact',async()=>{
 const message='Ramen där högra sidan ska kunna lyftas av.',{tools,material,read}=await setup(message)
 const saved=await tools.execute('save_construction_draft',{...frameSave(message,material),joint_rules:[{...rule,except:[['right','front']]}]})
 assert.equal(saved.status,'saved',JSON.stringify(saved))
 assert.deepEqual(saved.rule_joints,[{id:ruleJointId('front','left'),parts:['left','front'],rule:'horn'}])
 assert.deepEqual((await read(saved.receipt.recordId)).joints.map((j:any)=>j.id),[ruleJointId('front','left')])
 const check=await tools.execute('check_construction_draft',{artifact_id:saved.receipt.recordId,revision:1})
 assert.ok(check.issues.some((i:any)=>i.code==='contact_without_joint'&&i.ids.includes('right')),'unjoined contact stays visible: '+JSON.stringify(check.issues))
})

test('a refused new save is kept under its key, and a saved construction can be revised whole in a keyed sketch',async()=>{
 const message='Spara ramen, rätta formeln och revidera.',{tools,material,read}=await setup(message)
 const bad=frameSave(message,material) as any;bad.recipe.instances[1].placement.x='span - ghost'
 const refused=await tools.execute('save_construction_draft',bad)
 assert.equal(refused.status,'invalid');assert.equal(refused.issues[0].path,'instances/right/placement/x')
 assert.equal(refused.sketch?.status,'kept_with_issues',JSON.stringify(refused))
 // Only the corrected part, same key.
 const fixed=await tools.execute('save_construction_draft',{...frameSave(message,material),recipe:{...frameSave(message,material).recipe,definitions:[],instances:[{id:'right',definition_id:'rail',placement:at('span - w')}]},
  parameter_plan:{version:1,frames:[],nodes:[decision('w',18,'Virkets tjocklek.')],bindings:[]},materials:[],instance_policy:{version:1,instances:[]},joint_rules:[],mode:'sketch'})
 assert.equal(fixed.status,'sketched',JSON.stringify(fixed))
 const saved=await tools.execute('commit_construction_sketch',{record_id:null,new_key:'ram',action:'commit',key:'ram_c',change_note:'Ramen',request_quote:message})
 assert.equal(saved.status,'saved',JSON.stringify(saved))
 const id=saved.receipt.recordId
 assert.equal((await read(id)).joints.length,2,'the rule from the first call is kept in the sketch')
 // A whole revision of the saved frame, sketched by key (refused live as sketch_existing_construction).
 const revision={...frameSave(message,material),key:'ram2',record_id:id,expected_revision:1,mode:'sketch',description:'Ram med bredare tvärslå',joint_rules:[]}
 const sketched=await tools.execute('save_construction_draft',revision)
 assert.equal(sketched.status,'sketched',JSON.stringify(sketched))
 const committed=await tools.execute('commit_construction_sketch',{record_id:id,new_key:'ram2',action:'commit',key:'ram2_c',change_note:'Ny beskrivning',request_quote:message})
 assert.equal(committed.status,'saved',JSON.stringify(committed))
 const draft=await read(id)
 assert.equal(draft.revision,2);assert.equal(draft.description,'Ram med bredare tvärslå')
})

test('audit round 1, edits: a part placed by formula can be removed; a number where a formula rules is refused; a rule alone joins saved parts',async()=>{
 const message='Lägg till och ta bort en bakre slå.',{tools,material,read}=await setup(message)
 const id=(await tools.execute('save_construction_draft',{...frameSave(message,material),joint_rules:[{...rule,except:[['right','front']]}]})).receipt.recordId
 // A rule alone: the touching pair left out before is joined now (the database refuses an empty change).
 const joined=await tools.execute('edit_construction_parts',{record_id:id,expected_revision:1,key:'join',change_note:'Foga höger',request_quote:message,mode:'save',changes:{},joint_rules:[rule],form_assign:[]})
 assert.equal(joined.status,'saved',JSON.stringify(joined));assert.equal((await read(id)).joints.length,2)
 const added=await tools.execute('edit_construction_parts',{record_id:id,expected_revision:2,key:'bak',change_note:'Bakre slå',request_quote:message,mode:'save',
  changes:{instances:{upsert:[{id:'back',definition_id:'cross',placement:at('w','depth - w')}],remove:[]},roles:{upsert:[role('back')],remove:[]}},joint_rules:[rule],form_assign:[]})
 assert.equal(added.status,'saved',JSON.stringify(added))
 // A number where code computes the field from a node is refused, not silently replaced.
 const clash=await tools.execute('edit_construction_parts',{record_id:id,expected_revision:3,key:'tal',change_note:'Flytta',request_quote:message,mode:'save',
  changes:{instances:{upsert:[{id:'back',definition_id:'cross',placement:at(18,300)}],remove:[]}},joint_rules:[],form_assign:[]})
 assert.equal(clash.status,'invalid',JSON.stringify(clash));assert.deepEqual(clash.issues.map((i:any)=>[i.path,i.computed]),[['instances/back/placement/y',382]])
 // Removing the part: code removes the bindings it wrote for it, its formula nodes and its rule joints.
 const removed=await tools.execute('edit_construction_parts',{record_id:id,expected_revision:3,key:'bort',change_note:'Ta bort bakre slå',request_quote:message,mode:'save',
  changes:{instances:{upsert:[],remove:['back']},roles:{upsert:[],remove:['back']}},joint_rules:[],form_assign:[]})
 assert.equal(removed.status,'saved',JSON.stringify(removed))
 const draft=await read(id)
 assert.equal(draft.revision,4);assert.equal(draft.joints.length,2)
 assert.ok(!draft.parameters.bindings.some((b:any)=>b.path.startsWith('instances/back/')))
 assert.ok(!draft.parameters.nodes.some((n:any)=>n.id.startsWith('fx.')&&!draft.parameters.bindings.some((b:any)=>b.node===n.id)&&!draft.parameters.nodes.some((m:any)=>m.operands?.includes(n.id))))
})

test('audit round 1, keyed sketches keep their construction and base; a refused edit\'s shadow goes when the change saves; the sketch check matches the commit',async()=>{
 const message='Skissa ramar och revidera utan att skriva över.',{tools,material,read}=await setup(message)
 // The sketch check sees code's joints and the completed mapping, as the commit will.
 const sketched=await tools.execute('save_construction_draft',{...frameSave(message,material),mode:'sketch'})
 assert.equal(sketched.status,'sketched',JSON.stringify(sketched))
 assert.deepEqual(sketched.check.issues.filter((i:any)=>['form_instance_unmapped','contact_without_joint','concept_geometry_changed','disconnected_parts'].includes(i.code)),[])
 const a=(await tools.execute('commit_construction_sketch',{record_id:null,new_key:'ram',action:'commit',key:'ram_c',change_note:'Ram A',request_quote:message})).receipt.recordId
 // A new frame B sketched by key; a later call arrives bound to A, as the job binding does.
 await tools.execute('save_construction_draft',{...frameSave(message,material),key:'b',title:'Ram B',mode:'sketch'})
 await tools.execute('save_construction_draft',{...frameSave(message,material),key:'b',title:'Ram B',record_id:a,expected_revision:1,mode:'sketch'})
 const b=await tools.execute('commit_construction_sketch',{record_id:a,new_key:'b',action:'commit',key:'b_c',change_note:'Ram B',request_quote:message})
 assert.equal(b.status,'saved',JSON.stringify(b));assert.notEqual(b.receipt.recordId,a,'B is a new construction')
 assert.equal((await read(a)).title,'Ram');assert.equal((await read(a)).revision,1)
 // A whole revision of A sketched at revision 1; A changes to revision 2; the commit does not overwrite it.
 await tools.execute('save_construction_draft',{...frameSave(message,material),key:'rev',record_id:a,expected_revision:1,description:'Ny text',mode:'sketch'})
 const edit=await tools.execute('edit_construction_parts',{record_id:a,expected_revision:1,key:'bak',change_note:'Bakre slå',request_quote:message,mode:'save',
  changes:{instances:{upsert:[{id:'back',definition_id:'cross',placement:at('w','depth - w')}],remove:[]},roles:{upsert:[role('back')],remove:[]}},joint_rules:[rule],form_assign:[]})
 assert.equal(edit.status,'saved',JSON.stringify(edit))
 await tools.execute('save_construction_draft',{...frameSave(message,material),key:'rev',record_id:a,expected_revision:2,description:'Ny text igen',mode:'sketch'})
 const stale=await tools.execute('commit_construction_sketch',{record_id:a,new_key:'rev',action:'commit',key:'rev_c',change_note:'Revision',request_quote:message})
 assert.notEqual(stale.status,'saved',JSON.stringify(stale))
 assert.equal((await read(a)).revision,2);assert.ok((await read(a)).recipe.instances.some((i:any)=>i.id==='back'),'nothing overwritten')
 // A direct edit refused for its text leaves a shadow sketch; the corrected edit saves and the shadow goes.
 const sketches=async()=>Number((await pg.query('select count(*) n from bob_private.construction_sketches where artifact_id=$1',[a])).rows[0].n)
 const mid={nodes:{upsert:[decision('mid',191,'Mitt i ramen.')],remove:[]},instances:{upsert:[{id:'mid',definition_id:'cross',placement:at('w','mid')}],remove:[]},roles:{upsert:[role('mid')],remove:[]}}
 const refused=await tools.execute('edit_construction_parts',{record_id:a,expected_revision:2,key:'t1',change_note:'Se save_construction_draft',request_quote:message,mode:'save',
  changes:mid,joint_rules:[rule],form_assign:[]})
 assert.equal(refused.validation?.code,'human_text');assert.equal(refused.sketch?.status,'kept',JSON.stringify(refused));assert.equal(await sketches(),1)
 const fixed=await tools.execute('edit_construction_parts',{record_id:a,expected_revision:2,key:'t2',change_note:'Mittslå',request_quote:message,mode:'save',
  changes:mid,joint_rules:[rule],form_assign:[]})
 assert.equal(fixed.status,'saved',JSON.stringify(fixed))
 if(fixed.status==='saved')assert.equal(await sketches(),0,'the shadow of the refused try is gone')
})

test('audit round 2, edits: unknown paths named; hand bindings and saved values accepted; removed parts take their roles and joints; rules join only touched parts',async()=>{
 const message='Mittslå, flytta den och ta bort den.',{tools,material,read}=await setup(message)
 const id=(await tools.execute('save_construction_draft',{...frameSave(message,material),joint_rules:[{...rule,except:[['right','front']]}]})).receipt.recordId
 const mid=(y:unknown)=>({nodes:{upsert:[decision('mid',191,'Mitt i ramen.')],remove:[]},instances:{upsert:[{id:'mid',definition_id:'cross',placement:at('w',y)}],remove:[]},roles:{upsert:[bare('mid')],remove:[]}})
 // A mistyped hand binding is named, not dropped.
 const typo=await tools.execute('edit_construction_parts',{record_id:id,expected_revision:1,key:'typo',change_note:'Mittslå',request_quote:message,mode:'save',
  changes:{...mid('mid'),bindings:{upsert:[{path:'instances/front/placement/Y',node:'mid'}],remove:[]}},joint_rules:[rule],form_assign:[]})
 assert.equal(typo.reason,'binding_path_unknown',JSON.stringify(typo))
 // The rule joins the part this edit adds, not the pair left out with except earlier; quantity_policy may be left out.
 const added=await tools.execute('edit_construction_parts',{record_id:id,expected_revision:1,key:'mid',change_note:'Mittslå',request_quote:message,mode:'save',changes:mid('mid'),joint_rules:[rule],form_assign:[]})
 assert.equal(added.status,'saved',JSON.stringify(added))
 assert.deepEqual(added.rule_joints.map((j:any)=>j.id).sort(),[ruleJointId('left','mid'),ruleJointId('mid','right')].sort())
 assert.ok(!(await read(id)).joints.some((j:any)=>j.id===ruleJointId('front','right')),'except from the save still holds')
 // A hand binding with a placeholder number is the old style and is accepted.
 const hand=await tools.execute('edit_construction_parts',{record_id:id,expected_revision:2,key:'hand',change_note:'Bind för hand',request_quote:message,mode:'save',
  changes:{instances:{upsert:[{id:'mid',definition_id:'cross',placement:at(18,0.5)}],remove:[]},bindings:{upsert:[{path:'instances/mid/placement/y',node:'mid'}],remove:[]}},joint_rules:[],form_assign:[]})
 assert.equal(hand.status,'saved',JSON.stringify(hand))
 // A node changes and the part is sent again with its saved number: kept as it is, computed anew.
 const moved=await tools.execute('edit_construction_parts',{record_id:id,expected_revision:3,key:'flytt',change_note:'Flytta mittslån',request_quote:message,mode:'save',
  changes:{nodes:{upsert:[decision('mid',200,'Flyttad.')],remove:[]},instances:{upsert:[{id:'mid',definition_id:'cross',placement:at(18,191)}],remove:[]}},joint_rules:[],form_assign:[]})
 assert.equal(moved.status,'saved',JSON.stringify(moved));assert.equal((await read(id)).recipe.instances.find((i:any)=>i.id==='mid').placement.y,200)
 assert.deepEqual(moved.recomputed,[{path:'instances/mid/placement/y',written:191,computed:200}],'the answer names the recomputed field')
 // Removing the part leaves its own decision node: refused, since a decided value is not dropped unseen.
 const orphan=await tools.execute('edit_construction_parts',{record_id:id,expected_revision:4,key:'bort0',change_note:'Ta bort',request_quote:message,mode:'save',
  changes:{instances:{upsert:[],remove:['mid']}},joint_rules:[],form_assign:[]})
 assert.equal(orphan.status,'invalid',JSON.stringify(orphan));assert.match(JSON.stringify(orphan),/parameter_unused_node/)
 // With the node removed too: its role and joints go with the part, and the answer says so.
 const gone=await tools.execute('edit_construction_parts',{record_id:id,expected_revision:4,key:'bort',change_note:'Ta bort',request_quote:message,mode:'save',
  changes:{nodes:{upsert:[],remove:['mid']},instances:{upsert:[],remove:['mid']}},joint_rules:[],form_assign:[]})
 assert.equal(gone.status,'saved',JSON.stringify(gone))
 assert.deepEqual(gone.removed_with_parts.roles,['mid'])
 const draft=await read(id);assert.equal(draft.joints.length,1);assert.ok(!draft.instance_policy.instances.some((r:any)=>r.instance_id==='mid'))
 // A rule-only edit joins the pair left out before and says which joint it wrote.
 const join=await tools.execute('edit_construction_parts',{record_id:id,expected_revision:5,key:'foga',change_note:'Foga',request_quote:message,mode:'save',changes:{},joint_rules:[rule],form_assign:[]})
 assert.equal(join.status,'saved',JSON.stringify(join));assert.deepEqual(join.rule_joints.map((j:any)=>j.id),[ruleJointId('front','right')])
})

test('audit round 2, sketches: a refused edit is not merged into open work; a shadow survives unrelated saves; a removed definition takes its rule along',async()=>{
 const message='Skisser utan förlorat arbete.',{tools,material,read}=await setup(message)
 const id=(await tools.execute('save_construction_draft',frameSave(message,material))).receipt.recordId
 const sketched=async()=>(await pg.query('select count(*) n from bob_private.construction_sketches where artifact_id=$1',[id])).rows[0].n
 const mid=(note:string)=>({record_id:id,expected_revision:1,change_note:note,request_quote:message,joint_rules:[rule],form_assign:[],
  changes:{nodes:{upsert:[decision('mid',191,'Mitt i ramen.')],remove:[]},instances:{upsert:[{id:'mid',definition_id:'cross',placement:at('w','mid')}],remove:[]},roles:{upsert:[bare('mid')],remove:[]}}})
 // Refused for its text with no sketch open: kept as a shadow. An unrelated saved edit leaves it, and says so.
 const refused=await tools.execute('edit_construction_parts',{...mid('Se save_construction_draft'),key:'s1',mode:'save'})
 assert.equal(refused.sketch?.status,'kept',JSON.stringify(refused))
 const other=await tools.execute('edit_construction_parts',{record_id:id,expected_revision:1,key:'roll',change_note:'Ny roll',request_quote:message,mode:'save',
  changes:{roles:{upsert:[{instance_id:'left',role:'build_part',reason:'Sidoslå'}],remove:[]}},joint_rules:[],form_assign:[]})
 assert.equal(other.status,'saved',JSON.stringify(other));assert.equal(other.open_sketch?.status,'kept',JSON.stringify(other));assert.equal(Number(await sketched()),1)
 await tools.execute('commit_construction_sketch',{record_id:id,new_key:null,action:'discard',key:null,change_note:null,request_quote:message})
 // With ordinary sketch work open, a refused direct edit is not merged into it.
 const work=await tools.execute('edit_construction_parts',{...mid('Mittslå'),expected_revision:2,key:'w1',mode:'sketch'})
 assert.equal(work.status,'sketched',JSON.stringify(work))
 const direct=await tools.execute('edit_construction_parts',{record_id:id,expected_revision:2,key:'d1',change_note:'Se save_construction_draft',request_quote:message,mode:'save',
  changes:{roles:{upsert:[{instance_id:'left',role:'build_part',reason:'Igen'}],remove:[]}},joint_rules:[],form_assign:[]})
 assert.equal(direct.validation?.code,'human_text');assert.equal(direct.sketch,undefined,'not merged into open work')
 // A sketch call adding a definition with a rule, then one removing it: the rule goes too, the commit saves.
 const pin={definitions:{upsert:[{id:'pin',primitive:'box',material_ref:null,x_mm:'w',y_mm:'w',z_mm:'w'}],remove:[]},materials:{upsert:[{definition_id:'pin',material_id:material,material_revision:1,part_id:null,part_revision:null}],remove:[]}}
 const withPin=await tools.execute('edit_construction_parts',{record_id:id,expected_revision:2,key:'w2',change_note:'Tapp',request_quote:message,mode:'sketch',changes:pin,joint_rules:[{...rule,id:'tapp',between:['rail','pin']}],form_assign:[]})
 assert.equal(withPin.status,'sketched',JSON.stringify(withPin))
 const noPin=await tools.execute('edit_construction_parts',{record_id:id,expected_revision:2,key:'w3',change_note:'Ingen tapp',request_quote:message,mode:'sketch',
  changes:{definitions:{upsert:[],remove:['pin']},materials:{upsert:[],remove:['pin']}},joint_rules:[],form_assign:[]})
 assert.equal(noPin.status,'sketched',JSON.stringify(noPin))
 const saved=await tools.execute('commit_construction_sketch',{record_id:id,new_key:null,action:'commit',key:'w_c',change_note:'Mittslå',request_quote:message})
 assert.equal(saved.status,'saved',JSON.stringify(saved));assert.equal((await read(id)).recipe.instances.length,4)
})

test('audit round 2, saves: an unknown binding path is named; a repeat takes one role by its id',async()=>{
 const message='Ram med spjälor.',{tools,material,read}=await setup(message,{constructionRepeats:true,repeatStart:true})
 const base=frameSave(message,material) as any
 const typo={...base,recipe:{...base.recipe,arrays:[]},parameter_plan:{...base.parameter_plan,bindings:[{path:'instances/front/placment/z',node:'w'}]}}
 const refused=await tools.execute('save_construction_draft',typo)
 assert.equal(refused.reason,'binding_path_unknown',JSON.stringify(refused))
 // Rails, and three slats as one repeat with one role entry.
 const slats={...base,recipe:{...base.recipe,instances:base.recipe.instances.filter((i:any)=>i.id!=='front'),
  arrays:[{id:'slat',definition_id:'cross',axis:'y',count:3,start:{x:'w',y:0,z:0},spacing_mm:'mid'}]},
  parameter_plan:{...base.parameter_plan,nodes:[...base.parameter_plan.nodes,decision('mid',191,'Spjälavstånd.')]},
  instance_policy:{version:1,instances:[bare('left'),bare('right'),bare('slat')]}}
 const saved=await tools.execute('save_construction_draft',slats)
 assert.equal(saved.status,'saved',JSON.stringify(saved))
 const draft=await read(saved.receipt.recordId)
 assert.deepEqual(draft.instance_policy.instances.map((r:any)=>[r.instance_id,r.quantity_policy]),[['left','manufacture'],['right','manufacture'],['slat.1','manufacture'],['slat.2','manufacture'],['slat.3','manufacture']])
 assert.equal(draft.joints.length,6)
})

test('audit round 3, edits: a kept rule-only change survives an unrelated save; a second refused try replaces the first; a construction error is not kept behind a rule error; rules reach parts a node moves',async()=>{
 const message='Ram, regler och flyttade delar.',{tools:t,material}=await setup(message)
 const id=(await t.execute('save_construction_draft',frameSave(message,material))).receipt.recordId
 const edit=(over:Record<string,unknown>)=>t.execute('edit_construction_parts',{record_id:id,expected_revision:1,request_quote:message,mode:'save',changes:{},joint_rules:[],form_assign:[],...over})
 const sketchRead=()=>t.execute('commit_construction_sketch',{record_id:id,new_key:null,action:'read',key:null,change_note:null,request_quote:message})
 const discard=()=>t.execute('commit_construction_sketch',{record_id:id,new_key:null,action:'discard',key:null,change_note:null,request_quote:message})
 // A rule-only change refused for its text is kept; an unrelated saved edit leaves it open.
 const ruleOnly=await edit({key:'r1',change_note:'Se save_construction_draft',joint_rules:[{...rule,id:'horn2',reason:'Limmas.'}]})
 assert.equal(ruleOnly.sketch?.status,'kept',JSON.stringify(ruleOnly))
 const other=await edit({key:'r2',change_note:'Ny roll',changes:{roles:{upsert:[{instance_id:'left',role:'build_part',reason:'Sidoslå'}],remove:[]}}})
 assert.equal(other.status,'saved',JSON.stringify(other));assert.equal(other.open_sketch?.status,'kept','the kept rules are not dropped')
 await discard()
 // Two refused direct tries: the second replaces the first in the kept sketch.
 const add=(part:string,key:string)=>edit({key,expected_revision:2,change_note:'Se save_construction_draft',
  changes:{nodes:{upsert:[decision('ay',100,'Ny spjäla.')],remove:[]},instances:{upsert:[{id:part,definition_id:'cross',placement:at('w','ay')}],remove:[]},roles:{upsert:[bare(part)],remove:[]}}})
 {const r1=await add('a1','t1');assert.equal(r1.sketch?.status,'kept',JSON.stringify(r1))};assert.equal((await add('a2','t2')).sketch?.status,'kept')
 const held=await sketchRead()
 assert.deepEqual(held.changes.instances.upsert.map((i:any)=>i.id),['a2'],JSON.stringify(held))
 await discard()
 // A part outside every concept component with a rule naming a missing definition: the construction error is the answer, and nothing is kept.
 const outside=await edit({key:'o1',expected_revision:2,change_note:'Utanför',joint_rules:[{...rule,id:'ghost',between:['rail','ghost']}],
  changes:{nodes:{upsert:[decision('farx',5000,'Långt bort.')],remove:[]},instances:{upsert:[{id:'far',definition_id:'cross',placement:at('farx')}],remove:[]},roles:{upsert:[bare('far')],remove:[]}}})
 assert.equal(outside.reason,'form_mapping_incomplete',JSON.stringify(outside));assert.equal(outside.sketch,undefined,'not kept')
 // A part added without a rule, then moved by its node: the rule sent with the node change joins it.
 const pad=await edit({key:'p1',expected_revision:2,change_note:'Lös spjäla',
  changes:{nodes:{upsert:[decision('pady',200,'Spjälans läge.')],remove:[]},instances:{upsert:[{id:'pad',definition_id:'cross',placement:at('w','pady')}],remove:[]},roles:{upsert:[bare('pad')],remove:[]}}})
 assert.equal(pad.status,'saved',JSON.stringify(pad));assert.equal(pad.rule_joints,undefined)
 const moved=await edit({key:'p2',expected_revision:3,change_note:'Flytta spjälan',joint_rules:[rule],changes:{nodes:{upsert:[decision('pady',300,'Spjälan flyttas.')],remove:[]}}})
 assert.equal(moved.status,'saved',JSON.stringify(moved))
 assert.deepEqual(moved.rule_joints.map((j:any)=>j.id).sort(),[ruleJointId('left','pad'),ruleJointId('pad','right')].sort())
})

test('audit round 3, keyed sketches: a repeat role reaches the sketch check; a refused save is not merged into open work; a sketch of one construction is not saved onto another',async()=>{
 const message='Spjälor och nycklar.',{tools,material,read}=await setup(message,{constructionRepeats:true,repeatStart:true})
 const plain=frameSave(message,material) as any,base={...plain,recipe:{...plain.recipe,arrays:[]}}
 const slats={...base,key:'spj',mode:'sketch',recipe:{...base.recipe,instances:base.recipe.instances.filter((i:any)=>i.id!=='front'),
  arrays:[{id:'slat',definition_id:'cross',axis:'y',count:3,start:{x:'w',y:0,z:0},spacing_mm:'mid'}]},
  parameter_plan:{...base.parameter_plan,nodes:[...base.parameter_plan.nodes,decision('mid',191,'Spjälavstånd.')]},
  instance_policy:{version:1,instances:[bare('left'),bare('right'),bare('slat')]}}
 const sketched=await tools.execute('save_construction_draft',slats)
 assert.equal(sketched.status,'sketched',JSON.stringify(sketched))
 assert.ok(!JSON.stringify(sketched.check).includes('invalid_instance_policy'),JSON.stringify(sketched.check))
 // A direct save under the same key refused for its text: refused, the sketch untouched.
 const direct=await tools.execute('save_construction_draft',{...base,key:'spj',title:'Annan ram',description:'Se save_construction_draft'})
 assert.equal(direct.validation?.code,'human_text',JSON.stringify(direct));assert.equal(direct.sketch,undefined)
 const kept=await tools.execute('commit_construction_sketch',{record_id:null,new_key:'spj',action:'read',key:null,change_note:null,request_quote:message})
 assert.equal(kept.save.title,'Ram')
 // Two saved frames; a whole revision of A sketched under a key cannot continue or be saved as B.
 const a=(await tools.execute('save_construction_draft',{...base,key:'a'})).receipt.recordId
 const b=(await tools.execute('save_construction_draft',{...base,key:'b'})).receipt.recordId
 const revise=(record:string)=>tools.execute('save_construction_draft',{...base,key:'wall',record_id:record,expected_revision:1,mode:'sketch',title:'Ram A'})
 assert.equal((await revise(a)).status,'sketched')
 assert.equal((await revise(b)).reason,'operation_scope_changed')
 const commit=await tools.execute('commit_construction_sketch',{record_id:b,new_key:'wall',action:'commit',key:'wall_c',change_note:'Ram',request_quote:message})
 assert.equal(commit.reason,'operation_scope_changed',JSON.stringify(commit))
 assert.equal((await read(a)).revision,1);assert.equal((await read(b)).revision,1)
})

test('audit round 4: the fence holds for unbound jobs; superseded tries go; removed code joints and empty rules are named; a save keeps no construction error behind a rule error',async()=>{
 const message='Runda fyra.',{tools:t,material,read}=await setup(message)
 const base=frameSave(message,material) as any
 const id=(await t.execute('save_construction_draft',base)).receipt.recordId
 const edit=(over:Record<string,unknown>)=>t.execute('edit_construction_parts',{record_id:id,expected_revision:1,request_quote:message,mode:'save',changes:{},joint_rules:[],form_assign:[],...over})
 // A rule restated with a pair in except: code's joint goes, and the answer names it.
 const unjoin=await edit({key:'u1',change_note:'Lös höger',joint_rules:[{...rule,except:[['front','right']]}]})
 assert.equal(unjoin.status,'saved',JSON.stringify(unjoin));assert.deepEqual(unjoin.code_joints_removed,[ruleJointId('front','right')])
 // The same rules again write nothing: refused with a reason, not an unexplained database refusal.
 const nothing=await edit({key:'u2',expected_revision:2,change_note:'Igen',joint_rules:[{...rule,except:[['front','right']]}]})
 assert.equal(nothing.reason,'rules_wrote_nothing',JSON.stringify(nothing))
 // A second refused try that cannot be kept discards the first.
 const add=(part:string,y:number,key:string)=>edit({key,expected_revision:2,change_note:'Se save_construction_draft',
  changes:{nodes:{upsert:[decision('py',y,'Läge.')],remove:[]},instances:{upsert:[{id:part,definition_id:'cross',placement:at('w','py')}],remove:[]},roles:{upsert:[bare(part)],remove:[]}}})
 assert.equal((await add('a1',300,'t1')).sketch?.status,'kept')
 const second=await edit({key:'t2',expected_revision:2,change_note:'Se save_construction_draft',
  changes:{nodes:{upsert:[decision('fx_far',5000,'Långt bort.')],remove:[]},instances:{upsert:[{id:'a2',definition_id:'cross',placement:at('fx_far')}],remove:[]},roles:{upsert:[bare('a2')],remove:[]}}})
 assert.equal(second.sketch,undefined,JSON.stringify(second));assert.equal(second.earlier_try?.status,'discarded',JSON.stringify(second))
 assert.equal((await t.execute('commit_construction_sketch',{record_id:id,new_key:null,action:'read',key:null,change_note:null,request_quote:message})).status,'not_found')
 // A whole revision sketched under a key: a job bound to no construction cannot continue or commit it.
 const revise=(record:string|null)=>t.execute('save_construction_draft',{...base,key:'wall',record_id:record,expected_revision:record?2:0,mode:'sketch',title:'Ram A'})
 assert.equal((await revise(id)).status,'sketched')
 assert.equal((await revise(null)).reason,'operation_scope_changed')
 const commit=await t.execute('commit_construction_sketch',{record_id:null,new_key:'wall',action:'commit',key:'wall_c',change_note:'Ram',request_quote:message})
 assert.equal(commit.reason,'operation_scope_changed',JSON.stringify(commit));assert.equal((await read(id)).revision,2)
 // A new save with a rule naming a missing definition and a part outside the concept: the construction error is the answer, nothing kept.
 const far={...base,key:'far',recipe:{...base.recipe,instances:[...base.recipe.instances,{id:'far',definition_id:'cross',placement:at('farx')}]},
  parameter_plan:{...base.parameter_plan,nodes:[...base.parameter_plan.nodes,decision('farx',5000,'Långt bort.')]},
  instance_policy:{version:1,instances:[...base.instance_policy.instances,bare('far')]},joint_rules:[rule,{...rule,id:'ghost',between:['rail','ghost']}]}
 const refused=await t.execute('save_construction_draft',far)
 assert.equal(refused.status,'needs_data',JSON.stringify(refused));assert.equal(refused.sketch,undefined)
})

test('deep audit: an edit the database refuses for the concept names the component, the part outside it and the numbers',async()=>{
 const message='Flytta högra sidan.',{tools:t,material}=await setup(message)
 const id=(await t.execute('save_construction_draft',frameSave(message,material))).receipt.recordId
 const moved=await t.execute('edit_construction_parts',{record_id:id,expected_revision:1,key:'ut',change_note:'Flytta ut',request_quote:message,mode:'save',joint_rules:[],form_assign:[],
  changes:{nodes:{upsert:[decision('ten',10,'Tio millimeter ut.')],remove:[]},instances:{upsert:[{id:'right',definition_id:'rail',placement:at('span - w + ten')}],remove:[]}}})
 assert.equal(moved.reason,'concept_geometry_changed',JSON.stringify(moved))
 const issue=moved.issues?.find((i:any)=>i.code==='concept_geometry_changed')
 assert.ok(issue&&issue.ids[0]==='frame'&&issue.ids.includes('right'),JSON.stringify(moved.issues))
 assert.match(issue.message,/x 0\.\.600/);assert.match(issue.message,/x 0\.\.610/)
})

test('stored joint rules (owner decision 2026-11-08): a save stores its rules, reads show them, a later part edit applies them without resending, a changed rule is stored',async()=>{
 const message='Ram med sparade regler.',{tools:t,material,read}=await setup(message,{storedJointRules:true})
 const saved=await t.execute('save_construction_draft',frameSave(message,material))
 assert.equal(saved.status,'saved',JSON.stringify(saved))
 const id=saved.receipt.recordId
 assert.deepEqual((await read(id)).joint_rules.map((r:any)=>r.id),['horn'])
 // A part added with no rule sent: the stored rule joins it.
 const back=await t.execute('edit_construction_parts',{record_id:id,expected_revision:1,key:'bak',change_note:'Bakre slå',request_quote:message,mode:'save',joint_rules:[],form_assign:[],
  changes:{nodes:{upsert:[decision('by',382,'Bakre slån.')],remove:[]},instances:{upsert:[{id:'back',definition_id:'cross',placement:at('w','by')}],remove:[]},roles:{upsert:[bare('back')],remove:[]}}})
 assert.equal(back.status,'saved',JSON.stringify(back))
 assert.deepEqual(back.rule_joints.map((j:any)=>j.id).sort(),[ruleJointId('back','left'),ruleJointId('back','right')].sort())
 const r2=await read(id);assert.equal(r2.revision,2);assert.deepEqual(r2.joint_rules.map((r:any)=>r.reason),[rule.reason],'unchanged rules are inherited')
 // A rule sent again with another reason replaces the stored one for the new revision.
 const glued={...rule,reason:'Tvärslån limmas.'}
 const mid=await t.execute('edit_construction_parts',{record_id:id,expected_revision:2,key:'mitt',change_note:'Mittslå',request_quote:message,mode:'save',joint_rules:[glued],form_assign:[],
  changes:{nodes:{upsert:[decision('my',191,'Mittslån.')],remove:[]},instances:{upsert:[{id:'mid',definition_id:'cross',placement:at('w','my')}],remove:[]},roles:{upsert:[bare('mid')],remove:[]}}})
 assert.equal(mid.status,'saved',JSON.stringify(mid))
 const r3=await read(id);assert.deepEqual(r3.joint_rules.map((r:any)=>r.reason),['Tvärslån limmas.'])
 assert.equal(r3.joints.find((j:any)=>j.id===ruleJointId('left','mid')).reason,'Tvärslån limmas.')
 // A rule with a new id for the same definition pair replaces the stored one, not ambiguous.
 const screwed={...rule,id:'skruv',reason:'Tvärslån skruvas.'}
 const third=await t.execute('edit_construction_parts',{record_id:id,expected_revision:3,key:'tredje',change_note:'Tredje slå',request_quote:message,mode:'save',joint_rules:[screwed],form_assign:[],
  changes:{nodes:{upsert:[decision('ty',100,'Tredje slån.')],remove:[]},instances:{upsert:[{id:'third',definition_id:'cross',placement:at('w','ty')}],remove:[]},roles:{upsert:[bare('third')],remove:[]}}})
 assert.equal(third.status,'saved',JSON.stringify(third))
 assert.deepEqual((await read(id)).joint_rules.map((r:any)=>r.id),['skruv'])
})

test('Entrén 2026-11-08: after Bob changes the selected Solution, a part edit maps its parts in the new concept and moves the construction to it',async()=>{
 const message='Bredda ramen till 620.',{tools,material,read,project,solution}=await setup(message,{coherentWork:true,constructionViews:true})
 const id=(await tools.execute('save_construction_draft',frameSave(message,material))).receipt.recordId
 const first=await read(id)
 // Bob widens the frame in the Solution and selects that revision.
 const {intent}=constructionFormFixture()
 intent.model.nodes.find((n:any)=>n.id==='frame_s0')!.value=620
 await call(owner,'bob.solution_command',[project,'revise',solution,1,{title:'Ram',description:'Syntetisk',assumptions:'Ej mätt',tradeoffs:'Ej godkänd',measurements:[],design_intent:intent,change_note:'Bredare ram'}])
 const target=await call(owner,'bob.solution_command',[project,'select',solution,first.target_revision,{solution_revision:2,reason:'Bredare ram'}])
 assert.equal((await read(id)).source_state,'changed')
 // Live this came back as "Could not read the concept" seven times: the
 // concept was read at the old pin, which the database refuses once moved.
 const edit=await tools.execute('edit_construction_parts',{record_id:id,expected_revision:1,key:'bredd',change_note:'Ramen följer den bredare lösningen',request_quote:message,mode:'save',joint_rules:[],form_assign:[],
  changes:{nodes:{upsert:[decision('span',620,'Ramens bredd enligt den valda lösningen.')],remove:[]}}})
 assert.equal(edit.status,'saved',JSON.stringify(edit))
 const draft=await read(id)
 assert.equal(draft.revision,2);assert.equal(draft.target_revision,target.revision);assert.equal(draft.source_state,'current')
 assert.deepEqual(draft.recipe.instances.find((i:any)=>i.id==='right').placement.x,602)
 assert.deepEqual(draft.form_refinement.mappings,[{component_id:'frame',instance_ids:['left','right','front']}])
})
