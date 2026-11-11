import { useState } from 'react';
import { api } from '../api.js';
import { Notice, useData, useDialog } from '../lib.jsx';

// A grid of ticks: each column is a role, each row is something a person might be allowed to change.
export default function Roles() {
  const roles = useData('/roles');
  const [dialog, ask] = useDialog();
  const [notice, setNotice] = useState(null);
  const [draft, setDraft] = useState({ name: '', description: '', copyFrom: '' });

  const catalog = roles.data?.permissions ?? [];
  const list = roles.data?.roles ?? [];
  const groups = [...new Set(catalog.map((p) => p.group))];

  async function run(fn, success) {
    try {
      await fn();
      if (success) setNotice({ kind: 'success', text: success });
    } catch (err) {
      setNotice({ kind: 'error', text: err.message });
    }
    roles.reload();
  }

  const save = (role, body, success = 'Saved. It applies to those people straight away.') =>
    run(() => api(`/roles/${role.id}`, { method: 'PATCH', body }), success);

  function toggle(role, key, on) {
    save(role, { permissions: on ? [...role.permissions, key] : role.permissions.filter((k) => k !== key) });
  }

  async function remove(role) {
    const ok = await ask({
      title: `Delete the role "${role.name}"?`,
      message: 'This only removes the role. It can only be deleted when nobody is in it.',
      confirmLabel: 'Delete role',
      danger: true,
    });
    if (ok) run(() => api(`/roles/${role.id}`, { method: 'DELETE' }), `Deleted "${role.name}".`);
  }

  async function add(e) {
    e.preventDefault();
    const source = list.find((r) => r.id === draft.copyFrom);
    await run(
      () =>
        api('/roles', {
          method: 'POST',
          body: { name: draft.name, description: draft.description, permissions: source?.permissions ?? [] },
        }),
      `Added "${draft.name}". Tick what it can change.`,
    );
    setDraft({ name: '', description: '', copyFrom: '' });
  }

  return (
    <>
      {dialog}
      <p className="muted small">
        Everyone who signs in can <b>look</b> at stock, activity, reports and the catalog. A role only lists what its people may{' '}
        <b>change</b>; anything unticked is read-only for them. Administrators can do everything, including managing people, roles and the
        logo. Changes apply right away, even to people who are signed in.
      </p>
      <Notice kind={notice?.kind} onClose={() => setNotice(null)}>
        {notice?.text}
      </Notice>
      <Notice kind="error">{roles.error}</Notice>

      <div className="roles-scroll">
        <table className="roles-grid">
          <thead>
            <tr>
              <th scope="col" className="perm-col">
                What they can change
              </th>
              <th scope="col" className="role-col admin-col">
                <b>Administrator</b>
                <div className="small muted">Everything. Not editable.</div>
              </th>
              {list.map((r) => (
                <th scope="col" className="role-col" key={r.id}>
                  <input
                    key={`n-${r.id}-${r.name}`}
                    className="role-name"
                    aria-label={`Name of role ${r.name}`}
                    defaultValue={r.name}
                    maxLength={60}
                    onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== r.name && save(r, { name: e.target.value.trim() }, 'Renamed.')}
                  />
                  <input
                    key={`d-${r.id}-${r.description ?? ''}`}
                    className="role-desc"
                    aria-label={`Description of role ${r.name}`}
                    placeholder="What is this role for?"
                    defaultValue={r.description ?? ''}
                    maxLength={300}
                    onBlur={(e) => e.target.value.trim() !== (r.description ?? '') && save(r, { description: e.target.value.trim() }, 'Saved.')}
                  />
                  <div className="small muted">
                    {r.user_count} {r.user_count === 1 ? 'person' : 'people'} ·{' '}
                    <button className="link small" onClick={() => remove(r)}>
                      Delete
                    </button>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => [
              <tr className="group-row" key={`g-${g}`}>
                <th colSpan={list.length + 2} scope="colgroup">
                  {g}
                </th>
              </tr>,
              ...catalog
                .filter((p) => p.group === g)
                .map((p) => (
                  <tr key={p.key}>
                    <th scope="row" className="perm-col">
                      {p.label}
                      <div className="small muted">{p.help}</div>
                    </th>
                    <td className="tick admin-col">
                      <input type="checkbox" checked disabled aria-label={`Administrator: ${p.label}`} />
                    </td>
                    {list.map((r) => (
                      <td className="tick" key={r.id}>
                        <input
                          type="checkbox"
                          checked={r.permissions.includes(p.key)}
                          onChange={(e) => toggle(r, p.key, e.target.checked)}
                          aria-label={`${r.name}: ${p.label}`}
                        />
                      </td>
                    ))}
                  </tr>
                )),
            ])}
          </tbody>
        </table>
      </div>

      <form className="toolbar card tight" onSubmit={add}>
        <b>New role</b>
        <input placeholder="Name (e.g. Warehouse lead)" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} required maxLength={60} />
        <input className="grow" placeholder="What is it for? (optional)" value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} maxLength={300} />
        <select value={draft.copyFrom} onChange={(e) => setDraft({ ...draft, copyFrom: e.target.value })} aria-label="Start from">
          <option value="">Start with nothing ticked</option>
          {list.map((r) => (
            <option key={r.id} value={r.id}>
              Start from {r.name}
            </option>
          ))}
        </select>
        <button className="primary">Add role</button>
      </form>
    </>
  );
}
