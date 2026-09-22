import test from 'node:test'
import assert from 'node:assert/strict'
import { createCadAdapter, parseCadConstruction } from '../supabase/functions/_shared/cad-adapter.ts'

const fixture = () => ({
  version: 1, assembly_id: 'assembly.demo', units: 'mm',
  definitions: [
    { id: 'P-001', kind: 'box', size_mm: [45,70,1600], catalog_part_id: 'part.post', catalog_part_revision: 3 },
    { id: 'P-002', kind: 'tube', outside_diameter_mm: 32, wall_thickness_mm: 2, length_mm: 500 },
  ],
  instances: [
    { id: 'I-001', definition_id: 'P-001', position_mm: [0,0,800], rotation_deg: [0,0,0] },
    { id: 'I-002', definition_id: 'P-002', position_mm: [500,0,1200], rotation_deg: [0,90,0] },
  ], views: ['front','top'],
})

test('CAD contract is generic geometry, mm-only and rejects arbitrary execution fields', () => {
  assert(parseCadConstruction(fixture()))
  assert.equal(parseCadConstruction({ ...fixture(), execute: 'python' }), null)
  const bad = fixture() as any; bad.units = 'in'; assert.equal(parseCadConstruction(bad), null)
  const badKind = fixture() as any; badKind.definitions[0].kind = 'bunk_bed_v1'; assert.equal(parseCadConstruction(badKind), null)
})

test('CAD adapter sends only validated construction and checks build123d response identity', async () => {
  let request: RequestInit | undefined
  const adapter = createCadAdapter({ url: 'https://cad.invalid/', token: 'secret', fetchImpl: async (_url, init) => {
    request = init
    return new Response(JSON.stringify({ ok:true, manifest:{version:1,engine:'build123d',assembly_id:'assembly.demo',units:'mm',bbox_mm:{min:[0,0,0],max:[1,1,1]},definitions:[],instances:['I-001','I-002'],files:{step:'assembly.step',views:{front:'front.svg',top:'top.svg'}}}, step_base64:'SVNPLTEwMzAzLTIxO0VORA==', views:{front:'<svg></svg>',top:'<svg></svg>'} }), { status:200, headers:{'content-type':'application/json'} })
  } })
  const result = await adapter.render(fixture())
  assert.equal(result.manifest.engine, 'build123d')
  assert.equal((request?.headers as Record<string,string>).Authorization, 'Bearer secret')
  const sent = JSON.parse(String(request?.body)); assert.equal(sent.units, 'mm'); assert(!('execute' in sent))
})

test('CAD adapter rejects a response for another assembly', async () => {
  const adapter = createCadAdapter({ url:'https://cad.invalid', token:'secret', fetchImpl: async () => new Response(JSON.stringify({ok:true,manifest:{engine:'build123d',assembly_id:'other',units:'mm'},step_base64:'abcdefghijklmnop',views:{front:'<svg></svg>',top:'<svg></svg>'}}),{status:200}) })
  await assert.rejects(adapter.render(fixture()), /cad_invalid_response/)
})
