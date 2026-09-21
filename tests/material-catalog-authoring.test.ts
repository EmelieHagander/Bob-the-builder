// Candidate review only: use the actual installed CLI to author a correctly named
// migration in a disposable directory. No database, credentials, Git changes or
// workflow changes. The generated identity is reviewed before being committed.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, readdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
test('candidate catalog migration is authored by the installed Supabase CLI, not a fabricated timestamp', async()=>{
 const directory=await mkdtemp(join(tmpdir(),'bob-catalog-author-'))
 const cli=resolve('node_modules/.bin/supabase')
 const run=(args:string[])=>execFileSync(cli,args,{encoding:'utf8',timeout:30000,env:{...process.env,CI:'true'}})
 try{
   const version=run(['--version']).trim()
   const root=run(['--help']);assert.match(root,/migration/)
   assert.match(run(['migration','--help']),/new/)
   assert.match(run(['migration','new','--help']),/workdir/)
   await mkdir(join(directory,'supabase','migrations'),{recursive:true})
   run(['migration','new','material_catalog','--workdir',directory])
   const names=await readdir(join(directory,'supabase','migrations'))
   assert.equal(names.length,1);assert.match(names[0],/^\d{14}_material_catalog\.sql$/)
   const sql=await readFile(new URL('../db/proposed/material_catalog.sql',import.meta.url),'utf8')
   const file=join(directory,'supabase','migrations',names[0]);await writeFile(file,sql)
   assert.equal(await readFile(file,'utf8'),sql)
   console.log('CATALOG_AUTHORED_MIGRATION='+names[0]+' CLI='+version+' SHA256='+createHash('sha256').update(sql).digest('hex'))
 }finally{await rm(directory,{recursive:true,force:true})}
})
