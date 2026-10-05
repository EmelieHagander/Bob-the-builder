import { useState } from 'react'
import { Link } from 'react-router-dom'
import * as db from '../../data/database'
import { Icon, List, ListItem, Loading, Panel, SectionTitle, useAsync } from '../../components/ui'
import { InstallSettingsCard } from '../../components/InstallSettingsCard'

/** Account administration stays separate from the Home project overview. */
export function Account() {
  const [version, setVersion] = useState(0)
  const { data: account, loading, error } = useAsync(() => db.getAccount(), [version])
  const { data: project, loading: projectLoading, error: projectError } = useAsync(() => db.getProject(), [])
  const [signingOut, setSigningOut] = useState(false)
  const [signOutError, setSignOutError] = useState('')

  async function signOut() {
    if (signingOut) return
    setSigningOut(true); setSignOutError('')
    try { await db.signOut() }
    catch (reason) { setSignOutError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setSigningOut(false) }
  }

  return <div className="page account-page">
    <div className="page-head">
      <div><h1 className="page-title">Account</h1><p className="page-sub">Your household, shared spaces and Bob on your devices.</p></div>
      <div className="cluster"><Link className="btn" to="/" aria-label="Back to Home"><Icon name="arrow-left" size={16} /> Home</Link><Link className="btn" to="/account/settings"><Icon name="gear-six" size={16} /> Settings</Link></div>
    </div>
    <div className="account-hub-grid">
      <div className="account-hub-column">
        <Panel as="section" className="account-household" aria-label="Household account">
          <div className="account-household-heading"><span className="account-household-icon"><Icon name="house" size={26} /></span><div><small>Household account</small><h2>{loading ? 'Loading household…' : error ? 'Household unavailable' : account?.name || 'Your household'}</h2></div></div>
          {loading ? <Loading label="Loading account details…" /> : error ? <div role="alert"><p>Account details could not be loaded.</p><button className="btn" onClick={() => setVersion(v => v + 1)}>Try again</button></div>
            : account ? <><p className="foundation-hint">These details are shared with your household.</p>
              {(account.ownerName || account.email) && <dl className="account-contact">
                {account.ownerName && <div><dt>Contact name</dt><dd>{account.ownerName}</dd></div>}
                {account.email && <div><dt>Contact email</dt><dd>{account.email}</dd></div>}
              </dl>}
            </> : <p className="foundation-hint">No shared household account is connected to this login. You can still use the projects you have access to.</p>}
          <Link className="btn btn-primary" to="/account/settings"><Icon name="gear-six" size={16} /> {account ? 'Edit household details' : 'Household settings'}</Link>
        </Panel>
        <section aria-label="Account tools">
          <SectionTitle>Household &amp; spaces</SectionTitle>
          <List>
            <ListItem><Link className="account-tool-link" to="/account/buildings"><Icon name="house" size={22} /><div><strong>Buildings &amp; family</strong><span>Manage shared buildings, rooms and household access.</span></div><Icon name="arrow-right" size={18} /></Link></ListItem>
            <ListItem><Link className="account-tool-link" to="/account/calendar"><Icon name="calendar-dots" size={22} /><div><strong>Calendar</strong><span>View the saved build dates across your projects.</span></div><Icon name="arrow-right" size={18} /></Link></ListItem>
          </List>
        </section>
      </div>
      <div className="account-hub-column">
        <InstallSettingsCard />
        <Panel as="section" aria-label="Session">
          <SectionTitle icon="user-circle">Session</SectionTitle>
          {projectLoading ? <Loading label="Checking your workspace…" /> : projectError ? <p role="status">The selected workspace could not be loaded. Your project selection is unchanged.</p>
            : project ? <><p className="foundation-hint">Open workspace</p><strong className="account-workspace-name">{project.name}</strong><div className="cluster"><Link className="btn" to="/project">Open project</Link><button className="btn" onClick={() => db.setActiveProject(null)}>Close project</button></div><p className="foundation-hint">Closing a workspace keeps its saved work and your access.</p></>
              : <p className="foundation-hint">No project is open. Choose a project from Home when you are ready to build.</p>}
          {db.authEnabled() && <div className="account-sign-out"><button className="btn" disabled={signingOut} onClick={() => void signOut()}><Icon name="sign-out" size={16} /> {signingOut ? 'Signing out…' : 'Sign out'}</button>{signOutError && <p role="alert">Could not sign out. {signOutError}</p>}</div>}
        </Panel>
      </div>
    </div>
  </div>
}
