import type {WorkingContext} from './bob-working-context.ts'
/** Small helpers must see the same actual conversation as Bob. In stair mode
 * summary is intentionally empty and recent holds only the current request. */
export function helperConversation(context:WorkingContext|undefined,continued=false){
 if(!continued||!context?.stair)return {memory_summary:context?.summary??null,recent_conversation:(context?.recent??[]).slice(-6).map(({role,text})=>({role,text:text.slice(0,2000)}))}
 const stair=context.stair
 return {memory_summary:stair.summaries.map(s=>({from:s.seqFrom,through:s.seqTo,text:s.text})),
  recent_conversation:[...stair.raw,...context.recent].filter((m,i,a)=>a.findIndex(other=>other.seq===m.seq)===i).slice(-8).map(({seq,role,text})=>({seq,role,text:text.slice(0,2000)}))}
}
