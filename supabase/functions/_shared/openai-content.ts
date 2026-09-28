/** Generic multimodal message support for the shared Responses service; no app-specific data. */
export type OpenAIContentPart =
  | { type: 'text' | 'input_text' | 'output_text'; text: string }
  | { type: 'image_url'; image_url: string | { url: string; detail?: 'auto' | 'low' | 'high' } }
export type OpenAIMessageContent = string | null | OpenAIContentPart[]
export function responseMessageContent(role: 'user' | 'assistant', value: OpenAIMessageContent): Array<Record<string, unknown>> {
  const textType = role === 'user' ? 'input_text' : 'output_text'
  if (typeof value === 'string' || value === null) return [{ type: textType, text: value ?? '' }]
  return value.map(part => {
    if (part.type === 'text' || part.type === 'input_text' || part.type === 'output_text') return { type: textType, text: part.text }
    if (part.type === 'image_url' && role === 'user') {
      const url = typeof part.image_url === 'string' ? part.image_url : part.image_url.url
      const detail = typeof part.image_url === 'string' ? 'auto' : (part.image_url.detail ?? 'auto')
      if (typeof url !== 'string' || !url || !['auto', 'low', 'high'].includes(detail)) throw new Error('Invalid image content')
      return { type: 'input_image', image_url: url, detail }
    }
    // Never silently strip an image and let an answer pretend it was viewed.
    throw new Error('Unsupported multimodal content')
  })
}
export function hasImageContent(messages?: Array<{ content: OpenAIMessageContent }>): boolean {
  return !!messages?.some(m => Array.isArray(m.content) && m.content.some(p => p.type === 'image_url'))
}
/** Hydrate only explicit private image references, just before a NEW submission.
 * No mutation of journaled inputs. Deduplicate a repeated image within this request. */
export async function prepareResponseImages(request: Record<string, unknown>, resolve?: (ref: string) => Promise<string>): Promise<Record<string, unknown>> {
  const images = new Map<string, Promise<string>>()
  const input = request.input
  if (!Array.isArray(input)) return request
  return { ...request, input: await Promise.all(input.map(async message => {
    if (!Array.isArray(message.content)) return message
    return { ...message, content: await Promise.all(message.content.map(async (part: Record<string, unknown>) => {
      if (part.type !== 'input_image' || typeof part.image_url !== 'string' || !part.image_url.startsWith('private-image:')) return part
      if (!resolve) throw new Error('private_image_resolver_missing')
      if (!images.has(part.image_url)) images.set(part.image_url, resolve(part.image_url))
      const url = await images.get(part.image_url)!
      if (!/^data:image\/(png|jpeg|webp);base64,/.test(url)) throw new Error('invalid_resolved_image')
      return { ...part, image_url: url }
    })) }
  })) }
}
