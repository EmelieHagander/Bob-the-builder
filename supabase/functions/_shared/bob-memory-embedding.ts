import type { MemoryEmbedder } from './bob-memory-retrieval.ts'
import type { OpenAIServiceResponse } from './openai-service.ts'

type Memo = <T>(stream: string, input: unknown, work: () => Promise<T>, reserve?: number) => Promise<T>

/** Embeddings have no resumable provider response. A durable dispatch marker
 * prevents another paid submission after a lost result checkpoint. The private
 * transcript remains searchable through text when that outcome is unknown. */
export function createJournalledMemoryEmbedder(options: {
  model: string; identity: unknown; memo: Memo;
  invoke(texts: string[]): Promise<OpenAIServiceResponse<number[][]>>;
  hasAccess(): Promise<boolean>; onUncertain(): void;
}): MemoryEmbedder {
  return {
    model: options.model,
    async embed(texts) {
      if (!await options.hasAccess()) throw new Error('project_denied')
      const input = { identity: options.identity, texts }
      let freshDispatch = false
      await options.memo('memory:embedding-start', input, async () => { freshDispatch = true; return true }, 15000)
      const response = await options.memo('memory:embedding-result', input, async () => {
        if (!freshDispatch) return {
          success: false, data: null, model: options.model,
          usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
          error: 'embedding_outcome_unknown', priorAttemptUncertain: true,
        } satisfies OpenAIServiceResponse<number[][]>
        if (!await options.hasAccess()) throw new Error('project_denied')
        return options.invoke(texts)
      })
      if (response.priorAttemptUncertain) options.onUncertain()
      if (!response.success || !response.data) throw new Error('embedding_unavailable')
      if (!await options.hasAccess()) throw new Error('project_denied')
      return response.data
    },
  }
}
