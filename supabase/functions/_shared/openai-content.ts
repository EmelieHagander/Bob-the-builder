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
