/** The original short-lived caller JWT, encrypted at rest. No refresh token,
 * synthetic user JWT or privileged domain client is used by a background job. */
const bytes = (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0))
const encoded = (b: Uint8Array) => btoa(String.fromCharCode(...b))
async function key(secret: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('bob-background-credentials:v1:' + secret))
  return crypto.subtle.importKey('raw', digest, 'AES-GCM', false, ['encrypt', 'decrypt'])
}
export async function sealCredential(token: string, binding: string, secret: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(binding) }, await key(secret), new TextEncoder().encode(token))
  return { version: 1, iv: encoded(iv), ciphertext: encoded(new Uint8Array(ciphertext)) }
}
export async function openCredential(value: { version: number; iv: string; ciphertext: string }, binding: string, secret: string) {
  if (value.version !== 1) throw new Error('credential_unavailable')
  return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes(value.iv), additionalData: new TextEncoder().encode(binding) }, await key(secret), bytes(value.ciphertext)))
}
