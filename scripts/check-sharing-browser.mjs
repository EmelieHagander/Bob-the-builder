// Production React, routing and database.ts; only HTTP replies are fixtures.
// These checks prove UI behavior. tests/sharing.test.ts owns SQL/RLS proof.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright-core'

const base = 'http://127.0.0.1:4173/Bob-the-builder/'
const api = 'https://pwa-proof.invalid'
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--base', '/Bob-the-builder/', '--host', '127.0.0.1', '--port', '4173', '--strictPort'], { stdio: ['ignore', 'pipe', 'pipe'] })
let logs = '', browser, activePage
server.stdout.on('data', chunk => { logs += chunk })
server.stderr.on('data', chunk => { logs += chunk })
const user = { id: '00000000-0000-0000-0000-000000000003', email: 'fixture@example.test', aud: 'authenticated', role: 'authenticated', app_metadata: { provider: 'email' }, user_metadata: {}, created_at: '2026-09-13T00:00:00Z' }
const expiresAt = Math.floor(Date.now() / 1000) + 3600
const token = [JSON.stringify({ alg: 'HS256', typ: 'JWT' }), JSON.stringify({ sub: user.id, exp: expiresAt, role: 'authenticated' }), 'fixture-signature'].map(part => Buffer.from(part).toString('base64url')).join('.')
const projects = ['A', 'B'].map(id => ({ id, slug: id.toLowerCase(), name: 'Porch ' + id, description: '', location: '', type: 'Renovation', theme: 'birch', start_label: '', start_date: null, end_date: null }))
const directory = { households: [{ id: 'H1', name: 'Our family' }, { id: 'H2', name: 'Other household' }], friends: [{ id: 'F1', name: 'Alexandra with a very long family name' }, { id: 'F2', name: 'Sam' }] }
const audit = { change_note: 'Browser fixture', actor_label: 'Fixture member', recorded_at: '2026-09-13T14:00:00Z', archived: false }
const buildings = [{ id: 'B1', name: 'Main house' }, { id: 'B2', name: 'Workshop' }].map(building => ({ ...building, site_id: null, revision: 1, notes: '', ...audit }))

async function fixture(viewport, fresh = false) {
  const context = await browser.newContext({ viewport, serviceWorkers: 'block' })
  const state = {
    accessible: fresh ? [] : ['A', 'B'],
    sources: { A: { householdId: null, buildingId: null, revision: 0 }, B: { householdId: 'H2', buildingId: null, revision: 1 } },
    buildingHouseholds: { B1: null, B2: 'H2' },
    buildingRevision: 1,
    outgoing: [],
    volunteerLinks: [],
    incoming: fresh ? ['A', 'B'].map(id => ({ id: 'incoming-' + id, projectId: id, projectName: 'Porch ' + id, inviterName: 'Alexandra', status: 'pending' })) : [],
    canEditBuilding: true,
    canManageBuilding: true,
    canManageProject: true,
    conflict: false,
    unavailable: false,
    failProjectList: false,
    failAccountBind: false,
    account: null,
    writes: [],
    errors: [],
    spaces: [],
    emails: [],
  }
  function projectState(id) {
    return { projectId: id, ...state.sources[id], canManage: state.canManageProject, buildings: buildings.map(building => ({ id: building.id, name: building.name, householdId: state.buildingHouseholds[building.id], householdName: directory.households.find(household => household.id === state.buildingHouseholds[building.id])?.name ?? null })), invitations: state.outgoing.filter(invitation => invitation.projectId === id).map(({ projectId, ...invitation }) => invitation) }
  }
  function buildingState(id) {
    return { buildingId: id, householdId: state.buildingHouseholds[id], revision: state.buildingRevision, canManage: state.canManageBuilding, projects: projects.filter(project => state.accessible.includes(project.id)).map(project => ({ id: project.id, name: project.name, ...state.sources[project.id] })) }
  }
  await context.route('https://fonts.googleapis.com/**', route => route.abort())
  await context.route(api + '/**', async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname, method = request.method()
    const respond = options => route.fulfill({ ...options, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS' } })
    if (method === 'OPTIONS') return respond({ status: 204 })
      if (new URL(route.request().url()).pathname === '/rest/v1/rpc/project_plan_read') return respond({json:{record:null}})
      if (new URL(route.request().url()).pathname === '/rest/v1/rpc/project_work_read') return respond({json:{project_id:route.request().postDataJSON().p_project,vocabulary_version:'2026-09-24.1',status:'not_initialized',revision:null,focus_step_id:null,areas:[],steps:[],unorganised_tasks:[]}})
    if (path === '/auth/v1/token') return respond({ json: { access_token: token, refresh_token: 'fixture-refresh', token_type: 'bearer', expires_in: 3600, expires_at: expiresAt, user } })
    if (path === '/auth/v1/user') return respond({ json: user })
    if (path === '/auth/v1/logout') return respond({ json: {} })
    if (path.startsWith('/rest/')) assert.equal(request.headers().authorization, 'Bearer ' + token)
    if (path === '/rest/v1/rpc/claim_project_invites') return respond({ json: 0 })
    if (path === '/rest/v1/projects') return state.failProjectList ? respond({ status: 503, json: { message: 'Project list temporarily unavailable' } }) : respond({ json: projects.filter(project => state.accessible.includes(project.id)) })
    // An invited collaborator must not see or edit another household's notes.
    if (path === '/rest/v1/account') return respond({ json: state.account ? [state.account] : [] })
    if (path === '/rest/v1/rpc/bind_account_household') {
      const body = request.postDataJSON()
      if (state.failAccountBind) return respond({ status: 403, json: { message: 'Household account setup denied.' } })
      assert.equal(body.p_household, 'H1')
      state.writes.push({ command: 'bind_account_household', ...body })
      state.account = { id: 'account', name: 'Family account', owner_name: '', email: '' }
      return respond({ json: { householdId: body.p_household } })
    }
    if (path === '/rest/v1/people') {
      const member = { id: 'memberA', name: 'Fixture member', initials: 'FM', color: '#41513f', role: 'Organiser', diet: '', person_skills: [] }
      return respond({ json: url.searchParams.has('auth_user_id') ? member : [member, ...state.emails] })
    }
    if (['account_notes', 'areas', 'tasks', 'materials', 'events', 'announcements', 'current_sites', 'current_levels', 'current_elements', 'current_relationships'].some(name => path === '/rest/v1/' + name)) return respond({ json: [] })
    if (path === '/rest/v1/current_buildings') return respond({ json: buildings })
    if (path === '/rest/v1/project_buildings') return respond({ json: buildings.map(building => ({ ...building, project_id: url.searchParams.get('project_id')?.replace(/^eq\./, '') })) })
    if (path === '/rest/v1/current_spaces') return respond({ json: state.spaces })
    if (path === '/rest/v1/rpc/can_edit_building') return respond({ json: state.canEditBuilding })
    if (path === '/rest/v1/rpc/physical_node_command') {
      const body = request.postDataJSON()
      assert.equal(body.p_kind, 'space')
      assert.equal(body.p_action, 'create')
      state.writes.push({ command: 'physical_node_command', ...body })
      const row = { ...body.p_data, id: body.p_record, building_id: body.p_building, revision: 1, latest_revision: 1, project_id: null, source_project_id: null, has_proposal: false, ...audit }
      state.spaces.push(row)
      return respond({ json: row })
    }
    if (path === '/rest/v1/rpc/invite_person') {
      const body = request.postDataJSON()
      state.writes.push({ command: 'invite_person', ...body })
      state.emails.push({ id: 'email-member', name: body.p_name, initials: 'EC', role: 'Volunteer', diet: '', color: '#41513f', person_skills: [] })
      return respond({ json: 'email-member' })
    }
    if (path === '/rest/v1/rpc/sharing_directory') return state.unavailable ? respond({ status: 404, json: { code: 'PGRST202', message: 'not installed' } }) : respond({ json: directory })
    if (path === '/rest/v1/rpc/project_sharing_state') return respond({ json: projectState(request.postDataJSON().p_project) })
    if (path === '/rest/v1/rpc/building_sharing_state') return respond({ json: buildingState(request.postDataJSON().p_building) })
    if (path === '/rest/v1/rpc/project_invitations') return respond({ json: state.incoming })
    if (path === '/rest/v1/rpc/volunteer_links_state') {
      const projectId = request.postDataJSON().p_project
      return respond({ json: { projectId, links: state.volunteerLinks.filter(link => link.projectId === projectId), participants: [] } })
    }
    if (path === '/rest/v1/rpc/create_volunteer_link') {
      const body = request.postDataJSON()
      assert.match(body.p_secret, /^[0-9a-f]{64}$/)
      const link = { id: 'volunteer-' + state.volunteerLinks.length, projectId: body.p_project, label: body.p_label, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + body.p_days * 86400000).toISOString(), revokedAt: null, participants: 0 }
      state.volunteerLinks.push(link)
      return respond({ json: link })
    }
    if (path === '/rest/v1/rpc/revoke_volunteer_access') {
      const body = request.postDataJSON(), link = state.volunteerLinks.find(link => link.id === body.p_link && link.projectId === body.p_project)
      assert(link)
      link.revokedAt = new Date().toISOString()
      return respond({ json: { projectId: body.p_project, revoked: true } })
    }
    if (path === '/rest/v1/rpc/set_building_household') {
      const body = request.postDataJSON()
      assert.equal(body.p_expected, state.buildingRevision)
      assert(body.p_household || body.p_projects.length === 0, 'Stopping sharing must not attempt to enroll projects')
      state.writes.push({ command: 'set_building_household', ...body })
      state.buildingHouseholds[body.p_building] = body.p_household
      state.buildingRevision++
      for (const id of body.p_projects) {
        assert(state.sources[id].buildingId === body.p_building || (!state.sources[id].householdId && !state.sources[id].buildingId && state.sources[id].revision === 0), 'Bulk sharing must not replace a saved project choice')
        state.sources[id] = { householdId: null, buildingId: body.p_building, revision: state.sources[id].revision + 1 }
      }
      return respond({ json: buildingState(body.p_building) })
    }
    if (path === '/rest/v1/rpc/set_project_household') {
      const body = request.postDataJSON()
      if (state.conflict) return respond({ status: 409, json: { message: 'Sharing changed. Refresh sharing and try again.' } })
      assert.equal(body.p_expected, state.sources[body.p_project].revision)
      state.writes.push({ command: 'set_project_household', ...body })
      state.sources[body.p_project] = { householdId: body.p_household, buildingId: body.p_building, revision: body.p_expected + 1 }
      return respond({ json: projectState(body.p_project) })
    }
    if (path === '/rest/v1/rpc/invite_project_friend') {
      const body = request.postDataJSON(), friend = directory.friends.find(friend => friend.id === body.p_friend)
      assert(friend)
      state.writes.push({ command: 'invite_project_friend', ...body })
      const invitation = { id: 'outgoing-' + state.writes.length, projectId: body.p_project, inviteeId: friend.id, name: friend.name, status: 'pending' }
      state.outgoing.push(invitation)
      const { projectId, ...result } = invitation
      return respond({ json: result })
    }
    if (path === '/rest/v1/rpc/revoke_project_invitation') {
      const body = request.postDataJSON(), invitation = state.outgoing.find(invitation => invitation.id === body.p_invite)
      assert(invitation)
      invitation.status = 'revoked'
      state.writes.push({ command: 'revoke_project_invitation', ...body })
      return respond({ json: { revoked: true } })
    }
    if (path === '/rest/v1/rpc/respond_project_invitation') {
      const body = request.postDataJSON(), invitation = state.incoming.find(invitation => invitation.id === body.p_invite)
      assert(invitation)
      invitation.status = body.p_accept ? 'accepted' : 'declined'
      if (body.p_accept) state.accessible.push(invitation.projectId)
      state.writes.push({ command: 'respond_project_invitation', ...body })
      return respond({ json: { projectId: invitation.projectId } })
    }
    state.errors.push(method + ' ' + path)
    return respond({ status: 500, json: { message: 'Unexpected fixture request' } })
  })
  const page = await context.newPage()
  activePage = page
  page.setDefaultTimeout(15000)
  page.on('pageerror', error => state.errors.push(error.message))
  return { page, context, state }
}

async function signIn(page, fresh = false) {
  await page.goto(base + '#/signin')
  await page.getByPlaceholder('you@example.se').fill(user.email)
  await page.locator('input[type="password"]').fill('fixture-password')
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await page.getByRole('heading', { name: fresh ? 'Welcome to bob' : 'Your account', exact: true }).waitFor()
}

async function openProjectSharing(page) {
  const disclosure = page.locator('.sharing-disclosure')
  if (!(await disclosure.evaluate(node => node.open))) await disclosure.locator('summary').click()
  const card = page.getByRole('region', { name: 'Project sharing', exact: true })
  await card.getByLabel('Share project with', { exact: true }).waitFor()
  return card
}

async function assertLayout(page, viewport, scope, label) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${label}: page overflow at ${viewport.width}px`)
  assert(await scope.evaluate(node => node.scrollWidth <= node.clientWidth + 1), `${label}: card overflow`)
  for (const button of await scope.getByRole('button').all()) {
    if (!(await button.isVisible())) continue
    const box = await button.boundingBox()
    assert(box && box.width >= 44 && box.height >= 44, `${label}: every action has a 44px target`)
  }
  await page.screenshot({ path: `test-results/sharing-${label}-${viewport.width}.png`, fullPage: true })
}

try {
  for (let tries = 0; ; tries++) {
    try { if ((await fetch(base)).ok) break } catch {}
    assert(tries < 40 && server.exitCode === null, 'Preview did not start: ' + logs)
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] })
  await mkdir('test-results', { recursive: true })
  for (const viewport of [{ width: 320, height: 740 }, { width: 390, height: 844 }, { width: 1280, height: 900 }]) {
    const { page, context, state } = await fixture(viewport)
    await signIn(page)
    assert.equal(await page.getByPlaceholder('Jot something down…').count(), 0, 'Unrelated household notes must have no write controls')
    await page.getByRole('link', { name: 'Settings', exact: true }).click()
    await page.getByLabel('Household for account settings').selectOption('H1')
    state.failAccountBind = true
    await page.getByRole('button', { name: 'Set up household account', exact: true }).click()
    await page.getByText('Household account setup denied.', { exact: true }).waitFor()
    assert.equal(await page.getByLabel('Account name *', { exact: true }).count(), 0)
    state.failAccountBind = false
    await page.getByRole('button', { name: 'Set up household account', exact: true }).click()
    await page.getByLabel('Account name *', { exact: true }).waitFor()
    assert.equal(await page.getByLabel('Account name *', { exact: true }).inputValue(), 'Family account')
    await page.reload()
    await page.getByLabel('Account name *', { exact: true }).waitFor()
    assert.equal(await page.getByLabel('Account name *', { exact: true }).inputValue(), 'Family account')
    await page.goto(base + '#/account')
    await page.getByRole('heading', { name: 'Family account', exact: true }).waitFor()
    await page.getByRole('link', { name: 'Buildings & family', exact: true }).click()
    await page.getByRole('heading', { name: 'Main house', exact: true }).waitFor()
    assert.equal(await page.getByRole('button', { name: 'Use in this project', exact: true }).count(), 0)
    let building = page.getByRole('region', { name: 'Household sharing for Main house', exact: true })
    await building.getByLabel('Building household', { exact: true }).selectOption('H1')
    assert(await building.getByRole('checkbox', { name: /^Porch B/ }).isDisabled())
    await building.getByRole('checkbox', { name: /^Porch A/ }).check()
    await building.getByRole('button', { name: 'Save building sharing', exact: true }).click()
    await building.getByText('Building sharing saved.', { exact: true }).waitFor()
    assert.deepEqual(state.writes.at(-1).p_projects, ['A'])
    assert.equal(state.sources.B.householdId, 'H2', 'Other project sharing is unchanged')
    await page.reload()
    building = page.getByRole('region', { name: 'Household sharing for Main house', exact: true })
    await building.getByRole('checkbox', { name: /^Porch A/ }).waitFor()
    assert.equal(await building.getByLabel('Building household').inputValue(), 'H1')
    assert(await building.getByRole('checkbox', { name: /^Porch A/ }).isChecked())
    assert(await building.getByRole('checkbox', { name: /^Porch A/ }).isDisabled())
    await assertLayout(page, viewport, building, 'building')
    await building.getByLabel('Building household').selectOption('')
    await building.getByRole('button', { name: 'Save building sharing', exact: true }).click()
    await building.getByText('Building sharing saved.', { exact: true }).waitFor()
    assert.deepEqual(state.writes.at(-1).p_projects, [])
    assert.equal(state.sources.A.buildingId, 'B1', 'Ending household access preserves explicit inheritance source')

    // A changed building household is read live, rather than copied into a project.
    state.buildingHouseholds.B1 = 'H2'
    await building.locator('.sharing-project-row').filter({ hasText: 'Porch A' }).getByRole('link', { name: 'Manage in project' }).click()
    await page.getByRole('heading', { name: 'People', exact: true }).waitFor()
    let sharing = await openProjectSharing(page)
    assert.equal(await sharing.getByLabel('Follow building').inputValue(), 'B1')
    await sharing.getByText(/Main house: Other household/).waitFor()
    await sharing.getByLabel('Follow building').selectOption('B2')
    await sharing.getByRole('button', { name: 'Save project sharing', exact: true }).click()
    await sharing.getByText('Project sharing saved.', { exact: true }).waitFor()
    assert.equal(state.sources.A.buildingId, 'B2')
    assert.equal(state.sources.A.householdId, null)
    await page.reload()
    sharing = await openProjectSharing(page)
    assert.equal(await sharing.getByLabel('Follow building').inputValue(), 'B2')
    await sharing.getByLabel('Share project with').selectOption('private')
    await sharing.getByRole('button', { name: 'Save project sharing', exact: true }).click()
    await sharing.getByText('Project sharing saved.', { exact: true }).waitFor()
    assert.equal(state.sources.A.buildingId, null)
    await sharing.getByLabel('Share project with').selectOption('household')
    await sharing.getByLabel('Project household').selectOption('H1')
    state.conflict = true
    await sharing.getByRole('button', { name: 'Save project sharing', exact: true }).click()
    await sharing.getByRole('alert').getByText('Sharing changed. Refresh sharing and try again.', { exact: true }).waitFor()
    assert.equal(state.sources.A.householdId, null)
    assert.equal(await sharing.getByText('Project sharing saved.', { exact: true }).count(), 0)
    state.conflict = false
    await sharing.getByRole('button', { name: 'Save project sharing', exact: true }).click()
    await sharing.getByText('Project sharing saved.', { exact: true }).waitFor()
    assert.equal(state.sources.A.householdId, 'H1')
    await assertLayout(page, viewport, sharing, 'project')

    await page.getByRole('button', { name: 'Invite people', exact: true }).click()
    let modal = page.getByRole('dialog', { name: 'Invite to the crew', exact: true })
    await modal.getByRole('button', { name: 'Create volunteer link', exact: true }).click()
    await modal.getByLabel('Link to share', { exact: true }).waitFor()
    assert.match(await modal.getByLabel('Link to share', { exact: true }).inputValue(), /#\/volunteer\/[0-9a-f]{64}$/)
    assert.equal(state.volunteerLinks[0].projectId, 'A')
    await assertLayout(page, viewport, modal, 'volunteer-link')
    await modal.getByRole('button', { name: 'Revoke link', exact: true }).click()
    await modal.getByRole('button', { name: 'Confirm revocation', exact: true }).click()
    await modal.getByText('Volunteer access revoked.', { exact: true }).waitFor()
    assert(state.volunteerLinks[0].revokedAt)
    await modal.getByRole('button', { name: 'Existing friend', exact: true }).click()
    await modal.getByLabel('Friend', { exact: true }).selectOption('F1')
    await modal.getByRole('button', { name: 'Invite friend', exact: true }).click()
    await modal.getByText(/Alexandra with a very long family name: invitation pending/).waitFor()
    assert.equal(state.outgoing[0].projectId, 'A')
    await assertLayout(page, viewport, modal, 'friend')
    await modal.getByRole('button', { name: 'Done', exact: true }).click()
    await modal.waitFor({ state: 'hidden' })
    await sharing.getByText('Pending acceptance', { exact: true }).waitFor()
    await sharing.getByRole('button', { name: 'Cancel invitation', exact: true }).click()
    await sharing.getByRole('button', { name: 'Confirm removal', exact: true }).click()
    await sharing.getByText('No pending or accepted friend invitations.', { exact: true }).waitFor()
    assert.equal(state.outgoing[0].status, 'revoked')
    state.outgoing.push({ id: 'accepted-friend', projectId: 'A', inviteeId: 'F2', name: 'Sam', status: 'accepted' })
    await sharing.getByRole('button', { name: 'Refresh sharing', exact: true }).click()
    await sharing.getByRole('button', { name: 'Remove invitation access', exact: true }).click()
    await sharing.getByRole('button', { name: 'Confirm removal', exact: true }).click()
    await sharing.getByText('No pending or accepted friend invitations.', { exact: true }).waitFor()
    assert.equal(state.outgoing.at(-1).status, 'revoked')
    await page.getByRole('button', { name: 'Invite people', exact: true }).click()
    modal = page.getByRole('dialog', { name: 'Invite to the crew', exact: true })
    await modal.getByRole('button', { name: 'Crew by email', exact: true }).click()
    await modal.getByLabel('Name *', { exact: true }).fill('Email crew')
    await modal.getByLabel('Email *', { exact: true }).fill('email-crew@example.test')
    await modal.getByRole('button', { name: 'Add crew profile', exact: true }).click()
    await modal.getByText(/Crew profiles saved: Email crew/).waitFor()
    await modal.getByRole('button', { name: 'Done', exact: true }).click()
    assert.equal(state.emails.length, 1)

    // Family building editor sees physical tools but cannot manage sharing.
    state.canManageBuilding = false
    await page.goto(base + '#/account/buildings')
    await page.getByText('Building sharing is managed by its direct members.', { exact: false }).waitFor()
    await page.getByRole('button', { name: 'Add space', exact: true }).click()
    modal = page.getByRole('dialog', { name: 'Add space', exact: true })
    await modal.getByLabel('Space name', { exact: true }).fill('Family room')
    await modal.getByRole('button', { name: 'Save', exact: true }).click()
    await modal.waitFor({ state: 'hidden' })
    await page.getByText('Family room', { exact: true }).waitFor()
    state.canEditBuilding = false
    await page.reload()
    await page.getByText('Family room', { exact: true }).waitFor()
    assert.equal(await page.getByRole('button', { name: 'Add space', exact: true }).count(), 0)
    assert.equal(await page.getByRole('region', { name: 'Household sharing for Main house', exact: true }).count(), 0)

    state.unavailable = true
    await page.goto(base + '#/people')
    await page.locator('.sharing-disclosure > summary').click()
    await page.getByRole('alert').getByText('Sharing is not available on this server yet. No sharing change was confirmed.', { exact: true }).waitFor()
    assert.equal(await page.getByRole('button', { name: 'Save project sharing', exact: true }).count(), 0)
    assert.deepEqual(state.errors, [], 'No unexpected calls or browser exceptions')
    await context.close()

    // Both invitations and physical context work without an existing project.
    const fresh = await fixture(viewport, true)
    await signIn(fresh.page, true)
    const inbox = fresh.page.getByRole('region', { name: 'Project invitations', exact: true })
    await inbox.getByText('Porch A', { exact: true }).waitFor()
    await assertLayout(fresh.page, viewport, inbox, 'incoming')
    await fresh.page.getByRole('link', { name: 'Buildings & family', exact: true }).click()
    await fresh.page.getByRole('heading', { name: 'Main house', exact: true }).waitFor()
    assert.equal(await fresh.page.getByRole('button', { name: 'Use in this project', exact: true }).count(), 0)
    await fresh.page.getByRole('link', { name: 'Account & projects', exact: true }).click()
    await inbox.locator('li').filter({ hasText: 'Porch B' }).getByRole('button', { name: 'Decline', exact: true }).click()
    await inbox.getByText('Invitation declined.', { exact: true }).waitFor()
    fresh.state.failProjectList = true
    await inbox.locator('li').filter({ hasText: 'Porch A' }).getByRole('button', { name: 'Accept invitation', exact: true }).click()
    await inbox.getByRole('alert').getByText(/Invitation accepted, but Bob could not reload the project/).waitFor()
    assert.deepEqual(fresh.state.accessible, ['A'])
    fresh.state.failProjectList = false
    await inbox.getByRole('button', { name: 'Refresh project access', exact: true }).click()
    await fresh.page.getByRole('heading', { name: 'Your account', exact: true }).waitFor()
    assert.equal(await fresh.page.getByText('Porch B', { exact: true }).count(), 0, 'Declining does not grant the other project')
    await fresh.page.reload()
    await fresh.page.getByRole('heading', { name: 'Your account', exact: true }).waitFor()
    await fresh.page.locator('.card').filter({ hasText: 'Porch A' }).getByRole('button', { name: 'Open', exact: true }).waitFor()
    assert.deepEqual(fresh.state.errors, [])
    await fresh.context.close()
    console.log(`Sharing ${viewport.width}px: opt-in building/projects, inherited source, direct household, conflict/reload, friends/email, family editing, incoming accept/decline/recovery and no-project entry: OK`)
  }
} finally {
  if (activePage && !activePage.isClosed()) await activePage.screenshot({ path: 'test-results/sharing-last-state.png', fullPage: true }).catch(() => {})
  if (browser) await browser.close().catch(() => {})
  server.kill('SIGTERM')
}
