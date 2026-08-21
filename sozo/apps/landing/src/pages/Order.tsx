import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { fetchPrices } from '../api';
import {
  ConsentCheckbox,
  Done,
  Field,
  Honeypot,
  PhoneField,
  SubmitError,
} from '../components/form';
import { useT } from '../i18n';
import { displayCategory, FALLBACK_CATEGORIES } from '../lib/catalog';
import { DISPATCH_TEL_DISPLAY, DISPATCH_TEL_HREF } from '../lib/contacts';
import { MASTERS } from '../lib/team';
import { useSla } from '../lib/sla';
import { isPhoneValid, toE164 } from '../lib/phone';
import { useLeadSubmit } from '../lib/useLeadSubmit';
import { useResource } from '../lib/useResource';

/** Если клиент не выбрал категорию — заявка идёт как выезд с диагностикой. */
const DEFAULT_CATEGORY = 'ВЫЕЗД И ДИАГНОСТИКА';

export default function Order() {
  const t = useT();
  const sla = useSla();
  const [params] = useSearchParams();
  const prices = useResource(fetchPrices, []);

  const [phone, setPhone] = useState('');
  const [category, setCategory] = useState(params.get('category') ?? '');
  const [description, setDescription] = useState('');
  const [consent, setConsent] = useState(false);
  const [honeypot, setHoneypot] = useState('');

  const { pending, error, result, submit } = useLeadSubmit();

  const categories =
    prices.status === 'ready' ? prices.data.categories.map((c) => c.category) : FALLBACK_CATEGORIES;

  const canSubmit = isPhoneValid(phone) && consent && !pending;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    await submit(
      {
        kind: 'b2c',
        phone: toE164(phone),
        consent: true,
        category: category || DEFAULT_CATEGORY,
        description: description.trim() || undefined,
      },
      honeypot,
    );
  }

  if (result) {
    return (
      <Done
        title={t('order.successTitle')}
        lead={t('order.successLead', { sla: sla(result.slaMinutes, 10) })}
        ticket={result.ticket}
      >
        <div className="btn-row">
          <Link to="/" className="btn btn-secondary">
            {t('order.backHome')}
          </Link>
        </div>
      </Done>
    );
  }

  return (
    <section className="section-lg">
      <div className="wrap">
        <div className="form-layout">
          <div className="stack-lg">
            <div className="section-head">
              <p className="eyebrow">{t('order.eyebrow')}</p>
              <h1 className="h2">{t('order.title')}</h1>
              <p className="lead">{t('order.lead')}</p>
            </div>

            <form className="stack-lg" onSubmit={onSubmit} noValidate>
              <Honeypot value={honeypot} onChange={setHoneypot} />

              <PhoneField digits={phone} onChange={setPhone} />

              <Field id="category" label={t('order.categoryLabel')}>
                <select
                  id="category"
                  className="select"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                >
                  <option value="">{t('order.categoryAny')}</option>
                  {categories.map((c) => (
                    <option key={c} value={c}>
                      {displayCategory(c, t)}
                    </option>
                  ))}
                </select>
              </Field>

              <Field
                id="description"
                label={t('order.descriptionLabel')}
                hint={t('order.descriptionHint')}
              >
                <textarea
                  id="description"
                  className="textarea"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  maxLength={1000}
                  placeholder={t('order.descriptionPlaceholder')}
                />
              </Field>

              <ConsentCheckbox checked={consent} onChange={setConsent} />

              <SubmitError message={error} />

              <button type="submit" className="btn btn-block" disabled={!canSubmit}>
                {pending ? t('order.submitting') : t('order.submit')}
              </button>

              <p className="small muted">
                {t('order.offerNote')}
                <Link to="/legal#offer">{t('order.offerLink')}</Link>.
              </p>
            </form>
          </div>

          <aside className="form-aside">
            <div className="aside-card stack">
              <h2 className="h3">{t('order.nextTitle')}</h2>
              <ol className="stack-sm">
                <li className="tick">
                  <span>{t('order.step1')}</span>
                </li>
                <li className="tick">
                  <span>{t('order.step2')}</span>
                </li>
                <li className="tick">
                  <span>{t('order.step3')}</span>
                </li>
                <li className="tick">
                  <span>{t('order.step4')}</span>
                </li>
              </ol>
              <div className="aside-faces">
                <div className="faces" aria-hidden="true">
                  {MASTERS.slice(0, 4).map((m) => (
                    <img key={m.id} src={m.photo} alt="" loading="lazy" />
                  ))}
                </div>
                <p className="small muted">{t('order.mastersNote')}</p>
              </div>
            </div>

            <div className="aside-card aside-dark stack-sm">
              <p className="small muted">{t('order.urgentTitle')}</p>
              <a className="aside-tel" href={DISPATCH_TEL_HREF}>
                {DISPATCH_TEL_DISPLAY}
              </a>
              <p className="small muted">{t('order.emergencyNote')}</p>
            </div>
          </aside>
        </div>
      </div>
    </section>
  );
}
