import { useState } from 'react';
import { api } from '../api.js';

export default function Login({ onSignedIn }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [ticket, setTicket] = useState(null); // set after the password step when a code is needed
  const [code, setCode] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

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

  if (helpOpen) return <HelpRequest initialEmail={email} onBack={() => setHelpOpen(false)} />;

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
          <button type="button" className="link small" onClick={() => setHelpOpen(true)}>
            Forgot your password or lost your phone?
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
            Lost your phone? Type one of your backup codes (like <code>abcde-fghjk</code>) instead. No backup codes?{' '}
            <button type="button" className="link small inline-link" onClick={() => setHelpOpen(true)}>
              Ask an admin to reset it
            </button>
            .
          </p>
          <button type="button" className="link small" onClick={() => (setTicket(null), setError(null))}>
            ← Back
          </button>
        </form>
      )}
    </div>
  );
}

function HelpRequest({ initialEmail, onBack }) {
  const [email, setEmail] = useState(initialEmail || '');
  const [kind, setKind] = useState('password');
  const [note, setNote] = useState('');
  const [sent, setSent] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setSent((await api('/auth/help', { method: 'POST', body: { email, kind, note } })).message);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <form onSubmit={submit} className="card">
        <h1>Need help signing in?</h1>
        {sent ? (
          <>
            <p>{sent}</p>
            <button type="button" className="primary" onClick={onBack}>
              Back to sign in
            </button>
          </>
        ) : (
          <>
            <p className="small">An admin will get your request and contact you. They'll check it's really you before resetting anything.</p>
            <label>
              Your email
              <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
            </label>
            <label>
              What do you need?
              <select value={kind} onChange={(e) => setKind(e.target.value)}>
                <option value="password">I forgot my password</option>
                <option value="two_factor">I lost my phone / can't get a code (two-factor reset)</option>
              </select>
            </label>
            <label>
              Anything else? <span className="muted">(optional)</span>
              <textarea rows={2} maxLength={500} placeholder="e.g. best number to reach me" value={note} onChange={(e) => setNote(e.target.value)} />
            </label>
            {error && <div className="error">{error}</div>}
            <button className="primary" disabled={busy}>
              {busy ? 'Sending…' : 'Send to an admin'}
            </button>
            <button type="button" className="link small" onClick={onBack}>
              ← Back to sign in
            </button>
          </>
        )}
      </form>
    </div>
  );
}
