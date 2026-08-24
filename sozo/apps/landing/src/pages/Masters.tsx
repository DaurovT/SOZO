import { Link } from 'react-router-dom';
import Faq from '../components/Faq';
import { AppRow, AppTabbar, Phone } from '../components/Phone';
import { useT, useTn } from '../i18n';
import { PHOTO } from '../lib/photos';
import { revealDelay } from '../lib/reveal';
import { DISPATCH_TEL_DISPLAY, DISPATCH_TEL_HREF } from '../lib/contacts';
import { MASTERS } from '../lib/team';

/** Условия работы. Подписи — ключи словаря, порядок блоков не переводится. */
const TERMS = [
  { title: 'mastersPage.termFlowTitle', text: 'mastersPage.termFlowText' },
  { title: 'mastersPage.termScheduleTitle', text: 'mastersPage.termScheduleText' },
  { title: 'mastersPage.termShareTitle', text: 'mastersPage.termShareText' },
  { title: 'mastersPage.termWeeklyTitle', text: 'mastersPage.termWeeklyText' },
  { title: 'mastersPage.termTrainingTitle', text: 'mastersPage.termTrainingText' },
  /* Материалы в долг через партнёрские магазины — это фаза 2 (PRD-06 §3.5),
     на лендинге не обещаем, пока не работает. */
  { title: 'mastersPage.termDisputeTitle', text: 'mastersPage.termDisputeText' },
];

/* Заработок словами: три вопроса, которые мастер задаёт вслух. */
const MONEY = [
  { title: 'mastersPage.moneyOrdersTitle', text: 'mastersPage.moneyOrdersText' },
  { title: 'mastersPage.moneyShareTitle', text: 'mastersPage.moneyShareText' },
  { title: 'mastersPage.moneyPayoutTitle', text: 'mastersPage.moneyPayoutText' },
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
  { q: 'mastersPage.faqCombineQ', a: 'mastersPage.faqCombineA' },
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
                <a href={DISPATCH_TEL_HREF} className="btn btn-ghost">
                  {DISPATCH_TEL_DISPLAY}
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
                <p className="float-title">{t('mastersPage.payoutCardTitle')}</p>
                <p className="float-value">{t('mastersPage.payoutCardValue')}</p>
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
                {t('mastersPage.statSharePrefix')} 57%
              </p>
              <p className="stat-label">{t('mastersPage.statShareLabel')}</p>
            </div>
            <div>
              <p className="stat-value">{t('mastersPage.statPayoutValue')}</p>
              <p className="stat-label">{t('mastersPage.statPayoutLabel')}</p>
            </div>
            <div>
              <p className="stat-value">
                3–6
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

      {/* ===== Заработок ===== */}
      {/*
        Здесь стоял калькулятор с двумя ползунками. Он показывал крупную сумму
        и тут же забирал её обратно оговоркой — выглядело как обещание,
        читалось как отговорка. Три карточки вместо него объясняют, из чего
        доход складывается: сколько заявок, какая доля, когда деньги.
      */}
      <section className="section" id="money">
        <div className="wrap">
          <div className="section-head" data-reveal>
            <p className="eyebrow">{t('mastersPage.moneyEyebrow')}</p>
            <h2 className="h2">{t('mastersPage.moneyTitle')}</h2>
            <p className="lead">{t('mastersPage.moneyLead')}</p>
          </div>

          <div className="grid grid-3">
            {MONEY.map((m, i) => (
              <article
                key={m.title}
                className="card card-lift stack-sm"
                data-reveal
                style={revealDelay(i)}
              >
                <h3 className="h3">{t(m.title)}</h3>
                <p className="muted">{t(m.text)}</p>
              </article>
            ))}
          </div>

          <p className="small muted" style={{ marginTop: 'var(--s24)', maxWidth: '68ch' }}>
            {t('mastersPage.moneyHonest')}
          </p>

          <div className="btn-row" style={{ marginTop: 'var(--s24)' }}>
            <Link to="/apply" className="btn btn-auto">
              {t('mastersPage.applyCta')}
            </Link>
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
                  badge={t('mastersPage.appWeekSum')}
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
