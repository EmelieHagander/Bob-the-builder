/** Offline call-boundary measurements, not provider token estimates or billing.
 * Only lengths, counters and public tool/role names leave this module. */
import type { OpenAIServiceOptions, OpenAIServiceResponse } from '../../supabase/functions/_shared/openai-service.ts'

const bytes = (value: string) => Buffer.byteLength(value, 'utf8')
const json = (value: unknown) => JSON.stringify(value) ?? ''
const sourceKeys = new Set(['project', 'measurements', 'current_target', 'source_evidence', 'independent_evidence', 'initialEvidence', 'evidence', 'project_catalog'])
const historyKeys = new Set(['previousBrief', 'olderMessages', 'throughSeq', 'summary', 'index', 'messageStates', 'recentWrites', 'recentSources'])

export function measureRuntimeInput(options: OpenAIServiceOptions, history: string[] = []) {
  const content = { system: bytes(options.systemMessage ?? ''), tool_descriptions: 0, parameter_schemas: 0,
    response_schema: options.schema ? bytes(json(options.schema)) : 0, working_frame: 0, project_data: 0,
    history: 0, tool_arguments: 0, tool_results: 0, image_carriers: 0, other_messages: 0 }
  let images = 0
  const classify = (text: string) => {
    if (history.includes(text)) { content.history += bytes(text); return }
    if (text.startsWith('Current project evidence beside the selected images')) {
      const offset = text.indexOf('{')
      if (offset >= 0) { content.working_frame += bytes(text.slice(0, offset)); classify(text.slice(offset)); return }
    }
    // Bob's frame consists of labelled paragraphs and JSON blocks. Keep text
    // outside recognised blocks visible rather than silently dropping it.
    if (text.includes('Fresh project briefing:\n\n')) {
      const marker = 'Fresh project briefing:\n\n', offset = text.indexOf(marker)
      const before = text.slice(0, offset), after = text.slice(offset + marker.length)
      for (const block of before.split('\n\n')) {
        try {
          const value = JSON.parse(block)
          if (value && Object.keys(value).some(k => historyKeys.has(k))) content.history += bytes(block)
          else content.working_frame += bytes(block)
        } catch { content.working_frame += bytes(block) }
      }
      content.working_frame += bytes(marker) + bytes(before) - before.split('\n\n').reduce((n, s) => n + bytes(s), 0)
      content.project_data += bytes(after)
      return
    }
    try {
      const value = JSON.parse(text)
      if (value && !Array.isArray(value) && typeof value === 'object' && json(value) === text) {
        // Attribute exact serialised top-level values; object keys, punctuation
        // and whitespace remain frame overhead, so content bytes still balance.
        let attributed = 0
        for (const [key, item] of Object.entries(value)) {
          const size = bytes(json(item)); attributed += size
          content[sourceKeys.has(key) ? 'project_data' : historyKeys.has(key) ? 'history' : 'working_frame'] += size
        }
        content.working_frame += bytes(text) - attributed
        return
      }
    } catch { /* ordinary messages and server notes */ }
    content.other_messages += bytes(text)
  }
  for (const tool of options.tools ?? []) {
    content.tool_descriptions += bytes(tool.function.description)
    content.parameter_schemas += bytes(json(tool.function.parameters))
  }
  if (options.prompt) classify(options.prompt)
  for (const message of options.messages ?? []) {
    for (const call of message.tool_calls ?? []) content.tool_arguments += bytes(call.function.arguments)
    if (message.role === 'tool') { content.tool_results += bytes(typeof message.content === 'string' ? message.content : json(message.content)); continue }
    if (typeof message.content === 'string') classify(message.content)
    else for (const part of message.content) {
      if (part.type === 'text') classify(part.text)
      else { images++; content.image_carriers += bytes(json(part)) }
    }
  }
  for (const image of options.images ?? []) { images++; content.image_carriers += bytes(json(image)) }
  return {
    content_utf8_bytes: content,
    measured_content_bytes: Object.values(content).reduce((sum, n) => sum + n, 0),
    // Local options only: provider formatting, retained history, image decoding
    // and configured model settings are deliberately not guessed.
    local_input_json_bytes: bytes(json({ systemMessage: options.systemMessage, prompt: options.prompt,
      messages: options.messages, tools: options.tools, schema: options.schema, images: options.images })),
    previous_response: !!options.previousResponseId,
    retained_provider_context_bytes: options.previousResponseId ? null : 0,
    image_count: images, offered_tools: (options.tools ?? []).map(t => t.function.name),
    largest_tools: (options.tools ?? []).map(t => ({ name: t.function.name,
      description_bytes: bytes(t.function.description), parameter_bytes: bytes(json(t.function.parameters)) }))
      .sort((a, b) => b.description_bytes + b.parameter_bytes - a.description_bytes - a.parameter_bytes).slice(0, 5),
  }
}

export function measureRuntimeOutput(result: OpenAIServiceResponse<unknown>) {
  return { status: result.success ? 'ok' : 'failed',
    text_bytes: bytes(typeof result.data === 'string' ? result.data : json(result.data)),
    tool_argument_bytes: (result.toolCalls ?? []).reduce((sum, call) => sum + bytes(call.function.arguments), 0),
    returned_tools: (result.toolCalls ?? []).map(call => call.function.name) }
}
