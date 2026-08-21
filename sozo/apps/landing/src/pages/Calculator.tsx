import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { fetchObjectTypeRates, type ObjectTypeRate } from '../api';
import {
  ConsentCheckbox,
  Done,
  Field,
  Honeypot,
  PhoneField,
  Stepper,
  SubmitError,
} from '../components/form';
import { useLocale, useT, useTn } from '../i18n';
import { FALLBACK_OBJECT_TYPES, objectTypeLabel } from '../lib/catalog';
import { formatSum, formatTiyin } from '../lib/format';
import { isPhoneValid, toE164 } from '../lib/phone';
import { useSla } from '../lib/sla';
import { useLeadSubmit } from '../lib/useLeadSubmit';
import { useResource } from '../lib/useResource';

/** Итог округляем вверх до 100 000 сум = 10 000 000 тийин. */
const ROUND_STEP_TIYIN = 100_000 * 100;

/** Запас, если бэкенд не прислал свой срок: 4 рабочих часа. */
const SLA_FALLBACK_MINUTES = 240;

/** Адрес справочника ставок — часть API, не текст: не переводится. */
const RATES_API = '/v1/public/object-type-rates';

function monthlyTiyin(rate: ObjectTypeRate, points: number): number {
  const raw = rate.ratePerM2Tiyin * rate.typicalAreaM2 * points;
  return Math.ceil(raw / ROUND_STEP_TIYIN) * ROUND_STEP_TIYIN;
}

export default function Calculator() {
  const t = useT();
  const tn = useTn();
  const locale = useLocale();
  const sla = useSla();
  const rates = useResource(fetchObjectTypeRates, []);

  const [points, setPoints] = useState(1);
  const [objectType, setObjectType] = useState('');

  const [company, setCompany] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [consent, setConsent] = useState(false);
  const [honeypot, setHoneypot] = useState('');

  const { pending, error, result, submit } = useLeadSubmit();

  const rateList = rates.status === 'ready' ? rates.data : [];
  const typeNames =
    rates.status === 'ready' ? rateList.map((r) => r.objectType) : FALLBACK_OBJECT_TYPES;
  const selected = rateList.find((r) => r.objectType === objectType) ?? null;
  const total = selected ? monthlyTiyin(selected, points) : null;

  const canSubmit =
    isPhoneValid(phone) && consent && company.trim() !== '' && name.trim() !== '' && !pending;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    await submit(
      {
        kind: 'b2b',
        phone: toE164(phone),
        consent: true,
        name: name.trim(),
        company: company.trim(),
        pointsCount: points,
        objectType: objectType || typeNames[0],
        email: email.trim() || undefined,
      },
      honeypot,
    );
  }

  if (result) {
    return (
      <Done
        title={t('calculator.doneTitle')}
        lead={t('calculator.doneLead', { sla: sla(result.slaMinutes, SLA_FALLBACK_MINUTES) })}
        ticket={result.ticket}
      >
        <div className="btn-row">
          <Link to="/business" className="btn btn-secondary">
            {t('calculator.doneBack')}
          </Link>
        </div>
      </Done>
    );
  }

  // Адрес API стоит внутри фразы: во фрагменте она целая, с подстановкой
  // {api}, а здесь разрезается по ней, чтобы адрес остался в <code>.
  const [sourceBefore, sourceAfter] = t('calculator.ratesSource').split('{api}');

  return (
    <section className="section-lg">
      <div className="wrap-narrow stack-lg">
        <div className="section-head">
          <h1 className="h2">{t('calculator.title')}</h1>
          <p className="lead">{t('calculator.lead')}</p>
        </div>

        <div className="card stack-lg">
          <Stepper
            label={t('calculator.pointsLabel')}
            value={points}
            min={1}
            max={50}
            onChange={setPoints}
            suffix={tn('calculator.points', points)}
          />

          <Field id="objectType" label={t('calculator.objectType')}>
            <select
              id="objectType"
              className="select"
              value={objectType}
              onChange={(e) => setObjectType(e.target.value)}
            >
              <option value="">{t('calculator.objectTypePlaceholder')}</option>
              {typeNames.map((type) => (
                <option key={type} value={type}>
                  {objectTypeLabel(type, t)}
                </option>
              ))}
            </select>
          </Field>
        </div>

        {total !== null && selected && (
          <div className="result stack">
            <div className="stack-sm">
              <p className="muted">{t('calculator.approx')}</p>
              <p className="result-value">
                {formatTiyin(total, locale.tag, t('unit.sum'))}
                {t('unit.perMonth')}
              </p>
            </div>
            <dl className="result-rows">
              <div className="result-row">
                <span>{t('calculator.rateRow')}</span>
                <span>
                  {t('calculator.rateValue', {
                    value: formatSum(selected.ratePerM2Tiyin / 100, locale.tag),
                    unit: t('unit.sum'),
                  })}
                </span>
              </div>
              <div className="result-row">
                <span>{t('calculator.areaRow')}</span>
                <span>{t('calculator.areaValue', { value: selected.typicalAreaM2 })}</span>
              </div>
              <div className="result-row">
                <span>{t('calculator.pointsRow')}</span>
                <span>{points}</span>
              </div>
            </dl>
            <p className="small muted">{t('calculator.exactNote')}</p>
          </div>
        )}

        {rates.status === 'error' && <p className="stub-note">{t('calculator.ratesUnavailable')}</p>}

        {rates.status === 'ready' && (
          <p className="small muted">
            {sourceBefore}
            <code>{RATES_API}</code>
            {sourceAfter}
          </p>
        )}

        <div className="section-head">
          <h2 className="h2">{t('calculator.formTitle')}</h2>
          <p className="lead">{t('calculator.formLead')}</p>
        </div>

        <form className="stack-lg" onSubmit={onSubmit} noValidate>
          <Honeypot value={honeypot} onChange={setHoneypot} />

          <Field id="company" label={t('calculator.company')} required>
            <input
              id="company"
              className="input"
              type="text"
              autoComplete="organization"
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              maxLength={200}
            />
          </Field>

          <Field id="name" label={t('calculator.name')} required>
            <input
              id="name"
              className="input"
              type="text"
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={120}
            />
          </Field>

          <PhoneField digits={phone} onChange={setPhone} />

          <Field id="email" label={t('calculator.email')} hint={t('calculator.emailHint')}>
            <input
              id="email"
              className="input"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              maxLength={200}
            />
          </Field>

          <ConsentCheckbox checked={consent} onChange={setConsent} />

          <SubmitError message={error} />

          <button type="submit" className="btn btn-block" disabled={!canSubmit}>
            {pending ? t('calculator.submitting') : t('calculator.submit')}
          </button>
        </form>
      </div>
    </section>
  );
}
