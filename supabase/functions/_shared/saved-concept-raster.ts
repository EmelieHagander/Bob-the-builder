import {createSavedDrawingHandler,type SavedViewRecord} from './saved-drawing-raster.ts'
import {parseDesignIntent} from './project-design-intent.ts'
import {conceptSvg} from './solution-concept.ts'
export async function conceptSourceSvg(record:SavedViewRecord & {model_json?:string}){
 if(typeof record.model_json!=='string'||new TextEncoder().encode(record.model_json).length>48000)throw Error('saved_concept_unavailable')
 const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(record.model_json)))].map(n=>n.toString(16).padStart(2,'0')).join('')
 if(hash!==record.source_sha256)throw Error('saved_concept_changed')
 const intent=parseDesignIntent(JSON.parse(record.model_json));if(!intent?.model)throw Error('saved_concept_unavailable')
 return conceptSvg(intent,record.view)
}
export function createSavedConceptHandler(opts:Parameters<typeof createSavedDrawingHandler>[0]){
 const handler=createSavedDrawingHandler({...opts,sourceSvg:conceptSourceSvg})
 return async(req:Request)=>{
  if(req.method!=='POST')return handler(req)
  try{
   const body=await req.text();if(body.length>1500)throw Error()
   const pin=JSON.parse(body)
   if(Object.keys(pin).sort().join(',')!=='project_id,revision,solution_id,source_sha256,view')throw Error()
   const {solution_id,...rest}=pin
   return handler(new Request(req.url,{method:'POST',headers:req.headers,body:JSON.stringify({...rest,artifact_id:solution_id})}))
  }catch{return new Response(null,{status:400,headers:{'Access-Control-Allow-Origin':'*','Cache-Control':'no-store'}})}
 }
}
