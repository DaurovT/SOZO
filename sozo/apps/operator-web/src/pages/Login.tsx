import { useState } from 'react';
import { request, ApiError } from '../api';
import { setSession } from '../auth';
import type { AuthUser } from '../types';

/** Вход по телефону и OTP — та же механика, что у остальных приложений (ТЗ 14). */
export function Login() {
  const [phone, setPhone] = useState('+998900000000');
  const [code, setCode] = useState('');
  const [org, setOrg] = useState('uk-1');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (!sent) {
        await request('/auth/request-otp', { body: { phone } });
        setSent(true);
      } else {
        const r = await request<{ accessToken: string; user?: AuthUser }>('/auth/verify', {
          body: { phone, code },
        });
        setSession(r.accessToken, r.user ?? { phone, roles: [] }, org);
        window.location.reload();
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не удалось войти');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <form className="card" onSubmit={submit} style={{ padding: 'var(--s32)', width: 380, display: 'flex', flexDirection: 'column', gap: 'var(--s16)' }}>
        <div>
          <h1 className="h1">Кабинет эксплуатации</h1>
          <div className="cap" style={{ marginTop: 'var(--s4)' }}>Вход для управляющих организаций</div>
        </div>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s4)' }}>
          <span className="cap">Телефон</span>
          <input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} disabled={sent} />
        </label>

        {sent && (
          <label style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s4)' }}>
            <span className="cap">Код из SMS</span>
            <input className="input" value={code} onChange={(e) => setCode(e.target.value)} autoFocus />
          </label>
        )}

        <label style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s4)' }}>
          <span className="cap">Организация</span>
          <input className="input" value={org} onChange={(e) => setOrg(e.target.value)} />
        </label>

        {error && <div className="cap" style={{ color: 'var(--error)' }}>{error}</div>}

        <button className="btn btn--lg" disabled={busy}>{sent ? 'Войти' : 'Получить код'}</button>
      </form>
    </div>
  );
}
