import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createCadTransport} from '../supabase/functions/_shared/cad-transport.ts'
import type {CadAssemblyRequest} from '../supabase/functions/_shared/cad-adapter.ts'
const recipe:CadAssemblyRequest={contract_version:1,units:'mm',assembly_id:'fixture',definitions:[{id:'part',primitive:'box',x_mm:10,y_mm:20,z_mm:30,material_ref:null}],instances:[{id:'one',definition_id:'part',placement:{x:0,y:0,z:0,rx:0,ry:0,rz:0}}],views:['front']}
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jx1sAAAAASUVORK5CYII='
const hash=async(encoded:string)=>Buffer.from(await crypto.subtle.digest('SHA-256',Buffer.from(encoded,'base64'))).toString('hex')
async function packet(){const files={step:Buffer.from('ISO-10303-21').toString('base64'),front:Buffer.from('<svg/>').toString('base64')},bounds={min:[0,0,0],max:[10,20,30],size:[10,20,30]}
 return {files,previews:{front:png},manifest:{contract_version:1,assembly_id:'fixture',engine:{name:'build123d',version:'0.13.0',units:'mm'},definitions:recipe.definitions,instances:[{id:'one',definition_id:'part',bounding_box_mm:bounds}],bounding_box_mm:bounds,exports:{step:{file:'assembly.step',sha256:await hash(files.step)},front:{file:'front.svg',sha256:await hash(files.front)}},previews:{front:{file:'front.png',sha256:await hash(png),source_sha256:await hash(files.front)}}}}
}
test('transport delivers bounded PNG views only with valid hashes bound to the exact SVG exports',async()=>{
 const p=await packet();const fetcher=(async()=>new Response(JSON.stringify(p))) as typeof fetch
 assert.equal((await createCadTransport('https://fixture.invalid/render','fixture',fetcher)(recipe)).previews?.front,png)
 p.manifest.previews.front.source_sha256='0'.repeat(64)
 await assert.rejects(createCadTransport('https://fixture.invalid/render','fixture',fetcher)(recipe),/invalid_cad_preview/)
})
test('missing or corrupted previews cannot masquerade as visual feedback',async()=>{
 const p=await packet();p.previews.front='not png'
 await assert.rejects(createCadTransport('https://fixture.invalid/render','fixture',(async()=>new Response(JSON.stringify(p))) as typeof fetch)(recipe),/invalid_cad_preview/)
})
