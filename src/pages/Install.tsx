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
  const message = ready ? 'Klart! Bob är installerad på den här enheten.'
    : status === 'accepted' ? 'Du har godkänt installationen. Följ telefonens sista steg och leta sedan efter Bob på hemskärmen.'
    : status === 'dismissed' ? 'Du avbröt installationen. Det går bra att försöka igen med stegen nedan.'
    : status === 'error' ? 'Installationsrutan kunde inte öppnas. Använd stegen nedan i stället.'
    : status === 'prompting' ? 'Följ instruktionerna i webbläsarens installationsruta.' : ''

  return (
    <main className="page install-page" lang="sv">
      <Link to="/" className="btn"><Icon name="arrow-left" size={18} /> Öppna Bob</Link>

      <header className="install-header">
        <img src={`${import.meta.env.BASE_URL}icons/icon-192.png`} width="80" height="80" alt="Bobs gröna granikon" />
        <h1 className="page-title">Installera appen</h1>
        <p>Ha Bob nära till hands på bygget. Lägg till ikonen på hemskärmen och öppna appen med ett tryck.</p>
        <p className="install-hint">Det är gratis. Du behöver inte leta i någon appbutik.</p>
      </header>

      {ready ? (
        <Link to="/" className="btn btn-primary install-primary">Fortsätt till Bob <Icon name="arrow-right" size={18} /></Link>
      ) : canInstall || status === 'prompting' ? (
        <button className="btn btn-primary install-primary" disabled={status === 'prompting'} onClick={() => void requestAppInstallation()}>
          <Icon name="download-simple" size={20} /> {status === 'prompting' ? 'Installation pågår…' : 'Installera appen'}
        </button>
      ) : (
        <button className="btn btn-primary install-primary" onClick={() => {
          document.getElementById('install-steps')?.scrollIntoView({ block: 'start' })
          document.getElementById('install-steps-title')?.focus({ preventScroll: true })
        }}>Visa hur jag gör <Icon name="arrow-down" size={18} /></button>
      )}
      <p className="install-status" role="status">{message}</p>

      <section className="card install-card" id="install-steps" aria-labelledby="install-steps-title">
        <h2 id="install-steps-title" tabIndex={-1}>Gör så här</h2>
        <p>Välj den telefon eller dator som du vill installera Bob på.</p>
        <div className="cluster install-devices" role="group" aria-label="Din telefon eller dator">
          {([['iphone', 'iPhone / iPad'], ['android', 'Android'], ['computer', 'Dator']] as const).map(([value, label]) => (
            <button key={value} className={`btn ${device === value ? 'btn-primary' : ''}`} aria-pressed={device === value} onClick={() => setDevice(value)}>{label}</button>
          ))}
        </div>

        {device === 'iphone' && (
          <ol className="install-steps">
            <li><strong>Öppna den här sidan i Safari.</strong> Safari är webbläsaren med en blå kompass. Har du fått länken i exempelvis Messenger? Kopiera länken och klistra in den i Safari.</li>
            <li><strong>Tryck på Dela.</strong> Leta efter en fyrkant med en pil uppåt. I vissa versioner behöver du först trycka på knappen med tre punkter.</li>
            <li><strong>Välj Lägg till på hemskärmen.</strong> Du kan behöva dra uppåt i listan. Saknas valet? Tryck på Redigera åtgärder och lägg till det.</li>
            <li><strong>Tryck på Lägg till.</strong> Låt namnet vara bob. Om du ser Öppna som webbapp, låt det vara påslaget.</li>
            <li><strong>Gå till hemskärmen och tryck på Bob.</strong> Leta efter den gröna granikonen. Du kan behöva bläddra till nästa sida på hemskärmen.</li>
          </ol>
        )}
        {device === 'android' && (
          <ol className="install-steps">
            <li><strong>Öppna den här sidan i Chrome.</strong> Chrome är webbläsaren med en röd, gul, grön och blå ikon. Öppna länken där om du kom hit från en annan app.</li>
            <li><strong>Tryck på Installera appen ovan om knappen visas.</strong> Annars trycker du på Chromes meny med tre punkter, oftast uppe till höger.</li>
            <li><strong>Välj Installera app eller Lägg till på startskärmen.</strong> Namnet kan skilja sig mellan telefoner. Om du får välja mellan installation och genväg, välj Installera.</li>
            <li><strong>Bekräfta med Installera eller Lägg till.</strong> Följ de sista stegen som telefonen visar.</li>
            <li><strong>Öppna Bob från hemskärmen eller applistan.</strong> Leta efter den gröna granikonen.</li>
          </ol>
        )}
        {device === 'computer' && (
          <ol className="install-steps">
            <li><strong>Vill du ha Bob på telefonen?</strong> Öppna samma webbadress på telefonen. Välj sedan iPhone / iPad eller Android ovan.</li>
            <li><strong>Vill du installera på datorn?</strong> Öppna sidan i Chrome eller Edge och tryck på Installera appen om knappen visas.</li>
            <li><strong>Saknas knappen?</strong> Leta efter installation i webbläsarens meny eller vid adressfältet. Du kan också fortsätta använda Bob direkt i webbläsaren.</li>
          </ol>
        )}
      </section>

      <section className="card install-card" aria-labelledby="install-after-title">
        <h2 id="install-after-title">När ikonen är på plats</h2>
        <p>Öppna Bob från ikonen. Om du behöver logga in igen använder du samma konto som på webben. Dina projekt finns kvar.</p>
        <p><strong>Du behöver internet</strong> för att läsa och ändra projekt, se bilder och fråga Bob.</p>
      </section>
      <div className="install-questions">
        <details className="card">
          <summary>Uppdateras appen också?</summary>
          <p>Ja. När en ny version av webbappen har publicerats får Bob på telefonen också den. Spara det du arbetar med, stäng Bob och öppna igen. Du behöver inte installera om. Om en äldre version ligger kvar, stäng även andra öppna Bob-fönster och flikar.</p>
        </details>
        <details className="card">
          <summary>Jag hittar inte installationsvalet</summary>
          <p>Öppna sidan i Safari på iPhone eller Chrome på Android. Använd menyn som beskrivs i stegen ovan. Om Bob redan är installerad kan valet saknas: leta efter granikonen på hemskärmen eller i applistan. Du kan alltid använda Bob i webbläsaren också.</p>
        </details>
      </div>
    </main>
  )
}
