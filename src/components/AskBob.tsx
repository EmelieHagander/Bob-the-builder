/*
 * "Ask bob" — the scripted assistant drawer from the mockup. Reads its canned
 * conversation through the database layer like everything else.
 */

import { useState } from 'react'
import * as db from '../data/database'
import { Icon, useAsync } from './ui'
import type { ChatMessage } from '../data/types'

const toneColor = {
  clay: { c: 'var(--clay)', bg: 'var(--clay-bg)' },
  honey: { c: '#9A6313', bg: 'var(--honey-bg)' },
  leaf: { c: 'var(--leaf)', bg: 'var(--leaf-bg)' },
}

function Bubble({ msg }: { msg: ChatMessage }) {
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
          <button className="btn btn-primary" style={{ marginTop: 11, fontSize: 13 }}>
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

export function AskBob({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data: chat } = useAsync(() => db.getAskBobChat(), [])
  const { data: chips } = useAsync(() => db.getAskBobChips(), [])
  const [draft, setDraft] = useState('')

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
          {chat?.map((m, i) => <Bubble key={i} msg={m} />)}
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
            setDraft('')
          }}
          style={{ display: 'flex', gap: 8, padding: 18, borderTop: '1px solid var(--line)' }}
        >
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Ask bob anything about the build…"
            style={{ flex: 1, border: '1px solid var(--line)', borderRadius: 12, padding: '11px 14px', fontSize: 14, background: 'var(--surface)', color: 'var(--ink)' }}
          />
          <button type="submit" className="btn btn-primary" aria-label="Send">
            <Icon name="paper-plane-right" weight="fill" size={16} />
          </button>
        </form>
      </aside>
    </div>
  )
}
