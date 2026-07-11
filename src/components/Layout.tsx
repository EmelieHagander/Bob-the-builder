/*
 * App shell: sidebar (desktop), bottom tab bar (mobile), top bar with the
 * project switcher, and the floating "Ask bob" button + drawer.
 */

import { useEffect, useState, type ReactNode } from 'react'
import { Link, NavLink } from 'react-router-dom'
import * as db from '../data/database'
import { Avatar, Icon, useAsync } from './ui'
import { AskBob } from './AskBob'

/** Re-render dependency that bumps on every sign-in/out (no-op in demo mode). */
export function useAuthTick(): number {
  const [tick, setTick] = useState(0)
  useEffect(() => db.onAuthChange(() => setTick((t) => t + 1)), [])
  return tick
}

interface NavItem {
  to: string
  icon: string
  label: string
  end?: boolean
}

const NAV: NavItem[] = [
  { to: '/', icon: 'house', label: 'Dashboard', end: true },
  { to: '/areas', icon: 'squares-four', label: 'Areas' },
  { to: '/people', icon: 'users-three', label: 'People' },
  { to: '/events', icon: 'calendar-dots', label: 'Events' },
  { to: '/food', icon: 'cooking-pot', label: 'Food' },
  { to: '/shopping', icon: 'shopping-cart-simple', label: 'Shopping' },
  { to: '/announcements', icon: 'megaphone', label: 'Announcements' },
  { to: '/today', icon: 'sun-horizon', label: 'Today' },
]

function Sidebar() {
  const tick = useAuthTick()
  const { data: project } = useAsync(() => db.getProject(), [])
  const { data: me } = useAsync(() => db.getCurrentUser(), [tick])

  return (
    <aside
      className="no-print sidebar"
      style={{
        width: 'var(--sidebar-w)',
        flex: '0 0 var(--sidebar-w)',
        background: 'var(--brand)',
        color: 'var(--brand-ink)',
        padding: '18px 14px',
        display: 'flex',
        flexDirection: 'column',
        gap: 3,
        position: 'sticky',
        top: 0,
        height: '100vh',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '6px 8px 16px' }}>
        <div style={{ width: 40, height: 40, borderRadius: 13, background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 0 rgba(0,0,0,.14)' }}>
          <Icon name="tree-evergreen" weight="fill" size={23} color="var(--accent-ink)" />
        </div>
        <div style={{ lineHeight: 1 }}>
          <div className="font-display" style={{ fontWeight: 800, fontSize: 24, color: 'var(--brand-ink)' }}>bob</div>
          <div style={{ fontSize: 10, letterSpacing: '.16em', textTransform: 'uppercase', color: '#ffffff80', marginTop: 3 }}>build crew</div>
        </div>
      </div>

      <button
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          width: '100%',
          textAlign: 'left',
          background: '#ffffff14',
          border: '1px solid #ffffff24',
          borderRadius: 13,
          padding: '9px 11px',
          color: 'var(--brand-ink)',
          marginBottom: 12,
        }}
      >
        <div style={{ width: 26, height: 26, borderRadius: 8, background: '#ffffff26', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="mountains" size={15} />
        </div>
        <div style={{ flex: 1, lineHeight: 1.2 }}>
          <div style={{ fontSize: 13.5, fontWeight: 700 }}>{project?.name ?? '…'}</div>
          <div style={{ fontSize: 11, color: '#ffffff85' }}>{project ? `${project.type} · ${project.location.split(',')[0]}` : ''}</div>
        </div>
        <Icon name="caret-up-down" size={14} color="#ffffffaa" />
      </button>

      <nav style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        {NAV.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end} style={{ display: 'block' }}>
            {({ isActive }) => (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 11,
                  padding: '9px 11px',
                  borderRadius: 11,
                  fontSize: 13.5,
                  fontWeight: isActive ? 700 : 600,
                  background: isActive ? 'var(--accent)' : 'transparent',
                  color: isActive ? 'var(--accent-ink)' : '#ffffffcf',
                  transition: 'background .12s ease',
                }}
              >
                <Icon name={n.icon} weight={isActive ? 'fill' : 'regular'} size={17} /> {n.label}
              </div>
            )}
          </NavLink>
        ))}
      </nav>

      <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ background: '#ffffff12', border: '1px solid #ffffff1f', borderRadius: 14, padding: '13px 13px 14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 700, color: 'var(--brand-ink)' }}>
            <Icon name="tree-evergreen" weight="fill" size={16} color="var(--accent)" /> Stuck on something?
          </div>
          <div style={{ fontSize: 11.5, color: '#ffffffb0', marginTop: 4, lineHeight: 1.4 }}>
            Ask bob — he keeps the whole build in his head so you don't have to.
          </div>
        </div>
        {me ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingTop: 4, borderTop: '1px solid #ffffff1f' }}>
            <Avatar person={me} size={32} />
            <div style={{ lineHeight: 1.2, flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 700 }}>{me.name.split(' ')[0]}</div>
              <div style={{ fontSize: 11, color: '#ffffff85' }}>{me.role}</div>
            </div>
            {db.authEnabled() && (
              <button
                onClick={() => db.signOut()}
                title="Sign out"
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ffffff85', padding: 4 }}
              >
                <Icon name="sign-out" size={17} />
              </button>
            )}
          </div>
        ) : (
          db.authEnabled() && (
            <Link
              to="/signin"
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, paddingTop: 12, borderTop: '1px solid #ffffff1f', fontSize: 13, fontWeight: 700, color: 'var(--brand-ink)' }}
            >
              <Icon name="sign-in" size={16} /> Sign in
            </Link>
          )
        )}
      </div>
    </aside>
  )
}

function MobileNav() {
  const items = NAV.slice(0, 5)
  return (
    <nav
      className="no-print mobile-nav"
      style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 40,
        background: 'var(--brand)',
        // display is owned by theme.css (.mobile-nav): none on desktop, flex
        // under 860px. An inline display here would override the desktop rule
        // and leave an invisible click-swallowing bar across the bottom.
        justifyContent: 'space-around',
        padding: '8px 6px calc(8px + env(safe-area-inset-bottom))',
        borderTop: '1px solid #ffffff1f',
      }}
    >
      {items.map((n) => (
        <NavLink key={n.to} to={n.to} end={n.end} style={{ flex: 1 }}>
          {({ isActive }) => (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, color: isActive ? 'var(--accent)' : '#ffffffb0', fontSize: 10, fontWeight: 600 }}>
              <Icon name={n.icon} weight={isActive ? 'fill' : 'regular'} size={21} />
              {n.label}
            </div>
          )}
        </NavLink>
      ))}
    </nav>
  )
}

export function Layout({ children }: { children: ReactNode }) {
  const [bobOpen, setBobOpen] = useState(false)

  return (
    <div className="app-shell">
      <Sidebar />
      <div className="main-col">{children}</div>

      <button
        className="no-print"
        onClick={() => setBobOpen(true)}
        style={{
          position: 'fixed',
          right: 'clamp(16px, 3vw, 30px)',
          bottom: 'clamp(74px, 4vw, 28px)',
          zIndex: 50,
          display: 'flex',
          alignItems: 'center',
          gap: 9,
          background: 'var(--accent)',
          border: 'none',
          borderRadius: 999,
          padding: '13px 20px 13px 16px',
          fontSize: 15,
          fontWeight: 800,
          color: 'var(--accent-ink)',
          fontFamily: "'Baloo 2', cursive",
          boxShadow: '0 8px 22px -6px rgba(40,30,10,.5), 0 3px 0 var(--accent-2)',
        }}
      >
        <span style={{ width: 30, height: 30, borderRadius: '50%', background: 'var(--brand)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="tree-evergreen" weight="fill" size={18} color="var(--accent)" />
        </span>
        Ask bob
      </button>

      <MobileNav />
      <AskBob open={bobOpen} onClose={() => setBobOpen(false)} />
    </div>
  )
}
