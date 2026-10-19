import type {ParameterPlan} from '../../supabase/functions/_shared/cad-parameters.ts'
export function repeatedParts(count=5){
 const recipe:any={contract_version:1,units:'mm',assembly_id:'slats',definitions:[{id:'slat',primitive:'box',material_ref:null,x_mm:18,y_mm:80,z_mm:600}],instances:[],views:['front'],arrays:[{id:'slats',definition_id:'slat',axis:'x',count}]}
 const plan:ParameterPlan={version:1,frames:[],nodes:[
  {id:'width',role:'decision',value:18,unit:'mm',reason:'Synthetic panel thickness'},
  {id:'depth',role:'decision',value:80,unit:'mm',reason:'Synthetic depth'},
  {id:'height',role:'decision',value:600,unit:'mm',reason:'Synthetic height'},
  {id:'spacing',role:'decision',value:100,unit:'mm',reason:'Synthetic centre spacing'},
  {id:'origin',role:'decision',value:0,unit:'mm',reason:'Shared datum'},
  {id:'angle',role:'decision',value:0,unit:'deg',reason:'Shared axes'},
 ],bindings:[{path:'definitions/slat/x_mm',node:'width'},{path:'definitions/slat/y_mm',node:'depth'},{path:'definitions/slat/z_mm',node:'height'},
  {path:'arrays/slats/spacing_mm',node:'spacing'},...['x','y','z','rx','ry','rz'].map(k=>({path:'arrays/slats/start/'+k,node:k.startsWith('r')?'angle':'origin'}))]}
 return {recipe,plan}
}
