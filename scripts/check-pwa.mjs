import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import vm from 'node:vm'
import ts from 'typescript'

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url))
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex')
const base = 'https://example.test/Bob-the-builder/'
const manifest = JSON.parse(read('dist/manifest.webmanifest'))
assert.equal(manifest.display, 'standalone')
for (const field of ['id', 'scope', 'start_url']) {
  assert.equal(new URL(manifest[field], `${base}manifest.webmanifest`).href, base, field)
}
const html = read('dist/index.html').toString()
for (const path of ['manifest.webmanifest', 'favicon.svg', 'favicon.png', 'icons/apple-touch-icon.png']) {
  assert(html.includes(`href="/Bob-the-builder/${path}"`), `Production base for ${path}`)
}
const bundle = JSON.parse(read('public/icons/bundle.json'))
assert.equal(sha(read(bundle.source)), bundle.source_sha256)
for (const entry of bundle.exports) {
  const bytes = read(`dist/${entry.path}`)
  assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a')
  assert.equal(bytes.readUInt32BE(16), entry.size, entry.path)
  assert.equal(bytes.readUInt32BE(20), entry.size, entry.path)
  assert.equal(sha(bytes), entry.sha256, entry.path)
}
for (const icon of manifest.icons) {
  assert(icon.src.startsWith('icons/'))
  const entry = bundle.exports.find((item) => item.path === icon.src)
  assert(entry, `Missing exported icon ${icon.src}`)
  assert.equal(icon.sizes, `${entry.size}x${entry.size}`)
}
assert(manifest.icons.some((icon) => icon.purpose === 'maskable' && icon.sizes === '512x512'))
assert(manifest.icons.some((icon) => icon.purpose === 'any' && icon.sizes === '192x192'))
assert(manifest.icons.some((icon) => icon.purpose === 'any' && icon.sizes === '512x512'))
console.log('Production manifest, subpath links and all 6 icon checksums/dimensions: OK')

// Browser-event contract: an accepted prompt is not proof of installation.
const source = ts.transpileModule(read('src/lib/pwa-install.ts').toString(), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText
function installation(standalone = false) {
  const window = new EventTarget()
  window.matchMedia = () => ({ matches: false, addEventListener() {} })
  const context = vm.createContext({ window, navigator: { standalone }, exports: {}, require: () => ({}) })
  vm.runInContext(source, context)
  context.exports.startInstallSupport()
  return { window, api: context.exports }
}
const { window, api } = installation()
let prompts = 0
function offer(outcome, fail = false) {
  const event = new Event('beforeinstallprompt', { cancelable: true })
  event.prompt = async () => { prompts++; if (fail) throw Error('Unavailable') }
  event.userChoice = Promise.resolve({ outcome })
  window.dispatchEvent(event)
  assert(event.defaultPrevented)
}
offer('dismissed')
assert(api.getInstallState().canInstall, 'Capture before any guide subscriber mounts')
await Promise.all([api.requestAppInstallation(), api.requestAppInstallation()])
assert.equal(prompts, 1, 'A prompt is consumed only once')
assert.equal(api.getInstallState().status, 'dismissed')
offer('accepted')
await api.requestAppInstallation()
assert.equal(api.getInstallState().status, 'accepted')
assert.equal(api.getInstallState().installed, false)
offer('dismissed', true)
await api.requestAppInstallation()
assert.equal(api.getInstallState().status, 'error')
window.dispatchEvent(new Event('appinstalled'))
assert(api.getInstallState().installed)
assert(!api.getInstallState().canInstall)
assert(installation(true).api.getInstallState().standalone, 'iOS standalone mode')
assert(!installation().api.getInstallState().installed, 'No stale persistent installed flag')
console.log('Early prompt, single use, dismissal/error recovery and honest installed state: OK')

// Real worker source, fake network: only a public connection page is cached.
const handlers = {}
const prefix = `bob-connection-${encodeURIComponent('/Bob-the-builder/')}-`
const cacheNames = new Set([`${prefix}old`, 'maidin-cache', 'bob-connection-other-v1'])
const saved = new Map()
const offline = `${base}offline.html`
let network = async () => new Response('fresh project document')
const cache = {
  async add(url) { assert.equal(url, offline); saved.set(url, new Response('connection help')) },
  async match(url) { return saved.get(url)?.clone() },
}
vm.runInNewContext(read('public/sw.js').toString(), {
  URL, Response,
  self: {
    registration: { scope: base },
    addEventListener: (name, callback) => { handlers[name] = callback },
    clients: { claim: async () => {} },
    skipWaiting: () => { throw Error('Must not interrupt open app windows') },
  },
  caches: {
    open: async (name) => { cacheNames.add(name); return cache },
    keys: async () => [...cacheNames],
    delete: async (name) => cacheNames.delete(name),
  },
  fetch: (request) => network(request),
})
for (const name of ['install', 'activate']) {
  let done
  handlers[name]({ waitUntil: (promise) => { done = promise } })
  await done
}
assert(!cacheNames.has(`${prefix}old`))
assert(cacheNames.has('maidin-cache') && cacheNames.has('bob-connection-other-v1'))
function request(path, overrides = {}) {
  let response
  handlers.fetch({ request: { url: new URL(path, base).href, mode: 'navigate', method: 'GET', headers: new Headers(), ...overrides }, respondWith: (result) => { response = result } })
  return response
}
for (const [path, overrides] of [
  ['./', { method: 'POST' }], ['./', { headers: new Headers({ Authorization: 'fixture' }) }],
  ['?code=fixture', {}], ['?access_token=fixture', {}], ['auth/callback', {}],
  ['rest/v1/projects', {}], ['storage/v1/object/test.jpg', {}],
  ['functions/v1/ask-bob', {}], ['api/projects', {}],
  ['images/customer.jpg', { mode: 'no-cors' }], ['https://other.test/', {}],
  ['/Maidin/', {}],
]) assert.equal(request(path, overrides), undefined, `Network untouched: ${path}`)
assert.equal(await (await request('./')).text(), 'fresh project document')
network = async () => new Response('denied', { status: 403 })
assert.equal((await request('./')).status, 403, 'Do not disguise real server failures')
network = async () => { throw Error('offline') }
assert.equal(await (await request('./')).text(), 'connection help')
assert.deepEqual([...saved.keys()], [offline], 'No project documents enter Cache Storage')
console.log('Worker cache isolation, network-only auth/data, online freshness and offline fallback: OK')
