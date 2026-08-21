import { useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { fetchMasterVerify } from '../api';
import { useT } from '../i18n';
import { gradeLabel } from '../lib/catalog';
import { DISPATCH_TEL_DISPLAY, DISPATCH_TEL_HREF } from '../lib/contacts';
import { useResource } from '../lib/useResource';

/*
 * L-07 — публичная верификация бейджа мастера по QR.
 * ВАЖНО: страница должна отдаваться с noindex (<meta name="robots" content="noindex, nofollow">
 * и заголовком X-Robots-Tag) — коды бейджей не должны попадать в поисковую выдачу.
 * В dev-версии на Vite тега нет: он появится в SSR-версии на Next.js по DEV-07.
 *
 * Контактов мастера здесь нет намеренно: страница подтверждает только статус бейджа.
 */

export default function Verify() {
  const t = useT();
  const { code = '' } = useParams();
  const load = useCallback(() => fetchMasterVerify(code), [code]);
  const state = useResource(load, [code]);

  return (
    <section className="section-lg">
      <div className="wrap-narrow">
        <div className="verify stack-lg">
          <div className="section-head" style={{ textAlign: 'center' }}>
            <p className="eyebrow">{t('verify.eyebrow')}</p>
            <h1 className="h2">{t('verify.title')}</h1>
          </div>

          {state.status === 'loading' && (
            <div className="card">
              <p className="muted" style={{ textAlign: 'center' }}>
                {t('verify.loading')}
              </p>
            </div>
          )}

          {state.status === 'error' && (
            <div className="card stack">
              <p className="h3">{t('verify.errorTitle')}</p>
              <p className="muted">{t('verify.errorLead')}</p>
              <a className="btn btn-secondary btn-block" href={DISPATCH_TEL_HREF}>
                {t('verify.call', { phone: DISPATCH_TEL_DISPLAY })}
              </a>
            </div>
          )}

          {state.status === 'ready' && state.data.valid && (
            <div className="card stack-lg">
              <div className="verify-photo" aria-hidden="true">
                {t('verify.photoPlaceholder')}
              </div>
              <div className="stack-sm" style={{ textAlign: 'center' }}>
                <h2 className="h2">{state.data.fullName}</h2>
              </div>
              <div className="chips">
                {state.data.skillTags.map((tag) => (
                  <span key={tag} className="chip">
                    {tag}
                  </span>
                ))}
                <span className="chip chip-grade">
                  {t('verify.grade', { grade: gradeLabel(state.data.grade, t) })}
                </span>
              </div>
              <p className="status status-ok">{state.data.message}</p>
            </div>
          )}

          {state.status === 'ready' && !state.data.valid && (
            <div className="card stack-lg">
              <div className="verify-photo" aria-hidden="true">
                {t('verify.noPhotoPlaceholder')}
              </div>
              <p className="status status-bad">{state.data.message}</p>
              <a className="btn btn-secondary btn-block" href={DISPATCH_TEL_HREF}>
                {t('verify.callDispatcher', { phone: DISPATCH_TEL_DISPLAY })}
              </a>
            </div>
          )}

          <p className="small muted" style={{ textAlign: 'center' }}>
            {t('verify.note')}
          </p>
        </div>
      </div>
    </section>
  );
}
