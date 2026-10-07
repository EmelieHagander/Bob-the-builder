import { Link } from 'react-router-dom'
import { Icon } from './ui'
import { useAppInstallation } from '../lib/pwa-install'

export function InstallSettingsCard() {
  const { standalone, installed } = useAppInstallation()
  const ready = standalone || installed
  return (
    <section className="card install-card" aria-labelledby="install-card-title">
      <div className="install-card-heading">
        <img src={`${import.meta.env.BASE_URL}icons/icon-192.png`} width="48" height="48" alt="" />
        <h2 id="install-card-title">Bob on your home screen</h2>
      </div>
      <p>{ready ? 'Bob is installed on this device.' : 'Open the build with one tap on your phone. Free, with the same projects as here.'}</p>
      <Link className="btn btn-primary" to="/install">
        <Icon name={ready ? 'check-circle' : 'device-mobile'} size={20} />
        {ready ? 'Installation help' : 'Install the app'}
      </Link>
      <p className="install-hint">A simple guide for iPhone, iPad and Android (in Swedish).</p>
    </section>
  )
}
