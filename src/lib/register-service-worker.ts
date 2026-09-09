/** Public connection fallback only. The app itself still requires internet. */
export function registerServiceWorker() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator) || !window.isSecureContext) return
  const register = () => {
    const base = import.meta.env.BASE_URL
    void navigator.serviceWorker.register(`${base}sw.js`, { scope: base, updateViaCache: 'none' }).catch(() => {
      // Installation help and the online app remain usable if registration is
      // unavailable (for example in a restricted browser). Never force reload.
    })
  }
  if (document.readyState === 'complete') register()
  else window.addEventListener('load', register, { once: true })
}
