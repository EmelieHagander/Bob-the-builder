/** Physical meaning is separate from numeric parameter provenance and CAD solids.
 * The policy is pinned to the construction revision, never inferred from labels. */
export const INSTANCE_ROLE_POLICY = {
 build_part: 'manufacture', existing_part: 'retain', prefabricated_part: 'complete_item',
 reference: 'exclude', unknown: 'unknown',
} as const
export type InstanceRole = keyof typeof INSTANCE_ROLE_POLICY
export type InstancePolicy = {version: 1; instances: {
 instance_id: string; role: InstanceRole; quantity_policy: typeof INSTANCE_ROLE_POLICY[InstanceRole]; reason: string
}[]}
const textId={type:'string',pattern:'^[A-Za-z][A-Za-z0-9_.:-]{0,79}$'}
export const INSTANCE_POLICY_ENTRY_SCHEMA={anyOf:Object.entries(INSTANCE_ROLE_POLICY).map(([role,quantity_policy])=>({
 type:'object',additionalProperties:false,required:['instance_id','role','quantity_policy','reason'],properties:{
  instance_id:textId,role:{type:'string',enum:[role]},quantity_policy:{type:'string',enum:[quantity_policy]},
  reason:{type:'string',minLength:1,maxLength:2000},
 },
}))}
export const INSTANCE_POLICY_SCHEMA={anyOf:[{type:'null'},{type:'object',additionalProperties:false,required:['version','instances'],properties:{
 version:{type:'integer',enum:[1]},instances:{type:'array',minItems:1,maxItems:512,items:INSTANCE_POLICY_ENTRY_SCHEMA},
}}]}
export function constructionInstancePolicy(recipe:{instances:{id:string}[]},value:unknown) {
 const ids=new Set(recipe.instances.map(i=>i.id))
 if(value==null)return {version:1 as const,instances:recipe.instances.map(i=>({instance_id:i.id,role:'unknown' as const,quantity_policy:'unknown' as const,
  reason:'Historical instance role is not recorded. Classify this exact saved instance before deriving quantities.'}))}
 const p=value as InstancePolicy
 if(!p||typeof p!=='object'||Array.isArray(p)||Object.keys(p).sort().join()!=='instances,version'||p.version!==1||!Array.isArray(p.instances)
  ||p.instances.length!==ids.size)throw new Error('invalid_instance_policy')
 const seen=new Set<string>()
 for(const row of p.instances){
  if(!row||typeof row!=='object'||Array.isArray(row)||Object.keys(row).sort().join()!=='instance_id,quantity_policy,reason,role'
   ||!ids.has(row.instance_id)||seen.has(row.instance_id)||!Object.hasOwn(INSTANCE_ROLE_POLICY,row.role)
   ||INSTANCE_ROLE_POLICY[row.role]!==row.quantity_policy||typeof row.reason!=='string'||!row.reason.trim()||row.reason.length>2000)throw new Error('invalid_instance_policy')
  seen.add(row.instance_id)
 }
 return p
}
