// Real built UI/data seam; HTTP fixtures cover upload/retry/transcript rendering.
// SQL authority and the actual image-provider payload have separate tests.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright-core'

const base='http://127.0.0.1:4181/Bob-the-builder/',api='https://pwa-proof.invalid'
const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','preview','--base','/Bob-the-builder/','--host','127.0.0.1','--port','4181','--strictPort'],{stdio:'ignore'})
const user={id:crypto.randomUUID(),email:'images@example.test',aud:'authenticated',role:'authenticated',app_metadata:{provider:'email'},user_metadata:{},created_at:'2026-10-10T00:00:00Z'}
const expiresAt=Math.floor(Date.now()/1000)+3600
const token=[JSON.stringify({alg:'HS256',typ:'JWT'}),JSON.stringify({sub:user.id,exp:expiresAt,role:'authenticated'}),'fixture'].map(p=>Buffer.from(p).toString('base64url')).join('.')
const projects=['A','B'].map(id=>({id,slug:id.toLowerCase(),name:`Photo project ${id}`,description:'Plan from a photo',theme:'birch',phase:'concept',location:'',type:'Renovation',start_label:'',start_date:null,end_date:null}))
let browser
try{
  for(let n=0;;n++){
    try{if((await fetch(base)).ok)break}catch{/* starting */}
    assert(n<40&&server.exitCode===null,'Preview did not start');await new Promise(r=>setTimeout(r,250))
  }
  browser=await chromium.launch({executablePath:process.env.CHROME_PATH??'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'})
  await mkdir('test-results',{recursive:true})
  for(const viewport of [{width:320,height:568},{width:390,height:844},{width:1280,height:900}]){
    const context=await browser.newContext({viewport,isMobile:viewport.width<860,hasTouch:viewport.width<860,serviceWorkers:'block'})
    const images=new Map(),threads=new Map(['A','B'].map(id=>[id,{id:crypto.randomUUID(),messages:[]}]))
    const errors=[],sends=[],uploadPaths=[],reservations=[]
    let failUpload=true,loseSend=true,png
    await context.route('https://fonts.googleapis.com/**',route=>route.abort())
    await context.route(`${api}/**`,async route=>{
      const req=route.request(),url=new URL(req.url()),body=req.postDataJSON?.bind(req)
      const respond=options=>route.fulfill({...options,headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info, x-supabase-api-version, accept-profile, content-profile, x-upsert, cache-control','Access-Control-Allow-Methods':'GET, POST, OPTIONS'}})
      if(req.method()==='OPTIONS')return respond({status:204})
      if(url.pathname==='/auth/v1/token')return respond({json:{access_token:token,refresh_token:'fixture',token_type:'bearer',expires_in:3600,expires_at:expiresAt,user}})
      if(url.pathname==='/auth/v1/user')return respond({json:user})
      if(url.pathname==='/rest/v1/projects')return respond({json:projects.filter(p=>!url.searchParams.get('id')||url.searchParams.get('id')===`eq.${p.id}`)})
      if(url.pathname==='/rest/v1/account')return respond({json:{id:'account',name:'Photo fixture',owner_name:'',email:''}})
      if(url.pathname==='/rest/v1/people')return respond({json:[{id:`member${url.searchParams.get('project_id')?.replace('eq.','')??'A'}`,name:'Photo member',initials:'PM',color:'#41513f',role:'Organiser',diet:'',person_skills:[]}]})
      if(url.pathname==='/rest/v1/bob_threads')return respond({json:{id:threads.get(url.searchParams.get('project_id')?.replace('eq.',''))?.id}})
      if(url.pathname==='/rest/v1/bob_messages')return respond({json:[...threads.values()].find(t=>`eq.${t.id}`===url.searchParams.get('thread_id'))?.messages??[]})
      if(url.pathname==='/rest/v1/media_assets'){
        const rows=[...images.values()].filter(m=>(!url.searchParams.get('id')||url.searchParams.get('id')===`eq.${m.id}`)&&(!url.searchParams.get('project_id')||url.searchParams.get('project_id')===`eq.${m.project_id}`))
        return respond({json:req.headers().accept?.includes('vnd.pgrst.object')?rows[0]??null:rows})
      }
      if(url.pathname==='/rest/v1/rpc/media_command'){
        const v=body(),existing=images.get(v.p_media)
        if(v.p_action==='reserve'){
          reservations.push(v.p_media)
          const m={id:v.p_media,project_id:v.p_project,bucket_id:'bob-project-media',object_path:`${v.p_project}/${v.p_media}`,state:'pending',source_kind:'user_upload',created_at:new Date().toISOString(),media_links:[],...v.p_data}
          images.set(m.id,m);return respond({json:m})
        }
        if(v.p_action==='finalize'&&existing?.uploaded){existing.state='ready';return respond({json:existing})}
        return respond({status:400,json:{message:'Image bytes are not stored yet.'}})
      }
      if(url.pathname.startsWith('/storage/v1/object/')){
        const id=url.pathname.split('/').at(-1),image=images.get(id)
        assert(image,'Storage identity must have been reserved')
        if(req.method()==='POST'){
          uploadPaths.push(url.pathname)
          if(failUpload){failUpload=false;return respond({status:503,json:{message:'Interrupted upload'}})}
          image.uploaded=true;return respond({json:{Key:image.object_path}})
        }
        return respond({status:200,body:png,contentType:'image/png'})
      }
      if(url.pathname==='/functions/v1/ask-bob'){
        const v=body()
        if(v.action==='renew_requests')return respond({json:{ok:true,renewed:0}})
        sends.push(v)
        if(loseSend){loseSend=false;return respond({status:503,json:{error:'unavailable'}})}
        const illustration=crypto.randomUUID(),source=images.get(v.imageIds[0])
        images.set(illustration,{...source,id:illustration,object_path:`A/${illustration}`,title:'Build in the place',source_kind:'ai_generated',purpose:'proposal',state:'ready'})
        const evidence={kind:'ai_assessment',sources:[],partial:false,writes:[{projectId:'A',dataset:'media',recordId:illustration,label:'Build in the place',operation:'updated',savedAt:new Date().toISOString()}]}
        const thread=threads.get(v.projectId)
        thread.messages.push({role:'user',text:v.message,turn_id:v.clientTurnId,image_ids:v.imageIds,seq:1,delivery_state:'completed'},
          {role:'assistant',text:'Here is the mockup.',evidence,turn_id:v.clientTurnId,seq:2,delivery_state:'completed'})
        return respond({json:{ok:true,status:'completed',projectId:v.projectId,summary:'Here is the mockup.',evidence}})
      }
      if(url.pathname==='/rest/v1/rpc/bob_chat_inbox')return respond({json:null})
      if(url.pathname==='/rest/v1/rpc/bob_mark_chat_read')return respond({json:null})
      if(url.pathname==='/rest/v1/rpc/project_work_read')return respond({json:{project_id:body().p_project,vocabulary_version:'2026-09-24.1',status:'not_initialized',revision:null,focus_step_id:null,areas:[],steps:[],unorganised_tasks:[]}})
      if(url.pathname==='/rest/v1/rpc/project_plan_read')return respond({json:{record:null}})
      if(url.pathname==='/rest/v1/rpc/drawing_work_list')return respond({json:{items:[],next_cursor:null}})
      if(url.pathname==='/rest/v1/rpc/claim_project_invites')return respond({json:0})
      if(url.pathname==='/rest/v1/rpc/project_invitations')return respond({json:[]})
      if(url.pathname==='/rest/v1/rpc/sharing_directory')return respond({json:{households:[],friends:[]}})
      if(url.pathname==='/rest/v1/rpc/project_sharing_state')return respond({json:{projectId:body().p_project,householdId:null,buildingId:null,revision:0,canManage:false,buildings:[],invitations:[]}})
      if(url.pathname.startsWith('/rest/v1/')&&req.method()==='GET')return respond({json:[]})
      errors.push(`${req.method()} ${url.pathname}`);return respond({status:500,json:{error:'Unexpected fixture request'}})
    })
    const page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message))
    await page.goto(`${base}#/signin`)
    await page.getByRole('button',{name:'Continue as guest',exact:true}).click()
    await page.getByRole('heading',{name:'Home',exact:true}).waitFor()
    await page.getByRole('button',{name:'Open project Photo project A',exact:true}).click()
    const open=async()=>{
      await page.getByRole('button',{name:'Ask bob',exact:true}).click()
      const drawer=page.getByRole('complementary',{name:'Ask bob for Photo project A'})
      await drawer.getByRole('button',{name:'Attach images'}).waitFor();return drawer
    }
    let drawer=await open()
    png=Buffer.from(await page.evaluate(()=>{
      const canvas=document.createElement('canvas');canvas.width=320;canvas.height=180
      const c=canvas.getContext('2d');c.fillStyle='#e4e0cf';c.fillRect(0,0,320,180);c.fillStyle='#566c5a';c.fillRect(20,20,90,100);c.fillStyle='#cfad7f';c.fillRect(0,130,320,50)
      return canvas.toDataURL('image/png').split(',')[1]
    }),'base64')
    await drawer.getByRole('textbox').fill('This is where the build should go. Make a mockup.')
    await drawer.locator('input[type=file]').setInputFiles({name:'room.png',mimeType:'image/png',buffer:png})
    await drawer.getByRole('button',{name:'Retry upload'}).click()
    await drawer.getByText('Ready to send',{exact:true}).waitFor()
    assert.equal(reservations.length,1);assert.equal(uploadPaths.length,2);assert.equal(uploadPaths[0],uploadPaths[1],'retry uses the same storage identity')
    await page.screenshot({path:`test-results/bob-images-${viewport.width}-draft.png`})
    await drawer.getByRole('button',{name:'Send',exact:true}).click()
    await drawer.getByRole('button',{name:'Retry request',exact:true}).click()
    await drawer.getByText('Here is the mockup.',{exact:true}).waitFor()
    assert.equal(sends.length,2);assert.equal(sends[0].clientTurnId,sends[1].clientTurnId);assert.deepEqual(sends[0].imageIds,sends[1].imageIds)
    await drawer.getByRole('button',{name:'Open attached image 1'}).locator('img').waitFor()
    await drawer.getByRole('button',{name:'Open project illustration 1'}).locator('img').waitFor()
    const sendBox=await drawer.getByRole('button',{name:'Send',exact:true}).boundingBox()
    assert(sendBox&&sendBox.height>=44&&sendBox.x+sendBox.width<=viewport.width)
    assert(await drawer.evaluate(el=>el.scrollWidth<=el.clientWidth),'no horizontal overflow')
    await page.screenshot({path:`test-results/bob-images-${viewport.width}-reply.png`})
    await page.reload();drawer=await open()
    await drawer.getByRole('button',{name:'Open attached image 1'}).locator('img').waitFor()
    await drawer.getByRole('button',{name:'Open project illustration 1'}).click()
    await page.getByRole('dialog',{name:'Project illustration',exact:true}).locator('img').waitFor()
    await page.getByRole('dialog',{name:'Project illustration',exact:true}).getByRole('button',{name:'Close',exact:true}).click()
    await drawer.locator('input[type=file]').setInputFiles({name:'phone.heic',mimeType:'image/heic',buffer:png})
    await drawer.getByText('Choose a JPEG, PNG or WebP image. Export HEIC images as JPEG first.',{exact:true}).waitFor()
    assert(await drawer.getByRole('button',{name:'Send',exact:true}).isDisabled())
    await drawer.getByRole('button',{name:'Remove attachment phone.heic',exact:true}).click()
    await drawer.getByRole('button',{name:'Close Ask bob',exact:true}).click()
    await page.goto(base+'#/')
    await page.getByRole('button',{name:'Open project Photo project B',exact:true}).click()
    await page.getByRole('button',{name:'Ask bob',exact:true}).click()
    const other=page.getByRole('complementary',{name:'Ask bob for Photo project B'})
    await other.getByRole('button',{name:'Attach images'}).waitFor()
    assert.equal(await other.getByRole('button',{name:'Open attached image 1'}).count(),0)
    assert.deepEqual(errors,[])
    await writeFile(`test-results/bob-images-${viewport.width}.json`,JSON.stringify({viewport,reservations:reservations.length,uploadRetries:uploadPaths.length,sameTurn:sends[0].clientTurnId===sends[1].clientTurnId},null,2))
    await context.close()
  }
  console.log('Verified chat image upload/retry, exact-turn delivery, mockup/original rendering, reload and project switching at 320/390/1280 px.')
}finally{await browser?.close();server.kill('SIGTERM')}
