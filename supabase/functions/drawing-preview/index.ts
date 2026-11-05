import {createClient} from 'npm:@supabase/supabase-js@2.110.2'
import {rasterSavedView} from '../_shared/saved-view-engine.ts'
import {createSavedDrawingHandler} from '../_shared/saved-drawing-raster.ts'
const url=Deno.env.get('SUPABASE_URL')!,key=Deno.env.get('SUPABASE_ANON_KEY')!
Deno.serve(createSavedDrawingHandler({
 read:async(authorization,pin,svg)=>{
  const caller=createClient(url,key,{db:{schema:'bob'},global:{headers:{Authorization:authorization}},auth:{persistSession:false,autoRefreshToken:false}})
  const user=await caller.auth.getUser(authorization.slice(7));if(user.error||!user.data.user)return null
  const {data,error}=await caller.rpc('read_saved_drawing_view',{p_project:pin.project_id,p_artifact:pin.artifact_id,p_revision:pin.revision,p_view:pin.view,p_svg:svg})
  if(error)throw Error('saved_view_unavailable');return data
 },
 raster:rasterSavedView,
}))
