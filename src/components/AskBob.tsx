/*
 * Project-bound assistant drawer. The direct backend can read allowed project
 * records and save requested changes; generated prose remains an AI assessment. Layout
 * remounts this drawer when project/auth context changes.
 */

import { Fragment, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import * as db from '../data/database'
import { Icon, useAsync } from './ui'
import { Modal } from './Modal'
import type { ChatMessage } from '../data/types'
import { BobWriteReceipts } from './BobWriteReceipts'
import { createRequestScope } from '../lib/projectRequest'
import { BOB_DRAFT_EVENT, getBobSurface, takePendingBobDraft, useBobSurfaceSnapshot } from '../lib/bobSurface'
import type { BobScreenPointer, CurrentView } from '../domain/bobScreen'
import { readOutgoing, reconcileOutgoing, type OutgoingTurn } from '../lib/bobOutgoing'
import { formatDateTime } from '../lib/format'

type RetryTurn = { text: string; turnId: string; screen?: BobScreenPointer | null }

function ViewEvidence({ view }: { view: CurrentView }) {
  if (view.status !== 'ok') return <p className="foundation-hint" role="status">
    {view.status === 'not_found' ? 'The page selection could not be found in this project.' : view.status === 'unsupported' ? 'Detailed context for this page is unavailable.' : 'The page records could not be read.'} Bob has no verified page focus for this answer.
  </p>
  const f = view.focus
  const warnings: Record<string, string> = { plan_step_goal_truncated: 'The Step goal was shortened in the page context.', plan_step_notes_truncated: 'The Step notes were shortened in the page context.', task_instructions_truncated: 'Task instructions were shortened in the page context.', selected_instruction_truncated: 'The selected instruction was shortened in the page context.' }
  const labels = [f.area?.name, f.planStep?.name, f.task?.name, f.instruction?.name,
    f.solution && `${f.solution.name} · v${f.solution.revision}`,
    f.drawing && `${f.drawing.name} · v${f.drawing.revision}`, f.event?.name].filter(Boolean)
  return <details className="bob-context-evidence">
    <summary>Page records used{labels.length ? ` · ${labels.join(' / ')}` : ''}</summary>
    <p className="foundation-hint">Read from the project at {formatDateTime(view.retrievedAt)}. Page focus does not approve measurements or drawings.</p>
    {f.drawing && <p>Viewed drawing v{f.drawing.revision} · {f.drawing.status.replace(/_/g, ' ')} · {f.drawing.sourceState === 'current' ? 'linked sources current' : f.drawing.sourceState === 'changed' ? 'sources changed — review before use' : 'sources could not be checked'}</p>}
    {view.warnings.length > 0 && <ul>{view.warnings.map((warning, i) => <li key={i}>{warnings[warning] ?? 'Some page context was limited. Open the saved source for its complete details.'}</li>)}</ul>}
  </details>
}

const toneColor = {
  clay: { c: 'var(--clay)', bg: 'var(--clay-bg)' },
  honey: { c: '#9A6313', bg: 'var(--honey-bg)' },
  leaf: { c: 'var(--leaf)', bg: 'var(--leaf-bg)' },
}

const CHAT_HISTORY_PREFIX = 'bob:ask-bob-history:v1'
const MAX_SAVED_MESSAGES = 80

function parseSavedChat(raw: string | null): ChatMessage[] {
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((item): item is ChatMessage => {
        if (!item || typeof item !== 'object') return false
        const message = item as Partial<ChatMessage>
        return (message.from === 'bob' || message.from === 'user') && typeof message.text === 'string'
      })
      .slice(-MAX_SAVED_MESSAGES)
  } catch {
    return []
  }
}

const inlineMarkdownPattern = /(\*\*[^*\n]+?\*\*|~~[^~\n]+?~~|`[^`\n]+?`|\*[^*\n]+?\*|\[[^\]\n]+\]\(https?:\/\/[^)\s]+\))/g

function renderInlineMarkdown(text: string, keyPrefix = 'inline'): ReactNode[] {
  return text.split(inlineMarkdownPattern).map((part, index) => {
    const key = `${keyPrefix}-${index}`
    if (!part) return null
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={key}>{renderInlineMarkdown(part.slice(2, -2), `${key}-strong`)}</strong>
    }
    if (part.startsWith('~~') && part.endsWith('~~')) {
      return <del key={key}>{renderInlineMarkdown(part.slice(2, -2), `${key}-del`)}</del>
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return <code key={key} style={{ background: 'var(--surface-2)', borderRadius: 5, padding: '1px 4px', fontSize: '0.92em' }}>{part.slice(1, -1)}</code>
    }
    if (part.startsWith('*') && part.endsWith('*')) {
      return <em key={key}>{renderInlineMarkdown(part.slice(1, -1), `${key}-em`)}</em>
    }
    const link = part.match(/^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/)
    if (link) {
      return (
        <a key={key} href={link[2]} target="_blank" rel="noreferrer" style={{ textDecoration: 'underline', textUnderlineOffset: 2 }}>
          {link[1]}
        </a>
      )
    }
    return <Fragment key={key}>{part}</Fragment>
  })
}

function isMarkdownBlockStart(line: string) {
  const trimmed = line.trim()
  return !trimmed
    || /^```/.test(trimmed)
    || /^#{1,3}\s+/.test(trimmed)
    || /^[-*+]\s+/.test(trimmed)
    || /^\d+\.\s+/.test(trimmed)
    || /^>\s?/.test(trimmed)
    || /^(?:-{3,}|\*{3,}|_{3,})$/.test(trimmed)
}

/**
 * Bob commonly answers in Markdown. Render the useful chat subset directly as
 * React elements so model output stays readable without accepting raw HTML.
 */
function MarkdownText({ text }: { text: string }) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const blocks: ReactNode[] = []
  let i = 0
  let blockIndex = 0

  while (i < lines.length) {
    const line = lines[i]
    const trimmed = line.trim()
    if (!trimmed) { i += 1; continue }

    if (/^```/.test(trimmed)) {
      const code: string[] = []
      i += 1
      while (i < lines.length && !/^```/.test(lines[i].trim())) { code.push(lines[i]); i += 1 }
      if (i < lines.length) i += 1
      blocks.push(
        <pre key={`code-${blockIndex++}`} style={{ margin: 0, padding: '10px 12px', overflowX: 'auto', background: 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: 8, fontSize: 12.5, lineHeight: 1.5, whiteSpace: 'pre' }}>
          <code>{code.join('\n')}</code>
        </pre>,
      )
      continue
    }

    const heading = trimmed.match(/^(#{1,3})\s+(.+)$/)
    if (heading) {
      const content = renderInlineMarkdown(heading[2], `heading-${blockIndex}`)
      const headingStyle = { margin: 0, fontSize: heading[1].length === 1 ? 17 : heading[1].length === 2 ? 16 : 15, lineHeight: 1.3 }
      blocks.push(
        heading[1].length === 1
          ? <h1 key={`heading-${blockIndex++}`} style={headingStyle}>{content}</h1>
          : heading[1].length === 2
            ? <h2 key={`heading-${blockIndex++}`} style={headingStyle}>{content}</h2>
            : <h3 key={`heading-${blockIndex++}`} style={headingStyle}>{content}</h3>,
      )
      i += 1
      continue
    }

    const unordered = trimmed.match(/^[-*+]\s+(.+)$/)
    if (unordered) {
      const items: string[] = []
      while (i < lines.length) {
        const match = lines[i].trim().match(/^[-*+]\s+(.+)$/)
        if (!match) break
        items.push(match[1]); i += 1
      }
      blocks.push(
        <ul key={`ul-${blockIndex++}`} style={{ margin: 0, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 5 }}>
          {items.map((item, itemIndex) => <li key={itemIndex}>{renderInlineMarkdown(item, `ul-${blockIndex}-${itemIndex}`)}</li>)}
        </ul>,
      )
      continue
    }

    const ordered = trimmed.match(/^\d+\.\s+(.+)$/)
    if (ordered) {
      const items: string[] = []
      let start = 1
      while (i < lines.length) {
        const match = lines[i].trim().match(/^(\d+)\.\s+(.+)$/)
        if (!match) break
        if (!items.length) start = Number(match[1])
        items.push(match[2]); i += 1
      }
      blocks.push(
        <ol key={`ol-${blockIndex++}`} start={start} style={{ margin: 0, paddingLeft: 22, display: 'flex', flexDirection: 'column', gap: 5 }}>
          {items.map((item, itemIndex) => <li key={itemIndex}>{renderInlineMarkdown(item, `ol-${blockIndex}-${itemIndex}`)}</li>)}
        </ol>,
      )
      continue
    }

    if (/^>\s?/.test(trimmed)) {
      const quote: string[] = []
      while (i < lines.length) {
        const match = lines[i].trim().match(/^>\s?(.*)$/)
        if (!match) break
        quote.push(match[1]); i += 1
      }
      blocks.push(
        <blockquote key={`quote-${blockIndex++}`} style={{ margin: 0, paddingLeft: 10, borderLeft: '3px solid var(--line)', color: 'var(--ink-soft)' }}>
          {renderInlineMarkdown(quote.join(' '), `quote-${blockIndex}`)}
        </blockquote>,
      )
      continue
    }

    if (/^(?:-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      blocks.push(<hr key={`hr-${blockIndex++}`} style={{ width: '100%', border: 0, borderTop: '1px solid var(--line)' }} />)
      i += 1
      continue
    }

    const paragraph: string[] = []
    while (i < lines.length && !isMarkdownBlockStart(lines[i])) { paragraph.push(lines[i].trim()); i += 1 }
    if (!paragraph.length) { paragraph.push(trimmed); i += 1 }
    blocks.push(<p key={`p-${blockIndex++}`} style={{ margin: 0 }}>{renderInlineMarkdown(paragraph.join(' '), `p-${blockIndex}`)}</p>)
  }

  return <div className="bob-markdown">{blocks}</div>
}

function Bubble({ msg, onAction, onOpenDrawing }: { msg: ChatMessage; onAction?: (action: string) => void; onOpenDrawing?: () => void }) {
  const isUser = msg.from === 'user'
  return (
    <div className={`bob-message ${isUser ? 'bob-message-user' : 'bob-message-assistant'}`}>
      <div className="bob-bubble">
        {msg.evidence && <div style={{ fontSize: 11, color: 'var(--ink-soft)', marginBottom: 6 }}>Bob’s assessment</div>}
        {isUser ? <div style={{ whiteSpace: 'pre-wrap' }}>{msg.text}</div> : <MarkdownText text={msg.text} />}
        {isUser && msg.deliveryState === 'failed' && <div className="foundation-hint" style={{ color: 'inherit' }}>Bob’s earlier attempt was interrupted. Your message is saved.</div>}
        {msg.evidence?.currentView && <ViewEvidence view={msg.evidence.currentView} />}
        {msg.evidence && <details style={{ marginTop: 10, fontSize: 12, color: 'var(--ink-soft)' }}>
          <summary>Project records consulted ({msg.evidence.sources.length})</summary>
          <p>Stored project information; measurements and specifications are not verified.</p>
          {msg.evidence.partial && <p>Some results were limited or unavailable.</p>}
          <ul style={{ paddingLeft: 18 }}>{msg.evidence.sources.map((source, i) => <li key={i} title={`Record ${source.recordId}`}><strong>{source.label}</strong> · {source.dataset}<br />Retrieved {formatDateTime(source.retrievedAt)}{source.updatedAt ? ` · updated ${formatDateTime(source.updatedAt)}` : ' · update time unknown'}</li>)}</ul>
        </details>}
        {!!msg.evidence?.references?.length && <details className="bob-evidence">
          <summary>Building references ({msg.evidence.references.length})</summary>
          <ul>{msg.evidence.references.map(r=><li key={r.id}><a href={r.url} target="_blank" rel="noopener noreferrer">{r.title}</a> · {r.version}<br />Reviewed {r.reviewedAt}. General guidance; project conditions need their own evidence.</li>)}</ul>
        </details>}
        <BobWriteReceipts receipts={msg.evidence?.writes} onOpenDrawing={onOpenDrawing} />
        {msg.report && <div style={{ marginTop: 10, background: 'var(--canvas)', border: '1px solid var(--line)', borderRadius: 10, padding: '10px 12px', fontSize: 13.5, lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>{msg.report}</div>}
        {msg.list && <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>{msg.list.map((it, i) => <div key={i} style={{ display: 'flex', gap: 9, alignItems: 'flex-start' }}><span style={{ width: 24, height: 24, borderRadius: 7, flex: '0 0 auto', display: 'flex', alignItems: 'center', justifyContent: 'center', background: toneColor[it.tone].bg }}><Icon name={it.icon} weight="fill" size={13} color={toneColor[it.tone].c} /></span><span style={{ fontSize: 13.5, lineHeight: 1.4 }}>{it.text}</span></div>)}</div>}
        {msg.action && <button className="btn btn-primary" style={{ marginTop: 11, fontSize: 13 }} onClick={() => onAction?.(msg.action!)}><Icon name="sparkle" weight="fill" size={14} /> {msg.action}</button>}
        {msg.note && <div style={{ marginTop: 11, background: 'var(--honey-bg)', borderRadius: 9, padding: '8px 10px', fontSize: 12.5, color: '#7c5410', display: 'flex', gap: 7 }}><Icon name="warning" weight="fill" size={14} color="var(--honey)" style={{ marginTop: 1 }} /><span>{msg.note}</span></div>}
      </div>
    </div>
  )
}

function WorkingBubble({ label }: { label: string }) {
  return <div className="bob-working" role="status" aria-live="polite">
    <span className="bob-hammer"><Icon name="hammer" weight="fill" size={20} color="var(--honey)" /></span>
    <span>{label}</span>
  </div>
}

export function AskBob({ open, onClose, project }: { open: boolean; onClose: () => void; project: { id: string; name: string } }) {
  const surface = useBobSurfaceSnapshot(project.id)
  const { data: chips } = useAsync(() => db.getAskBobChips(), [project.id])
  const [draft, setDraft] = useState('')
  useEffect(() => {
    const take = () => {
      const text = takePendingBobDraft()
      if (text) setDraft(previous => previous.trim() ? `${previous}\n\n${text}` : text)
    }
    take()
    window.addEventListener(BOB_DRAFT_EVENT, take)
    return () => window.removeEventListener(BOB_DRAFT_EVENT, take)
  }, [])
  const [compact, setCompact] = useState(() => { try { return localStorage.getItem('bob:chat-density') !== 'comfortable' } catch { return true } })
  const [expanded, setExpanded] = useState(false)
  const [showJump, setShowJump] = useState(false)
  const [readTarget, setReadTarget] = useState<{ threadId: string; seq: number } | null>(null)
  const readAck = useRef('')
  const wasOpen = useRef(open)
  const sendVersion = useRef(0)
  const [viewport, setViewport] = useState<{ height: number; top: number } | null>(null)
  const composer = useRef<HTMLTextAreaElement>(null)
  const overlay = useRef<HTMLDivElement>(null)
  const stickToEnd = useRef(true)
  useEffect(() => { try { localStorage.setItem('bob:chat-density', compact ? 'compact' : 'comfortable') } catch { /* preference is optional */ } }, [compact])
  useEffect(() => {
    if (!open || !window.visualViewport) return
    const v = window.visualViewport
    const update = () => setViewport({ height: v.height, top: v.offsetTop })
    update(); v.addEventListener('resize', update); v.addEventListener('scroll', update)
    return () => { v.removeEventListener('resize', update); v.removeEventListener('scroll', update) }
  }, [open])
  useLayoutEffect(() => {
    const input = composer.current
    if (!input) return
    const available = viewport?.height ?? window.innerHeight
    const cap = Math.max(44, Math.min(expanded ? 240 : 104, available * (expanded ? 0.35 : 0.22), available - 270))
    input.style.height = 'auto'
    input.style.height = `${expanded ? cap : Math.min(Math.max(44, input.scrollHeight), cap)}px`
  }, [draft, expanded, open, viewport])
  const [extra, setExtra] = useState<ChatMessage[]>([])
  const [historyKey, setHistoryKey] = useState<string | null>(null)
  const [localHistory, setLocalHistory] = useState(false)
  const [confirmReset, setConfirmReset] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [resetError, setResetError] = useState('')
  const resetPending = useRef(false)
  const [historyReady, setHistoryReady] = useState(false)
  const [historyNotice, setHistoryNotice] = useState('')
  const [working, setWorking] = useState(false)
  const [needsRefresh, setNeedsRefresh] = useState(false)
  const [retry, setRetry] = useState<RetryTurn | null>(null)
  const [recovering, setRecovering] = useState<(RetryTurn & { expiresAt: number }) | null>(null)
  const [workingLabel, setWorkingLabel] = useState(db.describeBobProgress(undefined))
  const outgoing = useRef<OutgoingTurn | null>(null)
  const outgoingKey = useRef<string | null>(null)
  const serverThread = useRef<string | null>(null)
  function keepOutgoing(value: OutgoingTurn | null) {
    outgoing.current = value
    try {
      if (outgoingKey.current) {
        if (value) sessionStorage.setItem(outgoingKey.current, JSON.stringify(value))
        else sessionStorage.removeItem(outgoingKey.current)
      }
    } catch { /* The in-memory message remains available if storage is disabled. */ }
  }
  // Keep this component alive when closed so a local request and draft survive.
  // A page reload recovers the same turn from the private server transcript.
  const close = () => {
    onClose()
    if (needsRefresh && !working) {
      setNeedsRefresh(false)
      db.refreshAskBobProject(project.id)
    }
  }
  useEffect(() => {
    if (!open && needsRefresh && !working) {
      setNeedsRefresh(false)
      db.refreshAskBobProject(project.id)
    }
  }, [open, needsRefresh, working, project.id])
  useEffect(() => {
    if (!open) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previousOverflow }
  }, [open])
  useEffect(() => {
    if (!open) return
    const previous = document.activeElement as HTMLElement | null
    // Opening a conversation on a phone should show the answer before the keyboard.
    if (window.matchMedia('(pointer: fine)').matches) composer.current?.focus({ preventScroll: true })
    else overlay.current?.querySelector<HTMLButtonElement>('[aria-label="Close Ask bob"]')?.focus({ preventScroll: true })
    return () => { if (previous?.isConnected) previous.focus() }
  }, [open])
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      const dialogs = document.querySelectorAll('[role="dialog"]')
      if (dialogs[dialogs.length - 1] !== overlay.current) return
      if (event.key === 'Escape' && !confirmReset) { event.preventDefault(); event.stopImmediatePropagation(); close() }
      if (event.key === 'Tab') {
        const targets = Array.from(overlay.current?.querySelectorAll<HTMLElement>('button:not([disabled]),textarea:not([disabled]),a[href],summary,[tabindex="0"]') ?? []).filter(node => node.getClientRects().length > 0)
        const first = targets[0], last = targets[targets.length - 1]
        if (event.shiftKey && (document.activeElement === first || !overlay.current?.contains(document.activeElement))) { event.preventDefault(); last?.focus() }
        else if (!event.shiftKey && (document.activeElement === last || !overlay.current?.contains(document.activeElement))) { event.preventDefault(); first?.focus() }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, confirmReset, needsRefresh, working])
  const scope = useRef(createRequestScope())
  const historyScroll = useRef<HTMLDivElement>(null)
  const historyContent = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    if (open && historyScroll.current && stickToEnd.current) historyScroll.current.scrollTop = historyScroll.current.scrollHeight
  }, [open, extra, working, workingLabel, historyNotice, retry, viewport])
  useEffect(() => {
    if (!open || !historyScroll.current || !historyContent.current) return
    // Follow new content and viewport/composer resizing only while at the end.
    // Reading an older answer must survive polling and late image/font layout.
    const observer = new ResizeObserver(() => {
      if (stickToEnd.current && historyScroll.current) historyScroll.current.scrollTop = historyScroll.current.scrollHeight
    })
    observer.observe(historyScroll.current)
    observer.observe(historyContent.current)
    return () => observer.disconnect()
  }, [open])
  useEffect(() => {
    const mark = () => {
      if (!open || showJump || !stickToEnd.current || !readTarget || document.visibilityState !== 'visible') return
      const target = `${project.id}/${readTarget.threadId}/${readTarget.seq}`
      if (readAck.current === target) return
      const el = historyScroll.current
      if (!el || el.scrollHeight - el.scrollTop - el.clientHeight > 50) return
      readAck.current = target
      void db.markBobChatRead(project.id, readTarget.threadId, readTarget.seq).catch(() => { if (readAck.current === target) readAck.current = '' })
    }
    const frame = requestAnimationFrame(mark)
    document.addEventListener('visibilitychange', mark)
    return () => { cancelAnimationFrame(frame); document.removeEventListener('visibilitychange', mark) }
  }, [open, showJump, readTarget, project.id, extra.length])
  useEffect(() => () => scope.current.invalidate(), [project.id])

  useEffect(() => {
    let cancelled = false
    const isCurrent = scope.current.capture()
    const current = () => !cancelled && isCurrent()
    outgoing.current = null; outgoingKey.current = null; serverThread.current = null
    setExtra([]); setReadTarget(null); readAck.current = ''; setHistoryKey(null); setHistoryReady(false); setHistoryNotice('')
    void (async () => {
      const me = await db.getCurrentUser()
      if (!current()) return
      const key = `${CHAT_HISTORY_PREFIX}:${project.id}:${me?.id ?? 'demo'}`
      setHistoryKey(key)
      try {
        const history = await db.getAskBobConversation(project.id)
        if (!current()) return
        if (history.mode === 'server') {
          outgoingKey.current = history.ownerId ? `bob:outgoing:v1:${project.id}:${history.ownerId}` : null
          try { outgoing.current = outgoingKey.current ? readOutgoing(sessionStorage.getItem(outgoingKey.current)) : null } catch { /* unavailable storage */ }
          applyServerHistory(history); setHistoryReady(true)
          return
        }
      } catch {
        if (!current()) return
        setHistoryNotice('Conversation sync is unavailable right now. This device will keep a temporary copy.')
      }
      if (!current()) return
      let saved: ChatMessage[] = []
      try { saved = parseSavedChat(localStorage.getItem(key)) } catch { /* storage can be unavailable */ }
      setLocalHistory(true); setExtra(saved); setHistoryReady(true)
    })().catch(() => {
      if (current()) setHistoryNotice('Could not load your conversation. Close Bob and try again.')
    })
    return () => { cancelled = true }
  }, [project.id])

  function applyServerHistory(history: Awaited<ReturnType<typeof db.getAskBobConversation>>) {
    serverThread.current = history.threadId ?? null
    keepOutgoing(reconcileOutgoing(outgoing.current, history.threadId, history.messages))
    const held = outgoing.current
    setLocalHistory(false)
    setExtra(held ? [...history.messages, { from: 'user', text: held.text, turnId: held.turnId }] : history.messages)
    setReadTarget(history.threadId && history.latestSeq ? { threadId: history.threadId, seq: history.latestSeq } : null)
    window.dispatchEvent(new Event(db.BOB_INBOX_EVENT))
    setRetry(held ?? history.retry ?? null)
    setRecovering(history.pending ?? null)
    setWorkingLabel(db.describeBobProgress(history.pending?.progress))
    setWorking(!!history.pending)
    setHistoryNotice(held ? 'Your new message is kept in this tab, but receipt is not confirmed. Use Retry request when Bob is free.'
      : history.retry ? 'The previous answer was interrupted. Retry to continue without repeating saved changes.' : '')
  }

  // Opening an already-mounted drawer must see replies delivered while elsewhere.
  useEffect(() => {
    const reopened = open && !wasOpen.current
    wasOpen.current = open
    if (!reopened || !historyReady || localHistory || recovering || working) return
    let cancelled = false
    const version = sendVersion.current
    const isCurrent = scope.current.capture()
    void db.getAskBobConversation(project.id).then(history => {
      if (!cancelled && isCurrent() && version === sendVersion.current && history.mode === 'server') applyServerHistory(history)
    }).catch(() => { /* The existing transcript remains usable while offline. */ })
    return () => { cancelled = true }
  }, [open, project.id, historyReady, localHistory])

  // Reopening/reloading never resends a pending question. Read until the server
  // commits the answer or reports failure. Durable jobs own their expiry; legacy
  // synchronous requests retain the existing five-minute lease.
  useEffect(() => {
    if (!recovering) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout>
    const isCurrent = scope.current.capture()
    const current = () => !cancelled && isCurrent()
    const poll = async () => {
      try {
        const history = await db.getAskBobConversation(project.id)
        if (!current()) return
        if (history.mode !== 'server') throw new Error('Conversation unavailable')
        applyServerHistory(history)
        if (!history.pending) {
          if (history.messages.some(message => message.evidence?.writes?.length)) setNeedsRefresh(true)
          return
        }
      } catch {
        if (!current()) return
        if (Date.now() >= recovering.expiresAt) {
          setRecovering(null); setWorking(false); setRetry(outgoing.current ?? recovering)
          setHistoryNotice('Could not check the answer. Reconnect and retry to recover it without repeating saved changes.')
          return
        }
        setHistoryNotice('Connection interrupted. Checking for Bob’s answer…')
      }
      if (current()) timer = setTimeout(poll, 2000)
    }
    timer = setTimeout(poll, 1500)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [recovering?.turnId, recovering?.expiresAt, project.id])

  useEffect(() => {
    if (!historyReady || !historyKey || !localHistory) return
    try {
      if (extra.length === 0) localStorage.removeItem(historyKey)
      else localStorage.setItem(historyKey, JSON.stringify(extra.slice(-MAX_SAVED_MESSAGES)))
    } catch { /* Private browsing/storage quota must not break the assistant. */ }
  }, [extra, historyKey, historyReady, localHistory])

  // An already-open tab must not resurrect an old local transcript or late reply.
  useEffect(() => {
    const onReset = (event: StorageEvent) => {
      if (!historyKey || event.key !== `${historyKey}:reset` || !event.newValue) return
      scope.current.invalidate()
      keepOutgoing(null)
      serverThread.current = null
      setReadTarget(null); readAck.current = ''
      setExtra([]); setDraft(''); setExpanded(false); setShowJump(false); stickToEnd.current = true; setWorking(false); setRecovering(null); setConfirmReset(false); setRetry(null)
      setHistoryReady(true)
      setHistoryNotice('This conversation was cleared in another tab. Saved project data is unchanged.')
    }
    window.addEventListener('storage', onReset)
    return () => window.removeEventListener('storage', onReset)
  }, [historyKey])

  const resetConversation = async () => {
    if (resetPending.current || working || !historyReady || !historyKey) return
    resetPending.current = true
    const isCurrent = scope.current.capture()
    setResetting(true); setResetError('')
    try {
      const mode = await db.resetAskBobConversation(project.id)
      if (!isCurrent()) return
      let cacheCleared = true
      try { localStorage.removeItem(historyKey) } catch { cacheCleared = false }
      if (!cacheCleared && mode === 'local') throw new Error('Could not clear this device’s saved chat. Check browser storage access and try again.')
      try { localStorage.setItem(`${historyKey}:reset`, crypto.randomUUID()) } catch { /* cross-tab notification is best effort */ }
      scope.current.invalidate()
      keepOutgoing(null)
      serverThread.current = null
      setReadTarget(null); readAck.current = ''
      window.dispatchEvent(new Event('bob:inbox-changed'))
      setLocalHistory(mode === 'local'); setExtra([]); setDraft(''); setExpanded(false); setShowJump(false); stickToEnd.current = true; setWorking(false); setRecovering(null); setRetry(null)
      setConfirmReset(false)
      setHistoryNotice(cacheCleared
        ? 'New conversation started. Saved project data is unchanged.'
        : 'Server conversation cleared. This browser’s old local copy could not be removed; check browser storage access.')
    } catch (error) {
      if (isCurrent()) setResetError(error instanceof Error ? error.message : 'Could not confirm the reset. Please try again.')
    } finally {
      resetPending.current = false
      setResetting(false)
    }
  }

  const push = (...msgs: ChatMessage[]) => setExtra(list => [...list, ...msgs])

  const send = async (retryRequest?: RetryTurn, appendUser = !retryRequest) => {
    const text = (retryRequest?.text ?? draft).trim()
    if (!text || working || resetting || resetPending.current || !historyReady || confirmReset || (outgoing.current && appendUser)) return
    sendVersion.current++
    const isCurrent = scope.current.capture()
    const clientTurnId = retryRequest?.turnId ?? crypto.randomUUID()
    // A retry belongs to the original send. A new request reads navigation now.
    const screen = appendUser ? getBobSurface(project.id) : retryRequest?.screen
    if (!localHistory) keepOutgoing({ text, turnId: clientTurnId, screen, threadId: serverThread.current })
    if (appendUser) setDraft('')
    setExpanded(false); setShowJump(false); stickToEnd.current = true; setRetry(null); setHistoryNotice('')
    if (appendUser) push({ from: 'user', text, turnId: clientTurnId })
    setWorking(true); setWorkingLabel(db.describeBobProgress(undefined))
    const result = await db.askBob(project.id, text, clientTurnId, screen)
    if (!isCurrent()) return
    if ('pending' in result) {
      setRecovering({ text, turnId: clientTurnId, screen, expiresAt: result.expiresAt })
      return
    }
    // A disconnected HTTP response does not mean the server stopped working.
    if ('unavailable' in result && ['turn_in_flight', 'seam_unreachable'].includes(result.unavailable)) {
      try {
        const history = await db.getAskBobConversation(project.id)
        if (!isCurrent()) return
        if (history.mode === 'server') {
          applyServerHistory(history)
          if (history.messages.some(message => message.from === 'bob' && message.turnId === clientTurnId && message.evidence?.writes?.length)) setNeedsRefresh(true)
          return
        }
      } catch { /* Preserve the same turn id for a later recovery attempt. */ }
      if (!isCurrent()) return
      if (result.unavailable === 'turn_in_flight') {
        setWorking(false)
        setRetry({ text, turnId: clientTurnId, screen })
        setHistoryNotice('Bob is busy. Your message is kept here. Use Retry request when he is free.')
        return
      }
    }
    if (!isCurrent()) return
    setWorking(false)
    if ('answer' in result) {
      keepOutgoing(null)
      if (result.evidence.writes?.length) setNeedsRefresh(true)
      push({ from: 'bob', text: result.answer, evidence: result.evidence })
    } else if (result.unavailable !== 'project_changed') {
      if (['project_denied', 'unauthorized', 'not_configured', 'project_mismatch', 'turn_budget_exhausted'].includes(result.unavailable)) {
        keepOutgoing(null)
        if (result.unavailable !== 'turn_budget_exhausted') setDraft(previous => previous || text)
      }
      if (!['project_denied', 'unauthorized', 'not_configured', 'project_mismatch', 'turn_budget_exhausted'].includes(result.unavailable)) setRetry({ text, turnId: clientTurnId, screen })
      const message = result.unavailable === 'not_configured'
        ? 'This is demo mode. I can show the sample project, but a real AI conversation is not connected.'
        : result.unavailable === 'unauthorized'
          ? 'Please sign in again before asking about this project.'
          : result.unavailable === 'project_denied'
            ? 'I could not access this project. Your membership may have changed.'
            : result.unavailable === 'turn_budget_exhausted'
              ? 'Bob stopped because this request reached its AI spending or call limit. Review what was saved before starting a new request.'
            : result.unavailable === 'context_preparing'
              ? 'Bob is catching up on the older conversation. Retry the same request to continue; no new project changes were made.'
            : result.unavailable === 'context_unavailable'
              ? 'Bob could not safely use the page, project or conversation context. The records may have changed while he was working. Review any saved changes, then use Retry request to reread the original selection.'
            : result.unavailable === 'turn_in_flight'
              ? 'That conversation already has a question in progress. Try again when it finishes.'
              : 'I could not retrieve an answer for this project. Please try again.'
      push({ from: 'bob', text: message })
    }
  }

  const handleAction = (action: string) => { void send({ text: action, turnId: crypto.randomUUID() }, true) }

  if (!open) return null

  return createPortal(
    <div ref={overlay} role="dialog" aria-modal="true" aria-label={`Bob conversation for ${project.name}`} className="no-print bob-overlay" style={{ ...(viewport ? { top: viewport.top, height: viewport.height } : {}) }}>
      <div onClick={close} style={{ position: 'absolute', inset: 0, background: 'rgba(30,26,14,.34)', animation: 'fadeUp .2s ease' }} />
      <aside aria-label={`Ask bob for ${project.name}`} className={`bob-drawer ${compact ? 'bob-compact' : 'bob-comfortable'}`}>
        <header className="bob-header" style={{ display: 'flex', alignItems: 'center', gap: 11, padding: 'max(8px, env(safe-area-inset-top)) 12px 8px', borderBottom: '1px solid var(--line)', background: 'var(--brand)', color: 'var(--brand-ink)' }}>
          <span style={{ width: 38, height: 38, borderRadius: 12, background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="tree-evergreen" weight="fill" size={21} color="var(--accent-ink)" /></span>
          <div style={{ flex: 1, minWidth: 0, lineHeight: 1.2 }}><div className="font-display" style={{ fontWeight: 800, fontSize: 18 }}>Ask bob</div><div className="bob-project-name" title={project.name}>{project.name}</div></div>
          <button aria-label="Close Ask bob" onClick={close} style={{ background: '#ffffff1c', border: 'none', borderRadius: 10, padding: '0 12px', minHeight: 44, gap: 6, flex: '0 0 auto', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--brand-ink)' }}><Icon name="x" size={18} /><span>Close</span></button>
        </header>

        <div className="bob-toolbar">
          <button type="button" className="btn" disabled={!historyReady || working || resetting} style={{ minHeight: 44 }} onClick={() => { setResetError(''); setConfirmReset(true) }}>
            <Icon name="arrow-counter-clockwise" size={16} /> New conversation
          </button>
          <button type="button" className="btn bob-density" aria-label="Comfortable text spacing" aria-pressed={!compact} title={compact ? 'Use larger text and spacing' : 'Use compact text and spacing'} onClick={() => setCompact(value => !value)}>Aa</button>
        </div>
        <div className="bob-transcript">
        <div ref={historyScroll} className="bob-history" onScroll={e => {
          const el = e.currentTarget
          stickToEnd.current = el.scrollHeight - el.scrollTop - el.clientHeight < 64
          setShowJump(!stickToEnd.current)
        }}>
          <div ref={historyContent} className="bob-history-content">
          <details className="bob-context" aria-label="Bob page context">
            <summary>{recovering || retry ? 'Continuing the original request' : surface?.label ?? 'Project context'}</summary>
            <p>{recovering || retry ? 'Its saved page context stays with this request.' : 'Page focus only. Bob checks the saved project records when you send.'}</p>
          </details>
          {!extra.length && !working && <Bubble msg={{ from: 'bob', text: `Ask me about ${project.name}, work out a build detail or request a saved update.` }} />}
          {extra.map((m, i) => <Bubble key={`x${i}`} msg={m} onAction={handleAction} onOpenDrawing={close} />)}
          {historyNotice && <div role="status" className="bob-history-notice">{historyNotice}</div>}
          {working && <WorkingBubble label={workingLabel} />}
        {!extra.length && !working && <div className="bob-chips">{chips?.map(c => <button key={c} disabled={resetting} onClick={() => setDraft(c)} style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 999, padding: '7px 12px', fontSize: 12.5, color: 'var(--ink-soft)', fontWeight: 600 }}>{c}</button>)}</div>}
        {retry && <details className="bob-retry-details">
          <summary>About this retry</summary>
          <p>{outgoing.current ? 'Your new message has not been confirmed. Retry this message when Bob is free.' : 'Retry the same request to check its result without duplicating saved changes.'}</p>
          {outgoing.current && <>
            <button className="btn" disabled={working || resetting || confirmReset} style={{ marginTop: 6, minHeight: 44 }} onClick={() => {
              const held = outgoing.current
              keepOutgoing(null); setRetry(null); setHistoryNotice('Retry dismissed. This does not cancel work Bob may already have received.')
              setExtra(messages => messages.map(message => message.from === 'user' && message.turnId === held?.turnId
                ? { ...message, note: 'Delivery was not confirmed.' } : message))
            }}>Dismiss retry</button>
            <p>Dismissing the retry removes the temporary copy. It does not cancel work Bob may already have received.</p>
          </>}
        </details>}
          </div>
        </div>
        {showJump && <button className="btn bob-jump" type="button" aria-label="Jump to latest message" onClick={() => { stickToEnd.current = true; if (historyScroll.current) historyScroll.current.scrollTop = historyScroll.current.scrollHeight; setShowJump(false) }}><Icon name="arrow-down" size={18} /> {readTarget && readAck.current !== `${project.id}/${readTarget.threadId}/${readTarget.seq}` ? 'New message' : 'Latest'}</button>}
        </div>
        {retry && <div className="bob-recovery" role="status">
          <span>{outgoing.current ? 'Receipt not confirmed' : 'Answer interrupted'}</span>
          <button className="btn btn-primary" disabled={working || resetting || confirmReset} onClick={() => void send(retry)}>Retry request</button>
        </div>}
        <form onSubmit={e => { e.preventDefault(); void send() }} className={`bob-composer ${expanded ? 'bob-composer-expanded' : ''}`}>
          <textarea ref={composer} rows={1} disabled={resetting} value={draft} onChange={e => setDraft(e.target.value)} aria-label="Question for bob" maxLength={4096} placeholder="Ask bob about this project…" onKeyDown={e => {
            if (e.nativeEvent.isComposing) return
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void send() }
            if (e.key === 'Escape' && expanded) { e.preventDefault(); setExpanded(false) }
          }} />
          <div className="bob-composer-actions">
            <button type="button" className="btn" aria-label={expanded ? 'Collapse message editor' : 'Expand message editor'} aria-expanded={expanded} onClick={() => { setExpanded(value => !value); composer.current?.focus() }}><Icon name={expanded ? 'arrows-in-simple' : 'arrows-out-simple'} size={18} /></button>
            <button type="submit" className="btn btn-primary" aria-label="Send" disabled={working || resetting || !historyReady || !draft.trim() || !!outgoing.current}><Icon name="paper-plane-right" weight="fill" size={18} /></button>
          </div>
        </form>
      </aside>
      {confirmReset && <Modal title="Start a new conversation?" layer={100} onClose={() => { if (!resetPending.current) setConfirmReset(false) }}>
        <p style={{ lineHeight: 1.5, overflowWrap: 'anywhere' }}>Clear your chat and Bob’s conversation context for <strong>{project.name}</strong>. This cannot be undone.</p>
        <p style={{ lineHeight: 1.5, color: 'var(--ink-soft)' }}>Saved project data and other people’s chats stay unchanged.</p>
        {resetError && <p role="alert" style={{ color: 'var(--clay)', lineHeight: 1.5 }}>{resetError}</p>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', flexWrap: 'wrap', gap: 8, marginTop: 18 }}>
          <button type="button" className="btn" style={{ minHeight: 44 }} disabled={resetting} onClick={() => setConfirmReset(false)}>Cancel</button>
          <button type="button" className="btn btn-primary" style={{ minHeight: 44 }} disabled={resetting} onClick={() => { void resetConversation() }}>{resetting ? 'Clearing…' : 'Clear chat and context'}</button>
        </div>
      </Modal>}
    </div>, document.body,
  )
}
