import { useEffect, useRef, useState, type RefObject } from 'react'
import * as db from '../data/database'
import type { SolutionPresentation } from '../domain/modelFeedback'
import { openBobForCurrentSurface, useBobSurface } from '../lib/bobSurface'

/** Metadata is recorded only after the actual SVG viewport is visible. */
export function ModelFeedbackContext({ projectId, solutionId, revision, viewId, areaId, viewport, enabled }: {
  areaId: string | null; projectId: string; solutionId: string; revision: number; viewId: string
  viewport: RefObject<HTMLDivElement>; enabled: boolean
}) {
  const [attempt, retry] = useState(0), [historyBusy, setHistoryBusy] = useState(false), [historyError, setHistoryError] = useState(false)
  const [state, setState] = useState<{ key: string; presentation?: SolutionPresentation; failed?: boolean } | null>(null)
  const key = [projectId, solutionId, revision, viewId, areaId, attempt].join(':')
  const activeKey = useRef(key); activeKey.current = key
  useEffect(() => { setHistoryBusy(false); setHistoryError(false) }, [key])
  const current = state?.key === key ? state : null, shown = current?.presentation
  useBobSurface(projectId, enabled ? { surface: 'solutions', solutionId, solutionRevision: revision, ...(shown ? { presentationId: shown.id } : {}) } : null,
    `Shown concept · v${revision}`, 2)
  useEffect(() => {
    if (!enabled || !viewport.current) return
    let cancelled = false, requested = false, visible = false
    const record = () => {
      if (requested || !visible || document.visibilityState !== 'visible') return
      requested = true
      db.recordSolutionPresentation(projectId, solutionId, revision, viewId, areaId).then(presentation => {
        if (!cancelled) setState({ key, presentation })
      }).catch(() => { if (!cancelled) setState({ key, failed: true }) })
    }
    const observer = new IntersectionObserver(entries => { visible = entries.some(entry => entry.isIntersecting); record() }, { threshold: 0.1 })
    observer.observe(viewport.current)
    document.addEventListener('visibilitychange', record)
    return () => { cancelled = true; observer.disconnect(); document.removeEventListener('visibilitychange', record) }
  }, [projectId, solutionId, revision, viewId, areaId, key, enabled, viewport])
  const labels = { accepted: 'Form and function accepted', change_requested: 'Changes requested', unclear: 'Response needs clarification', delegated: 'Decision delegated to Bob' }
  return <div className="fact-details" aria-label="Model feedback">
    {current?.failed && <p role="status" className="solution-attention">Could not link this view to your reply. <button className="btn" onClick={() => retry(n => n + 1)}>Retry model link</button></p>}
    {shown && !shown.source_current && <p className="solution-attention">This view has changed sources. Ask Bob to reconcile this version.</p>}
    <button className="btn" disabled={!shown && !current?.failed} onClick={openBobForCurrentSurface}>{!shown && !current?.failed ? 'Preparing model discussion…' : 'Discuss this model with Bob'}</button>
    {shown && <details className="ui-row-details"><summary>Model feedback history</summary>
      <p className="foundation-hint">Up to 10 responses per page, newest first.</p>
      {!shown.feedback.length ? <p>No response recorded for this version. Viewing alone does not accept it.</p> : shown.feedback.map(f => <p key={f.id}>
        <strong>{labels[f.outcome]}</strong> · {f.authority === 'bob' ? `Bob under ${f.actor_label}'s mandate` : f.actor_label}
        {' · '}{f.scope_label}{' · '}{f.scope === 'whole_model' ? 'Whole model' : f.component_ids.map(id => shown.components.find(c => c.id === id)?.label ?? id).join(', ')}{' · '}{f.view_id}
        {' · '}{new Date(f.recorded_at).toLocaleString()}{!f.source_current && ' · Historical sources'}
      </p>)}
      {historyError && <p role="status">Earlier feedback could not be read. Try again.</p>}
      {shown.next_feedback_id && <button className="btn" disabled={historyBusy} onClick={async () => {
        setHistoryBusy(true); setHistoryError(false)
        try {
          const earlier = await db.readSolutionPresentation(projectId, shown.id, shown.next_feedback_id!)
          if (activeKey.current !== key) return
          setState(previous => previous?.key === key ? { key, presentation: earlier } : previous)
        } catch { if (activeKey.current === key) setHistoryError(true) } finally { if (activeKey.current === key) setHistoryBusy(false) }
      }}>{historyBusy ? 'Reading earlier feedback…' : 'Earlier model feedback'}</button>}
      <p className="foundation-hint">Feedback concerns intended form and function. Technical checks remain separate.</p>
      <button className="btn" onClick={() => retry(n => n + 1)}>Refresh model feedback</button>
    </details>}
  </div>
}
