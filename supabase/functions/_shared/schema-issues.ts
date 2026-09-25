/** Bounded, content-free diagnostics. Domain validators remain authoritative. */
export type SchemaIssue = { path:string; expected:string }
export function schemaIssues(schema:Record<string,any>, value:unknown, path='$', depth=0):SchemaIssue[]{
  if(depth>12)return []
  const fail=(expected:string)=>[{path,expected}]
  if(schema.anyOf){const results=schema.anyOf.map((s:Record<string,any>)=>schemaIssues(s,value,path,depth+1));return results.sort((a:SchemaIssue[],b:SchemaIssue[])=>a.length-b.length)[0]??[]}
  const types=Array.isArray(schema.type)?schema.type:[schema.type]
  const type=value===null?'null':Array.isArray(value)?'array':typeof value
  if(schema.type&&!types.includes(type)&&!(type==='number'&&Number.isInteger(value)&&types.includes('integer')))return fail(types.join(' | '))
  if(schema.enum&&!schema.enum.includes(value))return fail('one of '+schema.enum.join(', '))
  if(typeof value==='number'&&(!Number.isFinite(value)||schema.minimum!==undefined&&value<schema.minimum||schema.exclusiveMinimum!==undefined&&value<=schema.exclusiveMinimum||schema.maximum!==undefined&&value>schema.maximum))return fail(`finite number ${schema.exclusiveMinimum!==undefined?'> '+schema.exclusiveMinimum:'>= '+(schema.minimum??'-infinity')} and <= ${schema.maximum??'infinity'}`)
  if(typeof value==='string'&&(schema.maxLength!==undefined&&value.length>schema.maxLength||schema.minLength!==undefined&&value.length<schema.minLength||schema.pattern&&!new RegExp(schema.pattern).test(value)))return fail('string matching declared length/pattern')
  if(Array.isArray(value)){
    if(schema.maxItems!==undefined&&value.length>schema.maxItems||schema.minItems!==undefined&&value.length<schema.minItems)return fail(`array of ${schema.minItems??0}–${schema.maxItems??'bounded'} items`)
    return schema.items?value.slice(0,512).flatMap((v,i)=>schemaIssues(schema.items,v,`${path}[${i}]`,depth+1)).slice(0,12):[]
  }
  if(value&&typeof value==='object'){
    const object=value as Record<string,unknown>,issues:SchemaIssue[]=[]
    for(const k of schema.required??[])if(!Object.hasOwn(object,k))issues.push({path:path+'.'+k,expected:'required field'})
    for(const [k,v] of Object.entries(object)){
      if(schema.properties?.[k])issues.push(...schemaIssues(schema.properties[k],v,path+'.'+k,depth+1))
      else if(schema.additionalProperties===false)issues.push({path:path+'.'+k,expected:'remove unsupported field'})
      if(issues.length>=12)break
    }
    return issues.slice(0,12)
  }
  return []
}
