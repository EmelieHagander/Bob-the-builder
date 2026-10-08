import { CAD_PARAMETERS_SCHEMA } from './cad-parameters.ts'
import { CAD_RECIPE_SCHEMA } from './cad-schema.ts'
import { CAD_ARRAYS_SCHEMA } from './cad-arrays.ts'
import { frameParameterIds } from './cad-frames.ts'

/** Repairs send only what changed. The server applies the change set to the exact
 * input of this consult's last new-geometry render and re-runs the same render,
 * provenance and review path, so a patch can never bypass a check. */
const COLLECTIONS=['definitions','instances','arrays','clearances','motions'] as const
type Collection=typeof COLLECTIONS[number]
const object=(v:unknown):v is Record<string,any>=>!!v&&typeof v==='object'&&!Array.isArray(v)
const recipeItems=(name:Collection)=>name==='arrays'?CAD_ARRAYS_SCHEMA:(CAD_RECIPE_SCHEMA.properties as Record<string,any>)[name]
const ids={type:'array',maxItems:256,items:{type:'string'}}
const nullableText=(max:number)=>({type:['string','null'],maxLength:max})
export const REVISE_CAD_TOOL={type:'function' as const,function:{name:'revise_cad_candidate',
 description:'Repair your last new-geometry render by sending only what changed; everything else is kept exactly. upsert replaces items with the same id (or adds them); remove deletes by id. Removing a definition, instance, array, clearance or motion also removes the bindings under its path; unreferenced decision/estimate/derived nodes are dropped. Add bindings for every new or changed numeric field. The result is rendered, provenance-checked and reviewed exactly like render_cad_candidate and returns the full exact recipe. Use render_cad_candidate only for a fresh construction.',
 parameters:{type:'object',additionalProperties:false,required:['upsert','remove','views','title','description','assumptions'],properties:{
  upsert:{type:'object',additionalProperties:false,required:[...COLLECTIONS,'nodes','bindings'],properties:{
   ...Object.fromEntries(COLLECTIONS.map(name=>[name,{...recipeItems(name),minItems:0}])),
   nodes:{...(CAD_PARAMETERS_SCHEMA.properties as Record<string,any>).nodes,minItems:0},
   bindings:{...(CAD_PARAMETERS_SCHEMA.properties as Record<string,any>).bindings,minItems:0}}},
  remove:{type:'object',additionalProperties:false,required:[...COLLECTIONS,'nodes','bindings'],properties:{...Object.fromEntries(COLLECTIONS.map(name=>[name,ids])),nodes:ids,bindings:{...ids,description:'Binding paths'}}},
  views:{anyOf:[{type:'null'},(CAD_RECIPE_SCHEMA.properties as Record<string,any>).views]},
  title:nullableText(200),description:nullableText(6000),assumptions:nullableText(3500)}}}}

export function applyCadRevision(last:Record<string,any>|null,change:unknown):{args:Record<string,any>;dropped_nodes:string[]}{
 if(!last)throw new Error('no_render_to_revise')
 const c=change as any
 const keys=[...COLLECTIONS,'nodes','bindings'].sort().join(',')
 if(!object(c)||!object(c.upsert)||!object(c.remove)||Object.keys(c.upsert).sort().join(',')!==keys||Object.keys(c.remove).sort().join(',')!==keys)throw new Error('invalid_revision')
 for(const k of Object.keys(c.upsert))if(!Array.isArray(c.upsert[k])||!Array.isArray(c.remove[k])||c.remove[k].some((x:unknown)=>typeof x!=='string'))throw new Error('invalid_revision')
 const next=structuredClone(last),recipe=next.recipe,plan=next.parameter_plan
 if(!object(recipe)||!object(plan)||!Array.isArray(plan.nodes)||!Array.isArray(plan.bindings))throw new Error('invalid_revision_base')
 const missing:string[]=[]
 const merge=(list:any[]|undefined,remove:string[],upsert:any[],key:'id'|'path',label:string)=>{
  let items=[...(list??[])]
  for(const id of remove){if(!items.some(x=>x?.[key]===id))missing.push(label+'/'+id);items=items.filter(x=>x?.[key]!==id)}
  for(const item of upsert){
   if(!object(item)||typeof item[key]!=='string')throw new Error('invalid_revision')
   const at=items.findIndex(x=>x?.[key]===item[key]);if(at>=0)items[at]=item;else items.push(item)
  }
  return items
 }
 for(const name of COLLECTIONS){
  const merged=merge(recipe[name],c.remove[name],c.upsert[name],'id',name)
  if(merged.length||name==='definitions'||name==='instances')recipe[name]=merged;else delete recipe[name]
  // A removed item takes its bindings with it.
  for(const id of c.remove[name])plan.bindings=plan.bindings.filter((b:any)=>!String(b.path).startsWith(`${name}/${id}/`))
 }
 plan.bindings=merge(plan.bindings,c.remove.bindings,c.upsert.bindings,'path','bindings')
 plan.nodes=merge(plan.nodes,c.remove.nodes,c.upsert.nodes,'id','nodes')
 if(missing.length)throw new Error('revision_unknown_ids:'+missing.slice(0,10).join(','))
 // Drop nodes nothing reaches any more, and say which, so a dropped measurement is visible.
 const byId=new Map(plan.nodes.map((n:any)=>[n.id,n])),reached=new Set<string>()
 const reach=(id:string)=>{if(reached.has(id))return;reached.add(id);const n:any=byId.get(id);if(n?.role==='derived')n.operands?.forEach(reach)}
 plan.bindings.forEach((b:any)=>reach(b.node));if(Array.isArray(plan.frames))frameParameterIds(plan.frames).forEach(reach)
 const dropped_nodes=plan.nodes.filter((n:any)=>!reached.has(n.id)&&n.role!=='unknown').map((n:any)=>n.id)
 plan.nodes=plan.nodes.filter((n:any)=>!dropped_nodes.includes(n.id))
 if(c.views!==null)recipe.views=c.views
 for(const k of ['title','description','assumptions'])if(c[k]!==null&&c[k]!==undefined)next[k]=c[k]
 return {args:next,dropped_nodes}
}
