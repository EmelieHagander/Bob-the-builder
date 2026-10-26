/*
 * People-facing error copy: the one place that turns a failure into words.
 *
 * The data layer throws one of two typed errors:
 *   • DataError — a backend or runtime failure. `code` is the stable code that
 *     behaviour and tests check; `detail` keeps the raw text for logs and tests.
 *     Raw detail is never rendered.
 *   • UserError — a failure whose message was written for the person using bob
 *     (validation, demo mode, explicit next steps). It may be shown as written.
 *
 * Screens render userErrorMessage(error, fallback) and never error.message or
 * String(error). tests/user-facing-errors.test.ts scans .tsx files for that.
 * Anything unrecognised becomes the caller's fallback or the generic sentence.
 */

export type ErrorKind =
  | 'auth' | 'permission' | 'not_found' | 'conflict' | 'duplicate' | 'in_use'
  | 'validation' | 'network' | 'timeout' | 'rate_limited' | 'not_configured' | 'unknown'

export const GENERIC_ERROR = 'Something went wrong. Try again.'

/** A backend/runtime failure. `detail` is for logs and tests only. */
export class DataError extends Error {
  readonly code: string
  readonly kind: ErrorKind
  readonly detail: string
  readonly status?: number
  readonly dbCode?: string
  constructor(code: string, detail = '', options: { kind?: ErrorKind; status?: number; dbCode?: string } = {}) {
    super(detail || code)
    this.name = 'DataError'
    this.code = code
    this.kind = options.kind ?? kindOfCode(code)
    this.detail = detail
    this.status = options.status
    this.dbCode = options.dbCode
  }
}

/** A failure whose message is written for people and may be shown as is. */
export class UserError extends Error {
  readonly code: string
  constructor(message: string, code = 'user_message') {
    super(message)
    this.name = 'UserError'
    this.code = code
  }
}

/* ───────────────────────── Copy ───────────────────────── */

/** One sentence per kind of failure. */
const KIND_COPY: Record<Exclude<ErrorKind, 'unknown'>, string> = {
  auth: 'Your sign-in has expired. Sign in again to continue.',
  permission: 'You do not have permission to do that.',
  not_found: 'This is no longer available. It may have been removed, or your access changed.',
  conflict: 'This changed somewhere else. Reload to see the latest version, then try again.',
  duplicate: 'That already exists. Reload to see it.',
  in_use: 'This is still used elsewhere in the project, so it cannot be removed.',
  validation: 'Some details were not accepted. Check them and try again.',
  network: 'Could not reach the server. Check your connection and try again.',
  timeout: 'That took too long. Check your connection and try again.',
  rate_limited: 'Too many attempts. Wait a moment and try again.',
  not_configured: 'This is not available on this server yet.',
}

/** Specific codes with their own sentence. */
const CODE_COPY: Record<string, string> = {
  project_denied: 'You no longer have access to this project.',
  building_denied: 'You do not have access to change this building.',
  site_denied: 'You cannot use that site in this project.',
  unauthorized: KIND_COPY.auth,
  auth_expired: KIND_COPY.auth,
  invalid_credentials: 'That email and password do not match. Check them and try again.',
  email_not_confirmed: 'Confirm your email address first, using the link we sent you.',
  user_already_exists: 'An account with this email already exists. Sign in instead.',
  email_exists: 'An account with this email already exists. Sign in instead.',
  weak_password: 'Choose a longer password that is harder to guess.',
  email_address_invalid: 'Check the email address and try again.',
  otp_expired: 'That sign-in link has expired. Ask for a new one.',
  signup_disabled: 'New accounts cannot be created right now.',
  over_email_send_rate_limit: 'Too many sign-in emails were sent. Wait a few minutes and try again.',
  already_invited: 'That person is already invited.',
  project_mismatch: 'These records do not belong to the open project. Reload to continue.',
  measurement_already_classified: 'This measurement already says what it measures. To change that, archive it and add a new measurement.',
  measurement_property_required: 'Choose what the measurement measures before adding a side or a reference.',
  invalid_measurement_property: 'Choose what the measurement measures from the list.',
  invalid_measurement_side: 'Choose north, east, south or west, or no side.',
  invalid_measurement_reference: 'Keep the reference to 120 characters or fewer.',
}

/*
 * Rules the backend currently states in English. The server text is matched
 * exactly, as a code; the sentence shown is owned here. Backend codes should
 * replace these entries over time. Unlisted text falls back to its kind.
 */
const RULE_LIST: [server: string, copy: string, code?: string][] = [
  // Work and phases
  ['Complete required checks before marking this task done.', 'Complete required checks before marking this task done.'],
  ['Join this task before updating it.', 'Join this task before updating it.'],
  ['This task is already done. Refresh the task list.', 'This task is already done. Refresh the task list.'],
  ['Only active tasks can be confirmed ready.', 'Only active tasks can be confirmed ready.'],
  ['Resolve named blockers before confirming readiness.', 'Resolve the named blockers before confirming readiness.'],
  ['Task dependencies cannot form a cycle.', 'Tasks cannot depend on each other in a loop.'],
  ['Task dependency must stay inside one Project.', 'Choose a task in this project.'],
  ['Reopen the task before adding or reopening a required check.', 'Reopen the task before adding or reopening a required check.'],
  ['Reopen the task before reopening a required check.', 'Reopen the task before reopening a required check.'],
  ['Completed Tasks are project history and are kept.', 'Completed tasks are kept as project history.'],
  ['Restore the Area before adding or reopening work.', 'Restore the Area before adding or reopening work.'],
  ['Resolve the pending plan proposal that uses this Area before archiving.', 'Resolve the pending plan proposal that uses this Area before archiving it.'],
  ['Move or finish this Area\'s unfinished Steps and Tasks before archiving.', 'Move or finish this Area\'s unfinished Steps and Tasks before archiving.'],
  ['Complete or explicitly defer every Area before completing the Project.', 'Complete or defer every Area before completing the project.'],
  ['Project is already in that phase', 'The project is already in that phase.'],
  ['Area is already in that phase', 'This Area is already in that phase.'],
  ['Estimated geometry must stay Concept until those dimensions are verified', 'A drawing based on estimated dimensions stays at Concept until those dimensions are measured.'],
  // Volunteers and attendance
  ['Volunteer access is unavailable. Ask the organiser for a new link.', 'Volunteer access is unavailable. Ask the organiser for a new link.', 'volunteer_access_unavailable'],
  ['Volunteer access not found.', 'This volunteer link is not valid. Ask the organiser for a new link.', 'volunteer_access_unavailable'],
  ['This volunteer link is full. Ask the organiser for a new link.', 'This volunteer link is full. Ask the organiser for a new link.'],
  ['This link cannot be reused. Create a new link.', 'This link cannot be reused. Create a new link.'],
  ['Revoke an old volunteer link before creating another.', 'Revoke an old volunteer link before creating another.'],
  ['Choose a link name and between 1 and 90 days.', 'Choose a link name and between 1 and 90 days.'],
  ['Enter your name (up to 120 characters) and optional allergies (up to 1000 characters).', 'Enter your name (up to 120 characters) and any allergies (up to 1000 characters).'],
  ['Check your name and allergies.', 'Check your name and allergies.'],
  ['Allergies can only be added when this project has food planned.', 'Allergies can only be added when this project has food planned.'],
  ['Choose your attendance.', 'Choose whether you are coming.'],
  ['Drawing unavailable or changed. Refresh the task to see its current drawings.', 'Drawing unavailable or changed. Refresh the task to see its current drawings.'],
  // Buildings and sharing
  ['Archive building before deleting.', 'Archive the building before deleting it.'],
  ['Archive site before deleting.', 'Archive the site before deleting it.'],
  ['Building is still used by a project.', 'This building is still used by a project.'],
  ['Building is still used by a project Area.', 'This building is still used by a project Area.'],
  ['Building site is still used by a project.', 'This site is still used by a project.'],
  ['Site is still used by a project.', 'This site is still used by a project.'],
  ['Site still contains buildings.', 'This site still contains buildings.'],
  ['Change household sharing or revoke the project invitation first', 'Change household sharing or revoke the project invitation first.'],
  ['Account already belongs to another household', 'This account already belongs to another household.'],
  ['Invitation is no longer pending', 'This invitation is no longer open.'],
  ['Project sharing has an existing choice. Review and change that project separately.', 'This project already has its own sharing choice. Change it from that project.'],
  // Materials, stock and designs
  ['Stock quantity is already reserved by another active material requirement', 'That stock is already reserved by another material requirement.'],
  ['Stock quantity is already reserved by another active material requirement or cut plan', 'That stock is already reserved by another material requirement or cut plan.'],
  ['Reusable component quantity is already reserved by another active material requirement', 'That reusable component is already reserved by another material requirement.'],
  ['Stock units cannot change. Create a new stock item for a different unit.', 'Stock units cannot change. Create a new stock item for a different unit.'],
  ['Restore the material requirement before sending it to Shopping.', 'Restore the material requirement before sending it to Shopping.'],
  ['Choose a project target before saving a drawing.', 'Select a target for this scope before saving a drawing.'],
  ['Choose a project target before saving a material requirement.', 'Select a target for this scope before saving a material requirement.'],
  ['Choose another target or clear it before archiving this alternative.', 'Select another target, or clear it, before archiving this alternative.'],
  ['Restore this alternative before selecting it.', 'Restore this alternative before selecting it.'],
  ['Restore this record before editing.', 'Restore this record before editing it.'],
  ['Restore the component before adding a measurement.', 'Restore the component before adding a measurement.'],
  ['There is no selected target to clear.', 'There is no selected target to clear.'],
  ['Project target changed. Reload before saving the drawing.', 'The selected target changed. Reload before saving the drawing.', 'target_changed'],
  ['Selected target changed for this Project/Area. Reload before saving the drawing.', 'The selected target changed. Reload before saving the drawing.', 'target_changed'],
  ['Project target changed. Reload before saving the material requirement.', 'The selected target changed. Reload before saving the material requirement.', 'target_changed'],
  ['Selected target changed for this Project/Area. Reload before saving the material requirement.', 'The selected target changed. Reload before saving the material requirement.', 'target_changed'],
  ['Target changed. Reload before deciding again.', 'The selected target changed. Reload before deciding again.', 'target_changed'],
  ['Unknown measurements cannot generate geometry', 'Measure the unknown dimensions before generating the drawing.'],
  ['The opening must fit completely inside the wall dimensions', 'The opening must fit completely inside the wall.'],
  ['Wall width and height must be greater than zero', 'Wall width and height must be greater than zero.'],
  ['Opening width and height must be greater than zero', 'Opening width and height must be greater than zero.'],
  ['Stud spacing must be a whole number from 200 to 1200 mm', 'Stud spacing must be a whole number from 200 to 1200 mm.'],
  ['Use the CAD assistant to revise this construction and its drawings together.', 'Ask Bob to revise this construction so its drawings stay together.'],
  // Images
  ['Upload incomplete. Remove this entry and choose the image again.', 'Upload incomplete. Remove this entry and choose the image again.'],
  ['File removal incomplete. Retry removing the image.', 'The image was not fully removed. Try removing it again.'],
  ['Finish the upload before attaching this image', 'Finish the upload before attaching this image.'],
  ['Image removal is in progress', 'This image is being removed.'],
]
const RULES = new Map<string, { copy: string; code: string }>(RULE_LIST.map(([server, copy, code]) => [server, { copy, code: code ?? 'rule' }]))

/* ───────────────────────── Classification ───────────────────────── */

const KIND_BY_CODE: Record<string, ErrorKind> = {
  project_denied: 'permission', building_denied: 'permission', site_denied: 'permission', permission_denied: 'permission',
  unauthorized: 'auth', auth_expired: 'auth', invalid_credentials: 'auth', email_not_confirmed: 'auth', otp_expired: 'auth',
  user_already_exists: 'duplicate', email_exists: 'duplicate', already_invited: 'duplicate', duplicate: 'duplicate',
  weak_password: 'validation', email_address_invalid: 'validation', invalid_input: 'validation', rule: 'validation',
  volunteer_access_unavailable: 'permission',
  signup_disabled: 'not_configured', not_configured: 'not_configured',
  over_email_send_rate_limit: 'rate_limited', over_request_rate_limit: 'rate_limited', rate_limited: 'rate_limited',
  not_found: 'not_found', no_data: 'not_found', in_use: 'in_use',
  conflict: 'conflict', project_mismatch: 'conflict', record_changed: 'conflict', measurement_already_classified: 'conflict', revision_conflict: 'conflict', turn_in_flight: 'conflict',
  network: 'network', timeout: 'timeout',
}

function kindOfCode(code: string): ErrorKind {
  if (KIND_BY_CODE[code]) return KIND_BY_CODE[code]
  if (/_denied$/.test(code)) return 'permission'
  if (/(^|_)(changed|conflict|stale)$/.test(code)) return 'conflict'
  if (/_(not_found|unavailable|missing)$/.test(code)) return 'not_found'
  if (/(^|_)(invalid|unsupported)(_|$)|_too_large$/.test(code)) return 'validation'
  if (/not_configured$/.test(code)) return 'not_configured'
  return 'unknown'
}

const SQLSTATE_CODE: Record<string, string> = {
  '42501': 'permission_denied', '23505': 'duplicate', '23503': 'in_use', '40001': 'conflict', '55000': 'conflict',
  PT409: 'conflict', P0002: 'not_found', PGRST116: 'not_found', '57014': 'timeout', PGRST202: 'not_configured',
  '42883': 'not_configured', PGRST301: 'auth_expired', PGRST303: 'auth_expired',
  '22023': 'invalid_input', '22P02': 'invalid_input', '23514': 'invalid_input', '23502': 'invalid_input',
  '22001': 'invalid_input', '22003': 'invalid_input', '54000': 'invalid_input',
}

const STATUS_CODE: Record<number, string> = { 401: 'auth_expired', 403: 'permission_denied', 404: 'not_found', 409: 'conflict', 429: 'rate_limited' }

const SERVER_CODE = /^([a-z][a-z0-9]*(?:_[a-z0-9]+)*)(?::.*)?$/s

function textCode(text: string): string | undefined {
  if (/ is already invited$/.test(text)) return 'already_invited'
  if (/^Invalid login credentials$/i.test(text)) return 'invalid_credentials'
  if (/^Email not confirmed$/i.test(text)) return 'email_not_confirmed'
  if (/^User already registered$/i.test(text)) return 'user_already_exists'
  if (/JWT expired|session.*(missing|expired)/i.test(text)) return 'auth_expired'
  if (/failed to fetch|networkerror|network request failed|load failed/i.test(text)) return 'network'
  if (/timed? ?out|took too long/i.test(text)) return 'timeout'
  return undefined
}

function textKind(text: string): ErrorKind {
  if (/temporarily|service unavailable|try again later/i.test(text)) return 'unknown'
  if (/permission denied|row-level security|\bdenied\b|not allowed/i.test(text)) return 'permission'
  if (/\bchanged\b|\bconflict\b/i.test(text)) return 'conflict'
  if (/already exists|duplicate key|already reserved/i.test(text)) return 'duplicate'
  if (/still (used|contains)|is still referenced/i.test(text)) return 'in_use'
  if (/\bunavailable\b|not found|no longer|no such/i.test(text)) return 'not_found'
  if (/^(invalid|unsupported|unknown)\b|\bmust (be|use|stay)\b|^(use|choose|supply|enter) /i.test(text)) return 'validation'
  return 'unknown'
}

/** Classify any thrown or returned failure. Raw text stays in `detail` only. */
export function toDataError(raw: unknown): DataError {
  if (raw instanceof DataError) return raw
  const record = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
  const detail = typeof record.message === 'string' ? record.message : typeof raw === 'string' ? raw : ''
  const reported = typeof record.code === 'string' ? record.code : undefined
  const status = typeof record.status === 'number' ? record.status : undefined
  const name = typeof record.name === 'string' ? record.name : ''
  const dbCode = reported && /^([0-9A-Z]{5}|PGRST\d+|PT\d{3})$/.test(reported) ? reported : undefined
  const authCode = reported && !dbCode && /^[a-z][a-z0-9_]*$/.test(reported) ? reported : undefined
  const text = detail.trim()
  const rule = RULES.get(text)
  const serverCode = rule ? undefined : SERVER_CODE.exec(text)?.[1]
  const specific = serverCode ?? authCode ?? rule?.code ?? textCode(text) ?? runtimeCode(name)
  const generic = (dbCode && SQLSTATE_CODE[dbCode]) || (status && STATUS_CODE[status]) || undefined
  let kind: ErrorKind = specific ? kindOfCode(specific) : 'unknown'
  // Runtime faults (TypeError, RangeError…) and server outages carry no meaning for people.
  const runtime = /^(Type|Range|Syntax|Reference|Eval|URI)Error$/.test(name)
  if (kind === 'unknown' && !serverCode && !rule && !runtime && !(status && status >= 500)) kind = textKind(text)
  if (kind === 'unknown' && generic) kind = kindOfCode(generic)
  return new DataError(specific ?? generic ?? (kind === 'unknown' ? 'unknown' : kind), detail, { kind, status, dbCode })
}

function runtimeCode(name: string): string | undefined {
  if (name === 'AuthRetryableFetchError') return 'network'
  if (name === 'AbortError' || name === 'TimeoutError') return 'timeout'
  return undefined
}

/** The stable code behind a failure, for behaviour that depends on it. */
export function errorCode(error: unknown): string {
  if (error instanceof DataError || error instanceof UserError) return error.code
  return toDataError(error).code
}

/** True when the failure carries one of these codes. */
export function hasErrorCode(error: unknown, ...codes: string[]): boolean {
  return codes.includes(errorCode(error))
}

/**
 * The sentence a person sees for a failure: authored copy, a known rule or
 * code, the cause's kind, then `fallback` (what failed, in the caller's words)
 * or the generic sentence. Raw backend or runtime text is never returned.
 */
export function userErrorMessage(error: unknown, fallback?: string): string {
  if (error instanceof UserError) return error.message
  const failure = toDataError(error)
  const rule = RULES.get(failure.detail.trim())
  if (rule) return rule.copy
  if (CODE_COPY[failure.code]) return CODE_COPY[failure.code]
  if (failure.kind !== 'unknown') return KIND_COPY[failure.kind]
  return fallback ?? GENERIC_ERROR
}

/**
 * For bob's own pure input validators (storage box, room layout, stair and
 * coordinate parsers) whose sentences are authored copy and which run without
 * any backend call. Their messages may be shown; a backend or runtime failure,
 * or a message that looks like a code, falls back to userErrorMessage.
 */
export function validatorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.constructor === Error && /^[A-Z][^\n]{0,300}[.!?]$/.test(error.message)) return error.message
  return userErrorMessage(error, fallback)
}
