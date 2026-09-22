import type { CadConstructionV1, CadDefinition, CadView } from './cad-adapter.ts'

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const key = /^[A-Za-z0-9_.-]{1,80}$/
const text = { type: 'string' }
const nullableText = { type: ['string','null'] }

export const ASSEMBLY_TOOL = {
  type: 'function' as const,
  function: {
    name: 'save_project_assembly',
    description: 'Create or revise a generic part assembly for one existing Artifact target. Parts are exact catalog revisions; geometry uses reusable primitives and placed instances, never object-specific generators.',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        record_id: { ...nullableText, description: 'Existing Artifact UUID to revise, or null to create.' },
        create_area_id: { ...nullableText, description: 'Exact Area ID on create, or null for Project. Always null when revising.' },
        expected_revision: { type:'integer', description:'0 for create; exact current Artifact revision for revise.' },
        target_revision: { type:'integer', description:'Exact current selected target decision. Read target first.' },
        title: text,
        description: text,
        assumptions: { ...text, description:'Visible design assumptions and unresolved fit/fixing/safety questions. Geometry is design specification unless backed by explicit evidence.' },
        definitions: {
          type:'array', minItems:1, maxItems:256,
          description:'Reusable resolved part geometries. Each pins one exact catalog part revision.',
          items: {
            type:'object', additionalProperties:false,
            properties:{
              key:{type:'string'},
              part_id:{type:'string'},
              part_revision:{type:'integer'},
              shape:{
                type:'object',
                description:'Generic local geometry only. V1: box or hollow tube.',
                oneOf:[
                  { type:'object', additionalProperties:false, required:['kind','length_mm','width_mm','thickness_mm'], properties:{
                    kind:{type:'string',enum:['box']},
                    length_mm:{type:'number'}, width_mm:{type:'number'}, thickness_mm:{type:'number'},
                  }},
                  { type:'object', additionalProperties:false, required:['kind','outside_diameter_mm','wall_thickness_mm','length_mm'], properties:{
                    kind:{type:'string',enum:['tube']},
                    outside_diameter_mm:{type:'number'}, wall_thickness_mm:{type:'number'}, length_mm:{type:'number'},
                  }},
                ],
              },
            },
            required:['key','part_id','part_revision','shape'],
          },
        },
        instances:{
          type:'array', minItems:1, maxItems:1024,
          description:'Placed instances. Moving an instance changes placement only; it does not edit the catalog part definition.',
          items:{type:'object',additionalProperties:false,properties:{
            key:{type:'string'}, definition_key:{type:'string'},
            position_mm:{type:'array',minItems:3,maxItems:3,items:{type:'number'}},
            rotation_deg:{type:'array',minItems:3,maxItems:3,items:{type:'number'}},
          },required:['key','definition_key','position_mm','rotation_deg']},
        },
        views:{type:'array',minItems:1,maxItems:4,uniqueItems:true,items:{type:'string',enum:['front','right','top','isometric']}},
        measurements:{type:'array',maxItems:20,items:{type:'object',additionalProperties:false,required:['id','revision'],properties:{id:{type:'string'},revision:{type:'integer'}}}},
        change_note:{...text,description:'Reason for this create/revision.'},
        request_quote:{...text,description:'Exact quote from CURRENT user message authorising this saved construction.'},
      },
      required:['record_id','create_area_id','expected_revision','target_revision','title','description','assumptions','definitions','instances','views','measurements','change_note','request_quote'],
    },
  },
}

export type AssemblyShape =
  | { kind:'box'; length_mm:number; width_mm:number; thickness_mm:number }
  | { kind:'tube'; outside_diameter_mm:number; wall_thickness_mm:number; length_mm:number }
export type AssemblyDefinition = { key:string; part_id:string; part_revision:number; shape:AssemblyShape }
export type AssemblyInstance = { key:string; definition_key:string; position_mm:[number,number,number]; rotation_deg:[number,number,number] }
export interface AssemblyRecipeV1 {
  version:1
  definitions:AssemblyDefinition[]
  instances:AssemblyInstance[]
  views:CadView[]
}
export interface ParsedAssemblyWrite {
  kind:'assembly'
  record_id:string|null
  expected_updated_at:null
  expected_revision:number
  request_quote:string
  data:{
    title:string; description:string; assumptions:string; target_revision:number
    recipe:AssemblyRecipeV1
    measurements:Array<{id:string;revision:number}>
    area_id?:string|null
    change_note?:string
  }
}

const isObject=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v)
const finite=(v:unknown, positive=false)=>typeof v==='number'&&Number.isFinite(v)&&Math.abs(v)<=1_000_000&&(!positive||v>0)
const vec=(v:unknown)=>Array.isArray(v)&&v.length===3&&v.every(n=>finite(n))
const str=(v:unknown,max:number,empty=false):v is string=>typeof v==='string'&&v.length<=max&&(empty||v.trim().length>0)
const exact=(v:Record<string,unknown>,keys:string[])=>Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k))

function parseShape(raw:unknown):AssemblyShape|null{
  if(!isObject(raw)||typeof raw.kind!=='string')return null
  if(raw.kind==='box'){
    if(!exact(raw,['kind','length_mm','width_mm','thickness_mm'])||!finite(raw.length_mm,true)||!finite(raw.width_mm,true)||!finite(raw.thickness_mm,true))return null
    return {kind:'box',length_mm:Number(raw.length_mm),width_mm:Number(raw.width_mm),thickness_mm:Number(raw.thickness_mm)}
  }
  if(raw.kind==='tube'){
    if(!exact(raw,['kind','outside_diameter_mm','wall_thickness_mm','length_mm'])
      ||!finite(raw.outside_diameter_mm,true)||!finite(raw.wall_thickness_mm,true)||!finite(raw.length_mm,true)
      ||Number(raw.wall_thickness_mm)*2>=Number(raw.outside_diameter_mm))return null
    return {kind:'tube',outside_diameter_mm:Number(raw.outside_diameter_mm),wall_thickness_mm:Number(raw.wall_thickness_mm),length_mm:Number(raw.length_mm)}
  }
  return null
}

export function parseAssemblyWrite(value:unknown):ParsedAssemblyWrite|null{
  if(!isObject(value)||!exact(value,ASSEMBLY_TOOL.function.parameters.required))return null
  const v=value
  if(v.record_id!==null&&(typeof v.record_id!=='string'||!uuid.test(v.record_id)))return null
  if(v.create_area_id!==null&&!str(v.create_area_id,200))return null
  if(v.record_id!==null&&v.create_area_id!==null)return null
  if(!Number.isSafeInteger(v.expected_revision)||(v.record_id===null?v.expected_revision!==0:Number(v.expected_revision)<1)
    ||!Number.isSafeInteger(v.target_revision)||Number(v.target_revision)<1
    ||!str(v.title,200)||!str(v.description,6000)||!str(v.assumptions,3500)||!str(v.change_note,1000)||!str(v.request_quote,500))return null
  if(!Array.isArray(v.definitions)||v.definitions.length<1||v.definitions.length>256
    ||!Array.isArray(v.instances)||v.instances.length<1||v.instances.length>1024
    ||!Array.isArray(v.views)||v.views.length<1||v.views.length>4||new Set(v.views).size!==v.views.length
    ||!Array.isArray(v.measurements)||v.measurements.length>20)return null

  const definitions:AssemblyDefinition[]=[]
  const dkeys=new Set<string>()
  for(const raw of v.definitions){
    if(!isObject(raw)||!exact(raw,['key','part_id','part_revision','shape'])||!str(raw.key,80)||!key.test(raw.key)||dkeys.has(raw.key)
      ||typeof raw.part_id!=='string'||!uuid.test(raw.part_id)||!Number.isSafeInteger(raw.part_revision)||Number(raw.part_revision)<1)return null
    const shape=parseShape(raw.shape);if(!shape)return null
    dkeys.add(raw.key);definitions.push({key:raw.key,part_id:raw.part_id,part_revision:Number(raw.part_revision),shape})
  }
  const instances:AssemblyInstance[]=[];const ikeys=new Set<string>()
  for(const raw of v.instances){
    if(!isObject(raw)||!exact(raw,['key','definition_key','position_mm','rotation_deg'])
      ||!str(raw.key,80)||!key.test(raw.key)||ikeys.has(raw.key)||typeof raw.definition_key!=='string'||!dkeys.has(raw.definition_key)
      ||!vec(raw.position_mm)||!vec(raw.rotation_deg))return null
    ikeys.add(raw.key);instances.push({key:raw.key,definition_key:raw.definition_key,
      position_mm:raw.position_mm.map(Number) as [number,number,number],rotation_deg:raw.rotation_deg.map(Number) as [number,number,number]})
  }
  const allowedViews=new Set(['front','right','top','isometric'])
  if(v.views.some(x=>typeof x!=='string'||!allowedViews.has(x)))return null
  const measurements:Array<{id:string;revision:number}>=[];const mids=new Set<string>()
  for(const raw of v.measurements){
    if(!isObject(raw)||!exact(raw,['id','revision'])||typeof raw.id!=='string'||!uuid.test(raw.id)
      ||!Number.isSafeInteger(raw.revision)||Number(raw.revision)<1||mids.has(raw.id.toLowerCase()))return null
    mids.add(raw.id.toLowerCase());measurements.push({id:raw.id,revision:Number(raw.revision)})
  }
  const recipe:AssemblyRecipeV1={version:1,definitions,instances,views:v.views as CadView[]}
  return {kind:'assembly',record_id:v.record_id as string|null,expected_updated_at:null,expected_revision:Number(v.expected_revision),
    request_quote:v.request_quote as string,data:{title:v.title as string,description:v.description as string,assumptions:v.assumptions as string,
      target_revision:Number(v.target_revision),recipe,measurements,
      ...(v.record_id===null?{area_id:v.create_area_id as string|null}:{change_note:v.change_note as string})}}
}

export function assemblyToCad(assemblyId:string,recipe:AssemblyRecipeV1):CadConstructionV1{
  if(!key.test(assemblyId))throw new Error('cad_invalid_assembly_id')
  const definitions:CadDefinition[]=recipe.definitions.map(d=>d.shape.kind==='box'
    ?{id:d.key,kind:'box',size_mm:[d.shape.length_mm,d.shape.width_mm,d.shape.thickness_mm],catalog_part_id:d.part_id,catalog_part_revision:d.part_revision}
    :{id:d.key,kind:'tube',outside_diameter_mm:d.shape.outside_diameter_mm,wall_thickness_mm:d.shape.wall_thickness_mm,length_mm:d.shape.length_mm,
      catalog_part_id:d.part_id,catalog_part_revision:d.part_revision})
  return {version:1,assembly_id:assemblyId,units:'mm',definitions,
    instances:recipe.instances.map(i=>({id:i.key,definition_id:i.definition_key,position_mm:i.position_mm,rotation_deg:i.rotation_deg})),views:recipe.views}
}


export interface AssemblyPartListLine {
  definition_key:string
  part_id:string
  part_revision:number
  quantity:number
  instance_keys:string[]
  shape:AssemblyShape
}

/** Deterministic manufacturing identity summary from the exact assembly recipe.
 * Quantity is counted ONLY from leaf instances; definitions never carry a second count. */
export function assemblyPartList(recipe:AssemblyRecipeV1):AssemblyPartListLine[]{
  const byDefinition=new Map(recipe.definitions.map(d=>[d.key,{...d,quantity:0,instance_keys:[] as string[]}]))
  for(const instance of recipe.instances){
    const line=byDefinition.get(instance.definition_key)
    if(!line)throw new Error('assembly_dangling_instance')
    line.quantity++;line.instance_keys.push(instance.key)
  }
  return [...byDefinition.values()].filter(line=>line.quantity>0).map(line=>({
    definition_key:line.key,part_id:line.part_id,part_revision:line.part_revision,quantity:line.quantity,
    instance_keys:[...line.instance_keys],shape:structuredClone(line.shape),
  }))
}
