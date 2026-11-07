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
function tokens(text:string):string[]{
 const out:string[]=[]
 let i=0
 while(i<text.length){
  const c=text[i]
  if(c===' '){i++;continue}
  if('()+*/-'.includes(c)){out.push(c);i++;continue}
  const m=/^[A-Za-z][A-Za-z0-9_.:]*(?:-[A-Za-z0-9_.:]+)*/.exec(text.slice(i))
  if(m){out.push(m[0]);i+=m[0].length;continue}
  throw new Error(/[0-9]/.test(c)?'formula_number':'formula_syntax')
 }
 return out
}
function parse(text:string):Ast{
 const t=tokens(text);let at=0
 const peek=()=>t[at],take=()=>t[at++]
 const primary=():Ast=>{
  const x=take()
  if(x==='('){const e=expr();if(take()!==')')throw new Error('formula_syntax');return e}
  if(x===undefined||!ID.test(x))throw new Error('formula_syntax')
  return {kind:'id',id:x}
 }
 const unary=():Ast=>peek()==='-'?(take(),{kind:'neg',value:unary()}):primary()
 const term=():Ast=>{let left=unary();while(peek()==='*'||peek()==='/'){const op=take() as Op;left={kind:'op',op,left,right:unary()}}return left}
 const expr=():Ast=>{let left=term();while(peek()==='+'||peek()==='-'){const op=take() as Op;left={kind:'op',op,left,right:term()}}return left}
 const e=expr()
 if(at!==t.length)throw new Error('formula_syntax')
 return e
}
/** FNV-1a 64-bit: a stable name for one operation, so the same formula gives
 * the same node in every save and edit, and two parts share it. */
function fnv(text:string):string{
 let h=0xcbf29ce484222325n
 for(const ch of new TextEncoder().encode(text)){h^=BigInt(ch);h=(h*0x100000001b3n)&0xffffffffffffffffn}
 return h.toString(16).padStart(16,'0').slice(0,12)
}
const MESSAGES:Record<string,string>={
 formula_number:'Name each number as a parameter node with its reason (a decision or a measurement) and use that name in the formula.',
 formula_syntax:'Write a formula with node names, + - * / and parentheses; put spaces around a minus sign.',
 formula_unknown_node:'The formula names a node that is not in parameter_plan.nodes.',
 formula_unit:'A negative value needs a node whose unit is mm or deg.',
 formula_binding_conflict:'This field has both a formula and a binding; keep one.',
 formula_reserved_id:'Node IDs starting with fx. are made by code from formulas.',
}
const issue=(code:string,path:string):FormulaIssue=>({code,path,message:MESSAGES[code]??code})

/** One compiler over a set of known nodes. Generated nodes accumulate, shared
 * by every formula it compiles. */
export function formulaCompiler(known:ParameterInput[]){
 const nodes=new Map(known.map(n=>[n.id,n])),generated=new Map<string,ParameterInput>()
 const units=new Map<string,ParameterUnit|null>()
 const unitOf=(id:string):ParameterUnit|null=>{
  if(units.has(id))return units.get(id)!
  units.set(id,null)
  const n=nodes.get(id)??generated.get(id)
  let u:ParameterUnit|null=null
  if(!n)u=null
  else if(n.role==='source')u='mm'
  else if(n.role==='derived'){
   const [a,b]=n.operands.map(unitOf)
   if(n.operation==='add_v1'||n.operation==='subtract_v1')u=a
   else if(n.operation==='multiply_v1')u=a==='scalar'?b:a
   else u=a!==null&&a===b?'scalar':a
  }else u=n.unit
  units.set(id,u);return u
 }
 const derive=(op:keyof typeof OPERATION,a:string,b:string):string=>{
  const rounding=op==='+'||op==='-'?'exact':'half_away_6'
  const id=FORMULA_NODE_PREFIX+fnv(`${OPERATION[op]}|${a}|${b}|${rounding}`)
  if(!nodes.has(id)&&!generated.has(id))generated.set(id,{id,role:'derived',operation:OPERATION[op],operands:[a,b],rounding})
  return id
 }
 const emit=(ast:Ast):string=>{
  if(ast.kind==='id'){
   if(!nodes.has(ast.id)&&!generated.has(ast.id))throw new Error('formula_unknown_node')
   return ast.id
  }
  if(ast.kind==='neg'){
   const value=emit(ast.value),u=unitOf(value)
   if(u!=='mm'&&u!=='deg')throw new Error('formula_unit')
   return derive('-',ZERO_NODE_IDS[u],value)
  }
  return derive(ast.op,emit(ast.left),emit(ast.right))
 }
 return {
  /** The node a formula ends in (an existing node for a bare name). */
  compile(text:string):string{return emit(parse(text))},
  generated:()=>[...generated.values()],
  uses:(id:string)=>generated.has(id)||nodes.has(id),
 }
}

/** The fields of one recipe object that take a controlling number, with the
 * path its binding uses. */
type Field={path:string;obj:Record<string,unknown>;key:string;placeholder:number}
const place=(path:string,p:unknown,out:Field[])=>{
 if(!p||typeof p!=='object')return
 for(const k of ['x','y','z','rx','ry','rz'])if(k in (p as object))out.push({path:`${path}/${k}`,obj:p as Record<string,unknown>,key:k,placeholder:0})
}
export function definitionFields(d:Record<string,any>,out:Field[]=[]){
 for(const k of CAD_DIMENSIONS)if(k in d)out.push({path:`definitions/${d.id}/${k}`,obj:d,key:k,placeholder:1})
 if(Array.isArray(d.cuts))d.cuts.forEach((c:any,i:number)=>{
  if(!c||typeof c!=='object')return
  for(const k of CAD_DIMENSIONS)if(k in c)out.push({path:`definitions/${d.id}/cuts/${i}/${k}`,obj:c,key:k,placeholder:1})
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
function compileFields(fields:Field[],compiler:ReturnType<typeof formulaCompiler>,bound:Set<string>){
 const bindings:{path:string;node:string}[]=[],issues:FormulaIssue[]=[]
 for(const f of fields){
  const text=f.obj[f.key]
  if(typeof text!=='string')continue
  if(bound.has(f.path)){issues.push(issue('formula_binding_conflict',f.path));continue}
  if(!FORMULA.test(text)){issues.push(issue(/[0-9]/.test(text)?'formula_number':'formula_syntax',f.path));continue}
  try{bindings.push({path:f.path,node:compiler.compile(text)});f.obj[f.key]=f.placeholder}
  catch(e){issues.push(issue(e instanceof Error?e.message:'formula_syntax',f.path))}
 }
 return {bindings,issues}
}
const reserved=(nodes:unknown)=>Array.isArray(nodes)?nodes.filter((n:any)=>typeof n?.id==='string'&&n.id.startsWith(FORMULA_NODE_PREFIX)).map((n:any)=>issue('formula_reserved_id','nodes/'+n.id)):[]

/** A new construction: the recipe with numbers, and the plan with the
 * formula bindings and their nodes. An array's spacing_mm leaves the recipe,
 * where only its binding is read. */
export function compileSaveFormulas(rawRecipe:unknown,rawPlan:unknown):{recipe:unknown;plan:unknown}{
 if(!rawRecipe||typeof rawRecipe!=='object'||!rawPlan||typeof rawPlan!=='object')return {recipe:rawRecipe,plan:rawPlan}
 const recipe=structuredClone(rawRecipe) as Record<string,any>,plan=structuredClone(rawPlan) as Record<string,any>
 const declared=Array.isArray(plan.nodes)?plan.nodes:[],explicit=Array.isArray(plan.bindings)?plan.bindings:[]
 const issues=reserved(declared)
 const compiler=formulaCompiler(declared as ParameterInput[])
 const out=compileFields(recipeFields(recipe),compiler,new Set(explicit.map((b:any)=>b?.path)))
 issues.push(...out.issues)
 if(issues.length)throw new CadFormulaError(issues.slice(0,24))
 if(Array.isArray(recipe.arrays))recipe.arrays=recipe.arrays.map((a:any)=>a&&typeof a==='object'?(({spacing_mm:_s,...rest})=>rest)(a):a)
 plan.nodes=[...declared,...compiler.generated()];plan.bindings=[...explicit,...out.bindings]
 return {recipe,plan}
}

/** A part edit: the upserted definitions and parts with numbers, plus node
 * and binding upserts for their formulas. A formula field replaces that
 * field's saved binding; a number keeps it. */
export function compileEditFormulas(rawChanges:unknown,savedNodes:ParameterInput[]):unknown{
 if(!rawChanges||typeof rawChanges!=='object')return rawChanges
 const changes=structuredClone(rawChanges) as Record<string,any>
 const upserts=(name:string):any[]=>Array.isArray(changes[name]?.upsert)?changes[name].upsert:[]
 const issues=reserved(upserts('nodes'))
 const removed=new Set(Array.isArray(changes.nodes?.remove)?changes.nodes.remove:[])
 const known=[...savedNodes.filter(n=>!removed.has(n.id)&&!upserts('nodes').some((u:any)=>u?.id===n.id)),...upserts('nodes')] as ParameterInput[]
 const compiler=formulaCompiler(known)
 const fields:Field[]=[]
 for(const d of upserts('definitions'))if(d&&typeof d==='object')definitionFields(d,fields)
 for(const i of upserts('instances'))if(i&&typeof i==='object')instanceFields(i,fields)
 const out=compileFields(fields,compiler,new Set(upserts('bindings').map((b:any)=>b?.path)))
 issues.push(...out.issues)
 if(issues.length)throw new CadFormulaError(issues.slice(0,24))
 const saved=new Set(savedNodes.map(n=>n.id))
 const fresh=compiler.generated().filter(n=>!saved.has(n.id))
 if(fresh.length)(changes.nodes??={upsert:[],remove:[]}).upsert.push(...fresh)
 if(out.bindings.length)(changes.bindings??={upsert:[],remove:[]}).upsert.push(...out.bindings)
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

export const FORMULA_STRING={type:'string',pattern:FORMULA_PATTERN,maxLength:400}
