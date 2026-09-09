/*
 * Project-bound assistant drawer. The direct backend can read allowed project
 * records and suggest next steps; responses remain AI assessments. Layout
 * remounts this drawer when project/auth context changes.
 */

import { useEffect, useRef, useState } from 'react'
import * as db from '../data/database'
import { Icon, useAsync } from './ui'
import type { ChatMessage } from '../data/types'
import { createRequestScope } from '../lib/projectRequest'

const toneColor = {
  clay: { c: 'var(--clay)', bg: 'var(--clay-bg)' },
  honey: { c: '#9A6313', bg: 'var(--honey-bg)' },
  leaf: { c: 'var(--leaf)', bg: 'var(--leaf-bg)' },
}

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
        {msg.evidence && <div style={{ fontSize: 11, color: 'var(--ink-soft)', marginBottom: 6 }}>Bob’s assessment</div>}
        <div style={{ whiteSpace: 'pre-wrap' }}>{msg.text}</div>
        {msg.evidence && <details style={{ marginTop: 10, fontSize: 12, color: 'var(--ink-soft)' }}>
          <summary>Project records consulted ({msg.evidence.sources.length})</summary>
          <p>Stored project information; measurements and specifications are not verified.</p>
          {msg.evidence.partial && <p>Some results were limited or unavailable.</p>}
          <ul style={{ paddingLeft: 18 }}>{msg.evidence.sources.map((source, i) => <li key={i}>
            <strong>{source.label}</strong> · {source.dataset}<br />
            Record {source.recordId}<br />
            Retrieved {new Date(source.retrievedAt).toLocaleString()}
            {source.updatedAt ? ` · updated ${new Date(source.updatedAt).toLocaleString()}` : ' · update time unknown'}
          </li>)}</ul>
        </details>}
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

/** Shown only while a question is genuinely in flight. */
function WorkingBubble() {
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
      <span style={{ width: 30, height: 30, borderRadius: '50%', background: 'var(--brand)', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: '0 0 auto' }}>
        <Icon name="tree-evergreen" weight="fill" size={17} color="var(--accent)" />
      </span>
      <div style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: '16px 16px 16px 4px', boxShadow: 'var(--shadow-sm)', padding: '12px 15px', fontSize: 13.5, color: 'var(--ink-soft)', display: 'flex', gap: 8, alignItems: 'center' }}>
        <Icon name="hammer" weight="fill" size={15} color="var(--honey)" />
        <span>Bob is checking the project…</span>
      </div>
    </div>
  )
}

export function AskBob({ open, onClose, project }: { open: boolean; onClose: () => void; project: { id: string; name: string } }) {
  const { data: chips } = useAsync(() => db.getAskBobChips(), [project.id])
  const [draft, setDraft] = useState('')
  const [extra, setExtra] = useState<ChatMessage[]>([])
  const [working, setWorking] = useState(false)
  const scope = useRef(createRequestScope())
  useEffect(() => () => scope.current.invalidate(), [project.id])

  const push = (...msgs: ChatMessage[]) => setExtra(list => [...list, ...msgs])

  const send = async () => {
    const text = draft.trim()
    if (!text || working) return
    const isCurrent = scope.current.capture()
    setDraft('')
    push({ from: 'user', text })
    setWorking(true)
    const result = await db.askBuilders(project.id, text)
    if (!isCurrent()) return
    setWorking(false)
    if ('answer' in result) {
      push({ from: 'bob', text: result.answer, evidence: result.evidence })
    } else if (result.unavailable !== 'project_changed') {
      const message = result.unavailable === 'not_configured'
        ? 'This is demo mode. I can show the sample project, but a real AI conversation is not connected.'
        : result.unavailable === 'unauthorized'
          ? 'Please sign in again before asking about this project.'
          : result.unavailable === 'project_denied'
            ? 'I could not access this project. Your membership may have changed.'
            : 'I could not retrieve an answer for this project. Please try again.'
      push({ from: 'bob', text: message })
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
            <div style={{ fontSize: 12, color: '#ffffffaa' }}>{project.name}</div>
          </div>
          <button aria-label="Close Ask bob" onClick={onClose} style={{ background: '#ffffff1c', border: 'none', borderRadius: 10, width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--brand-ink)' }}>
            <Icon name="x" size={16} />
          </button>
        </header>

        <div style={{ flex: 1, overflowY: 'auto', padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Bubble msg={{ from: 'bob', text: `Ask me about ${project.name}. I can read project records and suggest next steps.` }} />
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
            aria-label="Question for bob"
            maxLength={4096}
            placeholder="Ask bob about this project…"
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
