import type { JournalIdentity } from './bob-job-journal.ts'

type Memo = <T>(stream: string, input: unknown, work: () => Promise<T>) => Promise<T>

/** Authority can renew while an accepted provider operation is pending. Its
 * reservation deadline is immutable; the next operation uses current authority.
 * This pins transport identity, never grants access or extends a provider job. */
export async function pinBobModelDeadline(memo: Memo, identity: JournalIdentity, expiresAt: string): Promise<string> {
  const pinned = await memo('model-deadline:' + identity.key, { fingerprint: identity.fingerprint }, async () => expiresAt)
  if (typeof pinned !== 'string' || !Number.isFinite(Date.parse(pinned))) throw new Error('model_deadline_invalid')
  return pinned
}
