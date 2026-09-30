import {fingerprint, rethrowContinuation} from './bob-job-journal.ts'

export type DrawingDependency={tool:string;args:unknown}
/** Store read instructions, not old source values. Refresh every discovered
 * dependency before suppressing another paid attempt. Oversized/incomplete
 * maps fail closed rather than claiming unchanged inputs. */
export function createDrawingDependencies(previous:DrawingDependency[]=[]){
 const reads=new Map<string,{tool:string;args:unknown;result:unknown}>()
 let complete=previous.length<=128
 return {
  get complete(){return complete},
  async record(tool:string,args:unknown,result:unknown){
   const key=await fingerprint({tool,args})
   if(reads.size>=128&&!reads.has(key)||JSON.stringify(args).length>8000){complete=false;return result}
   reads.set(key,{tool,args:structuredClone(args),result})
   return result
  },
  async refresh(execute:(tool:string,args:unknown)=>Promise<unknown>){
   for(const read of previous.slice(0,128)){
    if(reads.has(await fingerprint(read)))continue
    try{await this.record(read.tool,read.args,await execute(read.tool,read.args))}
    catch(error){rethrowContinuation(error);if(error instanceof Error&&error.message==='project_denied')throw error;await this.record(read.tool,read.args,{status:'unavailable'})}
   }
  },
  plan(){return [...reads.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([,r])=>({tool:r.tool,args:r.args}))},
  async digest(){return fingerprint([...reads.entries()].sort(([a],[b])=>a.localeCompare(b)))},
 }
}
