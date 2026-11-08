import type { AnswerEvidence } from '../data/provenance'

/**
 * Chat view of an answer that contains server-written delivery notices (owner,
 * 2026-11-06): the notice text is replaced by one short line. The stored answer
 * keeps the full text for debugging. Answers saved before notices were marked
 * show unchanged.
 */
export function answerDisplay(text: string, evidence?: AnswerEvidence): { text: string; line: string | null } {
  const notices = evidence?.notices ?? []
  if (!notices.length) return { text, line: null }
  let shown = text
  for (const notice of notices) {
    const at = shown.lastIndexOf(notice.text)
    if (notice.text && at >= 0) shown = shown.slice(0, at) + shown.slice(at + notice.text.length)
  }
  shown = shown.trim()
  const failed = notices.some(n => n.kind === 'failed'), uncertain = notices.some(n => n.kind === 'uncertain')
  if (!failed && !uncertain) return { text: shown, line: null }
  const saved = [...new Set((evidence?.writes ?? []).filter(w => w.operation !== 'deleted')
    .map(w => w.label + (typeof w.revision === 'number' ? ` · v${w.revision}` : '')))]
  const missing = [...new Set(notices.flatMap(n => n.missing ?? []).map(m => m.trim().replace(/[.。]+$/, '')).filter(Boolean))]
  const first = uncertain
    ? `Bob dropped the hammer. ${saved.length ? `Saved: ${saved.join(', ')}. Other changes may have saved too` : 'Some changes may have saved'}; check before asking again.`
    : saved.length ? `Bob dropped the hammer. Only this was saved: ${saved.join(', ')}.` : 'Bob dropped the hammer, nothing was done this turn.'
  return { text: shown, line: missing.length ? `${first} Still needed: ${missing.join('; ')}.` : first }
}
