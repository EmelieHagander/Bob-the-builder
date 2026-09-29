import type { DesignHandoff } from './cad-review.ts'

export const CAD_DIMENSIONS = ['x_mm','y_mm','z_mm','diameter_mm','length_mm','outside_diameter_mm','wall_thickness_mm'] as const
export type DimensionBinding = { definition_id:string; dimension:string; measurement_id:string; revision:number }
export type CadLineage = {
  version:1; coverage:'partial'; project_id:string;
  coordinates:DesignHandoff['coordinates'] | null;
  inherited_from:{artifact_id:string;revision:number} | null;
  bindings:{definition_id:string;dimension:string;source:{kind:'project_measurement';id:string;revision:number;value:string;unit:string;truth:string;description:string};normalized:{value:number;unit:'mm'}}[];
}

/** Shift the decimal before the sole conversion to a JS number. Multiplying a
 * binary approximation (e.g. 1.001 * 1000) loses an otherwise exact whole mm. */
export function measurementMillimetres(m:Record<string,any>):number {
  const shift=({mm:0,cm:1,m:3} as Record<string,number>)[m.unit]
  const value=typeof m.value==='string'||typeof m.value==='number'?String(m.value):''
  if(shift===undefined||!/^\d{1,7}(?:\.\d{1,3})?$/.test(value)||m.truth==='unknown')throw new Error('unusable_measurement_binding')
  const [whole,fraction='']=value.split('.')
  const digits=whole+fraction.padEnd(3,'0')
  const scaled=BigInt(digits)*10n**BigInt(shift)
  const exact=(scaled/1000n).toString()+'.'+(scaled%1000n).toString().padStart(3,'0')
  const mm=Number(exact)
  if(!Number.isFinite(mm)||mm<=0||Number(value)>1000000)throw new Error('unusable_measurement_binding')
  if(m.millimetres!=null&&Number(m.millimetres)!==mm)throw new Error('inconsistent_measurement_conversion')
  return mm
}

/** Metadata is constructed from authorized records, never accepted from the
 * designer or renderer. Partial deliberately excludes unbound values,
 * placements, cuts, physical-source transforms and formula dependencies. */
export function buildCadLineage(projectId:string,recipe:any,bindings:DimensionBinding[],records:Map<string,Record<string,any>>,coordinates:DesignHandoff['coordinates']):CadLineage {
  return {version:1,coverage:'partial',project_id:projectId,coordinates:structuredClone(coordinates),inherited_from:null,
    bindings:bindings.map(b=>{
      const m=records.get(b.measurement_id),d=recipe.definitions.find((d:any)=>d.id===b.definition_id)
      if(!m||m.revision!==b.revision||m.archived||!['measured','provided_spec','estimated'].includes(m.truth)
        ||typeof m.source!=='string'||!m.source.trim()||m.source.length>2000||m.project_id!=null&&m.project_id!==projectId
        ||!d||d[b.dimension]!==measurementMillimetres(m))throw new Error('unusable_measurement_provenance')
      return {definition_id:b.definition_id,dimension:b.dimension,source:{kind:'project_measurement' as const,id:b.measurement_id,revision:b.revision,value:String(m.value),unit:m.unit,truth:m.truth,description:m.source},normalized:{value:d[b.dimension],unit:'mm' as const}}
    }).sort((a,b)=>(a.definition_id+':'+a.dimension)<(b.definition_id+':'+b.dimension)?-1:(a.definition_id+':'+a.dimension)>(b.definition_id+':'+b.dimension)?1:0)}
}

const exact = (v:unknown, keys:string[]):v is Record<string,any> => !!v && typeof v==='object' && !Array.isArray(v)
  && Object.keys(v).sort().join(',')===[...keys].sort().join(',')
const uuid = (v:unknown):v is string => typeof v==='string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v)
const text = (v:unknown,max:number):v is string => typeof v==='string' && !!v.trim() && v.length<=max

/** Readback is a trust boundary too. Validate all retained metadata before
 * selecting a detail; malformed provenance cannot be recast as legacy absence. */
function validLineage(value:unknown,projectId:string):value is CadLineage {
  if(!exact(value,['version','coverage','project_id','coordinates','inherited_from','bindings'])
    ||value.version!==1||value.coverage!=='partial'||value.project_id!==projectId
    ||!Array.isArray(value.bindings)||value.bindings.length>32)return false
  const c=value.coordinates,parent=value.inherited_from
  if(c!==null&&(!exact(c,['origin','positive_x','positive_y','positive_z'])||Object.values(c).some(v=>v!==null&&!text(v,500))))return false
  if(parent!==null&&(!exact(parent,['artifact_id','revision'])||!uuid(parent.artifact_id)||!Number.isSafeInteger(parent.revision)||parent.revision<1))return false
  const seen=new Set<string>()
  for(const b of value.bindings){
    if(!exact(b,['definition_id','dimension','source','normalized'])||!text(b.definition_id,200)
      ||!CAD_DIMENSIONS.includes(b.dimension)||seen.has(b.definition_id+':'+b.dimension)
      ||!exact(b.source,['kind','id','revision','value','unit','truth','description'])
      ||b.source.kind!=='project_measurement'||!uuid(b.source.id)||!Number.isSafeInteger(b.source.revision)||b.source.revision<1
      ||typeof b.source.value!=='string'||!['measured','provided_spec','estimated'].includes(b.source.truth)||!text(b.source.description,2000)
      ||!exact(b.normalized,['value','unit'])||b.normalized.unit!=='mm'||typeof b.normalized.value!=='number')return false
    try{if(measurementMillimetres(b.source)!==b.normalized.value)return false}catch{return false}
    seen.add(b.definition_id+':'+b.dimension)
  }
  return true
}

/** A detail preserves the selected parent's original values and source pins.
 * Legacy absence is explicit partial/untracked, never reconstructed evidence. */
export function inheritCadLineage(projectId:string,source:any,recipe:any,artifactId:string,revision:number):CadLineage {
  const old=source.lineage??source.manifest?.bob_lineage
  if((old==null&&source.lineage_state!=null&&source.lineage_state!=='legacy_untracked')
    ||(old!=null&&!validLineage(old,projectId)))throw new Error('invalid_source_lineage')
  const definitions=new Set(recipe.definitions.map((d:any)=>d.id))
  const bindings:CadLineage['bindings']=old?structuredClone(old.bindings.filter((b:any)=>definitions.has(b.definition_id))):[]
  for(const b of bindings){
    const d=recipe.definitions.find((d:any)=>d.id===b.definition_id)
    if(b.normalized.value!==d[b.dimension])throw new Error('invalid_source_lineage')
  }
  return {version:1,coverage:'partial',project_id:projectId,coordinates:structuredClone(old?.coordinates??null),inherited_from:{artifact_id:artifactId,revision},bindings}
}

export function lineageMeasurementPins(existing:{id:string;revision:number}[],lineage:CadLineage){
  const pins=new Map<string,number>()
  for(const p of [...existing,...lineage.bindings.map(b=>({id:b.source.id,revision:b.source.revision}))]){
    if(pins.has(p.id)&&pins.get(p.id)!==p.revision)throw new Error('conflicting_measurement_pins')
    pins.set(p.id,p.revision)
  }
  if(pins.size>20)throw new Error('measurement_pin_budget')
  return [...pins].map(([id,revision])=>({id,revision}))
}
