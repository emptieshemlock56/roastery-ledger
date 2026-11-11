import { useEffect, useState } from 'react';
import { api } from './api.js';
import { Brand, LiveContext, UserContext } from './lib.jsx';
import Account from './pages/Account.jsx';
import Activity from './pages/Activity.jsx';
import Catalog from './pages/Catalog.jsx';
import Import from './pages/Import.jsx';
import Login from './pages/Login.jsx';
import Record from './pages/Record.jsx';
import Reports from './pages/Reports.jsx';
import Settings from './pages/Settings.jsx';
import Stock from './pages/Stock.jsx';
import TwoFactorSetup from './pages/TwoFactorSetup.jsx';
import Users from './pages/Users.jsx';

const PAGES = {
  stock: ['Stock', Stock],
  record: ['Record', Record],
  activity: ['Activity', Activity],
  reports: ['Reports', Reports],
  catalog: ['Catalog', Catalog],
  import: ['Import', Import, undefined, 'import'], // 4th item: the permission needed to open it
  users: ['Users', Users, 'admin'],
  settings: ['Settings', Settings, 'admin'],
  account: ['Account', Account, 'hidden'],
};

const ENV_STYLES = {
  dev: { label: 'DEV — local sandbox, data is fake', color: '#2f7d32' },
  test: { label: 'TEST', color: '#2f7d32' },
  staging: { label: 'STAGING — practice copy, changes here do not affect real inventory', color: '#c25e00' },
};

function usePage() {
  const read = () => window.location.hash.replace(/^#\/?/, '').split('?')[0] || 'stock';
  const [page, setPage] = useState(read);
  useEffect(() => {
    const on = () => setPage(read());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return page;
}

export default function App() {
  const [config, setConfig] = useState(null);
  const [user, setUser] = useState(undefined); // undefined = loading, null = signed out
  const [tick, setTick] = useState(0);
  const [lastChange, setLastChange] = useState(null);
  const page = usePage();

  const loadConfig = () => api('/config').then(setConfig, () => setConfig((c) => c ?? { env: 'unknown' }));
  // Keep the same object when nothing changed, so a refresh doesn't restart the live connection.
  const refreshMe = () => api('/auth/me').then((d) => setUser((prev) => (prev && JSON.stringify(prev) === JSON.stringify(d.user) ? prev : d.user)), () => {});

  useEffect(() => {
    loadConfig();
    api('/auth/me').then((d) => setUser(d.user), () => setUser(null));
    const out = () => setUser(null);
    window.addEventListener('ledger:signed-out', out);
    window.addEventListener('ledger:branding', loadConfig);
    return () => {
      window.removeEventListener('ledger:signed-out', out);
      window.removeEventListener('ledger:branding', loadConfig);
    };
  }, []);

  // Live updates from other users.
  useEffect(() => {
    if (!user || user.must_setup_2fa) return;
    const es = new EventSource('/api/events');
    es.onmessage = (e) => {
      setTick((t) => t + 1);
      try {
        const msg = JSON.parse(e.data);
        if (msg.entity === 'branding') loadConfig();
        if (msg.entity === 'roles' || msg.entity === 'users') refreshMe(); // someone's access may have changed
        if (msg.by && msg.by !== user.name) setLastChange(`${msg.by} updated ${msg.entity}`);
      } catch {
        /* ignore */
      }
    };
    return () => es.close();
  }, [user]);

  useEffect(() => {
    if (!lastChange) return;
    const t = setTimeout(() => setLastChange(null), lastChange.includes('backup code') ? 12000 : 4000);
    return () => clearTimeout(t);
  }, [lastChange]);

  const env = ENV_STYLES[config?.env];
  const banner = env && (
    <div className="env-banner" style={{ background: env.color }}>
      {env.label}
    </div>
  );

  function signedIn(u, { backupCodesLeft } = {}) {
    setUser(u);
    if (backupCodesLeft !== undefined && backupCodesLeft <= 3) {
      setLastChange(`You have ${backupCodesLeft} backup code${backupCodesLeft === 1 ? '' : 's'} left. Get new ones under Account.`);
    }
  }

  async function signOut() {
    await api('/auth/logout', { method: 'POST', body: {} }).catch(() => {});
    setUser(null);
  }

  if (user === undefined) return <div className="loading">Loading…</div>;
  if (!user) return (
    <>
      {banner}
      <Login onSignedIn={signedIn} logo={config?.logo} />
    </>
  );

  // Where two-factor sign-in is required, nothing else is available until it's set up.
  if (user.must_setup_2fa) return (
    <>
      {banner}
      <div className="login">
        <div className="card setup-card">
          <h1>☕ Set up two-factor sign-in</h1>
          <p>
            To keep the inventory safe, signing in needs your password <b>and</b> a code from your phone. This takes about two minutes and
            you only do it once.
          </p>
          <TwoFactorSetup onEnabled={setUser} />
          <button className="link small" onClick={signOut}>
            Sign out
          </button>
        </div>
      </div>
    </>
  );

  const canOpen = ([, , access, permission]) => (access !== 'admin' || user.role === 'admin') && (!permission || user.permissions.includes(permission));
  const allowed = PAGES[page] && canOpen(PAGES[page]);
  const Page = (allowed ? PAGES[page] : PAGES.stock)[1];

  return (
    <UserContext.Provider value={user}>
      <LiveContext.Provider value={{ tick }}>
        {banner}
        <header className="topbar">
          <div className="brand">
            <Brand logo={config?.logo} />
          </div>
          <nav>
            {Object.entries(PAGES)
              .filter(([, entry]) => entry[2] !== 'hidden' && canOpen(entry))
              .map(([key, [label]]) => (
                <a key={key} href={`#/${key}`} className={page === key ? 'active' : ''}>
                  {label}
                </a>
              ))}
          </nav>
          <div className="who">
            <a href="#/account" title="Account settings">
              {user.name}
            </a>
            <button className="link" onClick={signOut}>
              Sign out
            </button>
          </div>
        </header>
        <main>
          <Page />
        </main>
        {lastChange && <div className="toast">{lastChange}</div>}
        <footer className="foot">
          {config?.env} · version {config?.version}
        </footer>
      </LiveContext.Provider>
    </UserContext.Provider>
  );
}
