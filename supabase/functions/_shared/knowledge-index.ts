/**
 * One-shot embedding of reference-book passages (owner decision 2026-11-15).
 * Runs only when an operator calls the knowledge-index function: never inside
 * a Bob turn, so a 128-vector batch never enters a job journal, and nothing
 * is paid for on a user's turn. Text search works before and during indexing.
 */
export interface KnowledgeIndexStore {
  pending(limit: number, model: string): Promise<unknown>
  save(items: { id: string; fingerprint: string; embedding: number[] }[], model: string): Promise<unknown>
}
export interface KnowledgeIndexResult { status: 'complete' | 'partial' | 'failed'; indexed: number; remaining: number | null; error?: string }

const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

export async function indexKnowledgePassages(options: {
  store: KnowledgeIndexStore; model: string; embed(texts: string[]): Promise<number[][]>;
  batchSize?: number; maxBatches?: number; deadline?: number; now?: () => number;
}): Promise<KnowledgeIndexResult> {
  const batchSize = options.batchSize ?? 128, maxBatches = options.maxBatches ?? 20, now = options.now ?? Date.now
  let indexed = 0, remaining: number | null = null
  for (let batch = 0; batch < maxBatches; batch++) {
    if (options.deadline !== undefined && now() > options.deadline) return { status: 'partial', indexed, remaining }
    const page = await options.store.pending(batchSize, options.model)
    if (!object(page) || !Array.isArray(page.passages) || typeof page.remaining !== 'number') return { status: 'failed', indexed, remaining, error: 'pending_invalid' }
    remaining = page.remaining
    const passages = page.passages as { id: string; fingerprint: string; text: string }[]
    if (!passages.length) return { status: 'complete', indexed, remaining: 0 }
    if (!passages.every(p => object(p) && typeof p.id === 'string' && typeof p.fingerprint === 'string' && typeof p.text === 'string' && p.text.trim()))
      return { status: 'failed', indexed, remaining, error: 'pending_invalid' }
    let vectors: number[][]
    try { vectors = await options.embed(passages.map(p => p.text)) }
    catch (error) { return { status: 'failed', indexed, remaining, error: error instanceof Error ? error.message : 'embedding_failed' } }
    if (!Array.isArray(vectors) || vectors.length !== passages.length || !vectors.every(v => Array.isArray(v) && v.length === 256 && v.every(Number.isFinite)))
      return { status: 'failed', indexed, remaining, error: 'embedding_invalid' }
    await options.store.save(passages.map((p, i) => ({ id: p.id, fingerprint: p.fingerprint, embedding: vectors[i] })), options.model)
    indexed += passages.length
    remaining = Math.max(0, page.remaining - passages.length)
    if (remaining === 0) return { status: 'complete', indexed, remaining }
  }
  return { status: 'partial', indexed, remaining }
}
