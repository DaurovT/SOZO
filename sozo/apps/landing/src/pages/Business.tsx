import { Link } from 'react-router-dom';
import Counter from '../components/Counter';
import Faq from '../components/Faq';
import { AppRow, AppTabbar, Phone } from '../components/Phone';
import { useT, useTn } from '../i18n';
import { DISPATCH_TEL_DISPLAY, DISPATCH_TEL_HREF } from '../lib/contacts';
import { PHOTO } from '../lib/photos';
import { revealDelay } from '../lib/reveal';

/** Сегменты, подходящие под обслуживание. В списках держим ключи, не текст. */
const SEGMENTS = [
  'business.segmentPharmacies',
  'business.segmentShops',
  'business.segmentCafes',
  'business.segmentOffices',
  'business.segmentSalons',
  'business.segmentClinics',
  'business.segmentPickup',
  'business.segmentHotels',
];

const PAINS = [
  { title: 'business.painStaffTitle', text: 'business.painStaffText' },
  { title: 'business.painRandomTitle', text: 'business.painRandomText' },
  { title: 'business.painMoneyTitle', text: 'business.painMoneyText' },
];

const OFFER = [
  { title: 'business.offerContractTitle', text: 'business.offerContractText' },
  { title: 'business.offerSlaTitle', text: 'business.offerSlaText' },
  { title: 'business.offerPhotoTitle', text: 'business.offerPhotoText' },
  { title: 'business.offerBudgetTitle', text: 'business.offerBudgetText' },
  { title: 'business.offerInspectionTitle', text: 'business.offerInspectionText' },
  { title: 'business.offerBacklogTitle', text: 'business.offerBacklogText' },
];

const CABINET_POINTS = [
  'business.cabinetPointRequest',
  'business.cabinetPointEmergency',
  'business.cabinetPointReport',
  'business.cabinetPointActs',
  'business.cabinetPointBalance',
];

const START = [
  { title: 'business.startRequestTitle', text: 'business.startRequestText' },
  { title: 'business.startSurveyTitle', text: 'business.startSurveyText' },
  { title: 'business.startOfferTitle', text: 'business.startOfferText' },
  { title: 'business.startContractTitle', text: 'business.startContractText' },
];

const FAQ = [
  { q: 'business.faqIncludedQ', a: 'business.faqIncludedA' },
  { q: 'business.faqTwoSitesQ', a: 'business.faqTwoSitesA' },
  { q: 'business.faqLateQ', a: 'business.faqLateA' },
  { q: 'business.faqMaterialsQ', a: 'business.faqMaterialsA' },
  { q: 'business.faqContractQ', a: 'business.faqContractA' },
  { q: 'business.faqTrialQ', a: 'business.faqTrialA' },
];

function Mock(props: { caption: string; children: React.ReactNode }) {
  return (
    <figure className="mock">
      <div className="mock-canvas">{props.children}</div>
      <figcaption className="mock-caption">{props.caption}</figcaption>
    </figure>
  );
}

export default function Business() {
  const t = useT();
  const tn = useTn();

  return (
    <>
      {/* ===== Герой ===== */}
      <section className="hero">
        <div className="wrap">
          <div className="hero-grid">
            <div className="hero-copy">
              <span className="chip chip-dark chip-dot">{t('business.heroChip')}</span>
              <h1 className="display">
                {t('business.heroTitleLead')}{' '}
                <span className="mark">{t('business.heroTitleMark')}</span>
              </h1>
              <p className="lead">{t('business.heroLead')}</p>
              <div className="btn-row">
                <Link to="/calculator" className="btn">
                  {t('business.heroCalcCta')}
                </Link>
                <a href={DISPATCH_TEL_HREF} className="btn btn-ghost">
                  {DISPATCH_TEL_DISPLAY}
                </a>
              </div>
              <p className="hero-note">{t('business.heroNote')}</p>
            </div>

            <div className="hero-media">
              <div className="hero-photo">
                <img
                  src={PHOTO.roofHvac}
                  alt={t('business.heroPhotoAlt')}
                  width={1200}
                  height={900}
                  decoding="async"
                />
              </div>
              <div className="float-card float-card--status">
                <p className="float-title">{t('business.heroCardStatusTitle')}</p>
                <p className="float-value">{t('business.heroCardStatusValue')}</p>
                <div className="progress" aria-hidden="true">
                  <span />
                </div>
              </div>
              <div className="float-card float-card--price">
                <p className="float-title">{t('business.heroCardPointsTitle')}</p>
                <p className="float-value">12</p>
              </div>
            </div>
          </div>

          <div className="hero-stats">
            <div>
              <p className="stat-value">
                <Counter to={60} suffix={` ${t('business.unitMin')}`} />
              </p>
              <p className="stat-label">{t('business.statDaySla')}</p>
            </div>
            <div>
              <p className="stat-value">
                <Counter to={120} suffix={` ${t('business.unitMin')}`} />
              </p>
              <p className="stat-label">{t('business.statNightSla')}</p>
            </div>
            <div>
              <p className="stat-value">1</p>
              <p className="stat-label">{t('business.statContract')}</p>
            </div>
            <div>
              <p className="stat-value">100%</p>
              <p className="stat-label">{t('business.statPhoto')}</p>
            </div>
          </div>
        </div>
      </section>

      {/* ===== Кому подходит ===== */}
      <section className="section section-alt">
        <div className="wrap stack-lg">
          <div className="section-head section-head-wide" data-reveal>
            <p className="eyebrow">{t('business.fitEyebrow')}</p>
            <h2 className="h2">{t('business.fitTitle')}</h2>
          </div>
          <div className="chips" data-reveal>
            {SEGMENTS.map((key) => (
              <span className="chip" key={key}>
                {t(key)}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* ===== Боли ===== */}
      <section className="section">
        <div className="wrap">
          <div className="section-head" data-reveal>
            <p className="eyebrow">{t('business.painsEyebrow')}</p>
            <h2 className="h2">{t('business.painsTitle')}</h2>
          </div>
          <div className="grid grid-3">
            {PAINS.map((p, i) => (
              <article
                key={p.title}
                className="card card-lift stack-sm"
                data-reveal
                style={revealDelay(i)}
              >
                <p className="usp-num">0{i + 1}</p>
                <h3 className="h3">{t(p.title)}</h3>
                <p className="muted">{t(p.text)}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ===== Оффер ===== */}
      <section className="section section-alt">
        <div className="wrap">
          <div className="section-head" data-reveal>
            <p className="eyebrow">{t('business.offerEyebrow')}</p>
            <h2 className="h2">{t('business.offerTitle')}</h2>
            <p className="lead">{t('business.offerLead')}</p>
          </div>
          <div className="grid grid-3">
            {OFFER.map((o, i) => (
              <article
                key={o.title}
                className="card card-lift stack-sm"
                data-reveal
                style={revealDelay(i % 3)}
              >
                <span className="tile-mark" />
                <h3 className="h3">{t(o.title)}</h3>
                <p className="muted">{t(o.text)}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ===== Кабинет и отчёты ===== */}
      <section className="section">
        <div className="wrap">
          <div className="grid-2" style={{ alignItems: 'center' }}>
            <div className="stack-lg" data-reveal>
              <div className="section-head">
                <p className="eyebrow">{t('business.cabinetEyebrow')}</p>
                <h2 className="h2">{t('business.cabinetTitle')}</h2>
                <p className="lead">{t('business.cabinetLead')}</p>
              </div>
              <ul className="stack-sm">
                {CABINET_POINTS.map((key) => (
                  <li className="tick" key={key}>
                    <span>{t(key)}</span>
                  </li>
                ))}
              </ul>
              <div className="btn-row">
                <Link to="/calculator" className="btn">
                  {t('business.cabinetCta')}
                </Link>
              </div>
            </div>

            <div data-reveal>
              <Phone label={t('business.cabinetEyebrow')}>
                <AppRow
                  title={t('business.appSiteTitle')}
                  sub={t('business.appSiteSub')}
                  badge={t('business.appSiteBadge')}
                  badgeTone="live"
                >
                  <div className="progress" aria-hidden="true">
                    <span />
                  </div>
                </AppRow>
                <AppRow
                  title={t('business.appExpensesTitle')}
                  sub={t('business.appExpensesSub', {
                    points: tn('business.appPoints', 12),
                    requests: tn('business.appRequests', 48),
                  })}
                >
                  <div className="bars" aria-hidden="true">
                    {[38, 52, 30, 64, 44, 72, 50, 58].map((h, i) => (
                      <i
                        key={i}
                        className={i === 5 ? 'on' : ''}
                        style={{ height: `${h}%`, animationDelay: `${i * 60}ms` }}
                      />
                    ))}
                  </div>
                </AppRow>
                <AppRow
                  title={t('business.appActTitle')}
                  sub={t('business.appActSub', { unit: t('unit.sum') })}
                  badge={t('business.appActBadge')}
                  badgeTone="ok"
                >
                  <div className="app-photos">
                    <img className="app-photo" src={PHOTO.beforeShot} alt="" loading="lazy" />
                    <img className="app-photo" src={PHOTO.afterShot} alt="" loading="lazy" />
                  </div>
                </AppRow>
                <div className="app-cta">{t('business.appCta')}</div>
                <AppTabbar active={2} />
              </Phone>
            </div>
          </div>
        </div>
      </section>

      {/* ===== Демо отчётов ===== */}
      <section className="section section-alt">
        <div className="wrap">
          <div className="section-head" data-reveal>
            <p className="eyebrow">{t('business.reportsEyebrow')}</p>
            <h2 className="h2">{t('business.reportsTitle')}</h2>
          </div>
          <div className="grid grid-3">
            <div data-reveal>
              <Mock caption={t('business.mockMonthlyCaption')}>
                <div className="bars" aria-hidden="true">
                  {[40, 62, 35, 70, 48, 84, 52].map((h, i) => (
                    <i key={i} className={i === 5 ? 'on' : ''} style={{ height: `${h}%` }} />
                  ))}
                </div>
                <div className="rowline">
                  <span>{t('business.mockSiteFirst')}</span>
                  <strong>3 120 000</strong>
                </div>
                <div className="rowline">
                  <span>{t('business.mockSiteSecond')}</span>
                  <strong>1 480 000</strong>
                </div>
              </Mock>
            </div>

            <div data-reveal style={revealDelay(1)}>
              <Mock caption={t('business.mockActCaption')}>
                <div className="mock-line accent" style={{ width: '45%' }} />
                <div className="app-photos" style={{ flex: 1 }}>
                  <img className="mock-photo" src={PHOTO.beforeShot} alt="" loading="lazy" />
                  <img className="mock-photo" src={PHOTO.afterShot} alt="" loading="lazy" />
                </div>
              </Mock>
            </div>

            <div data-reveal style={revealDelay(2)}>
              <Mock caption={t('business.mockBalanceCaption')}>
                <div className="mock-line accent" style={{ width: '60%' }} />
                <div className="rowline">
                  <span>{t('business.mockBalanceIn')}</span>
                  <strong>6 000 000</strong>
                </div>
                <div className="rowline">
                  <span>{t('business.mockBalanceOut')}</span>
                  <strong>4 200 000</strong>
                </div>
                <div className="rowline">
                  <span>{t('business.mockBalanceRest')}</span>
                  <strong>1 800 000</strong>
                </div>
              </Mock>
            </div>
          </div>
          <p className="small muted" style={{ marginTop: 'var(--s16)' }}>
            {t('business.mockNote')}
          </p>
        </div>
      </section>

      {/* ===== Как начинаем ===== */}
      <section className="section">
        <div className="wrap">
          <div className="grid-2">
            <div className="sticky-col" data-reveal>
              <div className="section-head">
                <p className="eyebrow">{t('business.startEyebrow')}</p>
                <h2 className="h2">{t('business.startTitle')}</h2>
                <p className="lead">{t('business.startLead')}</p>
              </div>
              <div className="btn-row">
                <Link to="/calculator" className="btn">
                  {t('business.startCta')}
                </Link>
              </div>
            </div>
            <ol>
              {START.map((s, i) => (
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
      </section>

      {/* ===== FAQ ===== */}
      <section className="section section-alt">
        <div className="wrap">
          <div className="section-head" data-reveal>
            <p className="eyebrow">{t('business.faqEyebrow')}</p>
            <h2 className="h2">{t('business.faqTitle')}</h2>
          </div>
          <div data-reveal>
            <Faq items={FAQ.map((item) => ({ q: t(item.q), a: t(item.a) }))} />
          </div>
        </div>
      </section>

      {/* ===== CTA ===== */}
      <section className="section-lg section-dark">
        <div className="wrap">
          <div className="stack-lg" style={{ maxWidth: '58ch' }} data-reveal>
            <h2 className="h1">{t('business.ctaTitle')}</h2>
            <p className="lead">{t('business.ctaLead')}</p>
            <div className="btn-row">
              <Link to="/calculator" className="btn">
                {t('business.ctaCalc')}
              </Link>
              <a href={DISPATCH_TEL_HREF} className="btn btn-ghost">
                {t('business.ctaCall', { tel: DISPATCH_TEL_DISPLAY })}
              </a>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
