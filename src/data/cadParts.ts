import { cadPartName } from '../lib/labels'

/** Blank size in plain words, as on the drawing sheets: a box's longest side is its length. */
export function cadPartSize(d:Record<string,any>):string{
 if(d.primitive==='box'){const [a,b,c]=[d.x_mm,d.y_mm,d.z_mm].map(Number).sort((p,q)=>p-q);return `${a} × ${b} mm, length ${c} mm`}
 if(d.primitive==='tube')return `Tube, diameter ${d.outside_diameter_mm} mm, wall ${d.wall_thickness_mm} mm, length ${d.length_mm} mm`
 return `Round, diameter ${d.diameter_mm} mm, length ${d.length_mm} mm`
}
/** The drawing's P-numbers per definition ("P1–P4, P7"), from the saved annotation notes. */
export function cadPartMarkers(manifest:Record<string,any>|undefined):Map<string,string>{
 const views=manifest?.annotations?.views,first=views&&typeof views==='object'?Object.values(views)[0] as any:null
 const numbers=new Map<string,number[]>()
 for(const part of Array.isArray(first?.parts)?first.parts:[]){
  const n=Number(String(part?.number??'').replace(/^P/,''))
  if(Number.isInteger(n)&&n>0&&typeof part.definition_id==='string')numbers.set(part.definition_id,[...numbers.get(part.definition_id)??[],n])
 }
 return new Map([...numbers].map(([id,list])=>{
  const runs:number[][]=[]
  for(const n of [...list].sort((a,b)=>a-b)){const last=runs[runs.length-1];if(last&&n===last[1]+1)last[1]=n;else runs.push([n,n])}
  return [id,runs.map(([a,b])=>a===b?`P${a}`:`P${a}–P${b}`).join(', ')]
 }))
}
/** Blank sizes and counts from the saved recipe; no inferred stock or grain direction. */
export function cadParts(recipe:Record<string,any>){
 const definitions=Array.isArray(recipe.definitions)?recipe.definitions:[]
 const instances=Array.isArray(recipe.instances)?recipe.instances:[]
 return definitions.map((d:any)=>({id:String(d.id),name:cadPartName(String(d.id)),size:cadPartSize(d),material:String(d.material_ref??''),
  quantity:instances.filter((i:any)=>i.definition_id===d.id).length,
  dimensions:d.primitive==='box'?`${d.x_mm} × ${d.y_mm} × ${d.z_mm}`:
   d.primitive==='cylinder'?`Ø ${d.diameter_mm} × ${d.length_mm}`:`Ø ${d.outside_diameter_mm} × ${d.length_mm}; wall ${d.wall_thickness_mm}`,
  cuts:Array.isArray(d.cuts)?d.cuts.length:0,
 })).filter(row=>row.quantity>0)
}
export function cadCutListCsv(recipe:Record<string,any>){
 // Quoting plus a prefix avoids spreadsheet formula evaluation in arbitrary saved labels.
 const cell=(v:unknown)=>'"'+String(v).replace(/^[=+\-@\t\r]/,"'$&").replace(/"/g,'""')+'"'
 return [['Part','Material reference','Quantity','Blank dimensions (mm)','Cuts per part'],
  ...cadParts(recipe).map(p=>[p.id,p.material,p.quantity,p.dimensions,p.cuts])].map(row=>row.map(cell).join(',')).join('\r\n')+'\r\n'
}
