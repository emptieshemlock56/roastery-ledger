import { useEffect, useState } from 'react';
import { api } from './api.js';
import { LiveContext, UserContext } from './lib.jsx';
import Account from './pages/Account.jsx';
import Activity from './pages/Activity.jsx';
import Catalog from './pages/Catalog.jsx';
import Import from './pages/Import.jsx';
import Login from './pages/Login.jsx';
import Record from './pages/Record.jsx';
import Reports from './pages/Reports.jsx';
import Stock from './pages/Stock.jsx';
import Users from './pages/Users.jsx';

const PAGES = {
  stock: ['Stock', Stock],
  record: ['Record', Record],
  activity: ['Activity', Activity],
  reports: ['Reports', Reports],
  catalog: ['Catalog', Catalog],
  import: ['Import', Import],
  users: ['Users', Users, 'admin'],
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

  useEffect(() => {
    api('/config').then(setConfig, () => setConfig({ env: 'unknown' }));
    api('/auth/me').then((d) => setUser(d.user), () => setUser(null));
    const out = () => setUser(null);
    window.addEventListener('ledger:signed-out', out);
    return () => window.removeEventListener('ledger:signed-out', out);
  }, []);

  // Live updates from other users.
  useEffect(() => {
    if (!user) return;
    const es = new EventSource('/api/events');
    es.onmessage = (e) => {
      setTick((t) => t + 1);
      try {
        const msg = JSON.parse(e.data);
        if (msg.by && msg.by !== user.name) setLastChange(`${msg.by} updated ${msg.entity}`);
      } catch {
        /* ignore */
      }
    };
    return () => es.close();
  }, [user]);

  useEffect(() => {
    if (!lastChange) return;
    const t = setTimeout(() => setLastChange(null), 4000);
    return () => clearTimeout(t);
  }, [lastChange]);

  const env = ENV_STYLES[config?.env];
  const banner = env && (
    <div className="env-banner" style={{ background: env.color }}>
      {env.label}
    </div>
  );

  if (user === undefined) return <div className="loading">Loading…</div>;
  if (!user) return (
    <>
      {banner}
      <Login onSignedIn={setUser} />
    </>
  );

  const allowed = PAGES[page] && (PAGES[page][2] !== 'admin' || user.role === 'admin');
  const Page = (allowed ? PAGES[page] : PAGES.stock)[1];

  async function signOut() {
    await api('/auth/logout', { method: 'POST', body: {} }).catch(() => {});
    setUser(null);
  }

  return (
    <UserContext.Provider value={user}>
      <LiveContext.Provider value={{ tick }}>
        {banner}
        <header className="topbar">
          <div className="brand">☕ Roastery Ledger</div>
          <nav>
            {Object.entries(PAGES)
              .filter(([, [, , a]]) => a !== 'hidden' && (a !== 'admin' || user.role === 'admin'))
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
