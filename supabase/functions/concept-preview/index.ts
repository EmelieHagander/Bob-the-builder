import {createClient} from 'npm:@supabase/supabase-js@2.110.2'
import {createSavedConceptHandler} from '../_shared/saved-concept-raster.ts'
import {rasterSavedView} from '../_shared/saved-view-engine.ts'
const url=Deno.env.get('SUPABASE_URL')!,key=Deno.env.get('SUPABASE_ANON_KEY')!
Deno.serve(createSavedConceptHandler({raster:rasterSavedView,
 read:async(authorization,pin,model)=>{
  const caller=createClient(url,key,{db:{schema:'bob'},global:{headers:{Authorization:authorization}},auth:{persistSession:false,autoRefreshToken:false}})
  const user=await caller.auth.getUser(authorization.slice(7));if(user.error||!user.data.user)return null
  const {data,error}=await caller.rpc('read_saved_solution_view',{p_project:pin.project_id,p_solution:pin.artifact_id,p_revision:pin.revision,p_view:pin.view,p_model:model})
  if(error)throw Error('saved_concept_unavailable');return data?.solution_id?{...data,artifact_id:data.solution_id}:null
 }}))