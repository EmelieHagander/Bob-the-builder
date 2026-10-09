/** Explicit catalog injection for domain tests. Provider-wire tests use the
 * same database seed and catalog binder before the real provider adapter. */
import {catalogFixture,catalogCall,DRAWING_REVIEW_INSTRUCTION} from './ai-catalog-fixture.ts'
import type {AiCatalogSession} from '../../supabase/functions/_shared/ai-catalog.ts'
import {createCadAssistant as cad} from '../../supabase/functions/_shared/cad-assistant.ts'
import {collectCadResearch as research} from '../../supabase/functions/_shared/cad-research.ts'
import {createPlanAssistant as plan} from '../../supabase/functions/_shared/plan-assistant.ts'
import {prepareWorkingContext as context} from '../../supabase/functions/_shared/bob-working-context.ts'
import {createDeliveryLanguage as language} from '../../supabase/functions/_shared/delivery-language.ts'
import {drawingResumeReply as resume} from '../../supabase/functions/_shared/drawing-resume-reply.ts'
import {createProjectContext as images} from '../../supabase/functions/_shared/project-context/dispatcher.ts'
export * from '../../supabase/functions/_shared/plan-assistant.ts'
export * from '../../supabase/functions/_shared/bob-working-context.ts'
export * from '../../supabase/functions/_shared/delivery-language.ts'
export * from '../../supabase/functions/_shared/drawing-resume-reply.ts'
export * from '../../supabase/functions/_shared/project-context/dispatcher.ts'
export * from '../../supabase/functions/_shared/drawing-review.ts'
export {DRAWING_REVIEW_INSTRUCTION}
export function createCadAssistant(opts:Omit<Parameters<typeof cad>[0],'aiCatalog'>&{aiCatalog?:AiCatalogSession}){const session=opts.aiCatalog??catalogFixture();return cad({...opts,aiCatalog:session,callModel:catalogCall(opts.callModel,session)})}
export function collectCadResearch(opts:Omit<Parameters<typeof research>[0],'aiCatalog'>&{aiCatalog?:AiCatalogSession}){const session=opts.aiCatalog??catalogFixture();return research({...opts,aiCatalog:session,callModel:catalogCall(opts.callModel,session)})}
export function createPlanAssistant(opts:Omit<Parameters<typeof plan>[0],'aiCatalog'>&{aiCatalog?:AiCatalogSession}){const session=opts.aiCatalog??catalogFixture();return plan({...opts,aiCatalog:session,callModel:catalogCall(opts.callModel,session)})}
export function prepareWorkingContext(opts:Parameters<typeof context>[0]){return context({...opts,get deadline(){return opts.deadline},callModel:catalogCall(opts.callModel)})}
export function createDeliveryLanguage(opts:Parameters<typeof language>[0]&{aiCatalog?:AiCatalogSession}){return language({...opts,callModel:catalogCall(opts.callModel,opts.aiCatalog??catalogFixture())})}
export function drawingResumeReply(opts:Parameters<typeof resume>[0]){return resume({...opts,callModel:catalogCall(opts.callModel)})}
export function createProjectContext(opts:Parameters<typeof images>[0]){return images({...opts,reviewInstruction:opts.reviewInstruction??DRAWING_REVIEW_INSTRUCTION,imageEvidenceInstruction:opts.imageEvidenceInstruction??catalogFixture().text('images.evidence-intro'),reviewLabel:opts.reviewLabel??catalogFixture().text('images.review-label')})}
