/** Navigate large records without treating a transport limit as missing evidence. */
export const RECORD_DETAIL_TOOL={type:'function' as const,function:{name:'read_project_record_section',description:'Read a section of a large plan or CAD record. Start with path=[]; too_large returns keys or array_length so you can choose a narrower JSON path. For a plan use the revision as record_id; for CAD use the Artifact UUID. Exact revision is required for CAD. drawing reads current drawing metadata, source_state/source_reasons and linked work Steps, without geometry; check source freshness before relying on the saved classification; use its Artifact UUID and revision. This is project-bound read-only data.',parameters:{type:'object',additionalProperties:false,properties:{dataset:{type:'string',enum:['plan','cad','drawing']},record_id:{type:'string'},revision:{type:['integer','null']},path:{type:'array',maxItems:8,items:{type:'string'}}},required:['dataset','record_id','revision','path']}}}
export function createRecordDetailReader(read:(dataset:'plan'|'cad'|'drawing',id:string,revision:number|null)=>Promise<unknown>,hasAccess:()=>Promise<boolean>){let used=0
 return {tools:[RECORD_DETAIL_TOOL],get remaining(){return Math.max(0,16-used)},async execute(raw:unknown){
 if(++used>16)return {status:'budget_exhausted'}
 if(!raw||typeof raw!=='object'||Array.isArray(raw))return {status:'invalid'}
 const v=raw as Record<string,any>
 if(Object.keys(v).length!==4||!['plan','cad','drawing'].includes(v.dataset)||typeof v.record_id!=='string'||v.record_id.length>200||!Array.isArray(v.path)||v.path.length>8||v.path.some((s:unknown)=>typeof s!=='string'||s.length>100||['__proto__','prototype','constructor'].includes(s))||!(v.revision===null||Number.isSafeInteger(v.revision)&&v.revision>0))return {status:'invalid'}
 if(v.dataset!=='plan'&&v.revision===null||v.dataset==='plan'&&!/^[1-9][0-9]{0,8}$/.test(v.record_id))return {status:'invalid'}
 if(!await hasAccess())throw new Error('project_denied')
 let value:any=await read(v.dataset,v.record_id,v.revision)
 if(!await hasAccess())throw new Error('project_denied')
 for(const key of v.path){if(!value||typeof value!=='object'||!Object.hasOwn(value,key))return {status:'not_found'};value=value[key]}
 if(value===null||value===undefined)return {status:'not_found'}
 if(new TextEncoder().encode(JSON.stringify(value)).length>24000)return {status:'too_large',path:v.path,...(Array.isArray(value)?{array_length:value.length}:typeof value==='object'?{keys:Object.keys(value)}:{string_length:String(value).length})}
 return {status:'ok',path:v.path,record_id:v.record_id,revision:v.revision,data:value}
 }}
}
export type RecordDetailReader=ReturnType<typeof createRecordDetailReader>
