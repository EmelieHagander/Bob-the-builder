import {test} from 'node:test'
import assert from 'node:assert/strict'
import {snapMm,nudgeMm,turnQuarter,footprintOverlaps,shellFootprint,SHELL_GRID_MM} from '../src/lib/cadShell.ts'

const box=(x:number,y:number)=>({min:[0,0,0],max:[x,y,1000],size:[x,y,1000]})

test('owner moves snap to whole-mm grid positions',()=>{
 assert.equal(SHELL_GRID_MM,50)
 assert.equal(snapMm(3812),3800)
 assert.equal(snapMm(3826),3850)
 assert.equal(snapMm(-24),0)
 assert.ok(Object.is(snapMm(-10),0),'no negative zero')
 assert.equal(snapMm(-76),-100)
 assert.equal(snapMm(123,10),120)
})

test('nudges move one grid step, or onto the next grid line when off the grid',()=>{
 assert.equal(nudgeMm(3800,1),3850)
 assert.equal(nudgeMm(3800,-1),3750)
 assert.equal(nudgeMm(3812,1),3850)
 assert.equal(nudgeMm(3812,-1),3800)
 assert.ok(Object.is(nudgeMm(-30,1),0),'no negative zero')
 assert.equal(nudgeMm(0,-1),-50)
})

test('a quarter turn keeps the footprint centred and stays a quarter turn',()=>{
 const bed={x_mm:3800,y_mm:200,rz:90,bounding_box_mm:box(2100,900)}
 const before=shellFootprint(bed)!
 const turned=turnQuarter(bed)
 assert.deepEqual(turned,{x_mm:4400,y_mm:1700,rz:180})
 const after=shellFootprint({...bed,...turned})!
 assert.equal(after.x+after.width/2,before.x+before.width/2)
 assert.equal(after.y+after.depth/2,before.y+before.depth/2)
 assert.equal(after.width,before.depth,'width and depth swap')
 assert.equal(turnQuarter({...bed,rz:270}).rz,0)
 assert.deepEqual(turnQuarter({x_mm:10,y_mm:20,rz:0,bounding_box_mm:null}),{x_mm:10,y_mm:20,rz:90},'no size: turns about its origin')
 let p={...bed}
 for(let i=0;i<4;i++)p={...p,...turnQuarter(p)}
 assert.deepEqual([p.x_mm,p.y_mm,p.rz],[3800,200,90],'four turns come back')
})

test('footprint overlap flags crossing pieces, not furniture inside a room or touching edges',()=>{
 const room={x:0,y:0,width:4000,depth:3200}
 const at=(x:number,y:number,w:number,d:number)=>({x,y,width:w,depth:d})
 assert.deepEqual(footprintOverlaps([{key:'room',footprint:room},{key:'bed',footprint:at(2900,200,900,2100)}]),[],'inside the room')
 assert.deepEqual(footprintOverlaps([{key:'room',footprint:room},{key:'bed',footprint:at(3200,200,900,2100)}]),[['room','bed']],'crosses the wall')
 assert.deepEqual(footprintOverlaps([{key:'room',footprint:room},{key:'bed',footprint:at(4000,0,900,2100)}]),[],'touching edge')
 assert.deepEqual(footprintOverlaps([{key:'a',footprint:at(0,0,900,2000)},{key:'b',footprint:at(0,0,900,2000)}]),[['a','b']],'identical footprints overlap')
 assert.deepEqual(footprintOverlaps([{key:'a',footprint:at(0,0,900,2000)},{key:'b',footprint:null},{key:'c',footprint:at(500,500,900,900)}]),[['a','c']])
})
