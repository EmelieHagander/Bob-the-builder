import { rethrowContinuation } from './bob-job-journal.ts'

/** Retrieval is a derived private-thread index, never a second project truth.
 * Relevance belongs to each query. No persistent relevance/archive threshold. */
export const MEMORY_EMBEDDING_DIMENSIONS = 256
export const MEMORY_INDEX_BATCH = 8
export interface MemoryEmbeddingChunk {
  seq: number; chunkStart: number; fingerprint: string; text: string;
}
export interface MemoryEmbeddingWrite {
  seq: number; chunkStart: number; fingerprint: string; embedding: number[];
}
export interface MemoryRetrievalStore {
  exact?(seq: number, offset?: number): Promise<unknown>;
  searchHybrid?(query: string, before: number | null, embedding: number[] | null, model: string): Promise<unknown>;
  indexPending?(limit: number, model: string): Promise<unknown>;
  indexSave?(items: MemoryEmbeddingWrite[], model: string): Promise<unknown>;
  refresh?(expected: number, previousSummary: string, summary: string): Promise<unknown>;
}
export interface MemoryRetrieval {
  read(value: unknown): Promise<{ status: string; [key: string]: unknown }>;
  search(value: unknown): Promise<{ status: string; [key: string]: unknown }>;
  index(): Promise<unknown>;
}
export interface MemoryEmbedder {
  /** Pinned catalog model identity. Model or dimensions changing invalidates the
   * cache; the provider/accounting/journal adapter remains the caller's concern. */
  model: string;
  embed(texts: string[]): Promise<number[][]>;
}
export const READ_HISTORY_TOOL = {
  type: 'function' as const,
  function: {
    name: 'read_conversation_message',
    description: 'Open an original message by sequence in THIS private conversation. Read every page through nextOffset when needed. Conversation is historical context, not proof of current saved project state.',
    parameters: { type: 'object', additionalProperties: false, required: ['seq', 'offset'], properties: {
      seq: { type: 'integer', minimum: 1, description: 'Message sequence from the memory index or a history search source.' },
      offset: { type: ['integer', 'null'], minimum: 0, description: 'Character offset returned as nextOffset, or null to start.' },
    } },
  },
}
export const HYBRID_HISTORY_TOOL = {
  type: 'function' as const,
  function: {
    name: 'search_conversation_history',
    description: 'Find relevant older messages in THIS private conversation using text and semantic search. Results are source-linked excerpts; open original sequences for detail. Empty query browses recent history. Relevance is recalculated for this query.',
    parameters: { type: 'object', additionalProperties: false, required: ['query', 'before_seq'], properties: {
      query: { type: 'string', maxLength: 200, description: 'What is relevant to the current task. Empty string browses recent history.' },
      before_seq: { type: ['integer', 'null'], minimum: 1, description: 'Optional exclusive sequence boundary; for browsing use nextBeforeSeq, otherwise null.' },
    } },
  },
}
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
function rethrowMemoryControl(error: unknown): void {
  rethrowContinuation(error)
  // A provider adapter can intentionally report a definite optional outage as
  // an ordinary error. An unknown dispatched outcome must first be recorded
  // and surfaced by that adapter; never silently reclassify its uncertainty.
  if (object(error) && error.priorAttemptUncertain === true) throw error
}
const integer = (v: unknown, min: number) => Number.isSafeInteger(v) && Number(v) >= min
const fingerprint = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{32}$/.test(v)
const vector = (v: unknown): v is number[] => Array.isArray(v) && v.length === MEMORY_EMBEDDING_DIMENSIONS
  && v.every(n => typeof n === 'number' && Number.isFinite(n)) && v.some(n => n !== 0)
function validChunk(v: unknown): v is MemoryEmbeddingChunk {
  return object(v) && integer(v.seq, 1) && integer(v.chunkStart, 0) && Number(v.chunkStart) % 2000 === 0
    && fingerprint(v.fingerprint)
    && typeof v.text === 'string' && [...v.text].length > 0 && [...v.text].length <= 2000
}
function validMessage(v: unknown): boolean {
  return object(v) && integer(v.seq, 1) && ['user', 'assistant'].includes(String(v.role))
    && typeof v.text === 'string' && [...v.text].length > 0 && [...v.text].length <= 4000
    && ['pending', 'completed', 'failed'].includes(String(v.state))
}

/** Indexing advances in bounded batches on preparation and on demand. Original
 * text is read fresh by SQL and indexed only if its fingerprint still matches.
 * An embedding outage preserves exact/text retrieval; no transcript is erased. */
export function createMemoryRetrieval(options: {
  projectId: string; threadId: string; store: MemoryRetrievalStore;
  embedder?: MemoryEmbedder; hasAccess(): Promise<boolean>;
}): MemoryRetrieval {
  const { store, embedder } = options
  const bound = (value: unknown): value is Record<string, unknown> => object(value)
    && value.projectId === options.projectId && value.threadId === options.threadId
  const model = embedder?.model ?? ''
  const index = async () => {
    if (!embedder || !store.indexPending || !store.indexSave) return { status: 'lexical_only', reason: 'embedding_unavailable' }
    if (!await options.hasAccess()) return { status: 'denied' }
    try {
      const pending = await store.indexPending(MEMORY_INDEX_BATCH, model)
      if (!bound(pending) || !Array.isArray(pending.chunks) || pending.chunks.length > MEMORY_INDEX_BATCH
        || !pending.chunks.every(validChunk) || typeof pending.hasMore !== 'boolean') return { status: 'unavailable' }
      const chunks = pending.chunks as MemoryEmbeddingChunk[]
      if (new Set(chunks.map(c => `${c.seq}:${c.chunkStart}`)).size !== chunks.length) return { status: 'unavailable' }
      if (!chunks.length) return { status: 'indexed', indexed: 0, remaining: false }
      const embeddings = await embedder.embed(chunks.map(c => c.text))
      if (!Array.isArray(embeddings) || embeddings.length !== chunks.length || !embeddings.every(vector)) return { status: 'unavailable' }
      if (!await options.hasAccess()) return { status: 'denied' }
      const saved = await store.indexSave(chunks.map((c, i) => ({ seq: c.seq, chunkStart: c.chunkStart, fingerprint: c.fingerprint, embedding: embeddings[i] })), model)
      if (!bound(saved) || saved.saved !== chunks.length) return { status: 'unavailable' }
      return { status: 'indexed', indexed: chunks.length, remaining: pending.hasMore === true }
    } catch (error) { rethrowMemoryControl(error); return { status: 'lexical_only', reason: 'index_unavailable' } }
  }
  return {
    index,
    async read(value) {
      if (!object(value) || Object.keys(value).some(k => !['seq', 'offset'].includes(k)) || !integer(value.seq, 1)
        || !(value.offset === undefined || value.offset === null || integer(value.offset, 0))) return { status: 'invalid' }
      if (!await options.hasAccess()) return { status: 'denied' }
      if (!store.exact) return { status: 'unavailable' }
      try {
        const result = await store.exact(Number(value.seq), Number(value.offset ?? 0))
        if (!bound(result) || !['ok', 'missing', 'invalid_offset'].includes(String(result.status))) return { status: 'unavailable' }
        if (result.status === 'ok' && (!validMessage(result.message) || !object(result.source)
          || (result.message as Record<string, unknown>).seq !== value.seq
          || result.source.seq !== value.seq || !fingerprint(result.source.fingerprint)
          || result.offset !== Number(value.offset ?? 0) || !integer(result.totalCharacters, 1)
          || !(result.nextOffset === null || integer(result.nextOffset, Number(value.offset ?? 0) + 1)))) return { status: 'unavailable' }
        if (result.status === 'ok') {
          const end = Number(result.offset) + [...String((result.message as Record<string, unknown>).text)].length
          if (end > Number(result.totalCharacters) || (result.nextOffset === null ? end !== Number(result.totalCharacters) : result.nextOffset !== end)) return { status: 'unavailable' }
        }
        if (!await options.hasAccess()) return { status: 'denied' }
        return { ...result, status: String(result.status), truth: 'conversation_only' }
      } catch (error) { rethrowMemoryControl(error); return { status: 'unavailable' } }
    },
    async search(value) {
      if (!object(value) || Object.keys(value).some(k => !['query', 'before_seq'].includes(k))
        || typeof value.query !== 'string' || [...value.query].length > 200
        || !(value.before_seq === null || integer(value.before_seq, 1))) return { status: 'invalid' }
      if (!await options.hasAccess()) return { status: 'denied' }
      if (!store.searchHybrid) return { status: 'unavailable' }
      try {
        let embedding: number[] | null = null
        if (value.query.trim() && embedder) {
          const indexed = await index() as { status: string }
          if (indexed.status === 'denied' || !await options.hasAccess()) return { status: 'denied' }
          try {
            const vectors = await embedder.embed([value.query])
            if (vectors.length === 1 && vector(vectors[0])) embedding = vectors[0]
          } catch (error) { rethrowMemoryControl(error) }
        }
        if (!await options.hasAccess()) return { status: 'denied' }
        const result = await store.searchHybrid(value.query, value.before_seq as number | null, embedding, model)
        if (!bound(result) || !Array.isArray(result.messages) || result.messages.length > 5 || !result.messages.every(validMessage)
          || !Array.isArray(result.sources) || result.sources.length !== result.messages.length
          || !['hybrid', 'lexical', 'browse'].includes(String(result.searchMode))) return { status: 'unavailable' }
        for (let i = 0; i < result.sources.length; i++) {
          const source = result.sources[i], message = result.messages[i] as Record<string, unknown>
          if (!object(source) || source.seq !== message.seq || !fingerprint(source.fingerprint)) return { status: 'unavailable' }
        }
        if (!await options.hasAccess()) return { status: 'denied' }
        return { ...result, status: result.messages.length ? 'ok' : 'empty', truth: 'conversation_only' }
      } catch (error) { rethrowMemoryControl(error); return { status: 'unavailable' } }
    },
  }
}

/** The caller binds project/user/thread/turn/generation once; models never get
 * those authority fields as tool arguments. All RPCs recheck that same claim. */
export function memoryRetrievalStore(rpc: (name: string, args?: Record<string, unknown>) => Promise<unknown>): MemoryRetrievalStore {
  return {
    exact: (seq, offset = 0) => rpc('bob_read_context_message', { p_seq: seq, p_offset: offset }),
    searchHybrid: (query, before, embedding, model) => rpc('bob_search_context_memory', {
      p_query: query, p_before_seq: before, p_embedding: embedding === null ? null : JSON.stringify(embedding), p_model: model,
    }),
    indexPending: (limit, model) => rpc('bob_context_index_pending', { p_limit: limit, p_model: model }),
    indexSave: (items, model) => rpc('bob_context_index_save', { p_items: items, p_model: model }),
    refresh: (expected, previousSummary, summary) => rpc('bob_refresh_context_summary', {
      p_expected_seq: expected, p_expected_summary: previousSummary, p_summary: summary,
    }),
  }
}

export interface MemoryContextStore extends MemoryRetrievalStore {
  load(): Promise<unknown>;
  save(expected: number, through: number, summary: string): Promise<unknown>;
  search(query: string, before: number | null): Promise<unknown>;
}
export type MemoryCheckpoint = <T>(stream: string, input: unknown, work: () => Promise<T>) => Promise<T>

/** Checkpoint each operation, not the composite retrieval. Replaying a whole
 * index() while skipping its nested paid calls would shift later call ordinals.
 * Index writes are exact-source idempotent upserts; a lost checkpoint repeats
 * that same selected batch, never whichever batch is now pending. Authority is
 * still checked outside these checkpoints by the retrieval and context helpers.
 * The caller overlays the current worker generation on a replayed load frame. */
export function journalMemoryStore(store: MemoryContextStore, memo: MemoryCheckpoint): MemoryContextStore {
  const reconcile = async (operation: () => Promise<unknown>, expected: number, summary: string) => {
    try { return await operation() }
    catch (error) {
      rethrowMemoryControl(error)
      // CAS may have committed just before checkpoint/network loss. Only the
      // exact saved text and watermark can acknowledge this operation.
      const current = await store.load() as { lastFoldedSeq?: number; summary?: string }
      if (current.lastFoldedSeq === expected && current.summary === summary) return { lastFoldedSeq: expected }
      throw error
    }
  }
  return {
    load: () => memo('context:load', {}, () => store.load()),
    save: (expected, through, summary) => memo('context:save', { expected, through, summary },
      () => reconcile(() => store.save(expected, through, summary), through, summary)),
    search: (query, before) => memo('context:search', { query, before }, () => store.search(query, before)),
    ...(store.exact ? { exact: (seq: number, offset = 0) => memo('context:exact', { seq, offset }, () => store.exact!(seq, offset)) } : {}),
    ...(store.searchHybrid ? { searchHybrid: (query: string, before: number | null, embedding: number[] | null, model: string) =>
      memo('context:hybrid', { query, before, embedding, model }, () => store.searchHybrid!(query, before, embedding, model)) } : {}),
    ...(store.indexPending ? { indexPending: (limit: number, model: string) =>
      memo('context:index_pending', { limit, model }, () => store.indexPending!(limit, model)) } : {}),
    ...(store.indexSave ? { indexSave: (items: MemoryEmbeddingWrite[], model: string) =>
      memo('context:index_save', { items, model }, () => store.indexSave!(items, model)) } : {}),
    ...(store.refresh ? { refresh: (expected: number, previousSummary: string, summary: string) =>
      memo('context:refresh', { expected, previousSummary, summary },
        () => reconcile(() => store.refresh!(expected, previousSummary, summary), expected, summary)) } : {}),
  }
}
