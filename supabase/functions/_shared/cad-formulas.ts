import type {ParameterInput,ParameterUnit} from './cad-parameters.ts'
import {CAD_DIMENSIONS} from './cad-lineage.ts'
import {ZERO_NODE_IDS} from './cad-parameters.ts'

/** Owner decision 2026-11-07 (lean_construction_version 1): a controlling
 * number in the recipe may be written as a formula over named parameter nodes,
 * "D - st" or "(stud_h - hdr_h) / two". Code compiles it into the same saved
 * graph as before: one derived node per operation and one binding per field,
 * so every value still traces to a decision or a measurement with its reason.
 * Entry, 2026-11-07: an 11-part wall took 81 bindings and 27 derived nodes,
 * half of a 26,590-character save Konrad typed in 75-120 s. */
export const FORMULA_NODE_PREFIX='fx.'
export type FormulaIssue={code:string;path:string;message:string}
export class CadFormulaError extends Error {
 constructor(readonly issues:FormulaIssue[]){super('formula_invalid')}
}
type Op='+'|'-'|'*'|'/'
type Ast={kind:'id';id:string}|{kind:'neg';value:Ast}|{kind:'op';op:Op;left:Ast;right:Ast}
const OPERATION={'+':'add_v1','-':'subtract_v1','*':'multiply_v1','/':'divide_v1'} as const
const ID=/^[A-Za-z][A-Za-z0-9_.:-]{0,79}$/
export const FORMULA_PATTERN='^[A-Za-z(-][A-Za-z0-9_.:()+*/ -]{0,399}$'
const FORMULA=new RegExp(FORMULA_PATTERN)

/** Identifiers keep their hyphens when written without spaces ("lw-s1");
 * subtraction is "a - b". Numbers are not formula syntax: a number needs a
 * named node with its reason. */
class FormulaParseError extends Error {
 constructor(code:string,readonly detail=''){super(code)}
}
function tokens(text:string):string[]{
 const out:string[]=[]
 let i=0
 while(i<text.length){
  const c=text[i]
  if(c===' '){i++;continue}
  if('()+*/-'.includes(c)){out.push(c);i++;continue}
  const m=/^[A-Za-z][A-Za-z0-9_.:]*(?:-[A-Za-z0-9_.:]+)*/.exec(text.slice(i))
  if(m){out.push(m[0]);i+=m[0].length;continue}
  throw new FormulaParseError(/[0-9]/.test(c)?'formula_number':'formula_syntax',text.slice(i,i+12))
 }
 return out
}
/** Usual precedence: * and / before + and -, left to right; a leading minus
 * negates the whole product after it ("-two * lum" is -(two * lum)). */
function parse(text:string):Ast{
 const t=tokens(text);let at=0
 const peek=()=>t[at],take=()=>t[at++]
 const primary=():Ast=>{
  const x=take()
  if(x==='('){const e=expr();if(take()!==')')throw new FormulaParseError('formula_syntax');return e}
  if(x===undefined||!ID.test(x))throw new FormulaParseError('formula_syntax',x??'')
  return {kind:'id',id:x}
 }
 const factor=():Ast=>peek()==='-'?(take(),{kind:'neg',value:factor()}):primary()
 const product=():Ast=>{let left=factor();while(peek()==='*'||peek()==='/'){const op=take() as Op;left={kind:'op',op,left,right:factor()}}return left}
 const term=():Ast=>peek()==='-'?(take(),{kind:'neg',value:product()}):product()
 const expr=():Ast=>{let left=term();while(peek()==='+'||peek()==='-'){const op=take() as Op;left={kind:'op',op,left,right:term()}}return left}
 const e=expr()
 if(at!==t.length)throw new FormulaParseError('formula_syntax',t[at])
 return e
}
/** FNV-1a 64-bit: a stable name for one operation, so the same formula gives
 * the same node in every save and edit, and two parts share it. */
function fnv(text:string):string{
 let h=0xcbf29ce484222325n
 for(const ch of new TextEncoder().encode(text)){h^=BigInt(ch);h=(h*0x100000001b3n)&0xffffffffffffffffn}
 return h.toString(16).padStart(16,'0').slice(0,12)
}
export const formulaNodeId=(operation:string,a:string,b:string,rounding:string)=>FORMULA_NODE_PREFIX+fnv(`${operation}|${a}|${b}|${rounding}`)
/** A node named fx. is code's: its name is the hash of what it computes, so a
 * copied one is accepted only unchanged, and code never reuses a name for
 * something else. */
export function validFormulaNode(n:unknown):boolean{
 const x=n as any
 return !!x&&x.role==='derived'&&Array.isArray(x.operands)&&x.operands.length===2&&x.id===formulaNodeId(x.operation,x.operands[0],x.operands[1],x.rounding)
}
const MESSAGES:Record<string,string>={
 formula_number:'Name each number as a parameter node with its reason (a decision or a measurement) and use that name in the formula.',
 formula_syntax:'Write a formula with node names, + - * / and parentheses; put spaces around a minus sign.',
 formula_unknown_node:'The formula names a node that is not in parameter_plan.nodes; a name with a hyphen is one name, so write a minus sign with spaces.',
 formula_unit:'The formula gives another unit than this field takes (mm for sizes and positions, deg for rotations); a negative value needs a node in mm or deg.',
 formula_binding_conflict:'This field has both a formula and a binding; keep one.',
 formula_reserved_id:'Node IDs starting with fx. are made by code from formulas; a copied one must stay exactly as code made it.',
}
const issue=(code:string,path:string,detail=''):FormulaIssue=>({code,path,message:MESSAGES[code]??code,...(detail?{detail}:{})})
/** The fx. nodes a caller wrote that code did not make. */
export function formulaNodeIssues(nodes:unknown,base='nodes'):FormulaIssue[]{
 return Array.isArray(nodes)?nodes.filter((n:any)=>typeof n?.id==='string'&&n.id.startsWith(FORMULA_NODE_PREFIX)&&!validFormulaNode(n)).map((n:any)=>issue('formula_reserved_id',base+'/'+n.id)):[]
}

/** One compiler over a set of known nodes. Generated nodes accumulate, shared
 * by every formula it compiles. valueOf gives a source node's value in mm when
 * it is known, so a field gets its real value before the recipe is checked. */
export function formulaCompiler(known:ParameterInput[],valueOf:(id:string)=>number|undefined=()=>undefined){
 const nodes=new Map(known.map(n=>[n.id,n])),generated=new Map<string,ParameterInput>()
 const units=new Map<string,ParameterUnit|null>(),values=new Map<string,number|undefined>()
 const zero=(id:string)=>id===ZERO_NODE_IDS.mm?'mm':id===ZERO_NODE_IDS.deg?'deg':null
 const node=(id:string)=>nodes.get(id)??generated.get(id)
 const unitOf=(id:string):ParameterUnit|null=>{
  if(units.has(id))return units.get(id)!
  units.set(id,null)
  const n=node(id)
  let u:ParameterUnit|null=zero(id)
  if(!n||u)u=u??null
  else if(n.role==='source')u='mm'
  else if(n.role==='derived'){
   const [a,b]=n.operands.map(unitOf)
   if(n.operation==='add_v1'||n.operation==='subtract_v1')u=a
   else if(n.operation==='multiply_v1')u=a==='scalar'?b:a
   else u=a!==null&&a===b?'scalar':a
  }else u=n.unit
  units.set(id,u);return u
 }
 const valueOfNode=(id:string):number|undefined=>{
  if(values.has(id))return values.get(id)
  values.set(id,undefined)
  const n=node(id)
  let v:number|undefined=zero(id)?0:undefined
  if(n&&v===undefined){
   if(n.role==='decision'||n.role==='estimate')v=n.value
   else if(n.role==='source')v=valueOf(id)
   else if(n.role==='derived'){
    const [a,b]=n.operands.map(valueOfNode)
    if(a!==undefined&&b!==undefined)v=n.operation==='add_v1'?a+b:n.operation==='subtract_v1'?a-b:n.operation==='multiply_v1'?a*b:b!==0?a/b:undefined
   }
  }
  values.set(id,v);return v
 }
 const derive=(op:keyof typeof OPERATION,a:string,b:string):string=>{
  const rounding=op==='+'||op==='-'?'exact':'half_away_6'
  const id=formulaNodeId(OPERATION[op],a,b,rounding)
  if(!nodes.has(id)&&!generated.has(id))generated.set(id,{id,role:'derived',operation:OPERATION[op],operands:[a,b],rounding})
  return id
 }
 const emit=(ast:Ast):string=>{
  if(ast.kind==='id'){
   if(!node(ast.id)&&!zero(ast.id))throw new FormulaParseError('formula_unknown_node',ast.id)
   return ast.id
  }
  if(ast.kind==='neg'){
   const value=emit(ast.value),u=unitOf(value)
   if(u!=='mm'&&u!=='deg')throw new FormulaParseError('formula_unit',value)
   return derive('-',ZERO_NODE_IDS[u],value)
  }
  const a=emit(ast.left),b=emit(ast.right),ua=unitOf(a),ub=unitOf(b)
  // The evaluator's unit rules, checked here so the field is named.
  if(ua!==null&&ub!==null){
   const ok=ast.op==='+'||ast.op==='-'?ua===ub:ast.op==='*'?ua==='scalar'||ub==='scalar':ub==='scalar'||ua===ub
   if(!ok)throw new FormulaParseError('formula_unit',`${ua} ${ast.op} ${ub}`)
  }
  return derive(ast.op,a,b)
 }
 return {
  /** The node a formula ends in (an existing node for a bare name). */
  compile(text:string):string{return emit(parse(text))},
  unitOf,valueOf:valueOfNode,
  generated:()=>[...generated.values()],
 }
}

/** The fields of one recipe object that take a controlling number, with the
 * path its binding uses. */
type Field={path:string;obj:Record<string,unknown>;key:string;placeholder:number}
const place=(path:string,p:unknown,out:Field[])=>{
 if(!p||typeof p!=='object')return
 for(const k of ['x','y','z','rx','ry','rz'])if(k in (p as object))out.push({path:`${path}/${k}`,obj:p as Record<string,unknown>,key:k,placeholder:0})
}
// An outside diameter whose value is not known yet must still leave room for
// the wall, so the recipe rules pass until code asks for the missing value.
const placeholderOf=(k:string)=>k==='outside_diameter_mm'?100000:1
export function definitionFields(d:Record<string,any>,out:Field[]=[]){
 for(const k of CAD_DIMENSIONS)if(k in d)out.push({path:`definitions/${d.id}/${k}`,obj:d,key:k,placeholder:placeholderOf(k)})
 if(Array.isArray(d.cuts))d.cuts.forEach((c:any,i:number)=>{
  if(!c||typeof c!=='object')return
  for(const k of CAD_DIMENSIONS)if(k in c)out.push({path:`definitions/${d.id}/cuts/${i}/${k}`,obj:c,key:k,placeholder:placeholderOf(k)})
  place(`definitions/${d.id}/cuts/${i}/placement`,c.placement,out)
 })
 return out
}
export function instanceFields(i:Record<string,any>,out:Field[]=[]){place(`instances/${i.id}/placement`,i?.placement,out);return out}
function recipeFields(recipe:Record<string,any>):Field[]{
 const out:Field[]=[]
 for(const d of Array.isArray(recipe.definitions)?recipe.definitions:[])if(d&&typeof d==='object')definitionFields(d,out)
 for(const i of Array.isArray(recipe.instances)?recipe.instances:[])if(i&&typeof i==='object')instanceFields(i,out)
 for(const c of Array.isArray(recipe.clearances)?recipe.clearances:[])if(c&&typeof c==='object'&&'min_mm' in c)out.push({path:`clearances/${c.id}/min_mm`,obj:c,key:'min_mm',placeholder:1})
 for(const m of Array.isArray(recipe.motions)?recipe.motions:[])if(m?.delta&&typeof m.delta==='object')for(const k of ['x','y','z'])if(k in m.delta)out.push({path:`motions/${m.id}/delta/${k}`,obj:m.delta,key:k,placeholder:0})
 for(const a of Array.isArray(recipe.arrays)?recipe.arrays:[]){
  if(!a||typeof a!=='object')continue
  if(a.start&&typeof a.start==='object')for(const k of ['x','y','z'])if(k in a.start)out.push({path:`arrays/${a.id}/start/${k}`,obj:a.start,key:k,placeholder:0})
  if('spacing_mm' in a)out.push({path:`arrays/${a.id}/spacing_mm`,obj:a,key:'spacing_mm',placeholder:1})
 }
 return out
}

/** Replace every formula in these fields by a placeholder number and return
 * the bindings and generated nodes. Code computes the real values from the
 * graph, as for any bound field. */
function compileFields(fields:Field[],compiler:ReturnType<typeof formulaCompiler>){
 const bindings:{path:string;node:string}[]=[],issues:FormulaIssue[]=[]
 for(const f of fields){
  const text=f.obj[f.key]
  if(typeof text!=='string')continue
  if(!FORMULA.test(text)){issues.push(issue(/[0-9]/.test(text)&&!/[^A-Za-z0-9_.:()+*/ -]/.test(text)?'formula_number':'formula_syntax',f.path,text.slice(0,40)));continue}
  try{
   const node=compiler.compile(text),unit=compiler.unitOf(node),wants=/\/r[xyz]$/.test(f.path)?'deg':'mm'
   if(unit!==null&&unit!==wants){issues.push(issue('formula_unit',f.path,`${text} is ${unit}`));continue}
   // The real value where the graph already knows it, so the recipe checks
   // see true sizes; code computes it again exactly from the saved graph.
   const value=compiler.valueOf(node)
   bindings.push({path:f.path,node});f.obj[f.key]=value!==undefined&&Number.isFinite(value)?Number(value.toFixed(6)):f.placeholder
  }catch(e){issues.push(issue(e instanceof Error?e.message:'formula_syntax',f.path,e instanceof FormulaParseError?e.detail:''))}
 }
 return {bindings,issues}
}
/** A new construction: the recipe with numbers, and the plan with the
 * formula bindings and their nodes. An array's spacing_mm leaves the recipe,
 * where only its binding is read. valueOf gives source values in mm. */
export function compileSaveFormulas(rawRecipe:unknown,rawPlan:unknown,valueOf?:(id:string)=>number|undefined):{recipe:unknown;plan:unknown}{
 if(!rawRecipe||typeof rawRecipe!=='object'||!rawPlan||typeof rawPlan!=='object')return {recipe:rawRecipe,plan:rawPlan}
 const recipe=structuredClone(rawRecipe) as Record<string,any>,plan=structuredClone(rawPlan) as Record<string,any>
 const declared=Array.isArray(plan.nodes)?plan.nodes:[],explicit=Array.isArray(plan.bindings)?plan.bindings:[]
 const issues=formulaNodeIssues(declared)
 const compiler=formulaCompiler(declared as ParameterInput[],valueOf)
 const out=compileFields(recipeFields(recipe),compiler)
 issues.push(...out.issues)
 if(issues.length)throw new CadFormulaError(issues.slice(0,24))
 // A formula written at the field replaces a binding for the same path, which
 // a keyed sketch may still hold from an earlier call.
 const formulaPaths=new Set(out.bindings.map(b=>b.path))
 if(Array.isArray(recipe.arrays))recipe.arrays=recipe.arrays.map((a:any)=>a&&typeof a==='object'?(({spacing_mm:_s,...rest})=>rest)(a):a)
 plan.nodes=[...declared,...compiler.generated()];plan.bindings=[...explicit.filter((b:any)=>!formulaPaths.has(b?.path)),...out.bindings]
 return {recipe,plan}
}

/** A part edit: the upserted definitions and parts with numbers, plus node
 * and binding upserts for their formulas. A formula field replaces that
 * field's saved binding; a number keeps it. savedNodes carry their computed
 * values (normalized), which give fields their real values. */
export function compileEditFormulas(rawChanges:unknown,savedNodes:(ParameterInput&{normalized?:{value:number}})[],valueOf:(id:string)=>number|undefined=()=>undefined):unknown{
 if(!rawChanges||typeof rawChanges!=='object')return rawChanges
 const changes=structuredClone(rawChanges) as Record<string,any>
 const upserts=(name:string):any[]=>Array.isArray(changes[name]?.upsert)?changes[name].upsert:[]
 const issues=formulaNodeIssues(upserts('nodes'),'changes/nodes')
 const removed=new Set<string>(Array.isArray(changes.nodes?.remove)?changes.nodes.remove:[])
 const known=[...savedNodes.filter(n=>!removed.has(n.id)&&!upserts('nodes').some((u:any)=>u?.id===n.id)),...upserts('nodes')] as ParameterInput[]
 const saved=new Map(savedNodes.map(n=>[n.id,n]))
 const compiler=formulaCompiler(known,id=>valueOf(id)??(removed.has(id)?undefined:saved.get(id)?.normalized?.value))
 const fields:Field[]=[]
 for(const d of upserts('definitions'))if(d&&typeof d==='object')definitionFields(d,fields)
 for(const i of upserts('instances'))if(i&&typeof i==='object')instanceFields(i,fields)
 const out=compileFields(fields,compiler)
 issues.push(...out.issues)
 if(issues.length)throw new CadFormulaError(issues.slice(0,24))
 // New to this change: not in the saved plan, or removed by it and needed again.
 const knownIds=new Set(known.map(n=>n.id))
 const fresh=compiler.generated().filter(n=>!knownIds.has(n.id))
 if(fresh.length){
  const list=changes.nodes??={upsert:[],remove:[]}
  list.upsert.push(...fresh);list.remove=list.remove.filter((r:string)=>!fresh.some(n=>n.id===r))
 }
 if(out.bindings.length){
  // A formula replaces the field's binding; removing that path as well would conflict.
  const list=changes.bindings??={upsert:[],remove:[]},paths=new Set(out.bindings.map(b=>b.path))
  list.upsert=[...list.upsert.filter((b:any)=>!paths.has(b?.path)),...out.bindings];list.remove=list.remove.filter((r:string)=>!paths.has(r))
 }
 return changes
}

/** The formula nodes no binding, formula or frame uses any more; code made
 * them, so code removes them (an edit that changed a formula). */
export function unusedFormulaNodes(nodes:ParameterInput[],bindings:{node:string}[],frameIds:string[]=[]):string[]{
 // A formula node used only by another unused formula node goes too.
 const gone=new Set<string>()
 for(;;){
  const used=new Set([...bindings.map(b=>b.node),...frameIds])
  for(const n of nodes)if(!gone.has(n.id)&&n.role==='derived')n.operands.forEach(o=>used.add(o))
  const more=nodes.filter(n=>n.id.startsWith(FORMULA_NODE_PREFIX)&&!used.has(n.id)&&!gone.has(n.id))
  if(!more.length)return [...gone]
  for(const n of more)gone.add(n.id)
 }
}

/** Any short text: a formula the compiler cannot read is named by its field
 * and kept in the sketch, not refused as a wrong type. */
export const FORMULA_STRING={type:'string',minLength:1,maxLength:400}
