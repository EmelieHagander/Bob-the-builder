/** These synthetic fixtures explicitly request manufacturing, never classify
 * production instances by a name or infer ownership from a drawing. */
export function manufacturePolicy(recipe:{instances:{id:string}[]}) {
 return {version:1,instances:recipe.instances.map(i=>({instance_id:i.id,role:'build_part',quantity_policy:'manufacture',
  reason:'The synthetic fixture explicitly requests this instance as a newly manufactured part.'}))}
}
