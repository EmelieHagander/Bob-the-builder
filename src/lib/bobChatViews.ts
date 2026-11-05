import type {ProjectSource,ProjectWriteReceipt} from '../data/provenance'

/** Exact visual evidence may replace a receipt's default preview only for the
 * same revision. Looking at an older model cannot hide newly saved work. */
export function bobChatViews(projectId:string,receipts:ProjectWriteReceipt[]=[],sources:ProjectSource[]=[]){
 const drawings=new Map<string,ProjectWriteReceipt>(),concepts=new Map<string,ProjectWriteReceipt>(),seen=new Map<string,ProjectSource>()
 for(const r of receipts){
  if(r.projectId!==projectId||r.operation==='deleted'||!Number.isSafeInteger(r.revision)||Number(r.revision)<1)continue
  if(r.dataset==='artifacts')drawings.set(`${r.recordId}:${r.revision}`,r)
  if(r.dataset==='solutions'&&Number(r.revision)>Number(concepts.get(r.recordId)?.revision??0))concepts.set(r.recordId,r)
 }
 for(const s of sources)if(s.projectId===projectId&&s.visual)seen.set(s.visual.ref,s)
 for(const s of seen.values()){
  if(s.visual?.kind==='concept'){
   if(concepts.get(s.recordId)?.revision===s.visual.revision)concepts.delete(s.recordId)
  }else drawings.delete(`${s.recordId}:${s.visual?.revision}`)
 }
 return {seen:[...seen.values()],concepts:[...concepts.values()],drawings:[...drawings.values()]}
}
