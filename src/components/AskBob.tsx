/*
 * "Ask bob" — the assistant drawer. When the Launchpad seam is live
 * (supabase/README.md), a question goes to a real team of AI builders on
 * Launchpad: bob submits it, shows an honest working state while the run is
 * genuinely in flight, answers a mid-run follow-up question if the builders
 * ask one, and renders the result. Without the seam he falls back to the
 * scripted answer — the live "needs attention" feed — and says so.
 */

import { useEffect, useRef, useState } from 'react'
import * as db from '../data/database'
import { Icon, useAsync } from './ui'
import type { ChatMessage } from '../data/types'

const toneColor = {
  clay: { c: 'var(--clay)', bg: 'var(--clay-bg)' },
  honey: { c: '#9A6313', bg: 'var(--honey-bg)' },
  leaf: { c: 'var(--leaf)', bg: 'var(--leaf-bg)' },
}

/** How long bob keeps polling a run before calling it honestly lost (ms). */
const RUN_PATIENCE = 4 * 60_000
const POLL_EVERY = 4_000

function Bubble({ msg, onAction }: { msg: ChatMessage; onAction?: (action: string) => void }) {
  const isUser = msg.from === 'user'
  return (
    <div style={{ display: 'flex', gap: 10, justifyContent: isUser ? 'flex-end' : 'flex-start', alignItems: 'flex-start' }}>
      {!isUser && (
        <span style={{ width: 30, height: 30, borderRadius: '50%', background: 'var(--brand)', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: '0 0 auto' }}>
          <Icon name="tree-evergreen" weight="fill" size={17} color="var(--accent)" />
        </span>
      )}
      <div
        style={{
          maxWidth: '80%',
          padding: '12px 15px',
          fontSize: 14.5,
          lineHeight: 1.5,
          ...(isUser
            ? { background: 'var(--accent)', color: 'var(--accent-ink)', borderRadius: '16px 16px 4px 16px', fontWeight: 600 }
            : { background: 'var(--surface)', border: '1px solid var(--line)', color: 'var(--ink)', borderRadius: '16px 16px 16px 4px', boxShadow: 'var(--shadow-sm)' }),
        }}
      >
        <div>{msg.text}</div>
        {msg.report && (
          <div style={{ marginTop: 10, background: 'var(--canvas)', border: '1px solid var(--line)', borderRadius: 10, padding: '10px 12px', fontSize: 13.5, lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>
            {msg.report}
          </div>
        )}
        {msg.list && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
            {msg.list.map((it, i) => (
              <div key={i} style={{ display: 'flex', gap: 9, alignItems: 'flex-start' }}>
                <span style={{ width: 24, height: 24, borderRadius: 7, flex: '0 0 auto', display: 'flex', alignItems: 'center', justifyContent: 'center', background: toneColor[it.tone].bg }}>
                  <Icon name={it.icon} weight="fill" size={13} color={toneColor[it.tone].c} />
                </span>
                <span style={{ fontSize: 13.5, lineHeight: 1.4 }}>{it.text}</span>
              </div>
            ))}
          </div>
        )}
        {msg.action && (
          <button className="btn btn-primary" style={{ marginTop: 11, fontSize: 13 }} onClick={() => onAction?.(msg.action!)}>
            <Icon name="sparkle" weight="fill" size={14} /> {msg.action}
          </button>
        )}
        {msg.note && (
          <div style={{ marginTop: 11, background: 'var(--honey-bg)', borderRadius: 9, padding: '8px 10px', fontSize: 12.5, color: '#7c5410', display: 'flex', gap: 7 }}>
            <Icon name="warning" weight="fill" size={14} color="var(--honey)" style={{ marginTop: 1 }} />
            <span>{msg.note}</span>
          </div>
        )}
      </div>
    </div>
  )
}

/** Shown only while a Launchpad run is genuinely in flight. */
function WorkingBubble() {
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
      <span style={{ width: 30, height: 30, borderRadius: '50%', background: 'var(--brand)', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: '0 0 auto' }}>
        <Icon name="tree-evergreen" weight="fill" size={17} color="var(--accent)" />
      </span>
      <div style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: '16px 16px 16px 4px', boxShadow: 'var(--shadow-sm)', padding: '12px 15px', fontSize: 13.5, color: 'var(--ink-soft)', display: 'flex', gap: 8, alignItems: 'center' }}>
        <Icon name="hammer" weight="fill" size={15} color="var(--honey)" />
        <span>The builders are on it — this can take a minute or two…</span>
      </div>
    </div>
  )
}

export function AskBob({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data: chat } = useAsync(() => db.getAskBobChat(), [])
  const { data: chips } = useAsync(() => db.getAskBobChips(), [])
  const [draft, setDraft] = useState('')
  const [extra, setExtra] = useState<ChatMessage[]>([])
  const [working, setWorking] = useState(false)
  // A mid-run question from the builders: the next send answers it.
  const [pendingQuestion, setPendingQuestion] = useState<{ taskId: string; questionId: string } | null>(null)
  const alive = useRef(true)

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  const push = (...msgs: ChatMessage[]) => {
    if (alive.current) setExtra((list) => [...list, ...msgs])
  }

  /** The pre-Launchpad behavior: answer honestly with the live attention feed. */
  const scriptedAnswer = async (lead: string) => {
    const attention = await db.getAttention()
    push(
      attention.length > 0
        ? { from: 'bob', text: `${lead} — but here's what I'd flag on the build right now:`, list: attention.map((a) => ({ icon: a.icon, tone: a.tone, text: a.text })) }
        : { from: 'bob', text: `${lead} — but nothing needs attention right now. The build looks tidy.` },
    )
  }

  /** Poll one Launchpad run to its end and render what actually happened. */
  const followRun = async (taskId: string) => {
    setWorking(true)
    const deadline = Date.now() + RUN_PATIENCE
    try {
      while (alive.current && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, POLL_EVERY))
        const update = await db.getBuildersUpdate(taskId)
        if (!alive.current) return

        if (update.status === 'completed') {
          push({ from: 'bob', text: update.summary || 'The builders are done.', report: update.report })
          return
        }
        if (update.status === 'input-required' && update.question) {
          setPendingQuestion({ taskId, questionId: update.question.id })
          push({
            from: 'bob',
            text: `The builders have a question before they go on: ${update.question.text}`,
            note: 'Reply below to answer them — the run continues once you do.',
          })
          return
        }
        if (update.status === 'failed') {
          await scriptedAnswer("The builders couldn't finish that one")
          return
        }
        // still working — keep polling
      }
      if (alive.current) {
        await scriptedAnswer('That took longer than I was willing to keep you waiting')
      }
    } finally {
      if (alive.current) setWorking(false)
    }
  }

  const send = async () => {
    const text = draft.trim()
    if (!text || working) return
    setDraft('')
    push({ from: 'user', text })

    // Mid-run answer to the builders' question?
    if (pendingQuestion) {
      const { taskId, questionId } = pendingQuestion
      setPendingQuestion(null)
      setWorking(true)
      const ok = await db.answerBuilders(taskId, questionId, text)
      if (!alive.current) return
      if (ok) {
        await followRun(taskId)
      } else {
        setWorking(false)
        await scriptedAnswer("I couldn't get your answer through to the builders")
      }
      return
    }

    // Fresh question → hand it to whichever AI backend is live.
    setWorking(true)
    const result = await db.askBuilders(text)
    if (!alive.current) return
    if ('taskId' in result) {
      await followRun(result.taskId)
    } else if ('answer' in result) {
      // The synchronous backend already finished — render it, don't poll a
      // task that was never created.
      setWorking(false)
      push({ from: 'bob', text: result.answer })
    } else {
      setWorking(false)
      // No live seam (mock mode / not configured / signed out) keeps the
      // original honest script; a real failure says a builder-flavored truth.
      await scriptedAnswer(
        result.unavailable === 'not_configured'
          ? "I can't hold a real conversation yet"
          : result.unavailable === 'unauthorized'
            ? 'Sign in first so I know who I’m building with — I couldn’t send that'
            : "I couldn't reach the builders just now",
      )
    }
  }

  const handleAction = (action: string) =>
    push({ from: 'bob', text: `"${action}" — I can't do that for you quite yet. Head to the area page and use the Assign button; real hands-on help from me is coming.` })

  if (!open) return null

  return (
    <div className="no-print" style={{ position: 'fixed', inset: 0, zIndex: 60 }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(30,26,14,.34)', animation: 'fadeUp .2s ease' }} />
      <aside
        style={{
          position: 'absolute',
          top: 0,
          right: 0,
          bottom: 0,
          width: 'min(440px, 100%)',
          background: 'var(--canvas)',
          borderLeft: '1px solid var(--line)',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '-20px 0 50px -30px rgba(0,0,0,.5)',
          animation: 'fadeUp .25s ease',
        }}
      >
        <header style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '16px 18px', borderBottom: '1px solid var(--line)', background: 'var(--brand)', color: 'var(--brand-ink)' }}>
          <span style={{ width: 38, height: 38, borderRadius: 12, background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="tree-evergreen" weight="fill" size={21} color="var(--accent-ink)" />
          </span>
          <div style={{ flex: 1, lineHeight: 1.2 }}>
            <div className="font-display" style={{ fontWeight: 800, fontSize: 18 }}>Ask bob</div>
            <div style={{ fontSize: 12, color: '#ffffffaa' }}>He keeps the whole build in his head.</div>
          </div>
          <button onClick={onClose} style={{ background: '#ffffff1c', border: 'none', borderRadius: 10, width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--brand-ink)' }}>
            <Icon name="x" size={16} />
          </button>
        </header>

        <div style={{ flex: 1, overflowY: 'auto', padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
          {chat?.map((m, i) => <Bubble key={i} msg={m} onAction={handleAction} />)}
          {extra.map((m, i) => <Bubble key={`x${i}`} msg={m} onAction={handleAction} />)}
          {working && <WorkingBubble />}
        </div>

        <div style={{ padding: '0 18px 8px', display: 'flex', gap: 7, flexWrap: 'wrap' }}>
          {chips?.map((c) => (
            <button
              key={c}
              onClick={() => setDraft(c)}
              style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 999, padding: '7px 12px', fontSize: 12.5, color: 'var(--ink-soft)', fontWeight: 600 }}
            >
              {c}
            </button>
          ))}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault()
            void send()
          }}
          style={{ display: 'flex', gap: 8, padding: 18, borderTop: '1px solid var(--line)' }}
        >
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={pendingQuestion ? 'Answer the builders…' : 'Ask bob anything about the build…'}
            style={{ flex: 1, border: '1px solid var(--line)', borderRadius: 12, padding: '11px 14px', fontSize: 14, background: 'var(--surface)', color: 'var(--ink)' }}
          />
          <button type="submit" className="btn btn-primary" aria-label="Send" disabled={working} style={working ? { opacity: 0.55 } : undefined}>
            <Icon name="paper-plane-right" weight="fill" size={16} />
          </button>
        </form>
      </aside>
    </div>
  )
}
