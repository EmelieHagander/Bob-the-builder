/** Generic multimodal message support for the shared Responses service; no app-specific data. */
export type OpenAIContentPart =
  | { type: 'text' | 'input_text' | 'output_text'; text: string }
  | { type: 'image_url'; image_url: string | { url: string; detail?: 'auto' | 'low' | 'high' } }
export type OpenAIMessageContent = string | null | OpenAIContentPart[]
/** Opaque Responses items. Preserve provider order, IDs, phases and encrypted
 * reasoning without interpreting or logging the encrypted payload. */
export type OpenAIResponseItem = Record<string, unknown> & { type: string }
export function readResponseItems(value: unknown): OpenAIResponseItem[] {
  if (!Array.isArray(value) || !value.length) throw new Error('native_response_items_missing')
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('native_response_item_invalid')
    if (item.type === 'reasoning') {
      // Persisted responses (the default store) are referenced by item id;
      // the provider refuses encrypted content for them (2026-10-20).
      const stored = item.encrypted_content === undefined && typeof item.id === 'string' && !!item.id
      if (!stored && (typeof item.encrypted_content !== 'string' || !item.encrypted_content)) throw new Error('native_reasoning_content_missing')
    } else if (item.type === 'message') {
      if (item.role !== 'assistant' || !Array.isArray(item.content)) throw new Error('native_response_message_invalid')
    } else if (item.type === 'function_call') {
      if (![item.call_id, item.name, item.arguments].every(v => typeof v === 'string')) throw new Error('native_response_call_invalid')
    } else throw new Error('native_response_item_unsupported')
  }
  return structuredClone(value)
}
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
/** Hydrate only explicit private image references, just before a NEW submission:
 * a stored provider file id when one exists, else inline pixels. No mutation of journaled inputs. Deduplicate a repeated image within this request. */
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
      if (/^file-[A-Za-z0-9_-]{1,120}$/.test(url)) {
        const { image_url: _ref, ...rest } = part
        return { ...rest, file_id: url }
      }
      if (!/^data:image\/(png|jpeg|webp);base64,/.test(url)) throw new Error('invalid_resolved_image')
      return { ...part, image_url: url }
    })) }
  })) }
}
