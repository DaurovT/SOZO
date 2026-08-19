import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { setSession } from '../auth';
import { SozoLogo, SozoMark } from '../components/Logo';
import type { AuthUser } from '../types';

/** «+998 90 123 45 67» из произвольного ввода. */
function maskPhone(raw: string): string {
  let digits = raw.replace(/\D/g, '');
  if (digits.startsWith('998')) digits = digits.slice(3);
  digits = digits.slice(0, 9);
  const parts = [digits.slice(0, 2), digits.slice(2, 5), digits.slice(5, 7), digits.slice(7, 9)];
  return '+998' + parts.filter(Boolean).map((p) => ' ' + p).join('');
}

function phoneToE164(masked: string): string {
  return '+' + masked.replace(/\D/g, '');
}

export function LoginPage() {
  const navigate = useNavigate();
  const [phone, setPhone] = useState('+998');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const phoneValid = phoneToE164(phone).length === 13; // +998 и 9 цифр

  const requestOtp = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post<{ sent: boolean }>('/auth/request-otp', { phone: phoneToE164(phone) });
      setStep('code');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const verify = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ accessToken: string; user: AuthUser }>('/auth/verify', {
        phone: phoneToE164(phone),
        code,
      });
      setSession(res.accessToken, res.user);
      navigate('/dashboard', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-logo">
          <SozoMark size={40} />
          <SozoLogo height={26} title="SOZO" />
        </div>
        <h1>Админ</h1>
        <p className="subtitle">Панель администратора и бухгалтерии</p>
        {error !== null && <div className="banner banner--error">{error}</div>}
        {step === 'phone' ? (
          <form className="form-grid" onSubmit={requestOtp}>
            <div className="field">
              <label htmlFor="phone">Телефон</label>
              <input
                id="phone"
                type="tel"
                value={phone}
                onChange={(e) => setPhone(maskPhone(e.target.value))}
                placeholder="+998 90 123 45 67"
                autoFocus
              />
            </div>
            <button type="submit" className="btn btn--primary" disabled={!phoneValid || busy}>
              Получить код
            </button>
          </form>
        ) : (
          <form className="form-grid" onSubmit={verify}>
            <div className="field">
              <label htmlFor="code">Код из SMS ({phone})</label>
              <input
                id="code"
                inputMode="numeric"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 5))}
                placeholder="00000"
                autoFocus
              />
            </div>
            <button type="submit" className="btn btn--primary" disabled={code.length !== 5 || busy}>
              Войти
            </button>
            <button type="button" className="btn btn--link" onClick={() => setStep('phone')}>
              Изменить номер
            </button>
          </form>
        )}
        <div className="dev-hint">Dev-режим: код 00000</div>
      </div>
    </div>
  );
}
