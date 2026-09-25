import { schemaIssues } from './schema-issues.ts'
const obj=(properties:Record<string,unknown>,required=Object.keys(properties))=>({type:'object',additionalProperties:false,properties,required})
const id={type:'string',pattern:'^[A-Za-z][A-Za-z0-9_.:-]{0,79}$'}
const num=(bound:number,positive=false)=>({type:'number',maximum:bound,...(positive?{exclusiveMinimum:0}:{minimum:-bound})})
const placement=obj({x:num(1e7),y:num(1e7),z:num(1e7),rx:num(360000),ry:num(360000),rz:num(360000)})
const solids=(extra:Record<string,unknown>,cut=false)=>({anyOf:[
 obj({...extra,primitive:{type:'string',enum:['box']},x_mm:num(1e6,true),y_mm:num(1e6,true),z_mm:num(1e6,true)}),
 obj({...extra,primitive:{type:'string',enum:['cylinder']},diameter_mm:num(1e6,true),length_mm:num(1e6,true)}),
 ...(!cut?[obj({...extra,primitive:{type:'string',enum:['tube']},outside_diameter_mm:num(1e6,true),wall_thickness_mm:num(1e6,true),length_mm:num(1e6,true)})]:[]),
]})
const definitions=solids({id,material_ref:{anyOf:[id,{type:'null'}]}})
for(const schema of definitions.anyOf){schema.properties.cuts={type:'array',maxItems:16,items:solids({placement},true)}}
export const CAD_RECIPE_SCHEMA=obj({contract_version:{type:'integer',enum:[1]},units:{type:'string',enum:['mm']},assembly_id:id,
 definitions:{type:'array',minItems:1,maxItems:128,items:definitions},
 instances:{type:'array',minItems:1,maxItems:512,items:obj({id,definition_id:id,placement})},
 views:{type:'array',minItems:1,maxItems:4,items:{type:'string',enum:['front','right','top','isometric']}},
 clearances:{type:'array',maxItems:16,items:obj({id,first_id:id,second_id:id,min_mm:{type:'number',minimum:0,maximum:1e6}})},
 motions:{type:'array',maxItems:16,items:obj({id,moving_ids:{type:'array',minItems:1,maxItems:8,items:id},obstacle_ids:{type:'array',minItems:1,maxItems:32,items:id},delta:obj({x:num(1e6),y:num(1e6),z:num(1e6)})})},
},['contract_version','units','assembly_id','definitions','instances','views'])
export function cadIssues(value:unknown){
 const issues=schemaIssues(CAD_RECIPE_SCHEMA,value,'recipe')
 return issues.length?issues:[{path:'recipe',expected:'unique definition/instance/check IDs, existing referenced IDs, distinct views, tube wall < radius, <=256 cuts; inspect those relationships'}]
}
