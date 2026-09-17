import React from 'react';
import NavigationView from './components/NavigationView';
import { getGuestId } from './services/api';
import { useTheme } from './hooks/useTheme';
import './App.css';

function LegalNotice() {
  return (
    <div className="legal-notice" aria-label="Streept open-source license notice">
      <span>Streept · AGPL-3.0-or-later · No warranty</span>
      <a href="/LICENSE.txt" target="_blank" rel="noreferrer">License</a>
    </div>
  );
}

function OnlineStatus() {
  const [online, setOnline] = React.useState(() => navigator.onLine);
  React.useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on); window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);
  if (online) return null;
  return <div className="network-banner" role="status">Offline — cached navigation data will be used when available.</div>;
}

function App() {
  const [theme, toggleTheme] = useTheme();
  const guestId = getGuestId();

  return (
    <div className="App">
      <OnlineStatus />
      <LegalNotice />
      <NavigationView
        currentUserId={guestId}
        theme={theme}
        onToggleTheme={toggleTheme}
      />
    </div>
  );
}

export default App;
