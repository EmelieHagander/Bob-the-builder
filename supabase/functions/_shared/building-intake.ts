/** One atomic chat batch into canonical Building/Level/Space/Element history.
 * This validates tool data, not the correctness of natural-language extraction.
 * @keys are local dependencies, never durable or model-invented UUIDs.
 */
const text = { type: 'string' }, integer = { type: 'integer' }, nullableText = { type: ['string','null'] }
const reference = { ...text, description: 'Existing UUID from fresh project research or @key of an earlier operation of the required kind. Never invent UUIDs.' }
const truth = { type:'string',enum:['measured','provided_spec','estimated','ai_assessment','unknown'] }
export const INTAKE_FIELDS = {
  building: { notes_append: { ...text, description: 'Append user-described facts to the existing Building notes, never replace unrelated context. Max 2000 characters; total canonical notes remain bounded.' } },
  level: { name:text, position:integer, notes:text },
  measurement: { subject:text,value:nullableText,unit:{type:'string',enum:['mm','cm','m']},truth:{type:'string',enum:['measured','provided_spec','estimated','unknown']},notes:text,required:{type:'boolean'} },
  space: { name:text,kind:text,level_id:{...nullableText,description:reference.description},notes:text,truth,
    measurements:{type:'array',maxItems:20,description:'Add/update exact references. Unrelated and omitted existing links are preserved.',items:{type:'object',additionalProperties:false,required:['id','revision'],properties:{id:reference,revision:integer}}} },
  element: { name:text,kind:text,space_id:{...nullableText,description:reference.description},description:text,truth },
  relationship: { subject_space_id:reference,object_space_id:reference,relation:{type:'string',enum:['adjacent_to','shares_boundary_with','connects_to','above','below','attached_to']},notes:text,truth },
} as const
export type IntakeKind = keyof typeof INTAKE_FIELDS
export const BUILDING_INTAKE_TOOL = { type:'function' as const,function:{name:'save_building_context',
  description:'Record the user-described Building, levels, spaces/zones, elements, relationships and room measurement references in one atomic batch, reusing the canonical model. Read physical_buildings/levels/spaces/elements/relationships first and reuse identities. New building_id=null creates AND links a NEW building to this project; never link an existing unscoped building implicitly. Existing facts require Building edit authority. Project-only members can propose space/element/relationship changes, not change accepted reality or create levels. Distinguish zones from walls, adjacency from a walkable connection, above from an identical footprint, and estimates from measurements. No coordinates, staircase calculation or safety approval is provided. Capture narration only when the user requests saving; examples and hypothetical questions are not permission. Source quotes must be actual user messages, not model answers or summaries.',
  parameters:{type:'object',additionalProperties:false,required:['building_id','expected_building_revision','new_building_name','new_building_notes','operations','request_quote'],properties:{
    building_id:{...nullableText,description:'Exact project-scoped Building UUID, or null only for an explicitly requested NEW building.'},
    expected_building_revision:{...integer,description:'Current Building metadata revision, or 0 for new.'},
    new_building_name:{...nullableText,description:'Required for new Building; null for existing.'},
    new_building_notes:{...nullableText,description:'For new Building only: actual described orientation/extent, source and uncertainty; no invented measured geometry. Null for existing.'},
    operations:{type:'array',minItems:1,maxItems:40,description:'Dependency ordered: measurements/levels, then spaces, then elements/relationships. One edit per identity. Report incomplete capture when a story needs more than one batch.',items:{anyOf:Object.entries(INTAKE_FIELDS).map(([kind,fields])=>({type:'object',additionalProperties:false,
      required:['key','kind','record_id','expected_revision','mode','source_quote','source_seq','fields'],properties:{
        key:{...text,description:'Unique lowercase key, letters/digits/underscores, start with letter, max 40.'},kind:{type:'string',enum:[kind]},record_id:nullableText,
        expected_revision:{...integer,description:'0=create, exact current latest revision=update. Never implicitly accept a pending proposal.'},
        mode:{type:'string',enum:['existing','proposed'],description:'existing=user-described current reality; proposed=remodel idea (ai_assessment). Building/levels/measurements use existing.'},
        source_quote:{...text,description:'Exact 1–500 character USER quote supporting this operation.'},
        source_seq:{type:['integer','null'],description:'null=current user message; otherwise exact earlier USER seq from same-conversation history research.'},
        fields:{type:'object',additionalProperties:false,minProperties:1,properties:fields,description:'PATCH on update: omit unchanged fields. Building operations only append notes to the already identified root. Create needs name, or measurement subject/value/unit/truth, or both relationship endpoints/relation. Sources and audit are server-owned.'},
      }}))}},
    request_quote:{...text,description:'Exact 1–500 character quote from CURRENT user request authorising the save.'},
  }}}}
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v)
const obj=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v)
const str=(v:unknown,max:number,empty=false):v is string=>typeof v==='string'&&v.length<=max&&(empty||!!v.trim())
const rev=(v:unknown):v is number=>Number.isSafeInteger(v)&&Number(v)>0&&Number(v)<=2147483647
export function parseBuildingIntake(v:Record<string,unknown>,message:string){
  if(v.building_id===null?v.expected_building_revision!==0||!str(v.new_building_name,200)||!str(v.new_building_notes,4000,true)
    :!uuid(v.building_id)||!rev(v.expected_building_revision)||v.new_building_name!==null||v.new_building_notes!==null)return null
  if(!Array.isArray(v.operations)||!v.operations.length||v.operations.length>40||new TextEncoder().encode(JSON.stringify(v)).length>32000)return null
  const keys=new Map<string,{kind:IntakeKind;revision:number}>(),identities=new Set<string>()
  const ref=(v:unknown,kind:IntakeKind)=>uuid(v)||typeof v==='string'&&v.startsWith('@')&&keys.get(v.slice(1))?.kind===kind
  for(const op of v.operations){
    if(!obj(op)||Object.keys(op).length!==8||!['key','kind','record_id','expected_revision','mode','source_quote','source_seq','fields'].every(k=>Object.hasOwn(op,k))
      ||!str(op.key,40)||!/^[a-z][a-z0-9_]*$/.test(op.key)||keys.has(op.key)||!Object.hasOwn(INTAKE_FIELDS,String(op.kind))
      ||!['existing','proposed'].includes(String(op.mode))||!str(op.source_quote,500)||(op.source_seq!==null&&!rev(op.source_seq))
      ||(op.source_seq===null&&!message.includes(op.source_quote))||!obj(op.fields))return null
    const kind=op.kind as IntakeKind,f=op.fields,create=op.record_id===null
    if(create?op.expected_revision!==0:!uuid(op.record_id)||!rev(op.expected_revision)||identities.has(`${kind}:${op.record_id.toLowerCase()}`))return null
    if(!create)identities.add(`${kind}:${String(op.record_id).toLowerCase()}`)
    if(!Object.keys(f).length||Object.keys(f).some(k=>!Object.hasOwn(INTAKE_FIELDS[kind],k)))return null
    if(kind==='building'&&(create||op.record_id!==v.building_id||!str(f.notes_append,2000)))return null
    if(op.mode==='proposed'&&(kind==='building'||kind==='level'||kind==='measurement'||f.truth!=='ai_assessment'))return null
    for(const [k,max]of Object.entries({name:200,kind:80,subject:200,notes:4000,description:6000}))if(k in f&&!str(f[k],max,['notes','description'].includes(k)))return null
    if(create&&['level','space','element'].includes(kind)&&!str(f.name,200))return null
    if(create&&kind==='element'&&!str(f.kind,80))return null
    if('position'in f&&(!Number.isInteger(f.position)||Number(f.position)<-100||Number(f.position)>100))return null
    if('truth'in f&&!['measured','provided_spec','estimated','ai_assessment','unknown'].includes(String(f.truth)))return null
    if('level_id'in f&&f.level_id!==null&&!ref(f.level_id,'level'))return null
    if('space_id'in f&&f.space_id!==null&&!ref(f.space_id,'space'))return null
    if('measurements'in f){
      if(!Array.isArray(f.measurements)||f.measurements.length>20)return null
      const seen=new Set<string>()
      for(const m of f.measurements){if(!obj(m)||Object.keys(m).length!==2||!ref(m.id,'measurement')||!rev(m.revision)||(String(m.id).startsWith('@')&&keys.get(String(m.id).slice(1))?.revision!==m.revision)||seen.has(String(m.id).toLowerCase()))return null;seen.add(String(m.id).toLowerCase())}
    }
    if(kind==='relationship'){
      if(create&&(!ref(f.subject_space_id,'space')||!ref(f.object_space_id,'space')||!('relation'in f)))return null
      if(!create&&('subject_space_id'in f||'object_space_id'in f))return null
      if('relation'in f&&!['adjacent_to','shares_boundary_with','connects_to','above','below','attached_to'].includes(String(f.relation)))return null
      if(create&&String(f.subject_space_id).toLowerCase()===String(f.object_space_id).toLowerCase())return null
    }
    if(kind==='measurement'){
      if(create&&!['subject','value','unit','truth'].every(k=>k in f))return null
      if(f.truth==='ai_assessment'||('unit'in f&&!['mm','cm','m'].includes(String(f.unit)))||('required'in f&&typeof f.required!=='boolean'))return null
      if('value'in f&&f.value!==null&&(!str(f.value,32)||!/^\d+(?:\.\d{1,3})?$/.test(f.value)||Number(f.value)>1000000))return null
      if(create&&(f.truth==='unknown'?f.value!==null:f.value===null))return null
    }
    keys.set(op.key,{kind,revision:Number(op.expected_revision)+1})
  }
  return{kind:'building_context'as const,record_id:v.building_id as string|null,expected_updated_at:null,expected_revision:Number(v.expected_building_revision),request_quote:v.request_quote as string,
    data:{new_building_name:v.new_building_name,new_building_notes:v.new_building_notes,operations:v.operations}}
}
