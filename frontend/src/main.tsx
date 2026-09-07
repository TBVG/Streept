import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

class AppErrorBoundary extends React.Component<React.PropsWithChildren, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24, fontFamily: 'system-ui, sans-serif', background: '#18181b', color: '#edeae3' }}>
          <div style={{ maxWidth: 680 }}>
            <h1 style={{ marginBottom: 12 }}>Streept couldn't start</h1>
            <p style={{ marginBottom: 12, opacity: 0.8 }}>The frontend hit a browser error instead of rendering a blank page.</p>
            <pre style={{ whiteSpace: 'pre-wrap', padding: 16, borderRadius: 8, background: '#232428', overflow: 'auto' }}>{this.state.error.message}</pre>
            <button onClick={() => window.location.reload()} style={{ marginTop: 12, padding: '10px 14px', cursor: 'pointer' }}>Reload</button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </React.StrictMode>
);

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Offline shell is an enhancement; navigation itself keeps working
      // without the service worker.
    });
  });
}
