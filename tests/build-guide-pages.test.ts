// Build-guide pages (2026-11-14): each page adds one kind of part, so a guide
// can never be one unreadable page, whatever steps Bob gives.
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {guidePages} from '../supabase/functions/_shared/build-guide-pages.ts'

const joint=(id:string,a:string,b:string)=>({id,first:{instance_id:a},second:{instance_id:b}})
const kindsAdded=(steps:{joint_ids:string[]}[],joints:any[],def:Record<string,string>,context:string[]=[])=>{
 const placed=new Set(context)
 return steps.map(s=>{const fresh=[...new Set(s.joint_ids.flatMap(id=>{const j=joints.find(x=>x.id===id);return [j.first.instance_id,j.second.instance_id]}))].filter(i=>!placed.has(i))
  fresh.forEach(i=>placed.add(i));return [...new Set(fresh.map(i=>def[i]))].sort()})
}

test('one step holding a whole frame becomes pages that each add one kind of part',()=>{
 const def={p1:'post',p2:'post',r1:'rail',r2:'rail',s1:'slat',s2:'slat',s3:'slat'}
 const joints=[joint('a','p1','r1'),joint('b','p1','r2'),joint('c','p2','r1'),joint('d','p2','r2'),
  ...['s1','s2','s3'].flatMap(s=>[joint(s+'_1',s,'r1'),joint(s+'_2',s,'r2')])]
 const pages=guidePages([{joint_ids:joints.map(j=>j.id),section:'Frame'}],joints,def)
 assert.deepEqual(pages.map(p=>p.joint_ids),[['a'],['b'],['c','d'],['s1_1','s1_2','s2_1','s2_2','s3_1','s3_2']])
 assert.deepEqual(kindsAdded(pages,joints,def),[['post','rail'],['rail'],['post'],['slat']])
 assert.ok(pages.every(p=>p.section==='Frame'),'pages keep their section')
})

test('pages only split Bob\'s steps: every joint once, steps and sections kept in order',()=>{
 const def={a:'x',b:'y',c:'z',d:'w'}
 const joints=[joint('ab','a','b'),joint('bc','b','c'),joint('cd','c','d')]
 const pages=guidePages([{joint_ids:['ab'],section:'One'},{joint_ids:['bc','cd'],section:'Two'}],joints,def)
 assert.deepEqual(pages,[{joint_ids:['ab'],section:'One'},{joint_ids:['bc'],section:'Two'},{joint_ids:['cd'],section:'Two'}])
 assert.deepEqual(guidePages([{joint_ids:['ab']}],[joint('ab','a','b')],def),[{joint_ids:['ab']}],'no section stays no section')
})

test('identical pieces in one step share their pages, so the worker can draw them once with 2×',()=>{
 const def={pa:'post',ra:'rail',qa:'post',pb:'post',rb:'rail',qb:'post'}
 const joints=[joint('a1','pa','ra'),joint('a2','qa','ra'),joint('b1','pb','rb'),joint('b2','qb','rb')]
 assert.deepEqual(guidePages([{joint_ids:['a1','a2','b1','b2']}],joints,def).map(p=>p.joint_ids),[['a1','b1'],['a2','b2']])
})

test('parts already standing (context, earlier steps) are not drawn as new',()=>{
 const def={wall:'wall',r1:'rail',r2:'rail'}
 const joints=[joint('w1','wall','r1'),joint('w2','wall','r2'),joint('rr','r1','r2')]
 const pages=guidePages([{joint_ids:['w1','w2','rr']}],joints,def,['wall'])
 assert.deepEqual(pages.map(p=>p.joint_ids),[['w1','w2','rr']],'both rails on one page; the closing joint rides along')
})

test('the live bunk bed given as one step of 129 joints becomes many readable pages',()=>{
 const f=JSON.parse(readFileSync(new URL('../cad-worker/fixtures/bunk_bed_guide.json',import.meta.url),'utf8'))
 const def=Object.fromEntries(f.recipe.instances.map((i:any)=>[i.id,i.definition_id]))
 const ids=f.joints.map((j:any)=>j.id).sort()
 const pages=guidePages([{joint_ids:ids,section:'Montera hela konstruktionen'}],f.joints,def,f.context_ids)
 assert.ok(pages.length>=15,`got ${pages.length} pages`)
 assert.deepEqual(pages.flatMap(p=>p.joint_ids).sort(),ids,'every joint exactly once')
 assert.ok(kindsAdded(pages,f.joints,def,f.context_ids).every(k=>k.length<=2),'no page adds more than the two parts of a first joint')
 // Bob's own seven sections keep their order and only get finer.
 const fromSections=guidePages(f.steps,f.joints,def,f.context_ids)
 assert.ok(fromSections.length>f.steps.length)
 assert.deepEqual([...new Set(fromSections.map(p=>p.section))],f.steps.map((s:any)=>s.section))
})
