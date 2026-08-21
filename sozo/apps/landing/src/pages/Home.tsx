import { Link } from 'react-router-dom';
import { fetchPrices } from '../api';
import AppShowcase from '../components/AppShowcase';
import BeforeAfter from '../components/BeforeAfter';
import Counter from '../components/Counter';
import Faq from '../components/Faq';
import Marquee from '../components/Marquee';
import MasterRail from '../components/MasterRail';
import StoreButtons from '../components/StoreButtons';
import { useLocale, useT, useTn } from '../i18n';
import { displayCategory, FALLBACK_CATEGORIES, zoneLabel } from '../lib/catalog';
import { DISPATCH_TEL_DISPLAY, DISPATCH_TEL_HREF } from '../lib/contacts';
import { formatTiyin } from '../lib/format';
import { categoryPhoto, PHOTO } from '../lib/photos';
import { revealDelay } from '../lib/reveal';
import { useSla } from '../lib/sla';
import { MASTERS } from '../lib/team';
import { useResource } from '../lib/useResource';

/* Цифры витрины ведёт маркетинг (контент, не договор). Перед запуском —
   сверить с фактическими показателями системы. */
const FACTS = [
  'home.factOnTime',
  'home.factPriceUpfront',
  'home.factPhotos',
  'home.factWarranty',
  'home.factEmergency',
  'home.factPayment',
];

const USP = [
  { titleKey: 'home.uspTimeTitle', textKey: 'home.uspTimeText' },
  { titleKey: 'home.uspPriceTitle', textKey: 'home.uspPriceText' },
  { titleKey: 'home.uspPhotoTitle', textKey: 'home.uspPhotoText' },
  { titleKey: 'home.uspWarrantyTitle', textKey: 'home.uspWarrantyText' },
];

const STEPS = [
  { titleKey: 'home.stepRequestTitle', textKey: 'home.stepRequestText' },
  { titleKey: 'home.stepDealTitle', textKey: 'home.stepDealText' },
  { titleKey: 'home.stepVisitTitle', textKey: 'home.stepVisitText' },
  { titleKey: 'home.stepActTitle', textKey: 'home.stepActText' },
];

/* Район хранится русской строкой — подпись берётся через `zoneLabel`, как и
   везде на сайте: имя собственное на каждом языке пишется своей графикой. */
const REVIEWS = [
  {
    nameKey: 'home.reviewDilnozaName',
    initialKey: 'home.reviewDilnozaInitial',
    textKey: 'home.reviewDilnozaText',
    zone: 'Юнусабад',
  },
  {
    nameKey: 'home.reviewSergeyName',
    initialKey: 'home.reviewSergeyInitial',
    textKey: 'home.reviewSergeyText',
    zone: 'Мирабад',
  },
  {
    nameKey: 'home.reviewAzizaName',
    initialKey: 'home.reviewAzizaInitial',
    textKey: 'home.reviewAzizaText',
    zone: 'Чиланзар',
  },
  {
    nameKey: 'home.reviewBotirName',
    initialKey: 'home.reviewBotirInitial',
    textKey: 'home.reviewBotirText',
    zone: 'Сергели',
  },
];

const FAQ = [
  { qKey: 'home.faqVisitQ', aKey: 'home.faqVisitA' },
  { qKey: 'home.faqPriceQ', aKey: 'home.faqPriceA' },
  { qKey: 'home.faqEmergencyQ', aKey: 'home.faqEmergencyA' },
  { qKey: 'home.faqMastersQ', aKey: 'home.faqMastersA' },
  { qKey: 'home.faqNoAppQ', aKey: 'home.faqNoAppA' },
  { qKey: 'home.faqPaymentQ', aKey: 'home.faqPaymentA' },
];

/* ---------- Плитки категорий с ценами «от» ---------- */

function CategoryTiles() {
  const t = useT();
  const locale = useLocale();
  const prices = useResource(fetchPrices, []);

  // Деградация (PRD-06 §3): если публичный API недоступен — плитки без цен.
  const items =
    prices.status === 'ready'
      ? prices.data.categories.map((c) => ({ name: c.category, price: c.priceFromTiyin }))
      : FALLBACK_CATEGORIES.map((name) => ({ name, price: null }));

  return (
    <div className="stack-lg">
      <div className="grid-tiles">
        {items.map((item, i) => (
          <Link
            key={item.name}
            to={`/order?category=${encodeURIComponent(item.name)}`}
            className="tile"
            data-reveal
            style={revealDelay(i % 4)}
          >
            <img
              className="tile-img"
              src={categoryPhoto(item.name, i)}
              alt=""
              loading="lazy"
              decoding="async"
            />
            <span className="tile-mark" />
            <span className="tile-name">{displayCategory(item.name, t)}</span>
            <span className="tile-price">
              {item.price !== null ? (
                <>
                  {t('home.priceFrom')}{' '}
                  <strong>{formatTiyin(item.price, locale.tag, t('unit.sum'))}</strong>
                </>
              ) : (
                t('home.priceOnCall')
              )}
            </span>
          </Link>
        ))}
      </div>
      <p className="small muted">
        {prices.status === 'ready' ? prices.data.note : t('home.pricesNote')}
      </p>
    </div>
  );
}

/* ---------- Страница ---------- */

export default function Home() {
  const t = useT();
  const tn = useTn();
  const sla = useSla();

  return (
    <>
      {/* ===== Герой ===== */}
      <section className="hero">
        <div className="wrap">
          <div className="hero-grid">
            <div className="hero-copy">
              <span className="chip chip-dark chip-dot">{t('home.heroChip')}</span>
              <h1 className="display">
                {t('home.heroTitle')} <span className="mark">{t('home.heroTitleMark')}</span>
              </h1>
              <p className="lead">{t('home.heroLead')}</p>
              <div className="btn-row">
                <Link to="/order" className="btn">
                  {t('home.callMaster')}
                </Link>
                <a href={DISPATCH_TEL_HREF} className="btn btn-ghost">
                  {DISPATCH_TEL_DISPLAY}
                </a>
              </div>
              <p className="hero-note">{t('home.heroNote')}</p>
            </div>

            <div className="hero-media">
              <div className="hero-photo">
                <img
                  src={PHOTO.heroMain}
                  alt={t('home.heroPhotoAlt')}
                  width={1600}
                  height={1200}
                  fetchPriority="high"
                  decoding="async"
                />
              </div>

              <div className="float-card float-card--status">
                <p className="float-title">{t('home.heroOrderTitle')}</p>
                <p className="float-value">{t('home.heroOrderStatus')}</p>
                <div className="progress" aria-hidden="true">
                  <span />
                </div>
                <p className="float-title" style={{ marginTop: 6 }}>
                  {t('home.heroOrderEta')}
                </p>
              </div>

              <div className="float-card float-card--price">
                <p className="float-title">{t('home.heroQuoteTitle')}</p>
                <p className="float-value">{t('home.heroQuoteValue')}</p>
              </div>
            </div>
          </div>

          <div className="hero-stats">
            <div>
              <p className="stat-value">
                <Counter to={10} format={(v) => tn('home.statMinutes', v)} />
              </p>
              <p className="stat-label">{t('home.statCallback')}</p>
            </div>
            <div>
              <p className="stat-value">
                <Counter to={30} format={(v) => tn('home.statDays', v)} />
              </p>
              <p className="stat-label">{t('home.statWarranty')}</p>
            </div>
            <div>
              <p className="stat-value">24/7</p>
              <p className="stat-label">{t('home.statEmergency')}</p>
            </div>
            <div>
              <p className="stat-value">
                <Counter to={2} format={(v) => tn('home.statHours', v)} />
              </p>
              <p className="stat-label">{t('home.statWindow')}</p>
            </div>
          </div>
        </div>
      </section>

      <Marquee items={FACTS.map((key) => t(key))} />

      {/* ===== Категории ===== */}
      <section className="section section-alt" id="services">
        <div className="wrap">
          <div className="head-row">
            <div className="section-head" data-reveal>
              <p className="eyebrow">{t('home.servicesEyebrow')}</p>
              <h2 className="h2">{t('home.servicesTitle')}</h2>
              <p className="lead">{t('home.servicesLead')}</p>
            </div>
            <a href={DISPATCH_TEL_HREF} className="link-action">
              {t('home.servicesCallLink')}
            </a>
          </div>
          <CategoryTiles />
        </div>
      </section>

      {/* ===== Почему мы ===== */}
      <section className="section">
        <div className="wrap">
          <div className="section-head" data-reveal>
            <p className="eyebrow">{t('home.uspEyebrow')}</p>
            <h2 className="h2">{t('home.uspTitle')}</h2>
          </div>
          <div className="grid grid-4">
            {USP.map((u, i) => (
              <article
                key={u.titleKey}
                className="card card-lift stack-sm"
                data-reveal
                style={revealDelay(i)}
              >
                <p className="usp-num">0{i + 1}</p>
                <h3 className="h3">{t(u.titleKey)}</h3>
                <p className="muted">{t(u.textKey)}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ===== Как это работает ===== */}
      <section className="section section-alt">
        <div className="wrap">
          <div className="grid-2">
            <div className="sticky-col" data-reveal>
              <div className="section-head">
                <p className="eyebrow">{t('home.stepsEyebrow')}</p>
                <h2 className="h2">{t('home.stepsTitle')}</h2>
                <p className="lead">{t('home.stepsLead')}</p>
              </div>
              <div className="btn-row">
                <Link to="/order" className="btn">
                  {t('home.stepsCta')}
                </Link>
              </div>
            </div>

            <ol>
              {STEPS.map((s, i) => (
                <li className="flow-item" key={s.titleKey} data-reveal style={revealDelay(i)}>
                  <div className="flow-head">
                    <span className="num">{i + 1}</span>
                    <h3 className="h3">{t(s.titleKey)}</h3>
                  </div>
                  <p className="muted">{t(s.textKey)}</p>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </section>

      {/* ===== До / после ===== */}
      <section className="section">
        <div className="wrap">
          <div className="grid-2" style={{ alignItems: 'center' }}>
            <div className="stack-lg" data-reveal>
              <div className="section-head">
                <p className="eyebrow">{t('home.photoEyebrow')}</p>
                <h2 className="h2">{t('home.photoTitle')}</h2>
                <p className="lead">{t('home.photoLead')}</p>
              </div>
              <ul className="stack-sm">
                <li className="tick">
                  <span>{t('home.photoPointAuthentic')}</span>
                </li>
                <li className="tick">
                  <span>{t('home.photoPointAct')}</span>
                </li>
                <li className="tick">
                  <span>{t('home.photoPointHistory')}</span>
                </li>
              </ul>
              <p className="small muted">{t('home.photoHint')}</p>
            </div>

            <div data-reveal>
              <BeforeAfter
                before={PHOTO.beforeShot}
                after={PHOTO.afterShot}
                alt={t('home.photoAlt')}
              />
            </div>
          </div>
        </div>
      </section>

      {/* ===== Мастера ===== */}
      <section className="section section-dark">
        <div className="wrap">
          <div className="head-row">
            <div className="section-head" data-reveal>
              <p className="eyebrow">{t('home.mastersEyebrow')}</p>
              <h2 className="h2">{t('home.mastersTitle')}</h2>
              <p className="lead">{t('home.mastersLead')}</p>
            </div>
            <Link to="/masters" className="link-action">
              {t('home.mastersJoinLink')}
            </Link>
          </div>
          <div data-reveal>
            <MasterRail masters={MASTERS} />
          </div>
          <p className="small muted">{t('home.mastersHint')}</p>
        </div>
      </section>

      {/* ===== Приложения ===== */}
      <section className="section section-alt" id="app">
        <div className="wrap">
          <div className="section-head" data-reveal>
            <p className="eyebrow">{t('home.appEyebrow')}</p>
            <h2 className="h2">{t('home.appTitle')}</h2>
            <p className="lead">{t('home.appLead')}</p>
          </div>
          <div data-reveal>
            <AppShowcase />
          </div>
          <div style={{ marginTop: 'var(--s32)' }}>
            <StoreButtons />
          </div>
        </div>
      </section>

      {/* ===== Отзывы ===== */}
      <section className="section">
        <div className="wrap">
          <div className="section-head" data-reveal>
            <p className="eyebrow">{t('home.reviewsEyebrow')}</p>
            <h2 className="h2">{t('home.reviewsTitle')}</h2>
          </div>
          <div className="reviews-rail">
            {REVIEWS.map((r) => (
              <article className="review" key={r.nameKey}>
                <p className="review-stars" aria-label={t('home.reviewsRating')}>
                  ★★★★★
                </p>
                <p className="review-quote">{t(r.textKey)}</p>
                <div className="review-who">
                  <span className="review-avatar" aria-hidden="true">
                    {t(r.initialKey)}
                  </span>
                  <div>
                    <p className="tile-name" style={{ color: 'var(--text)' }}>
                      {t(r.nameKey)}
                    </p>
                    <p className="small muted">{zoneLabel(r.zone, t)}</p>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ===== Авария ===== */}
      <section className="section">
        <div className="wrap">
          <div className="emergency stack" data-reveal>
            <p className="eyebrow" style={{ color: 'var(--on-dark-secondary)' }}>
              <span className="pulse-dot" aria-hidden="true" />
              {t('home.emergencyEyebrow')}
            </p>
            <h2 className="h2">{t('home.emergencyTitle')}</h2>
            <p>{t('home.emergencyText')}</p>
            <a className="emergency-tel" href={DISPATCH_TEL_HREF}>
              {DISPATCH_TEL_DISPLAY}
            </a>
          </div>
        </div>
      </section>

      {/* ===== Тизеры B2B и мастерам ===== */}
      <section className="section">
        <div className="wrap">
          <div className="section-head" data-reveal>
            <p className="eyebrow">{t('home.teasersEyebrow')}</p>
            <h2 className="h2">{t('home.teasersTitle')}</h2>
          </div>
          <div className="split">
            <Link to="/business" className="split-card" data-reveal>
              <img src={PHOTO.roofHvac} alt="" loading="lazy" decoding="async" />
              <span className="badge">{t('home.businessBadge')}</span>
              <h3 className="h2" style={{ marginTop: 'var(--s12)' }}>
                {t('home.businessTitle')}
              </h3>
              <div className="split-list">
                <span>{t('home.businessPointSla')}</span>
                <span>{t('home.businessPointFee')}</span>
                <span>{t('home.businessPointReport')}</span>
              </div>
              <span className="link-action" style={{ color: 'var(--on-dark)' }}>
                {t('home.businessLink')}
              </span>
            </Link>

            <Link to="/masters" className="split-card" data-reveal style={revealDelay(1)}>
              <img src={PHOTO.electricPanel} alt="" loading="lazy" decoding="async" />
              <span className="badge">{t('home.mastersBadge')}</span>
              <h3 className="h2" style={{ marginTop: 'var(--s12)' }}>
                {t('home.mastersCardTitle')}
              </h3>
              <div className="split-list">
                <span>{t('home.mastersPointFlow')}</span>
                <span>{t('home.mastersPointPay')}</span>
                <span>{t('home.mastersPointSchedule')}</span>
              </div>
              <span className="link-action" style={{ color: 'var(--on-dark)' }}>
                {t('home.mastersCardLink')}
              </span>
            </Link>
          </div>
        </div>
      </section>

      {/* ===== FAQ ===== */}
      <section className="section section-alt">
        <div className="wrap">
          <div className="section-head" data-reveal>
            <p className="eyebrow">{t('home.faqEyebrow')}</p>
            <h2 className="h2">{t('home.faqTitle')}</h2>
          </div>
          <div data-reveal>
            <Faq items={FAQ.map((item) => ({ q: t(item.qKey), a: t(item.aKey) }))} />
          </div>
        </div>
      </section>

      {/* ===== Финальный CTA ===== */}
      <section className="section-lg section-dark">
        <div className="wrap">
          <div className="stack-lg" style={{ maxWidth: '56ch' }} data-reveal>
            <h2 className="h1">{t('home.finalTitle')}</h2>
            <p className="lead">{t('home.finalLead', { sla: sla(undefined, 10) })}</p>
            <div className="btn-row">
              <Link to="/order" className="btn">
                {t('home.callMaster')}
              </Link>
              <a href={DISPATCH_TEL_HREF} className="btn btn-ghost">
                {t('home.callNumber', { phone: DISPATCH_TEL_DISPLAY })}
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* Липкая панель звонка — только на мобильном (CSS скрывает от 1000px). */}
      <div className="sticky-call">
        <a href={DISPATCH_TEL_HREF} className="btn btn-ghost">
          {t('home.call')}
        </a>
        <Link to="/order" className="btn">
          {t('home.callMaster')}
        </Link>
      </div>
      <div className="sticky-call-spacer" aria-hidden="true" />
    </>
  );
}
