import { useState } from 'react';
import { Link } from 'react-router-dom';
import Counter from '../components/Counter';
import Faq from '../components/Faq';
import { AppRow, AppTabbar, Phone } from '../components/Phone';
import { useLocale, useT, useTn } from '../i18n';
import { PHOTO } from '../lib/photos';
import { formatSum } from '../lib/format';
import { revealDelay } from '../lib/reveal';
import { MASTERS } from '../lib/team';

/**
 * Параметры прикидки заработка — маркетинговый контент, не оферта.
 * Реальная доля зависит от уровня мастера, а поток заявок — от города и сезона.
 *
 * Диапазоны держим реалистичными: калькулятор, который умеет показать
 * «30 миллионов в месяц», выглядит как приманка и убивает доверие.
 */
const SHARE = 0.55;
const WORK_DAYS = 22;
const CHECK_MIN = 120_000;
const CHECK_MAX = 300_000;
const ORDERS_MIN = 2;
const ORDERS_MAX = 6;

/** Условия работы. Подписи — ключи словаря, порядок блоков не переводится. */
const TERMS = [
  { title: 'mastersPage.termShareTitle', text: 'mastersPage.termShareText' },
  { title: 'mastersPage.termWeeklyTitle', text: 'mastersPage.termWeeklyText' },
  { title: 'mastersPage.termFlowTitle', text: 'mastersPage.termFlowText' },
  { title: 'mastersPage.termScheduleTitle', text: 'mastersPage.termScheduleText' },
  { title: 'mastersPage.termTrainingTitle', text: 'mastersPage.termTrainingText' },
  /* Материалы в долг через партнёрские магазины — это фаза 2 (PRD-06 §3.5),
     на лендинге не обещаем, пока не работает. */
  { title: 'mastersPage.termDisputeTitle', text: 'mastersPage.termDisputeText' },
];

const REQUIREMENTS = [
  'mastersPage.reqTools',
  'mastersPage.reqExperience',
  'mastersPage.reqPhotos',
  'mastersPage.reqManners',
  'mastersPage.reqTransport',
];

const STEPS = [
  { title: 'mastersPage.stepFormTitle', text: 'mastersPage.stepFormText' },
  { title: 'mastersPage.stepCallTitle', text: 'mastersPage.stepCallText' },
  { title: 'mastersPage.stepCheckTitle', text: 'mastersPage.stepCheckText' },
  { title: 'mastersPage.stepFirstOrdersTitle', text: 'mastersPage.stepFirstOrdersText' },
];

const STORIES = [
  {
    id: 'ilhom',
    name: 'mastersPage.storyIlhomName',
    role: 'mastersPage.storyIlhomRole',
    photo: '/photos/masters/ilhom.webp',
    text: 'mastersPage.storyIlhomText',
  },
  {
    id: 'bekzod',
    name: 'mastersPage.storyBekzodName',
    role: 'mastersPage.storyBekzodRole',
    photo: '/photos/masters/bekzod.webp',
    text: 'mastersPage.storyBekzodText',
  },
  {
    id: 'rustam',
    name: 'mastersPage.storyRustamName',
    role: 'mastersPage.storyRustamRole',
    photo: '/photos/masters/rustam.webp',
    text: 'mastersPage.storyRustamText',
  },
];

const FAQ = [
  { q: 'mastersPage.faqEmploymentQ', a: 'mastersPage.faqEmploymentA' },
  { q: 'mastersPage.faqOrdersQ', a: 'mastersPage.faqOrdersA' },
  { q: 'mastersPage.faqMaterialsQ', a: 'mastersPage.faqMaterialsA' },
  { q: 'mastersPage.faqComplaintQ', a: 'mastersPage.faqComplaintA' },
  { q: 'mastersPage.faqTransportQ', a: 'mastersPage.faqTransportA' },
  { q: 'mastersPage.faqAnswerTimeQ', a: 'mastersPage.faqAnswerTimeA' },
];

export default function Masters() {
  const t = useT();
  const tn = useTn();
  const locale = useLocale();
  const [ordersPerDay, setOrdersPerDay] = useState(3);
  const [check, setCheck] = useState(180_000);
  const monthly = Math.floor((ordersPerDay * check * SHARE * WORK_DAYS) / 10_000) * 10_000;
  const checkPos = ((check - CHECK_MIN) / (CHECK_MAX - CHECK_MIN)) * 100;
  const ordersPos = ((ordersPerDay - ORDERS_MIN) / (ORDERS_MAX - ORDERS_MIN)) * 100;

  // Заголовок героя переводится целой фразой: выделенная часть отмечена в ней
  // подстановкой {mark} и на другом языке может стоять в другом месте
  const [titleBefore, titleAfter] = t('mastersPage.heroTitle').split('{mark}');

  return (
    <>
      {/* ===== Герой ===== */}
      <section className="hero">
        <div className="wrap">
          <div className="hero-grid">
            <div className="hero-copy">
              <span className="chip chip-dark chip-dot">{t('mastersPage.heroChip')}</span>
              <h1 className="display">
                {titleBefore}
                <span className="mark">{t('mastersPage.heroTitleMark')}</span>
                {titleAfter}
              </h1>
              <p className="lead">{t('mastersPage.heroLead')}</p>
              <div className="btn-row">
                <Link to="/apply" className="btn">
                  {t('mastersPage.applyCta')}
                </Link>
                <a href="#calc" className="btn btn-ghost">
                  {t('mastersPage.heroCalcLink')}
                </a>
              </div>
              <p className="hero-note">{t('mastersPage.heroNote')}</p>
            </div>

            <div className="hero-media">
              <div className="hero-photo">
                <img
                  src={PHOTO.electricPanel}
                  alt={t('mastersPage.heroPhotoAlt')}
                  width={1200}
                  height={900}
                  decoding="async"
                />
              </div>
              <div className="float-card float-card--status">
                <p className="float-title">{t('mastersPage.weekEarnings')}</p>
                <p className="float-value">{t('mastersPage.weekEarningsValue')}</p>
                <p className="float-title" style={{ marginTop: 6 }}>
                  {t('mastersPage.payoutMonday')}
                </p>
              </div>
              <div className="float-card float-card--price">
                <p className="float-title">{t('mastersPage.newOrderNear')}</p>
                <p className="float-value">{t('mastersPage.newOrderDistance')}</p>
              </div>
            </div>
          </div>

          <div className="hero-stats">
            <div>
              <p className="stat-value">
                {t('mastersPage.statSharePrefix')} <Counter to={57} suffix="%" />
              </p>
              <p className="stat-label">{t('mastersPage.statShareLabel')}</p>
            </div>
            <div>
              <p className="stat-value">{t('mastersPage.statPayoutValue')}</p>
              <p className="stat-label">{t('mastersPage.statPayoutLabel')}</p>
            </div>
            <div>
              <p className="stat-value">
                <Counter to={3} suffix="–6" />
              </p>
              <p className="stat-label">{t('mastersPage.statOrdersLabel')}</p>
            </div>
            <div>
              <p className="stat-value">{t('mastersPage.statLearningValue')}</p>
              <p className="stat-label">{t('mastersPage.statLearningLabel')}</p>
            </div>
          </div>
        </div>
      </section>

      {/* ===== Условия ===== */}
      <section className="section section-alt">
        <div className="wrap">
          <div className="section-head" data-reveal>
            <p className="eyebrow">{t('mastersPage.termsEyebrow')}</p>
            <h2 className="h2">{t('mastersPage.termsTitle')}</h2>
          </div>
          <div className="grid grid-3">
            {TERMS.map((term, i) => (
              <article
                key={term.title}
                className="card card-lift stack-sm"
                data-reveal
                style={revealDelay(i % 3)}
              >
                <span className="tile-mark" />
                <h3 className="h3">{t(term.title)}</h3>
                <p className="muted">{t(term.text)}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ===== Калькулятор ===== */}
      <section className="section" id="calc">
        <div className="wrap">
          <div className="grid-2" style={{ alignItems: 'center' }}>
            <div className="stack-lg" data-reveal>
              <div className="section-head">
                <p className="eyebrow">{t('mastersPage.calcEyebrow')}</p>
                <h2 className="h2">{t('mastersPage.calcTitle')}</h2>
                <p className="lead">{t('mastersPage.calcLead')}</p>
              </div>

              <div className="card stack-lg">
                <div className="field">
                  <label className="field-label" htmlFor="orders">
                    {t('mastersPage.calcOrdersLabel')} <strong>{ordersPerDay}</strong>
                  </label>
                  <input
                    id="orders"
                    className="range"
                    type="range"
                    min={ORDERS_MIN}
                    max={ORDERS_MAX}
                    step={1}
                    value={ordersPerDay}
                    style={{ ['--range-pos' as string]: `${ordersPos}%` }}
                    onChange={(e) => setOrdersPerDay(Number(e.target.value))}
                  />
                  <p className="field-hint">
                    {t('mastersPage.calcOrdersHint', {
                      orders: tn('mastersPage.ordersPerDay', ordersPerDay),
                      days: WORK_DAYS,
                    })}
                  </p>
                </div>

                <div className="field">
                  <label className="field-label" htmlFor="check">
                    {t('mastersPage.calcCheckLabel')}{' '}
                    <strong>
                      {formatSum(check, locale.tag)} {t('unit.sum')}
                    </strong>
                  </label>
                  <input
                    id="check"
                    className="range"
                    type="range"
                    min={CHECK_MIN}
                    max={CHECK_MAX}
                    step={10_000}
                    value={check}
                    style={{ ['--range-pos' as string]: `${checkPos}%` }}
                    onChange={(e) => setCheck(Number(e.target.value))}
                  />
                  <p className="field-hint">{t('mastersPage.calcCheckHint')}</p>
                </div>
              </div>
            </div>

            <div className="result stack" data-reveal>
              <div className="stack-sm">
                <p className="muted">{t('mastersPage.calcResultLead')}</p>
                <p className="result-value" aria-live="polite">
                  {t('mastersPage.calcResultValue', { sum: formatSum(monthly, locale.tag) })}
                </p>
              </div>
              <dl className="result-rows">
                <div className="result-row">
                  <span>{t('mastersPage.calcRowShare')}</span>
                  <span>{Math.round(SHARE * 100)}%</span>
                </div>
                <div className="result-row">
                  <span>{t('mastersPage.calcRowOrders')}</span>
                  <span>{ordersPerDay * WORK_DAYS}</span>
                </div>
                <div className="result-row">
                  <span>{t('mastersPage.calcRowPayouts')}</span>
                  <span>{t('mastersPage.calcRowPayoutsValue')}</span>
                </div>
              </dl>
              <p className="small muted">{t('mastersPage.calcNote')}</p>
              <div className="btn-row">
                <Link to="/apply" className="btn">
                  {t('mastersPage.applyCta')}
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ===== Приложение мастера ===== */}
      <section className="section section-alt">
        <div className="wrap">
          <div className="grid-2" style={{ alignItems: 'center' }}>
            <div className="stack-lg" data-reveal>
              <div className="section-head">
                <p className="eyebrow">{t('mastersPage.appEyebrow')}</p>
                <h2 className="h2">{t('mastersPage.appTitle')}</h2>
                <p className="lead">{t('mastersPage.appLead')}</p>
              </div>
              <ul className="stack-sm">
                <li className="tick">
                  <span>{t('mastersPage.appFeatureOrders')}</span>
                </li>
                <li className="tick">
                  <span>{t('mastersPage.appFeaturePrice')}</span>
                </li>
                <li className="tick">
                  <span>{t('mastersPage.appFeaturePhotos')}</span>
                </li>
                <li className="tick">
                  <span>{t('mastersPage.appFeatureEarnings')}</span>
                </li>
                <li className="tick">
                  <span>{t('mastersPage.appFeatureAndroid')}</span>
                </li>
              </ul>
            </div>

            <div data-reveal>
              <Phone label={t('mastersPage.phoneLabel')}>
                <AppRow
                  title={t('mastersPage.weekEarnings')}
                  sub={t('mastersPage.payoutMonday')}
                  badge={t('mastersPage.weekEarningsValue')}
                />
                <AppRow
                  title={t('mastersPage.appNewOrderTitle')}
                  sub={t('mastersPage.appNewOrderSub')}
                  badge={t('mastersPage.appTakeBadge')}
                  badgeTone="live"
                >
                  <span className="app-sub">{t('mastersPage.appNewOrderShare')}</span>
                </AppRow>
                <AppRow
                  title={t('mastersPage.appTodayTitle')}
                  sub={t('mastersPage.appTodaySub')}
                  badge={t('mastersPage.appTodayTime')}
                />
                <AppRow
                  title={t('mastersPage.appPhotosTitle')}
                  badge={t('mastersPage.appPhotosBadge')}
                  badgeTone="ok"
                >
                  <div className="app-photos">
                    <img className="app-photo" src={PHOTO.panelClose} alt="" loading="lazy" />
                    <img className="app-photo" src={PHOTO.electricPanel} alt="" loading="lazy" />
                  </div>
                </AppRow>
                <div className="app-cta">{t('mastersPage.appCta')}</div>
                <AppTabbar active={1} />
              </Phone>
            </div>
          </div>
        </div>
      </section>

      {/* ===== Истории мастеров ===== */}
      <section className="section">
        <div className="wrap">
          <div className="section-head" data-reveal>
            <p className="eyebrow">{t('mastersPage.storiesEyebrow')}</p>
            <h2 className="h2">{t('mastersPage.storiesTitle')}</h2>
          </div>
          <div className="grid grid-3">
            {STORIES.map((s, i) => (
              <article key={s.id} className="card stack" data-reveal style={revealDelay(i)}>
                <p className="review-quote">«{t(s.text)}»</p>
                <div className="review-who">
                  <img
                    src={s.photo}
                    alt={t(s.name)}
                    width={44}
                    height={44}
                    loading="lazy"
                    style={{
                      width: 48,
                      height: 48,
                      borderRadius: '50%',
                      objectFit: 'cover',
                      flex: 'none',
                    }}
                  />
                  <div>
                    <p className="tile-name" style={{ color: 'var(--text)' }}>
                      {t(s.name)}
                    </p>
                    <p className="small muted">{t(s.role)}</p>
                  </div>
                </div>
              </article>
            ))}
          </div>
          <p className="small muted" style={{ marginTop: 'var(--s16)' }}>
            {tn('mastersPage.directions', MASTERS.length)}
          </p>
        </div>
      </section>

      {/* ===== Требования и шаги ===== */}
      <section className="section section-alt">
        <div className="wrap">
          <div className="grid-2">
            <div className="stack-lg" data-reveal>
              <div className="section-head">
                <p className="eyebrow">{t('mastersPage.reqEyebrow')}</p>
                <h2 className="h2">{t('mastersPage.reqTitle')}</h2>
              </div>
              <ul className="stack-sm">
                {REQUIREMENTS.map((r) => (
                  <li key={r} className="tick">
                    <span>{t(r)}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <div className="section-head" data-reveal>
                <p className="eyebrow">{t('mastersPage.stepsEyebrow')}</p>
                <h2 className="h2">{t('mastersPage.stepsTitle')}</h2>
              </div>
              <ol>
                {STEPS.map((s, i) => (
                  <li className="flow-item" key={s.title} data-reveal style={revealDelay(i)}>
                    <div className="flow-head">
                      <span className="num">{i + 1}</span>
                      <h3 className="h3">{t(s.title)}</h3>
                    </div>
                    <p className="muted">{t(s.text)}</p>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </div>
      </section>

      {/* ===== Реферальная программа ===== */}
      <section className="section">
        <div className="wrap">
          <div className="card card-accent stack" data-reveal>
            <span className="badge">{t('mastersPage.referralBadge')}</span>
            <h2 className="h2">{t('mastersPage.referralTitle')}</h2>
            <p className="lead" style={{ color: 'var(--text)' }}>
              {t('mastersPage.referralLead')}
            </p>
            <p className="small muted">{t('mastersPage.referralNote')}</p>
          </div>
        </div>
      </section>

      {/* ===== FAQ ===== */}
      <section className="section section-alt">
        <div className="wrap">
          <div className="section-head" data-reveal>
            <p className="eyebrow">{t('mastersPage.faqEyebrow')}</p>
            <h2 className="h2">{t('mastersPage.faqTitle')}</h2>
          </div>
          <div data-reveal>
            <Faq items={FAQ.map((item) => ({ q: t(item.q), a: t(item.a) }))} />
          </div>
        </div>
      </section>

      {/* ===== CTA ===== */}
      <section className="section-lg section-dark">
        <div className="wrap">
          <div className="stack-lg" style={{ maxWidth: '54ch' }} data-reveal>
            <h2 className="h1">{t('mastersPage.ctaTitle')}</h2>
            <p className="lead">{t('mastersPage.ctaLead')}</p>
            <div className="btn-row">
              <Link to="/apply" className="btn">
                {t('mastersPage.applyCta')}
              </Link>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
