import { useMemo, useState } from 'react';
import { api } from '../api.js';
import { fmtDateTime, Grid, Notice, useData, useUser } from '../lib.jsx';

export default function Users() {
  const me = useUser();
  const users = useData('/users');
  const help = useData('/users/help-requests');
  const audit = useData('/audit');
  const [draft, setDraft] = useState({ name: '', email: '', password: '', role: 'member' });
  const [notice, setNotice] = useState(null);

  async function add(e) {
    e.preventDefault();
    try {
      await api('/users', { method: 'POST', body: draft });
      setNotice({ kind: 'success', text: `Created ${draft.email}. Share the password with them privately; they can change it under Account.` });
      setDraft({ name: '', email: '', password: '', role: 'member' });
      users.reload();
    } catch (err) {
      setNotice({ kind: 'error', text: err.message });
    }
  }

  async function update(id, body) {
    try {
      await api(`/users/${id}`, { method: 'PATCH', body });
      setNotice({ kind: 'success', text: 'Saved.' });
    } catch (err) {
      setNotice({ kind: 'error', text: err.message });
    }
    users.reload();
    help.reload();
  }

  function resetPassword(u) {
    const pw = window.prompt(`New temporary password for ${u.email} (10+ characters). This signs them out everywhere.`);
    if (pw) update(u.id, { password: pw });
  }

  async function resolve(id) {
    try {
      await api(`/users/help-requests/${id}/resolve`, { method: 'POST', body: {} });
    } catch (err) {
      setNotice({ kind: 'error', text: err.message });
    }
    help.reload();
  }

  async function reset2fa(u) {
    if (!window.confirm(`Reset two-factor sign-in for ${u.email}?\n\nUse this if they lost their phone and their backup codes. They'll be signed out and will set it up again next time they sign in.`)) return;
    try {
      await api(`/users/${u.id}/reset-2fa`, { method: 'POST', body: {} });
      setNotice({ kind: 'success', text: `Two-factor sign-in reset for ${u.email}. They'll set it up again at their next sign-in.` });
    } catch (err) {
      setNotice({ kind: 'error', text: err.message });
    }
    users.reload();
    help.reload();
  }

  const userCols = useMemo(
    () => [
      { field: 'name', flex: 1, editable: true },
      { field: 'email', flex: 1 },
      { field: 'role', width: 120, editable: true, cellEditor: 'agSelectCellEditor', cellEditorParams: { values: ['member', 'admin'] } },
      { field: 'active', width: 100, editable: true, cellDataType: 'boolean' },
      {
        field: 'two_factor',
        headerName: '2FA',
        width: 110,
        cellRenderer: (p) => (p.value ? <span className="pill ok">On</span> : <span className="pill warn">Not set up</span>),
      },
      {
        headerName: '',
        width: 240,
        sortable: false,
        filter: false,
        cellRenderer: (p) => (
          <>
            <button className="link small" onClick={() => resetPassword(p.data)}>
              Reset password
            </button>
            {p.data.two_factor && p.data.id !== me.id && (
              <button className="link small" style={{ marginLeft: 12 }} onClick={() => reset2fa(p.data)}>
                Reset 2FA
              </button>
            )}
          </>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const auditCols = useMemo(
    () => [
      { field: 'at', headerName: 'When', width: 160, valueFormatter: (p) => fmtDateTime(p.value) },
      { field: 'user_name', headerName: 'Who', width: 140 },
      { field: 'action', width: 130 },
      { field: 'entity', width: 110 },
      { field: 'details', flex: 1, valueFormatter: (p) => (p.value ? JSON.stringify(p.value) : '') },
    ],
    [],
  );

  return (
    <section>
      <h2>Users</h2>
      <p className="muted small">
        Admins can manage users. Everyone else can record and edit inventory data. Nobody can change how the app works from here: that
        only happens through a reviewed code change.
      </p>
      <HelpRequests
        rows={help.data || []}
        meId={me.id}
        onResetPassword={(r) => resetPassword({ id: r.user_id, email: r.email })}
        onReset2fa={(r) => reset2fa({ id: r.user_id, email: r.email })}
        onResolve={resolve}
      />
      <form className="toolbar card tight" onSubmit={add}>
        <b>New user</b>
        <input placeholder="Name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} required />
        <input type="email" placeholder="Email" value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} required />
        <input
          type="text"
          placeholder="Temporary password (10+)"
          minLength={10}
          autoComplete="off"
          value={draft.password}
          onChange={(e) => setDraft({ ...draft, password: e.target.value })}
          required
        />
        <select value={draft.role} onChange={(e) => setDraft({ ...draft, role: e.target.value })}>
          <option value="member">Member</option>
          <option value="admin">Admin</option>
        </select>
        <button className="primary">Add user</button>
      </form>
      <Notice kind={notice?.kind} onClose={() => setNotice(null)}>
        {notice?.text}
      </Notice>
      <Grid
        rowData={users.data || []}
        columnDefs={userCols}
        height="260px"
        onCellValueChanged={(e) => e.newValue !== e.oldValue && update(e.data.id, { [e.colDef.field]: e.newValue })}
      />
      <h3>Audit log</h3>
      <Grid rowData={audit.data || []} columnDefs={auditCols} height="360px" />
    </section>
  );
}

const KIND_LABELS = { password: 'Password reset', two_factor: 'Two-factor reset' };

function HelpRequests({ rows, meId, onResetPassword, onReset2fa, onResolve }) {
  const open = rows.filter((r) => !r.resolved_at);
  const done = rows.filter((r) => r.resolved_at);
  const [showDone, setShowDone] = useState(false);
  if (!rows.length) return null;

  const action = (r) => {
    if (!r.user_id) return <span className="muted small">No account has this email</span>;
    if (!r.user_active) return <span className="muted small">Account is deactivated</span>;
    if (r.kind === 'password')
      return (
        <button className="link small" onClick={() => onResetPassword(r)}>
          Reset password
        </button>
      );
    if (r.user_id === meId) return <span className="muted small">Another admin must reset yours</span>;
    if (!r.user_two_factor) return <span className="muted small">Two-factor isn't set up, nothing to reset</span>;
    return (
      <button className="link small" onClick={() => onReset2fa(r)}>
        Reset 2FA
      </button>
    );
  };

  return (
    <div className={`card stack help-requests ${open.length ? 'has-open' : ''}`}>
      <h3>
        Sign-in help requests {open.length > 0 && <span className="pill warn">{open.length} open</span>}
      </h3>
      {open.length > 0 && (
        <p className="small muted">Confirm it's really them (in person or by phone) before resetting anything. Anyone can fill in the form.</p>
      )}
      {open.map((r) => (
        <div key={r.id} className="help-row">
          <div>
            <b>{r.user_name || r.email}</b> <span className="muted small">{r.user_name ? r.email : ''}</span>
            <div className="small">
              {KIND_LABELS[r.kind]} · {fmtDateTime(r.created_at)}
              {r.note && <div className="muted">"{r.note}"</div>}
            </div>
          </div>
          <div className="help-actions">
            {action(r)}
            <button className="link small" onClick={() => onResolve(r.id)}>
              Mark done
            </button>
          </div>
        </div>
      ))}
      {open.length === 0 && <p className="small muted">No open requests.</p>}
      {done.length > 0 && (
        <button className="link small" onClick={() => setShowDone((v) => !v)}>
          {showDone ? 'Hide' : 'Show'} handled in the last 14 days ({done.length})
        </button>
      )}
      {showDone &&
        done.map((r) => (
          <div key={r.id} className="help-row done small">
            <span>
              {r.email} · {KIND_LABELS[r.kind]} · asked {fmtDateTime(r.created_at)}
            </span>
            <span className="muted">
              handled {fmtDateTime(r.resolved_at)}
              {r.resolved_by_name ? ` by ${r.resolved_by_name}` : ''}
            </span>
          </div>
        ))}
    </div>
  );
}
