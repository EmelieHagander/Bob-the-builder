/** Build-guide pages (2026-11-14): one page adds one kind of part.
 *
 * Bob names the guide's sections and lists their joints in build order. How
 * many joints fit on one readable page is not judgement but a rule, and leaving
 * it to the model let a whole bunk bed (129 joints, 31 parts) land on a single
 * unreadable page (Våningssäng, construction rev 27, 2026-11-10). So every step
 * Bob gives is drawn as a run of pages where each page adds the parts of one
 * kind (one definition) to what is already built, the way an assembly manual
 * does: "attach the 2 rails", then "screw on the 28 slats". A page that starts
 * a new piece shows the two parts its first joint joins. Joints between parts
 * that are already in place go on the page that brings the last of them.
 * Identical pieces in one step (two end frames) stay on shared pages, so the
 * worker can still draw them once with "2×".
 *
 * Pages only ever split Bob's steps: they never move a joint to another step
 * or section, and every joint is still on exactly one page. */
type Step={joint_ids:string[];section?:string}
type Joint={id:string;first:{instance_id:string};second:{instance_id:string}}

export function guidePages(steps:Step[],joints:Joint[],definitionOf:Record<string,string>,contextIds:string[]=[]):Step[]{
 const ends=new Map(joints.map(j=>[j.id,[j.first.instance_id,j.second.instance_id] as const]))
 const placed=new Set(contextIds),out:Step[]=[]
 for(const step of steps){
  const pieces=components(step.joint_ids,ends).map(ids=>splitPiece(ids,ends,definitionOf,new Set(placed)))
  const shared=pieces.length>1&&pieces.every(p=>p.length===pieces[0].length&&p.every((page,i)=>page.kinds===pieces[0][i].kinds))
  const pages=shared?pieces[0].map((_,i)=>pieces.flatMap(p=>p[i].joint_ids)):pieces.flatMap(p=>p.map(page=>page.joint_ids))
  for(const ids of pages)out.push({joint_ids:ids,...(step.section!==undefined?{section:step.section}:{})})
  for(const id of step.joint_ids)for(const i of ends.get(id)!)placed.add(i)
 }
 return out
}

/** Joints of one step that share parts (directly or through each other), in Bob's order. */
function components(ids:string[],ends:Map<string,readonly [string,string]>):string[][]{
 const parent=new Map<string,string>()
 const find=(a:string):string=>{let r=a;while((parent.get(r)??r)!==r)r=parent.get(r)!;parent.set(a,r);return r}
 for(const id of ids){const [a,b]=ends.get(id)!;parent.set(find(a),find(b))}
 const groups=new Map<string,string[]>()
 for(const id of ids){const root=find(ends.get(id)![0]);if(!groups.has(root))groups.set(root,[]);groups.get(root)!.push(id)}
 return [...groups.values()]
}

function splitPiece(ids:string[],ends:Map<string,readonly [string,string]>,definitionOf:Record<string,string>,placed:Set<string>){
 const pages:{joint_ids:string[];kinds:string}[]=[]
 let left=[...ids]
 const fresh=(id:string)=>ends.get(id)!.filter(i=>!placed.has(i))
 const kind=(i:string)=>definitionOf[i]??i
 while(left.length){
  // Joints between parts already in place close up the page that placed them.
  const closing=left.filter(id=>!fresh(id).length)
  if(closing.length){
   if(pages.length)pages.at(-1)!.joint_ids.push(...closing)
   else pages.push({joint_ids:closing,kinds:''})
   left=left.filter(id=>fresh(id).length);continue
  }
  const reach=left.filter(id=>fresh(id).length===1)
  let take:string[]
  if(reach.length){const k=kind(fresh(reach[0])[0]);take=reach.filter(id=>kind(fresh(id)[0])===k)}
  else take=[left[0]]
  const kinds=[...new Set(take.flatMap(id=>fresh(id).map(kind)))].sort().join('|')
  for(const id of take)for(const i of fresh(id))placed.add(i)
  if(pages.length&&!pages.at(-1)!.kinds)pages.at(-1)!.joint_ids.push(...take),pages.at(-1)!.kinds=kinds
  else pages.push({joint_ids:take,kinds})
  left=left.filter(id=>!take.includes(id))
 }
 return pages
}
