import type { AiCatalogSession } from './ai-catalog.ts'
import { guideThumbnail } from './cad-transport.ts'
import { type ArtClaim, guideArtDirection, guideArtReview, resolveItemArt } from './guide-item-art.ts'
import { callOpenAIResponses, generateImage } from './openai-service.ts'
import type { OpenAIContentPart } from './openai-content.ts'

type Memo = <T>(stream: string, input: unknown, work: () => Promise<T>, reserve?: number) => Promise<T>
type Reference = { contentType: 'image/png' | 'image/jpeg' | 'image/webp'; bytes: Uint8Array; url: string }
type Claimed = Extract<ArtClaim, { status: 'claimed' }>
interface Options {
  memo: Memo
  catalog: AiCatalogSession
  userId: string
  claim: (pin: string, builtin: boolean) => Promise<ArtClaim>
  finish: (pin: string, token: string, png: string | null) => Promise<boolean>
  renew: (pin: string, token: string) => Promise<boolean>
  authorize: () => Promise<boolean>
  reference: (id: string) => Promise<Reference>
}

export function guideArtResolver(opts: Options) {
  return (pin: string, builtin: string | undefined) => {
    const fields = (item: Claimed) => JSON.stringify({ name: item.name, description: item.notes })
    return resolveItemArt(pin, builtin, {
      claim: () =>
        opts.memo('guide-art:lookup', { pin, builtin }, async () => {
          try {
            return await opts.claim(pin, !!builtin)
          } catch {
            return { status: builtin ? 'builtin' : 'unavailable' } as ArtClaim
          }
        }),
      finish: (_, token, png) =>
        opts.memo('guide-art:publish', { pin, token, png }, async () => {
          try {
            return await opts.finish(pin, token, png)
          } catch {
            return false
          }
        }),
    }, (item) =>
      opts.memo('guide-art:draw', { pin, token: item.token }, async () => {
        try {
          if (!await opts.authorize() || !await opts.renew(pin, item.token)) return null
          const reference = item.reference ? await opts.reference(item.reference) : null
          const result = await generateImage({
            app: 'bob',
            coworkerId: 'bob',
            functionName: 'project-image',
            userId: opts.userId,
            aiDefinition: opts.catalog.role('project-image'),
            prompt: guideArtDirection + '\n' + fields(item),
            size: '1024x1024',
            quality: 'low',
            referenceImages: reference ? [reference] : [],
            timeoutMs: 80000,
          })
          if (!result.ok) return null
          return await guideThumbnail(
            Deno.env.get('BOB_CAD_URL'),
            Deno.env.get('BOB_CAD_TOKEN'),
            result.image,
          )
        } catch {
          return null
        }
      }, 105000), (png, item) =>
      opts.memo('guide-art:review', { pin, token: item.token, png }, async () => {
        try {
          if (!await opts.authorize() || !await opts.renew(pin, item.token)) return false
          const content: OpenAIContentPart[] = [{ type: 'text', text: fields(item) }]
          if (item.reference) {
            content.push({ type: 'text', text: 'Product photo' }, {
              type: 'image_url',
              image_url: (await opts.reference(item.reference)).url,
            })
          }
          content.push({ type: 'text', text: 'Identification picture' }, {
            type: 'image_url',
            image_url: 'data:image/png;base64,' + png,
          })
          const result = await callOpenAIResponses<string>({
            app: 'bob',
            coworkerId: 'bob',
            functionName: 'image-describer',
            aiFunction: 'guide-item-review',
            module: 'global',
            userId: opts.userId,
            aiDefinition: opts.catalog.role('image-describer'),
            systemMessage: guideArtReview,
            messages: [{ role: 'user', content }],
            timeoutMs: 18000,
            maxOutputTokens: 256,
          })
          return result.success && result.data?.trim() === 'ACCEPT'
        } catch {
          return false
        }
      }, 32000))
  }
}
