// Joint fasteners chosen from the catalog (owner decision 2026-11-01): the
// structural designer picks catalog items in any mix; code checks plain facts.
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {projectSchema} from './support/project-schema.ts'

const box=(id:string,x:number,y:number,z:number)=>({id,primitive:'box',material_ref:null,x_mm:x,y_mm:y,z_mm:z})
const at=(id:string,definition_id:string,x=0,y=0,z=0)=>({id,definition_id,placement:{x,y,z,rx:0,ry:0,rz:0}})
const butt=(id:string,first:[string,string],second:[string,string],fasteners:unknown[])=>
 ({id,method:'butt',first:{instance_id:first[0],face:first[1]},second:{instance_id:second[0],face:second[1]},reason:'Fixture joint',fasteners})
// A 400 x 300 x 250 box in 12 mm plywood: front panel and a side between front and back.
const recipe={contract_version:1,units:'mm',assembly_id:'box',views:['front'],clearances:[],motions:[],
 definitions:[box('front_back',400,12,250),box('side',12,276,250)],
 instances:[at('front','front_back'),at('left','side',0,12)]}

let shared:Promise<any>|null=null
function setup(){return shared??=build()}
async function build(){
 const pg=await projectSchema()
 const item=async(name:string)=>(await pg.query(`select i.id,r.revision from bob.catalog_items i join bob.catalog_item_revisions r on r.item_id=i.id
  where i.project_id is null and r.name=$1 order by r.revision desc limit 1`,[name])).rows[0]
 const pick=(row:{id:string;revision:number},count:number|null=null,spacing_mm:number|null=null)=>({material_id:row.id,material_revision:row.revision,count,spacing_mm})
 const glue=await item('Trälim, inomhus')
 return {pg,item,pick,glue:{id:glue.id as string,revision:glue.revision as number}}
}
const schedule=async(pg:any,joints:unknown)=>(await pg.query('select bob_private.construction_fastener_schedule($1::jsonb,$2::jsonb) s',[JSON.stringify(recipe),JSON.stringify(joints)])).rows[0].s
const issue=async(pg:any,list:unknown,project:string|null=null)=>(await pg.query('select bob_private.joint_fasteners_issue($1,$2::jsonb) v',[project,JSON.stringify(list)])).rows[0].v

test('the seeded screw, nail and glue types are tagged; other materials are not fasteners',async t=>{
 const {pg,item}=await setup();
 const kinds=(await pg.query(`select seed_key,fastener_kind from bob.material_types where fastener_kind is not null order by seed_key`)).rows
 assert.deepEqual(kinds.map((r:any)=>[r.seed_key,r.fastener_kind]),[['anchor_nail','nail'],['drywall_screw','screw'],['outdoor_screw','screw'],
  ['stainless_screw','screw'],['wire_nail_zinc','nail'],['wood_glue_indoor','glue'],['wood_glue_outdoor','glue'],['wood_screw_zinc','screw']])
 // 2026-11-01: generic wood glue, one package per item, class D2 or D3; no product or volume.
 const glues=(await pg.query(`select r.name,r.profile_code,r.properties->'grade'->>'value' grade,i.unit_code,i.identity_hash is not null hashed,
   (select array_agg(category_code order by category_code) from bob.catalog_item_categories c where c.item_id=i.id) cats
  from bob.catalog_items i join bob.catalog_item_revisions r on r.item_id=i.id join bob.material_types t on t.id=i.material_type_id
  where i.project_id is null and t.fastener_kind='glue' order by r.name`)).rows
 assert.deepEqual(glues.map((g:any)=>[g.name,g.profile_code,g.grade,g.unit_code,g.hashed,g.cats]),[
  ['Trälim, inomhus','liquid','D2','pcs',true,['adhesive','liquid']],['Trälim, utomhus (D3)','liquid','D3','pcs',true,['adhesive','liquid']]])
 const screw=await item('Träskruv, förzinkad (inomhus) 3,5 × 30')
 assert.deepEqual((await pg.query('select bob_private.joint_fastener_item($1,$2) f',[screw.id,screw.revision])).rows[0].f,{kind:'screw',project_id:null,diameter_mm:3.5,length_mm:30})
 const plywood=await item('Plywood, björk 12 × 1220 × 2440')
 assert.equal((await pg.query('select bob_private.joint_fastener_item($1,$2) f',[plywood.id,plywood.revision])).rows[0].f,null)
})

test('glue and screws on one joint: one row each, counts spread by the rule, glue package, exact totals',async t=>{
 const {pg,item,pick,glue}=await setup();
 const screw=await item('Träskruv, förzinkad (inomhus) 3,5 × 30')
 const s=await schedule(pg,[butt('front_left',['left','y_min'],['front','y_max'],[pick(screw),pick(glue)])])
 assert.equal(s.joints.length,2)
 const [sc,gl]=s.joints
 // 12 mm front screwed into the side's edge: contact 250 mm, e = 17.5 -> 3 screws, 108 mm apart.
 assert.deepEqual({...sc},{...sc,source:'chosen',method:'butt',kind:'screw',diameter_mm:3.5,length_mm:30,count:3,spacing_mm:108,
  through_instance_id:'front',through_mm:12,embed_mm:276,material_id:screw.id,material_revision:screw.revision,gaps:['narrow_contact']})
 // A 12 mm edge is narrower than 5 x 3.5 mm: the existing rule flags it, the joint still counts as complete.
 assert.equal(gl.kind,'glue');assert.equal(gl.count,null);assert.deepEqual(gl.gaps,[])
 assert.equal(s.glue_packages,1);assert.equal(s.complete,true)
 assert.deepEqual(s.totals,[{kind:'screw',diameter_mm:3.5,length_mm:30,count:3,joint_ids:['front_left']}])
})

test('plain facts: too short, through the far face, short penetration, a given count and no choice yet',async t=>{
 const {pg,item,pick}=await setup();
 const deep={...recipe,definitions:[box('front_back',400,12,250),box('side',12,15,250)]}
 const run=async(r:unknown,j:unknown)=>(await pg.query('select bob_private.construction_fastener_schedule($1::jsonb,$2::jsonb) s',[JSON.stringify(r),JSON.stringify(j)])).rows[0].s
 const dry25=await item('Gipsskruv 3,9 × 25'),wood30=await item('Träskruv, förzinkad (inomhus) 3,5 × 30'),nail=await item('Trådspik, förzinkad 2,8 × 75')
 // Side only 15 mm deep: a 25 mm screw through 12 mm ends 2 mm from the far face.
 assert.deepEqual((await run(deep,[butt('j',['left','y_min'],['front','y_max'],[pick(dry25)])])).joints[0].gaps,['passes_through','narrow_contact'])
 assert.deepEqual((await run(recipe,[butt('j',['left','y_min'],['front','y_max'],[pick(dry25,4)])])).joints[0].gaps,['short_penetration','narrow_contact'])
 const given=(await run(recipe,[butt('j',['left','y_min'],['front','y_max'],[pick(nail,6,40)])])).joints[0]
 assert.equal(given.count,6);assert.equal(given.spacing_mm,40);assert.deepEqual(given.gaps,['narrow_contact'])
 const thick={...recipe,definitions:[box('front_back',400,40,250),box('side',12,276,250)],instances:[at('front','front_back'),at('left','side',0,40)]}
 assert.deepEqual((await run(thick,[butt('j',['left','y_min'],['front','y_max'],[pick(wood30)])])).joints[0].gaps,['does_not_reach','narrow_contact'])
 const none=await run(recipe,[butt('j',['left','y_min'],['front','y_max'],[])])
 assert.equal(none.joints[0].source,'none');assert.deepEqual(none.joints[0].gaps,['no_fastener_chosen']);assert.equal(none.complete,false)
})

test('the chosen list only accepts real fastener items of this project or the shared catalog, and names each mistake',async t=>{
 const {pg,item,pick,glue}=await setup();
 const screw=await item('Träskruv, förzinkad (inomhus) 3,5 × 30'),plywood=await item('Plywood, björk 12 × 1220 × 2440')
 assert.equal(await issue(pg,[pick(screw),pick(glue)]),null)
 assert.equal(await issue(pg,[]),null)
 for(const [bad,code] of [[[pick(plywood)],'joint_fastener_not_in_catalog'],[[pick(screw),pick(screw)],'joint_fastener_repeated'],[[pick(glue,2)],'joint_fastener_glue_counted'],
  [[{...pick(screw),material_revision:99}],'joint_fastener_not_in_catalog'],[[{...pick(screw),extra:1}],'joint_fasteners_invalid'],[[pick(screw,0)],'joint_fasteners_invalid'],
  [[pick(screw,null,0)],'joint_fasteners_invalid'],[[{material_id:randomUUID(),material_revision:1,count:null,spacing_mm:null}],'joint_fastener_not_in_catalog'],
  [Array(9).fill(0).map(()=>pick(screw)),'joint_fasteners_invalid']] as [unknown[],string][])
  assert.equal(await issue(pg,bad),code,JSON.stringify(bad))
})

test('check_construction admits butt joints only with a valid list; earlier joints keep their rules',async t=>{
 const {pg,item,pick}=await setup();
 const screw=await item('Träskruv, förzinkad (inomhus) 3,5 × 30'),plywood=await item('Plywood, björk 12 × 1220 × 2440')
 const materials=recipe.definitions.map(d=>({definition_id:d.id,material_id:plywood.id,material_revision:plywood.revision,part_id:null,part_revision:null}))
 const check=(joints:unknown)=>pg.query('select bob_private.check_construction($1,$2,$3::jsonb,$4::jsonb,$5::jsonb,$6::jsonb)',
  ['p_fixture',randomUUID(),JSON.stringify(recipe),JSON.stringify(materials),JSON.stringify(joints),'[]'])
 await check([butt('j',['left','y_min'],['front','y_max'],[pick(screw)])])
 await check([{id:'j',method:'screwed_butt',first:{instance_id:'left',face:'y_min'},second:{instance_id:'front',face:'y_max'},reason:'Earlier joint'}])
 await assert.rejects(check([{...butt('j',['left','y_min'],['front','y_max'],[]),method:'glued_butt'}]),/invalid_joint/)
 const {fasteners:_f,...bare}=butt('j',['left','y_min'],['front','y_max'],[])
 await assert.rejects(check([bare]),/invalid_joint/)
 await assert.rejects(check([butt('j',['left','y_min'],['front','y_max'],[pick(plywood)])]),/joint_fastener_not_in_catalog/)
})

test('close the shared schema',async()=>{(await setup()).pg.close()})
