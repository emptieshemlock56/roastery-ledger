import { useState } from 'react';
import { api } from '../api.js';

export default function Login({ onSignedIn }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [ticket, setTicket] = useState(null); // set after the password step when a code is needed
  const [code, setCode] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function run(fn) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const submitPassword = (e) => {
    e.preventDefault();
    run(async () => {
      const r = await api('/auth/login', { method: 'POST', body: { email, password } });
      if (r.needs_code) {
        setTicket(r.ticket);
        setCode('');
      } else onSignedIn(r.user);
    });
  };

  const submitCode = (e) => {
    e.preventDefault();
    run(async () => {
      try {
        const r = await api('/auth/login/code', { method: 'POST', body: { ticket, code } });
        onSignedIn(r.user, { backupCodesLeft: r.backup_codes_left });
      } catch (err) {
        if (/sign in again|too long/i.test(err.message)) setTicket(null);
        throw err;
      }
    });
  };

  return (
    <div className="login">
      {!ticket ? (
        <form onSubmit={submitPassword} className="card">
          <h1>☕ Roastery Ledger</h1>
          <label>
            Email
            <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
          </label>
          <label>
            Password
            <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </label>
          {error && <div className="error">{error}</div>}
          <button className="primary" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
          <p className="muted small">Accounts are created by an admin. Ask your admin if you need one.</p>
        </form>
      ) : (
        <form onSubmit={submitCode} className="card">
          <h1>☕ Roastery Ledger</h1>
          <p>Open your authenticator app and enter the 6-digit code for Roastery Ledger.</p>
          <label>
            Code
            <input
              className="code-input"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="123456"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              required
              autoFocus
            />
          </label>
          {error && <div className="error">{error}</div>}
          <button className="primary" disabled={busy}>
            {busy ? 'Checking…' : 'Continue'}
          </button>
          <p className="muted small">
            Lost your phone? Type one of your backup codes (like <code>abcde-fghjk</code>) instead. No backup codes? Ask an admin to reset
            your two-factor sign-in.
          </p>
          <button type="button" className="link small" onClick={() => (setTicket(null), setError(null))}>
            ← Back
          </button>
        </form>
      )}
    </div>
  );
}
