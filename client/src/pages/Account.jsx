import { useState } from 'react';
import { api } from '../api.js';
import { Notice, useData, useUser } from '../lib.jsx';
import TwoFactorSetup, { BackupCodes } from './TwoFactorSetup.jsx';

export default function Account() {
  const user = useUser();
  const me = useData('/auth/me');
  const twoFactor = me.data?.user?.two_factor ?? user.two_factor;
  const required = me.data?.user?.two_factor_required ?? user.two_factor_required;

  return (
    <div className="narrow stack">
      <h2>Account</h2>
      <p>
        {user.name} · {user.email} · {user.role}
      </p>
      <ChangePassword />
      <TwoFactorCard enabled={twoFactor} required={required} onChange={me.reload} />
      <SignOutEverywhere />
    </div>
  );
}

function ChangePassword() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [msg, setMsg] = useState(null);

  async function submit(e) {
    e.preventDefault();
    try {
      await api('/auth/password', { method: 'POST', body: { current, next } });
      setMsg({ kind: 'success', text: 'Password changed. You were signed out on your other devices.' });
      setCurrent('');
      setNext('');
    } catch (err) {
      setMsg({ kind: 'error', text: err.message });
    }
  }

  return (
    <form onSubmit={submit} className="card stack">
      <h3>Change password</h3>
      <label>
        Current password
        <input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
      </label>
      <label>
        New password (10+ characters)
        <input type="password" autoComplete="new-password" minLength={10} value={next} onChange={(e) => setNext(e.target.value)} required />
      </label>
      <button className="primary">Change password</button>
      <Notice kind={msg?.kind}>{msg?.text}</Notice>
    </form>
  );
}

function TwoFactorCard({ enabled, required, onChange }) {
  const [mode, setMode] = useState(null); // 'setup' | 'codes' | 'disable'
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [newCodes, setNewCodes] = useState(null);
  const [msg, setMsg] = useState(null);

  const close = () => (setMode(null), setCode(''), setPassword(''), setNewCodes(null));

  async function getCodes(e) {
    e.preventDefault();
    try {
      setNewCodes((await api('/auth/2fa/backup-codes', { method: 'POST', body: { code } })).backup_codes);
      setMsg(null);
    } catch (err) {
      setMsg({ kind: 'error', text: err.message });
    }
  }

  async function disable(e) {
    e.preventDefault();
    try {
      await api('/auth/2fa/disable', { method: 'POST', body: { password } });
      close();
      setMsg({ kind: 'success', text: 'Two-factor sign-in is off.' });
      onChange();
    } catch (err) {
      setMsg({ kind: 'error', text: err.message });
    }
  }

  return (
    <div className="card stack">
      <h3>Two-factor sign-in</h3>
      {enabled ? (
        <p>
          <span className="pill ok">On</span> Signing in needs your password and a code from your authenticator app.
        </p>
      ) : (
        <p>
          <span className="pill">Off</span> Add a code from your phone to your password, so a stolen password isn't enough to sign in.
        </p>
      )}

      {!mode && (
        <div className="row">
          {!enabled && (
            <button className="primary" onClick={() => setMode('setup')}>
              Set up
            </button>
          )}
          {enabled && <button onClick={() => (setMode('codes'), setMsg(null))}>Get new backup codes</button>}
          {enabled && !required && <button onClick={() => (setMode('disable'), setMsg(null))}>Turn off</button>}
        </div>
      )}

      {mode === 'setup' && (
        <TwoFactorSetup
          onCancel={close}
          onEnabled={() => {
            close();
            setMsg({ kind: 'success', text: 'Two-factor sign-in is on.' });
            onChange();
          }}
        />
      )}

      {mode === 'codes' &&
        (newCodes ? (
          <BackupCodes codes={newCodes} onDone={close} doneLabel="Done" />
        ) : (
          <form className="stack" onSubmit={getCodes}>
            <p className="small">Your old backup codes will stop working. Enter the current code from your authenticator app:</p>
            <input className="code-input" inputMode="numeric" autoComplete="one-time-code" placeholder="123456" value={code} onChange={(e) => setCode(e.target.value)} required />
            <div className="row end">
              <button type="button" onClick={close}>
                Cancel
              </button>
              <button className="primary">Show new codes</button>
            </div>
          </form>
        ))}

      {mode === 'disable' && (
        <form className="stack" onSubmit={disable}>
          <label>
            Confirm with your password
            <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </label>
          <div className="row end">
            <button type="button" onClick={close}>
              Cancel
            </button>
            <button className="primary">Turn off</button>
          </div>
        </form>
      )}

      {enabled && required && !mode && (
        <p className="muted small">Lost your phone and backup codes? Another admin can reset it from the Users page.</p>
      )}
      <Notice kind={msg?.kind} onClose={() => setMsg(null)}>
        {msg?.text}
      </Notice>
    </div>
  );
}

function SignOutEverywhere() {
  const [msg, setMsg] = useState(null);
  async function go() {
    try {
      await api('/auth/logout-others', { method: 'POST', body: {} });
      setMsg({ kind: 'success', text: 'Signed out on every other device. You are still signed in here.' });
    } catch (err) {
      setMsg({ kind: 'error', text: err.message });
    }
  }
  return (
    <div className="card stack">
      <h3>Other devices</h3>
      <p className="small">Left yourself signed in on a shared or lost laptop? This signs you out everywhere except here.</p>
      <div>
        <button onClick={go}>Sign out everywhere else</button>
      </div>
      <Notice kind={msg?.kind} onClose={() => setMsg(null)}>
        {msg?.text}
      </Notice>
    </div>
  );
}
