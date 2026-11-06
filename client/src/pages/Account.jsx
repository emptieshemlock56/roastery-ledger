import { useState } from 'react';
import { api } from '../api.js';
import { Notice, useUser } from '../lib.jsx';

export default function Account() {
  const user = useUser();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [msg, setMsg] = useState(null);

  async function submit(e) {
    e.preventDefault();
    try {
      await api('/auth/password', { method: 'POST', body: { current, next } });
      setMsg({ kind: 'success', text: 'Password changed.' });
      setCurrent('');
      setNext('');
    } catch (err) {
      setMsg({ kind: 'error', text: err.message });
    }
  }

  return (
    <div className="narrow">
      <h2>Account</h2>
      <p>
        {user.name} · {user.email} · {user.role}
      </p>
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
    </div>
  );
}
