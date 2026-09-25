/** Blank sizes and counts from the saved recipe; no inferred stock or grain direction. */
export function cadParts(recipe:Record<string,any>){
 const definitions=Array.isArray(recipe.definitions)?recipe.definitions:[]
 const instances=Array.isArray(recipe.instances)?recipe.instances:[]
 return definitions.map((d:any)=>({id:String(d.id),material:String(d.material_ref??''),
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
