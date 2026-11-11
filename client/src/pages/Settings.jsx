import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { Notice, useData, useDialog } from '../lib.jsx';

const MAX_BYTES = 1024 * 1024;

export default function Settings() {
  return (
    <section>
      <h2>Settings</h2>
      <Logo />
    </section>
  );
}

function Logo() {
  const config = useData('/config');
  const [dialog, ask] = useDialog();
  const input = useRef(null);
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);
  const current = config.data?.logo;

  useEffect(() => {
    if (!file) return undefined;
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  function choose(e) {
    const f = e.target.files?.[0];
    setNotice(null);
    if (!f) return;
    if (!/^image\/(png|jpeg|webp)$/.test(f.type)) {
      setNotice({ kind: 'error', text: 'Use a PNG, JPG or WebP image.' });
      e.target.value = '';
      return;
    }
    if (f.size > MAX_BYTES) {
      setNotice({ kind: 'error', text: 'That image is too big. Please use one under 1 MB.' });
      e.target.value = '';
      return;
    }
    setFile(f);
  }

  function reloadEverywhere() {
    config.reload();
    window.dispatchEvent(new Event('ledger:branding'));
  }

  async function upload() {
    setBusy(true);
    try {
      const data = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result));
        r.onerror = () => reject(new Error('Could not read that file'));
        r.readAsDataURL(file);
      });
      await api('/branding/logo', { method: 'POST', body: { data } });
      setNotice({ kind: 'success', text: 'Logo saved. Everyone will see it.' });
      setFile(null);
      setPreview(null);
      if (input.current) input.current.value = '';
      reloadEverywhere();
    } catch (err) {
      setNotice({ kind: 'error', text: err.message });
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    const ok = await ask({
      title: 'Remove the logo?',
      message: 'The coffee cup goes back in its place.',
      confirmLabel: 'Remove logo',
      danger: true,
    });
    if (!ok) return;
    try {
      await api('/branding/logo', { method: 'DELETE' });
      setNotice({ kind: 'success', text: 'Logo removed.' });
      reloadEverywhere();
    } catch (err) {
      setNotice({ kind: 'error', text: err.message });
    }
  }

  const shown = preview || (current ? `/api/branding/logo?v=${current}` : null);

  return (
    <div className="card stack logo-card">
      {dialog}
      <h3>Company logo</h3>
      <p className="muted small">Shown in the top bar and on the sign-in page. PNG, JPG or WebP, under 1 MB. A wide logo around 400 pixels across works best.</p>
      <div className="logo-previews">
        <div className="logo-preview bar">
          {shown ? <img className="brand-logo" src={shown} alt="Logo preview in the top bar" /> : <span>☕</span>} <span>Roastery Ledger</span>
          <div className="small">Top bar</div>
        </div>
        <div className="logo-preview page">
          {shown ? <img className="brand-logo plain" src={shown} alt="Logo preview on the sign-in page" /> : <span>☕</span>} <b>Roastery Ledger</b>
          <div className="small muted">Sign-in page</div>
        </div>
      </div>
      <div className="row">
        <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" onChange={choose} aria-label="Choose a logo image" />
        {file && (
          <button className="primary" onClick={upload} disabled={busy}>
            {busy ? 'Saving…' : 'Use this logo'}
          </button>
        )}
        {current && !file && (
          <button className="danger" onClick={remove}>
            Remove logo
          </button>
        )}
      </div>
      <Notice kind={notice?.kind} onClose={() => setNotice(null)}>
        {notice?.text}
      </Notice>
    </div>
  );
}
