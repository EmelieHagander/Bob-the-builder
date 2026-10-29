import type { HumanTextIssue } from './human-text.ts'

/** Owner decision 2026-10-29 (pinned, answer_text_version 1): Bob's chat answer
 * follows the same human-text rule as saved prose. Only content-free outcomes
 * are recorded; the delivered words are always Bob's own. */
export type AnswerTextOutcome = 'clean' | 'rewrite_requested' | 'rewritten' | 'rewrite_unchanged' | 'delivered_with_issues'
export const ANSWER_TEXT_OUTCOMES: readonly AnswerTextOutcome[] = ['clean', 'rewrite_requested', 'rewritten', 'rewrite_unchanged', 'delivered_with_issues']

/** Up to four quoted fragments for the rewrite note; the answer itself stays whole. */
export const answerTextFragments = (issues: readonly HumanTextIssue[]) => issues.slice(0, 4)
  .map(issue => JSON.stringify(issue.fragment.length > 60 ? issue.fragment.slice(0, 57) + '…' : issue.fragment)).join(', ') + (issues.length > 4 ? ', …' : '')
