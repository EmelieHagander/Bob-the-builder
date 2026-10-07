import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Icon } from '../components/ui'
import { requestAppInstallation, useAppInstallation } from '../lib/pwa-install'

type Device = 'iphone' | 'android' | 'computer'

function initialDevice(): Device {
  if (/iPhone|iPad|iPod/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) return 'iphone'
  return /Android/i.test(navigator.userAgent) ? 'android' : 'computer'
}

export function Install() {
  const [device, setDevice] = useState<Device>(initialDevice)
  const { canInstall, standalone, installed, status } = useAppInstallation()
  const ready = standalone || installed
  const message = ready ? 'Done! Bob is installed on this device.'
    : status === 'accepted' ? 'You accepted the installation. Follow your phone\'s last steps, then look for Bob on your home screen.'
    : status === 'dismissed' ? 'You cancelled the installation. You can try again with the steps below.'
    : status === 'error' ? 'The install prompt could not open. Use the steps below instead.'
    : status === 'prompting' ? 'Follow the instructions in your browser\'s install prompt.' : ''

  return (
    <main className="page install-page">
      <Link to="/" className="btn"><Icon name="arrow-left" size={18} /> Open Bob</Link>

      <header className="install-header">
        <img src={`${import.meta.env.BASE_URL}icons/icon-192.png`} width="80" height="80" alt="Bob's green tree icon" />
        <h1 className="page-title">Install the app</h1>
        <p>Keep Bob close at hand on site. Add the icon to your home screen and open the app with one tap.</p>
        <p className="install-hint">It's free. You don't need an app store.</p>
      </header>

      {ready ? (
        <Link to="/" className="btn btn-primary install-primary">Continue to Bob <Icon name="arrow-right" size={18} /></Link>
      ) : canInstall || status === 'prompting' ? (
        <button className="btn btn-primary install-primary" disabled={status === 'prompting'} onClick={() => void requestAppInstallation()}>
          <Icon name="download-simple" size={20} /> {status === 'prompting' ? 'Installing…' : 'Install the app'}
        </button>
      ) : (
        <button className="btn btn-primary install-primary" onClick={() => {
          document.getElementById('install-steps')?.scrollIntoView({ block: 'start' })
          document.getElementById('install-steps-title')?.focus({ preventScroll: true })
        }}>Show me how <Icon name="arrow-down" size={18} /></button>
      )}
      <p className="install-status" role="status">{message}</p>

      <section className="card install-card" id="install-steps" aria-labelledby="install-steps-title">
        <h2 id="install-steps-title" tabIndex={-1}>How to do it</h2>
        <p>Choose the phone or computer you want to install Bob on.</p>
        <div className="cluster install-devices" role="group" aria-label="Your phone or computer">
          {([['iphone', 'iPhone / iPad'], ['android', 'Android'], ['computer', 'Computer']] as const).map(([value, label]) => (
            <button key={value} className={`btn ${device === value ? 'btn-primary' : ''}`} aria-pressed={device === value} onClick={() => setDevice(value)}>{label}</button>
          ))}
        </div>

        {device === 'iphone' && (
          <ol className="install-steps">
            <li><strong>Open this page in Safari.</strong> Safari is the browser with a blue compass. Did you get the link in an app like Messenger? Copy the link and paste it into Safari.</li>
            <li><strong>Tap Share.</strong> Look for a square with an arrow pointing up. In some versions you first need to tap the button with three dots.</li>
            <li><strong>Choose Add to Home Screen.</strong> You may need to scroll up in the list. Is it missing? Tap Edit Actions and add it.</li>
            <li><strong>Tap Add.</strong> Keep the name bob. If you see Open as Web App, leave it switched on.</li>
            <li><strong>Go to your home screen and tap Bob.</strong> Look for the green tree icon. You may need to swipe to the next home screen page.</li>
          </ol>
        )}
        {device === 'android' && (
          <ol className="install-steps">
            <li><strong>Open this page in Chrome.</strong> Chrome is the browser with a red, yellow, green and blue icon. Open the link there if you came here from another app.</li>
            <li><strong>Tap Install the app above if the button shows.</strong> Otherwise, tap Chrome's three-dot menu, usually at the top right.</li>
            <li><strong>Choose Install app or Add to Home screen.</strong> The name can differ between phones. If you can choose between installing and a shortcut, choose Install.</li>
            <li><strong>Confirm with Install or Add.</strong> Follow the last steps your phone shows.</li>
            <li><strong>Open Bob from your home screen or app list.</strong> Look for the green tree icon.</li>
          </ol>
        )}
        {device === 'computer' && (
          <ol className="install-steps">
            <li><strong>Want Bob on your phone?</strong> Open the same web address on your phone. Then choose iPhone / iPad or Android above.</li>
            <li><strong>Want to install on your computer?</strong> Open the page in Chrome or Edge and click Install the app if the button shows.</li>
            <li><strong>No button?</strong> Look for install in the browser menu or next to the address bar. You can also keep using Bob straight in the browser.</li>
          </ol>
        )}
      </section>

      <section className="card install-card" aria-labelledby="install-after-title">
        <h2 id="install-after-title">Once the icon is in place</h2>
        <p>Open Bob from the icon. If you need to sign in again, use the same account as on the web. Your projects are still there.</p>
        <p><strong>You need internet</strong> to read and change projects, see images and ask Bob.</p>
      </section>
      <div className="install-questions">
        <details className="card">
          <summary>Does the app update too?</summary>
          <p>Yes. When a new version of the web app is published, Bob on your phone gets it too. Save what you are working on, close Bob and open it again. You don't need to reinstall. If an older version stays, also close other open Bob windows and tabs.</p>
        </details>
        <details className="card">
          <summary>I can't find the install option</summary>
          <p>Open the page in Safari on iPhone or Chrome on Android. Use the menu described in the steps above. If Bob is already installed, the option may be missing: look for the tree icon on your home screen or in your app list. You can always use Bob in the browser too.</p>
        </details>
      </div>
    </main>
  )
}
