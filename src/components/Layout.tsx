/*
 * App shell: sidebar (desktop), bottom tab bar (mobile), top bar with the
 * project switcher, and the floating "Ask bob" button + drawer.
 */

import { useEffect, useState, type ReactNode } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import * as db from '../data/database'
import type { Project } from '../data/types'
import { phaseLabel } from '../lib/projectPhase'
import { Avatar, Icon, useAsync, useProjectVersion } from './ui'
import { AskBob } from './AskBob'
import { BOB_OPEN_EVENT, useBobSurface } from '../lib/bobSurface'
import type { BobScreenSurface } from '../domain/bobScreen'

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
  { to: '/', icon: 'house', label: 'Project', end: true },
  { to: '/areas', icon: 'squares-four', label: 'Areas' },
  { to: '/people', icon: 'users-three', label: 'People' },
  { to: '/events', icon: 'calendar-dots', label: 'Events' },
  { to: '/food', icon: 'cooking-pot', label: 'Food' },
  { to: '/shopping', icon: 'shopping-cart-simple', label: 'Shopping' },
  { to: '/announcements', icon: 'megaphone', label: 'Announcements' },
  { to: '/today', icon: 'sun-horizon', label: 'Today' },
  { to: '/account', icon: 'user-circle', label: 'Account' },
]

const ACCOUNT_NAV: NavItem[] = [
  { to: '/account', icon: 'user-circle', label: 'Account', end: true },
  { to: '/account/calendar', icon: 'calendar-dots', label: 'Calendar' },
  { to: '/account/buildings', icon: 'house', label: 'Buildings' },
  { to: '/account/settings', icon: 'gear-six', label: 'Settings' },
]

function Sidebar({ project }: { project: Project | null }) {
  const tick = useAuthTick()
  const projectVersion = useProjectVersion()
  const { data: me } = useAsync(() => db.getCurrentUser(), [tick, projectVersion])

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

      <Link
        to="/account"
        title="All projects — account dashboard"
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
        <div style={{ flex: 1, lineHeight: 1.2, minWidth: 0 }}>
          <div style={{ fontSize: 13.5, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{project?.name ?? 'All projects'}</div>
          <div style={{ fontSize: 11, color: '#ffffff85', marginTop: 2 }}>{project ? `${phaseLabel(project.phase)} · ${project.location.split(',')[0] || project.type}` : ''}</div>
        </div>
        <Icon name="caret-up-down" size={14} color="#ffffffaa" />
      </Link>

      <nav style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        {(project ? NAV : ACCOUNT_NAV).map((n) => (
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
        {project && <div style={{ background: '#ffffff12', border: '1px solid #ffffff1f', borderRadius: 14, padding: '13px 13px 14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 700, color: 'var(--brand-ink)' }}>
            <Icon name="tree-evergreen" weight="fill" size={16} color="var(--accent)" /> Stuck on something?
          </div>
          <div style={{ fontSize: 11.5, color: '#ffffffb0', marginTop: 4, lineHeight: 1.4 }}>
            Ask bob — he keeps the whole build in his head so you don't have to.
          </div>
        </div>}
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
              to="/account/settings"
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, paddingTop: 12, borderTop: '1px solid #ffffff1f', fontSize: 13, fontWeight: 700, color: 'var(--brand-ink)' }}
            >
              <Icon name="gear-six" size={16} /> Account settings
            </Link>
          )
        )}
      </div>
    </aside>
  )
}

function MobileNav({ hasProject }: { hasProject: boolean }) {
  // Field work stays one tap away. Stable tabs are easier to learn than
  // phase-dependent navigation, so Today replaces People here; People remains
  // available from the full project navigation.
  const items = hasProject ? [NAV[0], NAV[1], NAV[7], NAV[3], NAV[NAV.length - 1]] : ACCOUNT_NAV
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

export function Layout({ children, project }: { children: ReactNode; project: Project | null }) {
  const location = useLocation()
  const surfaces: Record<string, BobScreenSurface> = { '/': 'project', '/areas': 'areas', '/facts': 'facts', '/solutions': 'solutions', '/artifacts': 'drawings', '/people': 'people', '/events': 'events', '/shopping': 'shopping', '/today': 'today', '/announcements': 'announcements', '/building': 'building', '/material-plan': 'material-plan' }
  const showBob = !!project && !location.pathname.startsWith('/account')
  const surface = surfaces[location.pathname] ?? 'project'
  useBobSurface(project?.id ?? '', showBob ? { surface } : null, 'Project context', 0)
  const [bobOpen, setBobOpen] = useState(false)
  const [bobStarted, setBobStarted] = useState(false)
  const [bobUnread, setBobUnread] = useState(false)
  const authTick = useAuthTick()
  useEffect(() => {
    const show = () => { setBobStarted(true); setBobOpen(true) }
    window.addEventListener(BOB_OPEN_EVENT, show)
    return () => window.removeEventListener(BOB_OPEN_EVENT, show)
  }, [])
  useEffect(() => {
    let cancelled = false, checking = false
    setBobUnread(false)
    if (!project) return
    const check = async () => {
      if (checking || document.visibilityState === 'hidden') return
      checking = true
      try { const inbox = await db.getBobInbox(project.id); if (!cancelled) setBobUnread(!!inbox?.unread) }
      catch { /* Keep the last known state until reconnected. */ }
      finally { checking = false }
    }
    void check()
    const timer = setInterval(check, 10000)
    window.addEventListener(db.BOB_INBOX_EVENT, check)
    window.addEventListener('focus', check)
    document.addEventListener('visibilitychange', check)
    return () => { cancelled = true; clearInterval(timer); window.removeEventListener(db.BOB_INBOX_EVENT, check); window.removeEventListener('focus', check); document.removeEventListener('visibilitychange', check) }
  }, [project?.id, authTick])

  useEffect(() => {
    if (!project) return
    let checking=false
    const renew=async()=>{
      if(checking||document.visibilityState==='hidden')return
      checking=true
      try{await db.renewDrawingRequests(project.id)}catch{/* Request cards retain an honest authorization-needed state. */}
      finally{checking=false}
    }
    void renew()
    const timer=setInterval(renew,60000)
    window.addEventListener('focus',renew)
    return()=>{clearInterval(timer);window.removeEventListener('focus',renew)}
  },[project?.id,authTick])

  return (
    <div className="app-shell">
      <Sidebar project={project} />
      <div className="main-col">{children}</div>

      {showBob && <button
        className="no-print"
        aria-label="Ask bob"
        aria-describedby={bobUnread ? 'bob-unread-status' : undefined}
        onClick={() => { setBobStarted(true); setBobOpen(true) }}
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
        {bobUnread && <span id="bob-unread-status" className="bob-unread-badge" role="status">New from Bob</span>}
      </button>}

      <MobileNav hasProject={!!project} />
      {bobStarted && project && <AskBob project={project} open={bobOpen && showBob} onClose={() => setBobOpen(false)} />}
    </div>
  )
}
