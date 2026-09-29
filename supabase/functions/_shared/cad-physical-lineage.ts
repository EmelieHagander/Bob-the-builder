import {CAD_DIMENSIONS,measurementMillimetres,type CadLineage,type SpaceMeasurementSource} from './cad-lineage.ts'
import type {createProjectLookup} from './project-lookup.ts'

type RecordValue=Record<string,any>
export type PhysicalDimensionBinding={definition_id:string;dimension:string;space_measurement_id:string;space_revision:number}
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v)
const isCadDimension=(v:unknown):v is typeof CAD_DIMENSIONS[number]=>CAD_DIMENSIONS.some(dimension=>dimension===v)
export function splitDimensionBindings(value:unknown){
 if(!Array.isArray(value)||value.length>32)throw new Error('invalid_dimension_bindings')
 const physical:PhysicalDimensionBinding[]=[],project:any[]=[],seen=new Set<string>()
 for(const b of value){
  if(!b||typeof b!=='object'||Array.isArray(b)||typeof b.definition_id!=='string'||!isCadDimension(b.dimension))throw new Error('invalid_dimension_bindings')
  const key=b.definition_id+':'+b.dimension
  if(seen.has(key))throw new Error('duplicate_dimension_binding');seen.add(key)
  if('space_measurement_id' in b){
   if(Object.keys(b).sort().join(',')!=='definition_id,dimension,space_measurement_id,space_revision'||!uuid(b.space_measurement_id)||!Number.isSafeInteger(b.space_revision)||b.space_revision<1)throw new Error('invalid_physical_binding')
   physical.push(b)
  }else project.push(b)
 }
 return {physical,project}
}
export function physicalLineageSources(lineage:CadLineage|null):SpaceMeasurementSource[]{
 return lineage?.bindings.flatMap(b=>b.source.kind==='space_measurement'?[b.source]:[])??[]
}
export class PhysicalCadSourceError extends Error{
 constructor(readonly issues:{id:string;reason:string}[],readonly technical:boolean){super(technical?'physical_sources_unavailable':'physical_sources_changed')}
}
/** Exact project-scoped readers: the physical snapshot is the authority, not
 * access to its donor project's measurement table. Each reader is bounded. */
export async function readPhysicalCadSources(makeLookup:()=>ReturnType<typeof createProjectLookup>,pins:{space_measurement_id:string;space_revision:number}[],sourceReceipts:ReturnType<typeof createProjectLookup>['sources']){
 const ids=new Map<string,number>()
 for(const p of pins){
  if(ids.has(p.space_measurement_id)&&ids.get(p.space_measurement_id)!==p.space_revision)throw new Error('conflicting_physical_pins')
  ids.set(p.space_measurement_id,p.space_revision)
 }
 if(ids.size>20)throw new Error('physical_source_budget')
 const records=new Map<string,RecordValue>(),issues:{id:string;reason:string}[]=[]
 const lookup=makeLookup(),spaces=makeLookup(),buildings=makeLookup()
 const spaceCache=new Map<string,RecordValue|null>(),buildingCache=new Map<string,RecordValue|null>()
 let technical=false
 async function read(reader:ReturnType<typeof createProjectLookup>,dataset:'physical_space_measurements'|'physical_spaces'|'physical_buildings',id:string){
  const r=await reader.search({dataset,record_id:id,query:null,status:null,area_id:null,after_id:null})
  if(r.status==='denied')throw new Error('project_denied')
  if(!['ok','empty'].includes(r.status)||r.truncated||r.next_cursor){technical=true;issues.push({id,reason:'retrieval_failed'});return null}
  const matches=r.records.filter(v=>v.id===id)
  if(matches.length!==1){issues.push({id,reason:'source_missing_or_ambiguous'});return null}
  return matches[0]
 }
 try{
  for(const [id,revision] of ids){
   const m=await read(lookup,'physical_space_measurements',id)
   if(!m)continue
   // Read records are untrusted. Validate identities before using them as
   // cache keys or following them to another physical object; never coerce.
   const spaceId=m.space_id,buildingId=m.building_id
   if(!uuid(spaceId)||!uuid(buildingId)){
    technical=true;issues.push({id,reason:'invalid_source_identity'});continue
   }
   if(!spaceCache.has(spaceId))spaceCache.set(spaceId,await read(spaces,'physical_spaces',spaceId))
   if(!buildingCache.has(buildingId))buildingCache.set(buildingId,await read(buildings,'physical_buildings',buildingId))
   const sp=spaceCache.get(spaceId),bu=buildingCache.get(buildingId)
   if(!sp||!bu)continue
   if(m.space_revision!==revision||sp.revision!==revision||sp.building_id!==buildingId||sp.archived||bu.archived){issues.push({id,reason:'accepted_physical_source_changed'});continue}
   records.set(id,m)
  }
  if(issues.length)throw new PhysicalCadSourceError(issues,technical)
  return records
 }finally{
  // Preserve caller-visible source receipts even when verification fails.
  sourceReceipts.push(...lookup.sources,...spaces.sources)
  sourceReceipts.push(...buildings.sources)
 }
}
export function bindPhysicalDimensions(recipe:any,bindings:PhysicalDimensionBinding[],records:Map<string,RecordValue>,lineage:CadLineage){
 const seen=new Set(lineage.bindings.map(b=>b.definition_id+':'+b.dimension))
 for(const b of bindings){
  const key=b.definition_id+':'+b.dimension
  if(seen.has(key)||!isCadDimension(b.dimension))throw new Error('invalid_physical_binding')
  seen.add(key)
  const m=records.get(b.space_measurement_id),d=recipe.definitions?.find((d:any)=>d.id===b.definition_id)
  if(!m||m.id!==b.space_measurement_id||m.space_revision!==b.space_revision||!d||!Object.hasOwn(d,b.dimension)||!uuid(m.building_id)||!uuid(m.space_id)||!uuid(m.measurement_id)
   ||!Number.isSafeInteger(m.measurement_revision)||m.measurement_revision<1||!['measured','provided_spec','estimated'].includes(m.truth)
   ||typeof m.source!=='string'||!m.source.trim()||m.source.length>2000)throw new Error('unusable_physical_provenance')
  const value=measurementMillimetres(m);d[b.dimension]=value
  lineage.version=2
  lineage.bindings.push({definition_id:b.definition_id,dimension:b.dimension,source:{kind:'space_measurement',id:m.id,building_id:m.building_id,space_id:m.space_id,space_revision:m.space_revision,
   measurement_id:m.measurement_id,measurement_revision:m.measurement_revision,value:String(m.value),unit:m.unit,truth:m.truth,description:m.source},normalized:{value,unit:'mm'}})
 }
 lineage.bindings.sort((a,b)=>(a.definition_id+':'+a.dimension)<(b.definition_id+':'+b.dimension)?-1:(a.definition_id+':'+a.dimension)>(b.definition_id+':'+b.dimension)?1:0)
 return recipe
}
