import {before,test} from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {createElement} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {build} from 'esbuild'
import {conceptFixture} from './support/solution-concept-fixtures.ts'
let components:any
before(async()=>{
 const bundled=await build({stdin:{contents:"export {BobChatDrawings}from'./src/components/BobChatDrawings.tsx';export {SolutionConcept}from'./src/components/SolutionConcept.tsx'",resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,format:'cjs',platform:'node',jsx:'automatic',external:['react','react/*','react-dom','react-dom/*','react-router-dom'],loader:{'.css':'empty'},plugins:[{name:'no-browser-data',setup(build){build.onResolve({filter:/\/data\/database$/},()=>({path:'database',namespace:'fixture'}));build.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:"export const PROJECT_CHANGED_EVENT='fixture:project';export const getSolutionChatPreview=()=>{throw Error('SSR must not read private data')};export const getProjectDrawingPreview=getSolutionChatPreview;export const recordSolutionPresentation=getSolutionChatPreview;export const recordConstructionPresentation=getSolutionChatPreview;export const readSolutionPresentation=getSolutionChatPreview;"}))}}]})
 const module={exports:{}};new Function('require','module','exports',bundled.outputFiles[0].text)(createRequire(import.meta.url),module,module.exports);components=module.exports
})
test('solution-only reply receipts produce one lazy preview per identity, without eager private reads',()=>{
 const receipt={projectId:'A',dataset:'solutions',recordId:'entry',revision:10,operation:'updated'}
 const html=renderToStaticMarkup(createElement(components.BobChatDrawings,{projectId:'A',receipts:[{...receipt,revision:9},receipt,receipt,{...receipt,projectId:'B'},{...receipt,dataset:'target'},{...receipt,recordId:'removed',operation:'deleted'},{...receipt,recordId:'invalid',revision:0}]}))
 assert.equal((html.match(/class="bob-chat-drawing"/g)??[]).length,1)
})
test('read-only concept uses the existing views, SVG and dimension table without activating owner feedback',()=>{
 const html=renderToStaticMarkup(createElement(components.SolutionConcept,{intent:conceptFixture('barn'),revision:10,projectId:'A',solutionId:'entry',contextActive:false,areaId:null,readOnly:true}))
 assert(html.includes('<svg'));assert(html.includes('Concept views'));assert(html.includes('Concept dimensions'));assert(html.includes('not a measured drawing or construction approval'))
 assert(!html.includes('Model feedback'));assert(!html.includes('Preparing model discussion'));assert(!html.includes('Discuss this model with Bob'))
})
