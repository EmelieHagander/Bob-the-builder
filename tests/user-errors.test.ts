import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DataError, GENERIC_ERROR, UserError, errorCode, hasErrorCode, toDataError, userErrorMessage, validatorMessage } from '../src/lib/userErrors.ts'
import { cadParameterLabel, cadPathLabel, categoryLabel, materialMethodLabel, readableMaterialBasis, recordTypeLabel, truthLabel } from '../src/lib/labels.ts'

const uuid = '90000000-0000-4000-8000-000000000002'

test('backend codes become people-facing sentences while the raw detail stays for logs', () => {
  const denied = toDataError({ code: '42501', message: 'project_denied', details: null, hint: null })
  assert.equal(denied.code, 'project_denied'); assert.equal(denied.kind, 'permission'); assert.equal(denied.detail, 'project_denied')
  assert.equal(userErrorMessage(denied), 'You no longer have access to this project.')
  assert.equal(errorCode({ code: '40001', message: 'cad_shell_changed' }), 'cad_shell_changed')
  assert(hasErrorCode(new Error('cad_shell_changed'), 'cad_shell_changed'), 'Rethrown plain errors keep their code')
  assert.equal(userErrorMessage({ code: '23505', message: 'duplicate key value violates unique constraint "areas_project_id_slug_key"' }), 'That already exists. Reload to see it.')
  assert.equal(userErrorMessage({ code: '23503', message: 'update or delete on table "areas" violates foreign key constraint' }), 'This is still used elsewhere in the project, so it cannot be removed.')
  assert.equal(userErrorMessage({ code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' }), 'This is no longer available. It may have been removed, or your access changed.')
  assert.equal(userErrorMessage({ code: 'PGRST202', message: 'Could not find the function bob.sharing_directory' }), 'This is not available on this server yet.')
})

test('server sentences are matched as codes; the shown copy is owned by the frontend', () => {
  const rule = { code: '22023', message: 'Move or finish this Area\'s unfinished Steps and Tasks before archiving.' }
  assert.equal(userErrorMessage(rule), 'Move or finish this Area\'s unfinished Steps and Tasks before archiving.')
  assert.equal(userErrorMessage({ code: '22023', message: 'Choose a project target before saving a drawing.' }), 'Select a target for this scope before saving a drawing.')
  const revoked = { code: '42501', message: 'Volunteer access is unavailable. Ask the organiser for a new link.' }
  assert.equal(errorCode(revoked), 'volunteer_access_unavailable')
  assert.equal(userErrorMessage(revoked), 'Volunteer access is unavailable. Ask the organiser for a new link.')
  assert.equal(userErrorMessage({ code: '40001', message: 'Task changed. Reload before saving your edits.' }),
    'This changed somewhere else. Reload to see the latest version, then try again.')
  assert.equal(userErrorMessage({ code: 'P0001', message: 'anna@example.test is already invited' }), 'That person is already invited.')
})

test('auth, network and timeout failures read as practical next steps', () => {
  assert.equal(userErrorMessage({ name: 'AuthApiError', status: 400, code: 'invalid_credentials', message: 'Invalid login credentials' }),
    'That email and password do not match. Check them and try again.')
  assert.equal(userErrorMessage(Object.assign(new Error('Email not confirmed'), { name: 'AuthApiError', status: 400 })),
    'Confirm your email address first, using the link we sent you.')
  assert.equal(userErrorMessage(new TypeError('Failed to fetch')), 'Could not reach the server. Check your connection and try again.')
  assert.equal(userErrorMessage({ name: 'AuthRetryableFetchError', status: 0, message: '{}' }), 'Could not reach the server. Check your connection and try again.')
  assert.equal(userErrorMessage({ code: '57014', message: 'canceling statement due to statement timeout' }), 'That took too long. Check your connection and try again.')
  assert.equal(userErrorMessage({ status: 503, message: 'Service temporarily unavailable' }, 'Could not load drawings.'), 'Could not load drawings.',
    'A server outage is not presented as missing or deleted data')
})

test('unknown failures never show raw text, codes or IDs', () => {
  const leaks = [
    new Error(`relation "bob.secret_table" does not exist (${uuid})`),
    { message: `database: column "x" of relation "tasks" does not exist` },
    new RangeError('Invalid array length'),
    'internal stack text',
    null, undefined, 42,
  ]
  for (const leak of leaks) {
    const shown = userErrorMessage(leak, 'Could not save the event.')
    assert(['Could not save the event.'].includes(shown), `Unexpected copy: ${shown}`)
    assert.equal(userErrorMessage(leak), GENERIC_ERROR)
  }
  assert(!userErrorMessage({ code: '42501', message: `permission denied for table tasks ${uuid}` }).includes(uuid))
  assert.equal(userErrorMessage(new DataError('project_mismatch', 'Solution project mismatch.')), 'These records do not belong to the open project. Reload to continue.')
  const typed = new DataError('no_data', 'query returned no data')
  assert.equal(typed.kind, 'not_found'); assert.equal(typed.message, 'query returned no data', 'Raw detail stays available to logs and tests')
})

test('authored copy passes through; pure validator sentences may be shown, codes may not', () => {
  assert.equal(userErrorMessage(new UserError('Sign in to manage sharing.')), 'Sign in to manage sharing.')
  assert.equal(userErrorMessage(new UserError('The connection took too long. Check your connection and try again.', 'timeout')),
    'The connection took too long. Check your connection and try again.')
  assert.equal(validatorMessage(new Error('Material thickness leaves no usable interior. Increase the outer dimensions or reduce the thickness.'), 'Check the dimensions.'),
    'Material thickness leaves no usable interior. Increase the outer dimensions or reduce the thickness.')
  assert.equal(validatorMessage(new Error('invalid_images'), 'Check the dimensions.'), 'Some details were not accepted. Check them and try again.')
  assert.equal(validatorMessage(new TypeError('x is not a function'), 'Check the dimensions.'), 'Check the dimensions.')
  assert.equal(validatorMessage(toDataError({ message: 'Opening width and height must be greater than zero' }), 'Check the dimensions.'),
    'Opening width and height must be greater than zero.', 'Backend failures still go through the shared mapping')
})

test('labels name codes for people and never echo a code or UUID', () => {
  assert.equal(truthLabel('provided_spec'), 'Specification'); assert.equal(truthLabel('ai_assessment'), 'Bob’s assessment'); assert.equal(truthLabel('verified'), 'Unknown')
  assert.equal(recordTypeLabel('materials'), 'Shopping item'); assert.equal(recordTypeLabel('physical_space_measurements'), 'Space measurement')
  assert.equal(recordTypeLabel('tasks'), 'Task'); assert.equal(recordTypeLabel('bob_private_thing'), 'Project record')
  assert.equal(categoryLabel('sheet_goods'), 'Sheet material'); assert.equal(categoryLabel('fastener'), 'Fasteners')
  assert.equal(categoryLabel('wood.plywood'), 'Plywood'); assert.equal(categoryLabel('roof_flashing'), 'Roof flashing')
  assert.equal(categoryLabel('Fasteners & glue'), 'Fasteners & glue', 'People’s own words stay as written'); assert.equal(categoryLabel(''), 'Other')
  assert.equal(materialMethodLabel('stud_wall_net_area'), 'Net wall area from the drawing')
  assert.equal(materialMethodLabel('construction_blank_area'), 'Blank sizes from the construction')
  assert.equal(materialMethodLabel('construction_fasteners'), 'Fasteners counted from the construction joints')
  assert.equal(materialMethodLabel('construction_glue'), 'One glue package per construction')
  assert.equal(materialMethodLabel('future_method_v9'), 'Calculated by bob')
  assert.equal(cadParameterLabel('wall_height'), 'Wall height'); assert.equal(cadParameterLabel('wallHeight'), 'Wall height')
  assert.equal(cadPathLabel('definitions/side_panel/x_mm'), 'Side panel · width (x)')
  assert.equal(cadPathLabel('instances/panel/placement/rz'), 'Panel · rotation about z')
  assert.equal(cadParameterLabel(uuid), 'Parameter')
})

test('a calculated material basis keeps its arithmetic and certainty but names codes for people', () => {
  const basis = 'Calculated from Wall A v3 using stud_wall_net_area 4B2b-v1: (2400 mm × 2500 mm − 900 mm × 2100 mm) ÷ 1,000,000 = 4.11 m²; persisted base quantity 4.11 m² after upward normalization to 0.0001 m². Drawing status: build_ready. Input certainty: contains explicit estimate.'
  const shown = readableMaterialBasis(basis, 'stud_wall_net_area')
  assert.equal(shown, 'Calculated from Wall A v3 using the net wall area method: (2400 mm × 2500 mm − 900 mm × 2100 mm) ÷ 1,000,000 = 4.11 m²; persisted base quantity 4.11 m² after upward normalization to 0.0001 m². Drawing status: Build ready. Input certainty: contains explicit estimate.')
  const blank = `Construction blank role v2: artifact ${uuid} revision 4; definition side_panel; instances 2; local blank 600 x 18 x 400 mm.`
  assert.equal(readableMaterialBasis(blank, 'construction_blank_pieces'), null, 'IDs never reach the screen; a summary is shown instead')
  assert.equal(readableMaterialBasis('Calculated using future_method v2', 'future_method'), null)
  // Fastener and glue bases are human prose from the server and are shown as written.
  const screws = 'Counted from the saved construction "Shelf unit": 6 screws of 4 x 45 mm over 2 joints, from the joint fastener schedule. A rule-of-thumb proposal, not a strength calculation; the product, pilot holes and edge distances are still open. 1 other joint has no fastener size or rule yet and is not counted.'
  assert.equal(readableMaterialBasis(screws, 'construction_fasteners'), screws)
  assert.equal(readableMaterialBasis('One glue package for the saved construction "bunk_bed", which has 2 glued joints.', 'construction_glue'), null, 'a code-like title falls back to the summary')
  assert.match(readableMaterialBasis('Calculated from Wall A v3 using stud_wall_sheet_layer v1: 4 m². Drawing status: concept. Input certainty: contains explicit estimate. Product input: provided_spec; source: Supplier sheet.', 'stud_wall_sheet_layer') ?? '',
    /using the sheet layer method: 4 m²\. Drawing status: Concept\. Input certainty: contains explicit estimate\. Product input: specification; source: Supplier sheet\./)
})
