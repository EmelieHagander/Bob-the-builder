import type {ProjectSource,ProjectWriteReceipt} from '../data/provenance'

/** Exact visual evidence may replace a receipt's default preview only for the
 * same revision. Looking at an older model cannot hide newly saved work. */
export function bobChatViews(projectId:string,receipts:ProjectWriteReceipt[]=[],sources:ProjectSource[]=[]){
 const drawings=new Map<string,ProjectWriteReceipt>(),concepts=new Map<string,ProjectWriteReceipt>(),seen=new Map<string,ProjectSource>()
 const latestConcept=new Map<string,number>()
 for(const r of receipts){
  if(r.projectId!==projectId||r.operation==='deleted'||!Number.isSafeInteger(r.revision)||Number(r.revision)<1)continue
  if(r.dataset==='artifacts')drawings.set(`${r.recordId}:${r.revision}`,r)
  if(r.dataset==='solutions'){
   concepts.set(`${r.recordId}:${r.revision}`,r)
   latestConcept.set(r.recordId,Math.max(latestConcept.get(r.recordId)??0,Number(r.revision)))
  }
 }
 for(const s of sources)if(s.projectId===projectId&&s.visual)seen.set(s.visual.ref,s)
 for(const s of seen.values()){
  if(s.visual?.kind==='concept'){
   concepts.delete(`${s.recordId}:${s.visual.revision}`)
  }else drawings.delete(`${s.recordId}:${s.visual?.revision}`)
 }
 const savedConcepts=[...concepts.values()]
 return {
  seen:[...seen.values()],
  concepts:savedConcepts.filter(r=>r.revision===latestConcept.get(r.recordId)),
  earlierConcepts:savedConcepts.filter(r=>r.revision!==latestConcept.get(r.recordId)),
  drawings:[...drawings.values()],
 }
}
