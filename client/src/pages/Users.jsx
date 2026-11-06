import { useMemo, useState } from 'react';
import { api } from '../api.js';
import { fmtDateTime, Grid, Notice, useData } from '../lib.jsx';

export default function Users() {
  const users = useData('/users');
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
  }

  const userCols = useMemo(
    () => [
      { field: 'name', flex: 1, editable: true },
      { field: 'email', flex: 1 },
      { field: 'role', width: 120, editable: true, cellEditor: 'agSelectCellEditor', cellEditorParams: { values: ['member', 'admin'] } },
      { field: 'active', width: 100, editable: true, cellDataType: 'boolean' },
      {
        headerName: '',
        width: 150,
        sortable: false,
        filter: false,
        cellRenderer: (p) => (
          <button
            className="link small"
            onClick={() => {
              const pw = window.prompt(`New password for ${p.data.email} (10+ characters)`);
              if (pw) update(p.data.id, { password: pw });
            }}
          >
            Reset password
          </button>
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
