import { useSyncExternalStore } from 'react'

interface InstallPromptEvent extends Event {
  prompt(): Promise<unknown>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

type InstallStatus = 'idle' | 'prompting' | 'accepted' | 'dismissed' | 'error'

interface InstallState {
  canInstall: boolean
  standalone: boolean
  installed: boolean
  status: InstallStatus
}

const initialState: InstallState = {
  canInstall: false,
  standalone: false,
  installed: false,
  status: 'idle',
}
let state = initialState
let deferredPrompt: InstallPromptEvent | null = null
let listening = false
const listeners = new Set<() => void>()

function update(patch: Partial<InstallState>) {
  state = { ...state, ...patch }
  listeners.forEach((listener) => listener())
}

export const getInstallState = () => state
export const getServerInstallState = () => initialState
export function subscribeToInstallState(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener); }
}

/** Capture once at startup, before React mounts or a lazy help route is opened. */
export function startInstallSupport() {
  if (listening || typeof window === 'undefined') return
  listening = true

  const displayMode = window.matchMedia('(display-mode: standalone)')
  const syncDisplayMode = () => {
    const standalone = displayMode.matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true
    if (standalone) deferredPrompt = null
    update({ standalone, canInstall: !standalone && !state.installed && !!deferredPrompt })
  }
  syncDisplayMode()
  if (displayMode.addEventListener) displayMode.addEventListener('change', syncDisplayMode)
  else displayMode.addListener(syncDisplayMode)

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault()
    if (state.standalone || state.installed) return
    deferredPrompt = event as InstallPromptEvent
    update({ canInstall: true, status: 'idle' })
  })
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null
    // Only the browser's installation event confirms installation. Nothing is
    // persisted: a later uninstall must not leave a stale "installed" flag.
    update({ canInstall: false, installed: true, status: 'idle' })
  })
}

export async function requestAppInstallation() {
  const prompt = deferredPrompt
  if (!prompt || state.standalone || state.installed || state.status === 'prompting') return
  deferredPrompt = null; // A browser prompt can be consumed only once.
  update({ canInstall: false, status: 'prompting' })

  try {
    // Call synchronously from the click; do not lose the browser's user gesture.
    await prompt.prompt()
    const choice = await prompt.userChoice
    if (!state.installed) update({ status: choice.outcome })
  } catch {
    if (!state.installed) update({ status: 'error' })
  }
}

export function useAppInstallation() {
  return useSyncExternalStore(subscribeToInstallState, getInstallState, getServerInstallState)
}
