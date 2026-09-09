import { Link } from 'react-router-dom'
import { Icon } from './ui'
import { useAppInstallation } from '../lib/pwa-install'

export function InstallSettingsCard() {
  const { standalone, installed } = useAppInstallation()
  const ready = standalone || installed
  return (
    <section className="card install-card" aria-labelledby="install-card-title" lang="sv">
      <div className="install-card-heading">
        <img src={`${import.meta.env.BASE_URL}icons/icon-192.png`} width="48" height="48" alt="" />
        <h2 id="install-card-title">Bob på hemskärmen</h2>
      </div>
      <p>{ready ? 'Bob är installerad på den här enheten.' : 'Öppna bygget med ett tryck på telefonen. Gratis och med samma projekt som här.'}</p>
      <Link className="btn btn-primary" to="/install">
        <Icon name={ready ? 'check-circle' : 'device-mobile'} size={20} />
        {ready ? 'Installationshjälp' : 'Installera appen'}
      </Link>
      <p className="install-hint">En enkel guide för iPhone, iPad och Android.</p>
    </section>
  )
}
