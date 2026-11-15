import type {ToolSpec} from './project-tools/session.ts'
import {workerOperationSpec,type OperationSurface} from './worker-operations.ts'

/** Every design_project_cad field that makes a build guide: build_sections
 * (cad-build-guide-v3, 2026-11-09) and the order field of pinned older catalogs. */
export const BUILD_GUIDE_FIELDS=['build_sections','assembly_dependencies'] as const

/** Server-owned restrictions applied after catalog resolution, at every entry
 * point (native offer, manual, renewal, provider). Never an arbitrary schema. */
export type RuntimeToolSurface={version:1;buildGuides:boolean;operation?:OperationSurface}
export function runtimeToolSpec(spec:ToolSpec,surface:RuntimeToolSurface):ToolSpec{
 if(surface?.version!==1||typeof surface.buildGuides!=='boolean')throw Error('runtime_surface_invalid')
 let out=structuredClone(spec)
 if(out.function.name==='design_project_cad'&&!surface.buildGuides){
  const p=out.function.parameters as any
  for(const field of BUILD_GUIDE_FIELDS){
   if(p.properties)delete p.properties[field]
   if(Array.isArray(p.required))p.required=p.required.filter((k:string)=>k!==field)
  }
 }
 if(surface.operation)out=workerOperationSpec(out,surface.operation)
 return out
}
