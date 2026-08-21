import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useT } from '../i18n';
import { COMPANY, DISPATCH_TEL_DISPLAY, DISPATCH_TEL_HREF } from '../lib/contacts';

/** Состав будущей оферты — подписи пунктов переводятся, порядок нет. */
const OFFER_SECTIONS = [
  'legal.offerSubject',
  'legal.offerRequest',
  'legal.offerPrice',
  'legal.offerWarranty',
  'legal.offerRights',
  'legal.offerLiability',
  'legal.offerDisputes',
  'legal.offerRequisites',
];

export default function Legal() {
  const t = useT();
  const { hash } = useLocation();

  useEffect(() => {
    if (!hash) {
      window.scrollTo(0, 0);
      return;
    }
    const el = document.getElementById(hash.slice(1));
    if (el) el.scrollIntoView({ block: 'start' });
  }, [hash]);

  return (
    <section className="section-lg">
      <div className="wrap-narrow stack-lg">
        <h1 className="h2">{t('legal.title')}</h1>

        <article id="offer" className="card stack">
          <h2 className="h3">{t('legal.offerTitle')}</h2>
          <p className="stub-note">{t('legal.offerNote')}</p>
          <ol className="stack-sm">
            {OFFER_SECTIONS.map((key, i) => (
              <li key={key} className="step">
                <span className="usp-num">{String(i + 1).padStart(2, '0')}</span>
                <span>{t(key)}</span>
              </li>
            ))}
          </ol>
        </article>

        <article id="privacy" className="card stack">
          <h2 className="h3">{t('legal.privacyTitle')}</h2>
          <p className="stub-note">{t('legal.privacyNote')}</p>
          <p className="muted">{t('legal.privacyLaw')}</p>
          <div className="stack-sm">
            <p>
              <strong>{t('legal.privacyCollectTitle')}</strong> {t('legal.privacyCollectText')}
            </p>
            <p>
              <strong>{t('legal.privacyPurposeTitle')}</strong> {t('legal.privacyPurposeText')}
            </p>
            <p>
              <strong>{t('legal.privacyStorageTitle')}</strong> {t('legal.privacyStorageText')}
            </p>
            <p>
              <strong>{t('legal.privacyRevokeTitle')}</strong> {t('legal.privacyRevokeText')}
            </p>
          </div>
        </article>

        <article id="contacts" className="card stack">
          <h2 className="h3">{t('legal.contactsTitle')}</h2>
          <dl>
            <div className="kv">
              <dt>{t('legal.dispatch')}</dt>
              <dd>
                <a href={DISPATCH_TEL_HREF}>{DISPATCH_TEL_DISPLAY}</a>
              </dd>
            </div>
            <div className="kv">
              <dt>{t('legal.hours')}</dt>
              <dd>{t('legal.hoursValue')}</dd>
            </div>
            <div className="kv">
              <dt>{t('legal.address')}</dt>
              <dd>{t('legal.addressValue')}</dd>
            </div>
            <div className="kv">
              <dt>{t('legal.company')}</dt>
              <dd>{COMPANY}</dd>
            </div>
          </dl>
          <p className="stub-note">{t('legal.contactsNote')}</p>
        </article>
      </div>
    </section>
  );
}
