// Fastener schedule on construction joints (owner decisions 2026-10-26):
// fixed rules from geometry, one glue package per construction, optional
// Bob override (for example nails). Concept proposal, not a strength check.
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {readFile} from 'node:fs/promises'
import {projectSchema,asProjectUser} from './support/project-schema.ts'
import {intrinsicAxes} from '../supabase/functions/_shared/cad-frames.ts'

const box=(id:string,x:number,y:number,z:number)=>({id,primitive:'box',material_ref:null,x_mm:x,y_mm:y,z_mm:z})
const at=(id:string,definition_id:string,x=0,y=0,z=0,rx=0,ry=0,rz=0)=>({id,definition_id,placement:{x,y,z,rx,ry,rz}})
const joint=(id:string,method:string,first:[string,string],second:[string,string],extra:Record<string,unknown>={})=>
 ({id,method,first:{instance_id:first[0],face:first[1]},second:{instance_id:second[0],face:second[1]},reason:'Fixture joint',...extra})

async function schedule(pg:any,recipe:unknown,joints:unknown){
 return (await pg.query('select bob_private.construction_fastener_schedule($1::jsonb,$2::jsonb) s',[JSON.stringify(recipe),JSON.stringify(joints)])).rows[0].s
}

test('screws follow the thickness, length and spacing rules; glue is one package; other methods have no rule',async t=>{
 const pg=await projectSchema();t.after(()=>pg.close())
 const recipe={definitions:[box('post',45,45,1000),box('rail',800,45,95),box('gable',18,300,800),box('shelf',564,300,18),box('thick',90,90,500)],
  instances:[at('p','post'),at('r','rail',45,0,200),at('g','gable',0,1000),at('s','shelf',18,1000,400),at('t','thick',0,2000),at('u','rail',90,2000,0)]}
 const s=await schedule(pg,recipe,[
  joint('post_rail','screwed_butt',['p','x_max'],['r','x_min']),
  joint('gable_shelf','screwed_butt',['g','x_max'],['s','x_min']),
  joint('glued','glued_butt',['g','x_max'],['s','x_min']),
  joint('thick','screwed_butt',['t','x_max'],['u','x_min']),
  joint('dowel','dowel',['p','x_max'],['r','x_min']),
 ])
 const by=Object.fromEntries(s.joints.map((j:any)=>[j.joint_id,j]))
 assert.equal(s.rule_version,'fastener-rules-v1')
 // 45 mm post screwed into the rail end: d 5.0, L >= 112.5 -> 120; contact 95 mm, e 25 -> 2 screws 45 mm apart.
 assert.deepEqual({...by.post_rail,gaps:undefined},{...by.post_rail,gaps:undefined,source:'rule',kind:'screw',diameter_mm:5.0,length_mm:120,count:2,spacing_mm:45,
  through_instance_id:'p',through_mm:45,embed_mm:800,contact_length_mm:95,contact_width_mm:45,proposal:null})
 assert.deepEqual(by.post_rail.gaps,[])
 // 18 mm gable into an 18 mm shelf edge: d 4.0, L 45, 300 mm contact -> 3 screws, narrow edge flagged.
 assert.equal(by.gable_shelf.diameter_mm,4.0);assert.equal(by.gable_shelf.length_mm,45)
 assert.equal(by.gable_shelf.count,3);assert.equal(by.gable_shelf.spacing_mm,130)
 assert.deepEqual(by.gable_shelf.gaps,['narrow_contact'])
 assert.equal(by.glued.kind,'glue');assert.equal(by.glued.count,null)
 assert.equal(by.thick.kind,'screw');assert.equal(by.thick.diameter_mm,null);assert.deepEqual(by.thick.gaps,['thickness_outside_rule','count_unknown'])
 assert.equal(by.dowel.source,'no_rule');assert.deepEqual(by.dowel.gaps,['no_rule_for_method'])
 assert.equal(s.glue_packages,1)
 assert.equal(s.complete,false)
 assert.deepEqual(s.totals.map((r:any)=>[r.kind,r.diameter_mm,r.length_mm,r.count]),[['screw',4.0,45,3],['screw',5.0,120,2]])
})

test('a Bob override replaces the rule, keeps the rule proposal visible and spreads a missing count',async t=>{
 const pg=await projectSchema();t.after(()=>pg.close())
 const recipe={definitions:[box('gable',18,300,800),box('shelf',564,300,18)],instances:[at('g','gable'),at('s','shelf',18,0,400)]}
 const nail={kind:'nail',diameter_mm:2.8,length_mm:50,count:null,spacing_mm:null,reason:'Owner prefers nails'}
 const s=await schedule(pg,recipe,[joint('j','screwed_butt',['g','x_max'],['s','x_min'],{fastener:nail})])
 const j=s.joints[0]
 assert.equal(j.source,'override');assert.equal(j.kind,'nail');assert.equal(j.diameter_mm,2.8);assert.equal(j.length_mm,50)
 // e = max(15, 14) = 15 -> (300 - 30) / 150 -> 3 nails, 135 mm apart.
 assert.equal(j.count,3);assert.equal(j.spacing_mm,135)
 assert.deepEqual(j.proposal,{kind:'screw',diameter_mm:4.0,length_mm:45,count:3,spacing_mm:130})
 assert.deepEqual(s.totals.map((r:any)=>[r.kind,r.diameter_mm,r.length_mm,r.count]),[['nail',2.8,50,3]])
 const none=await schedule(pg,recipe,[joint('j','screwed_butt',['g','x_max'],['s','x_min'],{fastener:{kind:'none',diameter_mm:null,length_mm:null,count:null,spacing_mm:null,reason:'Loose fit'}})])
 assert.equal(none.joints[0].kind,'none');assert.deepEqual(none.totals,[]);assert.equal(none.complete,true)
 const unset=await schedule(pg,recipe,[joint('j','screwed_butt',['g','x_max'],['s','x_min'],{fastener:null})])
 assert.equal(unset.joints[0].source,'rule')
})

test('two existing parts get no new fastener unless Bob chooses one; new-to-existing keeps the rule',async t=>{
 const pg=await projectSchema();t.after(()=>pg.close())
 // An already built wall corner, plus a new 45 mm cleat screwed to one of the walls.
 const recipe={definitions:[box('wall',95,1000,2400),box('wall2',1000,95,2400),box('cleat',45,300,45)],
  instances:[at('w1','wall'),at('w2','wall2',95,0),at('s','cleat',95,200,1200)]}
 const role=(instance_id:string,r:string)=>({instance_id,role:r,quantity_policy:r==='existing_part'?'retain':'manufacture',reason:'Fixture'})
 const policy={version:1,instances:[role('w1','existing_part'),role('w2','existing_part'),role('s','build_part')]}
 const joints=[joint('walls','screwed_butt',['w1','x_max'],['w2','x_min']),joint('shelf','screwed_butt',['w1','x_max'],['s','x_min']),
  joint('walls_glued','glued_butt',['w1','x_max'],['w2','x_min'])]
 const run=async(js:unknown,p:unknown)=>(await pg.query('select bob_private.construction_fastener_schedule($1::jsonb,$2::jsonb,$3::jsonb) s',[JSON.stringify(recipe),JSON.stringify(js),JSON.stringify(p)])).rows[0].s
 const s=await run(joints,policy)
 const by=Object.fromEntries(s.joints.map((j:any)=>[j.joint_id,j]))
 assert.equal(by.walls.source,'existing');assert.equal(by.walls.kind,null);assert.equal(by.walls.count,null);assert.deepEqual(by.walls.gaps,[])
 assert.equal(by.walls_glued.source,'existing');assert.equal(s.glue_packages,0)
 assert.equal(by.shelf.source,'rule');assert.equal(by.shelf.kind,'screw');assert.equal(by.shelf.length_mm,120);assert.equal(by.shelf.count,3)
 assert.deepEqual(s.totals.map((r:any)=>r.joint_ids),[['shelf']])
 assert.equal(s.complete,true)
 // Bob's explicit choice still applies between existing parts.
 const bolt={kind:'bolt',diameter_mm:10,length_mm:180,count:2,spacing_mm:null,reason:'Tie the two walls'}
 const chosen=await run([joint('walls','screwed_butt',['w1','x_max'],['w2','x_min'],{fastener:bolt})],policy)
 assert.equal(chosen.joints[0].source,'override');assert.deepEqual(chosen.totals.map((r:any)=>[r.kind,r.count]),[['bolt',2]])
 // Without a policy (or with unknown roles) the rule applies as before.
 assert.equal((await run(joints,null)).joints[0].source,'rule')
 assert.equal((await run(joints,{version:1,instances:[role('w1','existing_part'),{...role('w2','unknown'),quantity_policy:'unknown'}]})).joints[0].source,'rule')
})

// Independent world boxes from the shared CAD frame convention.
function worldBoxes(recipe:any){
 const defs=new Map(recipe.definitions.map((d:any)=>[d.id,d])),out=new Map<string,{min:number[];max:number[]}>()
 for(const i of recipe.instances){
  const d:any=defs.get(i.definition_id),p=i.placement,basis=intrinsicAxes([p.rx,p.ry,p.rz]).map(v=>v.map(Math.round))
  const min=[p.x,p.y,p.z],max=[p.x,p.y,p.z],dims=[d.x_mm,d.y_mm,d.z_mm]
  for(let l=0;l<3;l++){const w=basis[l].findIndex(v=>Math.abs(v)===1),s=basis[l][w];min[w]+=Math.min(0,s*dims[l]);max[w]+=Math.max(0,s*dims[l])}
  out.set(i.id,{min,max})
 }
 return out
}

// The K2 checker's own face convention (construction-checks.ts), reproduced here.
function faceOf(recipe:any,instance:string,face:string){
 const i=recipe.instances.find((x:any)=>x.id===instance),d=recipe.definitions.find((x:any)=>x.id===i.definition_id),p=i.placement
 const basis=intrinsicAxes([p.rx,p.ry,p.rz]).map(v=>v.map(Math.round)),origin=[p.x,p.y,p.z],dims=[d.x_mm,d.y_mm,d.z_mm]
 const local=['x','y','z'].indexOf(face[0]),w=basis[local].findIndex(v=>Math.abs(v)===1),sign=basis[local][w]
 return face.endsWith('_min')?{axis:w,sign:-sign,plane:origin[w]}:{axis:w,sign,plane:origin[w]+sign*dims[local]}
}

test('rotated parts meet exactly where the K2 checker says they do',async t=>{
 const pg=await projectSchema();t.after(()=>pg.close())
 const rotations=[[0,0,0],[0,0,90],[0,0,180],[0,0,270],[90,0,0],[0,90,0],[0,270,0],[90,90,0],[90,0,90],[270,90,180]]
 const faces=['x_min','x_max','y_min','y_max','z_min','z_max']
 let met=0
 for(const [rx,ry,rz] of rotations)for(const [x,y,z] of [[45,0,300],[45,200,200],[0,45,100],[45,45,500]]){
  const recipe={definitions:[box('post',45,45,1000),box('rail',600,45,95)],instances:[at('p','post'),at('q','rail',x,y,z,rx,ry,rz)]}
  const boxes=worldBoxes(recipe),post=boxes.get('p')!,rail=boxes.get('q')!
  const joints=faces.flatMap(pf=>faces.map(qf=>joint(pf+'-'+qf,'screwed_butt',['p',pf],['q',qf])))
  const s=await schedule(pg,recipe,joints)
  for(const j of s.joints){
   const [pf,qf]=j.joint_id.split('-'),fa=faceOf(recipe,'p',pf),fb=faceOf(recipe,'q',qf)
   const fits=fa.axis===fb.axis&&fa.sign===-fb.sign&&Math.abs(fa.plane-fb.plane)<=1e-6
    &&[0,1,2].every(k=>k===fa.axis||Math.min(post.max[k],rail.max[k])-Math.max(post.min[k],rail.min[k])>1e-6)
   assert.equal(!j.gaps.includes('faces_do_not_meet'),fits,JSON.stringify({rx,ry,rz,x,y,z,id:j.joint_id}))
   if(fits){
    met++
    const ov=[0,1,2].filter(k=>k!==fa.axis).map(k=>Math.min(post.max[k],rail.max[k])-Math.max(post.min[k],rail.min[k]))
    assert.equal(j.contact_length_mm,Math.max(...ov));assert.equal(j.contact_width_mm,Math.min(...ov))
    assert.equal(j.through_mm+j.embed_mm,(post.max[fa.axis]-post.min[fa.axis])+(rail.max[fa.axis]-rail.min[fa.axis]))
   }
  }
 }
 assert(met>=12,`enough rotated contacts were exercised (${met})`)
})

test('the saved bunk bed gets a complete schedule whose contacts match the TS frame',async t=>{
 const pg=await projectSchema();t.after(()=>pg.close())
 const fixture=JSON.parse(await readFile(new URL('./fixtures/barnrum-bunk-bed-construction.json',import.meta.url),'utf8'))
 const s=await schedule(pg,fixture.recipe,fixture.joints)
 assert.equal(s.joints.length,36)
 const boxes=worldBoxes(fixture.recipe)
 for(const j of s.joints){
  const source=fixture.joints.find((x:any)=>x.id===j.joint_id)
  assert(!j.gaps.includes('faces_do_not_meet'),j.joint_id)
  const a=boxes.get(source.first.instance_id)!,b=boxes.get(source.second.instance_id)!
  const ov=[0,1,2].map(k=>Math.min(a.max[k],b.max[k])-Math.max(a.min[k],b.min[k]))
  const normal=ov.findIndex(v=>Math.abs(v)<1e-6)
  const rest=ov.filter((_,k)=>k!==normal)
  assert.equal(j.contact_length_mm,Math.max(...rest),j.joint_id)
  if(j.kind==='screw'&&j.diameter_mm!==null)assert(j.count>=1&&j.length_mm>j.through_mm,j.joint_id)
 }
 assert.equal(s.glue_packages,s.joints.some((j:any)=>j.method==='glued_butt')?1:0)
 assert.equal(s.totals.reduce((n:number,r:any)=>n+r.count,0),s.joints.filter((j:any)=>j.kind==='screw').reduce((n:number,j:any)=>n+(j.count??0),0))
})

test('check_construction accepts 5- and 6-key joints and rejects an invalid fastener',async t=>{
 const pg=await projectSchema();t.after(()=>pg.close())
 const valid=(f:unknown)=>pg.query('select bob_private.valid_joint_fastener($1::jsonb) v',[JSON.stringify(f)]).then((r:any)=>r.rows[0].v)
 const base={kind:'screw',diameter_mm:4,length_mm:45,count:null,spacing_mm:null,reason:'Chosen'}
 assert.equal(await valid(base),true)
 assert.equal(await valid({...base,kind:'nail',count:6,spacing_mm:100}),true)
 assert.equal(await valid({kind:'glue',diameter_mm:null,length_mm:null,count:null,spacing_mm:null,reason:'Glued'}),true)
 for(const bad of [{...base,kind:'staple'},{...base,diameter_mm:null},{...base,count:2.5},{...base,count:0},{...base,reason:''},
  {kind:'glue',diameter_mm:4,length_mm:null,count:null,spacing_mm:null,reason:'x'},{...base,extra:1},(({reason,...r})=>r)(base)])
  assert.equal(await valid(bad),false,JSON.stringify(bad))
 const definition=(await pg.query(`select pg_get_functiondef('bob_private.check_construction(text,uuid,jsonb,jsonb,jsonb,jsonb)'::regprocedure) d`)).rows[0].d as string
 assert.match(definition,/'id','method','first','second','reason','fastener'/)
 assert.match(definition,/not in \(5,6\)/)
 assert.match(definition,/jsonb_typeof\(j->'fastener'\)<>'null' and not bob_private\.valid_joint_fastener/)
})

test('read_construction_fasteners serves members of the project only',async t=>{
 const pg=await projectSchema();t.after(()=>pg.close())
 const owner=randomUUID(),outsider=randomUUID(),artifact=randomUUID()
 await pg.query('insert into auth.users values($1,$2,now()),($3,$4,now())',[owner,'fastener-owner@example.test',outsider,'fastener-other@example.test'])
 const project=(await asProjectUser(pg,owner,'select bob.create_project($1) r',[JSON.stringify({name:'Fastener fixture'})])).rows[0].r.id
 const recipe={definitions:[box('gable',18,300,800),box('shelf',564,300,18)],instances:[at('g','gable'),at('s','shelf',18,0,400)]}
 await pg.query("set session_replication_role=replica")
 await pg.query('insert into bob.artifacts(id,project_id,area_id,current_revision,has_multifloor_plan,has_stair_study) values($1,$2,null,1,false,false)',[artifact,project])
 await pg.query(`insert into bob.artifact_construction_revisions(project_id,artifact_id,artifact_revision,recipe,parameters,materials,joints,open_questions)
  values($1,$2,1,$3,'{}','[]',$4,'[]')`,[project,artifact,JSON.stringify(recipe),JSON.stringify([joint('j','screwed_butt',['g','x_max'],['s','x_min'])])])
 await pg.query("set session_replication_role=origin")
 const read=(uid:string,revision:number|null=null)=>asProjectUser(pg,uid,'select bob.read_construction_fasteners($1,$2,$3) r',[project,artifact,revision]).then((r:any)=>r.rows[0].r)
 const mine=await read(owner)
 assert.equal(mine.status,'ok');assert.equal(mine.revision,1);assert.equal(mine.joints[0].count,3)
 assert.equal((await read(owner,7)).status,'not_found')
 // The saved revision's instance policy is applied: both parts existing -> no new fastener.
 await pg.query("set session_replication_role=replica")
 await pg.query(`insert into bob.artifact_construction_revisions(project_id,artifact_id,artifact_revision,recipe,parameters,materials,joints,open_questions)
  values($1,$2,2,$3,'{}','[]',$4,'[]')`,[project,artifact,JSON.stringify(recipe),JSON.stringify([joint('j','screwed_butt',['g','x_max'],['s','x_min'])])])
 await pg.query('insert into bob.artifact_construction_instance_policies values($1,$2,2,$3)',[project,artifact,JSON.stringify({version:1,instances:[
  {instance_id:'g',role:'existing_part',quantity_policy:'retain',reason:'Built'},{instance_id:'s',role:'existing_part',quantity_policy:'retain',reason:'Built'}]})])
 await pg.query("set session_replication_role=origin")
 const built=await read(owner,2)
 assert.equal(built.joints[0].source,'existing');assert.deepEqual(built.totals,[])
 await assert.rejects(read(outsider),/project_denied/)
})
