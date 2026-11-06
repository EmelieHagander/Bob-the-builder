import type { OpenAIServiceOptions } from './openai-service.ts'

type Message = NonNullable<OpenAIServiceOptions['messages']>[number]

/** Owner decision 2026-11-06: an opened image stays only while it is in use.
 * Its pixels leave the next request once a result was saved after the model
 * saw them, or at the latest after this many of its answers. The image's text
 * (ref, title, description) stays, and reopening it is one call away. The
 * seed (the owner's current message and its photos) is never changed here. */
export const IMAGE_RELEASE_AFTER_RESPONSES = 3

const ordinaryUser = (m: Message) => m.role === 'user' && m.nativeOutput === undefined && !m.tool_calls?.length && !m.tool_call_id

/** groups[g] = [model answer g, tool results and image carriers after it];
 * an image delivered in group g is first seen by answer g + 1. */
export function releaseUsedImages(input: {
  groups: Message[][]
  /** Opaque identity of a private image this turn opened; undefined keeps it. */
  imageSource: (url: string) => string | undefined
  /** True when the tool call's recorded result was a saved write. */
  saved: (callId: string) => boolean
}): { groups: Message[][]; released: number } {
  const savedIn = input.groups.map(group => group.some(m => m.role === 'tool' && !!m.tool_call_id && input.saved(m.tool_call_id)))
  const last = input.groups.length - 1
  let released = 0
  const groups = input.groups.map((group, g) => {
    if (!savedIn.slice(g + 1).some(Boolean) && last - g < IMAGE_RELEASE_AFTER_RESPONSES) return group
    return group.map(message => {
      if (!ordinaryUser(message) || !Array.isArray(message.content)) return message
      let changed = false
      const content = message.content.map(part => {
        if (part.type !== 'image_url') return part
        const url = typeof part.image_url === 'string' ? part.image_url : part.image_url.url
        const ref = url.startsWith('private-image:') ? input.imageSource(url) : undefined
        if (!ref) return part
        changed = true
        released++
        return { type: 'text' as const, text: JSON.stringify({ image_pixels_released: ref, after_use: true,
          note: 'The pixels of this image left the context after use. Its ref and text above remain; open it again with open_project_item to look.' }) }
      })
      return changed ? { ...message, content } : message
    })
  })
  return { groups, released }
}
