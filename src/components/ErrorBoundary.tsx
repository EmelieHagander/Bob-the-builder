/*
 * Last-resort error boundary: one broken render should show a friendly
 * "something snapped" card instead of blanking the whole app.
 */

import { Component, type ErrorInfo, type ReactNode } from 'react'

interface State {
  error: Error | null
}

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('bob: render error', error, info.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <div style={{ maxWidth: 460, textAlign: 'center' }}>
          <div style={{ fontSize: 44 }}>🪵</div>
          <h1 style={{ fontSize: 22, margin: '10px 0 6px' }}>Something snapped</h1>
          <p style={{ fontSize: 14, color: '#6b6353', lineHeight: 1.5 }}>
            A part of bob hit an unexpected error. Your data is fine — reloading usually fixes it.
          </p>
          <pre style={{ textAlign: 'left', fontSize: 11.5, background: '#f4f0e6', borderRadius: 10, padding: '10px 12px', overflowX: 'auto', marginTop: 12 }}>
            {this.state.error.message}
          </pre>
          <button
            onClick={() => window.location.reload()}
            style={{ marginTop: 14, padding: '10px 22px', borderRadius: 11, border: 'none', background: '#41513F', color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}
          >
            Reload bob
          </button>
        </div>
      </div>
    )
  }
}
