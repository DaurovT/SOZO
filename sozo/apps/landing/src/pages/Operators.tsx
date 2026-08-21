import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { ConsentCheckbox, Done, Field, Honeypot, PhoneField, SubmitError } from '../components/form';
import { useLocale, useT } from '../i18n';
import { DISPATCH_TEL_DISPLAY, DISPATCH_TEL_HREF } from '../lib/contacts';
import { formatSum } from '../lib/format';
import { isPhoneValid, toE164 } from '../lib/phone';
import { revealDelay } from '../lib/reveal';
import { useLeadSubmit } from '../lib/useLeadSubmit';

/**
 * L-09. Лендинг для эксплуатирующих организаций (PRD-06 §3.9).
 *
 * Задача страницы — довести до самостоятельного подключения на бесплатном
 * тарифе, а не до звонка менеджера. Если ради согласования допусков нужно
 * пройти менеджера, КП и подписание, никто не подключится и чокпоинт
 * не образуется.
 *
 * Калькулятор здесь считает ДОХОД, а не расход — единственная такая страница
 * в пакете.
 */

/** Сегменты в переключателе. `api` уезжает в лид и потому остаётся русским —
 *  переводится только подпись (ключи словаря рядом). */
const SEGMENTS = [
  {
    key: 'bc',
    api: 'Бизнес-центр',
    tabKey: 'operators.segmentBcTab',
    headlineKey: 'operators.segmentBcHeadline',
    textKey: 'operators.segmentBcText',
  },
  {
    key: 'inhouse',
    api: 'Свой техотдел',
    tabKey: 'operators.segmentInhouseTab',
    headlineKey: 'operators.segmentInhouseHeadline',
    textKey: 'operators.segmentInhouseText',
  },
  {
    key: 'hoa',
    api: 'УК и ТСЖ',
    tabKey: 'operators.segmentHoaTab',
    headlineKey: 'operators.segmentHoaHeadline',
    textKey: 'operators.segmentHoaText',
  },
  {
    key: 'fm',
    api: 'FM-подрядчик',
    tabKey: 'operators.segmentFmTab',
    headlineKey: 'operators.segmentFmHeadline',
    textKey: 'operators.segmentFmText',
  },
];

const FREE = [
  'operators.freeAdmission',
  'operators.freeRequests',
  'operators.freeNotices',
  'operators.freePasses',
  'operators.freeFirstRight',
  'operators.freeFee',
];

const PRO = [
  'operators.proMasters',
  'operators.proSla',
  'operators.proDebt',
  'operators.proPassport',
  'operators.proReports',
];

/** Шаги подключения: подпись жирным + продолжение фразы */
const STEPS = [
  { titleKey: 'operators.step1Title', textKey: 'operators.step1Text' },
  { titleKey: 'operators.step2Title', textKey: 'operators.step2Text' },
  { titleKey: 'operators.step3Title', textKey: 'operators.step3Text' },
  { titleKey: 'operators.step4Title', textKey: 'operators.step4Text' },
];

/** Ставка сбора по умолчанию — 5% (параметр 124) */
const FEE_RATE = 0.05;
/** Оценка среднего чека частной заявки, сум */
const AVG_ORDER = 250_000;
/** Оценка доли квартир, заказывающих работы в месяц */
const ORDERS_PER_UNIT = 0.08;
/** Тариф «Подписка», сум за объект в месяц */
const SUBSCRIPTION_PRICE = 3_000_000;

export default function Operators() {
  const t = useT();
  const locale = useLocale();
  const [tab, setTab] = useState(0);
  const [units, setUnits] = useState(300);

  const [company, setCompany] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [objects, setObjects] = useState(1);
  const [consent, setConsent] = useState(false);
  const [honeypot, setHoneypot] = useState('');
  const { pending, error, result, submit } = useLeadSubmit();

  const monthly = Math.round(units * ORDERS_PER_UNIT * AVG_ORDER * FEE_RATE);
  const segment = SEGMENTS[tab];

  const canSubmit =
    isPhoneValid(phone) && consent && company.trim() !== '' && name.trim() !== '' && !pending;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    // Идёт как b2b-лид: у эксплуатирующей организации те же поля, что у сети
    // точек, а отдельный вид лида потребовал бы своей ветки на бэкенде
    await submit(
      {
        kind: 'b2b',
        phone: toE164(phone),
        consent: true,
        name: name.trim(),
        company: company.trim(),
        pointsCount: objects,
        objectType: segment.api,
      },
      honeypot,
    );
  }

  if (result) {
    return (
      <Done
        title={t('operators.doneTitle')}
        lead={t('operators.doneLead')}
        ticket={result.ticket}
      >
        <div className="btn-row">
          <Link to="/" className="btn btn-secondary">{t('operators.backHome')}</Link>
        </div>
      </Done>
    );
  }

  return (
    <>
      <section className="hero">
        <div className="wrap stack-lg">
          <div className="stack" data-reveal>
            <p className="eyebrow" style={revealDelay(0)}>{t('operators.heroEyebrow')}</p>
            <h1 className="display" style={revealDelay(1)}>
              {t('operators.heroTitle')} <span className="mark">{t('operators.heroTitleMark')}</span>
            </h1>
            <p className="lead" style={revealDelay(2)}>
              {t('operators.heroLead')}
            </p>
            <div className="btn-row" style={revealDelay(3)}>
              <a className="btn" href="#connect">{t('operators.heroCta')}</a>
              <a className="btn btn-ghost" href={DISPATCH_TEL_HREF}>{DISPATCH_TEL_DISPLAY}</a>
            </div>
          </div>
        </div>
      </section>

      <section className="section section-alt">
        <div className="wrap stack-lg">
          <div className="tabs" data-reveal>
            {SEGMENTS.map((s, i) => (
              <button
                key={s.key}
                className={`tab${i === tab ? ' is-on' : ''}`}
                onClick={() => setTab(i)}
                type="button"
              >
                {t(s.tabKey)}
              </button>
            ))}
          </div>
          <div className="tabpanel stack" data-reveal>
            <h2 className="h2">{t(segment.headlineKey)}</h2>
            <p className="lead">{t(segment.textKey)}</p>
          </div>
        </div>
      </section>

      <section className="section section-soft">
        <div className="wrap stack-lg">
          <div className="section-head" data-reveal>
            <p className="eyebrow">{t('operators.incomeEyebrow')}</p>
            <h2 className="h2">{t('operators.incomeTitle')}</h2>
          </div>
          <p className="lead">
            {t('operators.incomeLead', { fee: Math.round(FEE_RATE * 100) })}
          </p>

          <div className="field">
            <label className="field-label" htmlFor="units">
              {t('operators.unitsLabel')} <b>{units}</b>
            </label>
            <input
              id="units"
              className="range"
              type="range"
              min={20}
              max={1200}
              step={10}
              value={units}
              onChange={(e) => setUnits(Number(e.target.value))}
            />
          </div>

          <div className="result stack">
            <div className="stack-sm">
              <p className="muted">{t('operators.incomeCaption')}</p>
              <p className="result-value">
                {t('operators.incomeValue', { sum: formatSum(monthly, locale.tag) })}
              </p>
            </div>
          </div>
          <p className="small muted">
            {t('operators.incomeNote', {
              avg: formatSum(AVG_ORDER, locale.tag),
              share: Math.round(ORDERS_PER_UNIT * 100),
            })}
          </p>
          <p className="small muted">
            {t('operators.subscriptionNote', { price: formatSum(SUBSCRIPTION_PRICE, locale.tag) })}
          </p>
        </div>
      </section>

      <section className="section">
        <div className="wrap stack-lg">
          <div className="grid grid-2" data-reveal>
            <article className="card stack">
              <h3 className="h3">{t('operators.freeTitle')}</h3>
              <ul className="split-list">
                {FREE.map((f) => <li key={f}>{t(f)}</li>)}
              </ul>
            </article>
            <article className="card stack">
              <h3 className="h3">{t('operators.proTitle')}</h3>
              <ul className="split-list">
                {PRO.map((f) => <li key={f}>{t(f)}</li>)}
              </ul>
            </article>
          </div>
        </div>
      </section>

      <section className="section section-alt">
        <div className="wrap stack-lg">
          <div className="section-head" data-reveal>
            <h2 className="h2">{t('operators.stepsTitle')}</h2>
          </div>
          <ol className="stack" data-reveal>
            {STEPS.map((s) => (
              <li key={s.titleKey}>
                <b>{t(s.titleKey)}</b> {t(s.textKey)}
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="section" id="connect">
        <div className="wrap stack-lg">
          <div className="section-head">
            <h2 className="h2">{t('operators.formTitle')}</h2>
            <p className="lead">
              {t('operators.formLead')}
            </p>
          </div>

          <form className="stack-lg" onSubmit={onSubmit} noValidate>
            <Honeypot value={honeypot} onChange={setHoneypot} />

            <Field id="company" label={t('operators.fieldCompany')} required>
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

            <Field id="name" label={t('operators.fieldName')} required>
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

            <Field id="objects" label={t('operators.fieldObjects')} required>
              <input
                id="objects"
                className="input"
                type="number"
                min={1}
                max={999}
                value={objects}
                onChange={(e) => setObjects(Math.max(1, Math.min(999, Number(e.target.value) || 1)))}
              />
            </Field>

            <ConsentCheckbox checked={consent} onChange={setConsent} />
            <SubmitError message={error} />

            <button type="submit" className="btn btn-block" disabled={!canSubmit}>
              {pending ? t('operators.submitting') : t('operators.submit')}
            </button>
          </form>
        </div>
      </section>
    </>
  );
}
