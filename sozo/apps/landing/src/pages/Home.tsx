import { useEffect, useRef, useState, type RefObject } from 'react';
import { Link } from 'react-router-dom';
import { fetchPrices } from '../api';
import AudiencePreview from '../components/AudiencePreview';
import BeforeAfter from '../components/BeforeAfter';
import Faq from '../components/Faq';
import Marquee from '../components/Marquee';
import MasterRail from '../components/MasterRail';
import { useLocale, useT, useTn } from '../i18n';
import { displayCategory, FALLBACK_CATEGORIES } from '../lib/catalog';
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

/* Четыре аудитории продукта. Порядок не случаен: сверху тот, кого больше
   всего, дальше — по убыванию доли трафика. Ссылка у каждой своя, потому что
   и разговор у каждой свой. */
const AUDIENCES = [
  {
    to: '/order',
    kind: 'client' as const,
    titleKey: 'home.audienceClientTitle',
    textKey: 'home.audienceClientText',
    ctaKey: 'home.audienceClientCta',
  },
  {
    to: '/masters',
    kind: 'master' as const,
    titleKey: 'home.audienceMasterTitle',
    textKey: 'home.audienceMasterText',
    ctaKey: 'home.audienceMasterCta',
  },
  {
    to: '/business',
    kind: 'business' as const,
    titleKey: 'home.audienceBusinessTitle',
    textKey: 'home.audienceBusinessText',
    ctaKey: 'home.audienceBusinessCta',
  },
  {
    to: '/operators',
    kind: 'operator' as const,
    titleKey: 'home.audienceOperatorTitle',
    textKey: 'home.audienceOperatorText',
    ctaKey: 'home.audienceOperatorCta',
  },
];

/* Три доказательства в одном блоке: снимки, человек, история. Каждое
   отвечает на свой вопрос — «что сделали», «кто приезжал», «где это потом
   искать», — и потому не пересказывает соседнее. */
const TRUST = [
  { titleKey: 'home.trustPhotoTitle', textKey: 'home.trustPhotoText' },
  { titleKey: 'home.trustMasterTitle', textKey: 'home.trustMasterText' },
  { titleKey: 'home.trustAppTitle', textKey: 'home.trustAppText' },
];

/* Механика заявки — одна на все четыре аудитории. Меняется только, кто
   платит и куда приходит отчёт. */
const STEPS = [
  { titleKey: 'home.howRequestTitle', textKey: 'home.howRequestText' },
  { titleKey: 'home.howDealTitle', textKey: 'home.howDealText' },
  { titleKey: 'home.howWorkTitle', textKey: 'home.howWorkText' },
  { titleKey: 'home.howActTitle', textKey: 'home.howActText' },
];

const FAQ = [
  { qKey: 'home.faqVisitQ', aKey: 'home.faqVisitA' },
  { qKey: 'home.faqPriceQ', aKey: 'home.faqPriceA' },
  { qKey: 'home.faqEmergencyQ', aKey: 'home.faqEmergencyA' },
  { qKey: 'home.faqAreaQ', aKey: 'home.faqAreaA' },
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

/**
 * Показывать ли липкую панель звонка.
 *
 * Два условия, и оба — про то, чтобы панель не мешала. Пока виден первый
 * экран, на нём уже есть крупная кнопка «Вызвать мастера» и телефон — вторая
 * такая же внизу закрывает фотографию и карточки статуса. Пока виден финальный
 * блок, там снова обе кнопки, и панель наезжает на них и на подвал.
 *
 * Наблюдаем за двумя узлами, а не считаем прокрутку: обработчик scroll на
 * телефоне работает каждый кадр, а наблюдателю браузер сообщает сам.
 */
function useStickyCall(hero: RefObject<HTMLElement>, tail: RefObject<HTMLElement>) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const nodes = [hero.current, tail.current].filter(Boolean) as HTMLElement[];
    if (!nodes.length || !('IntersectionObserver' in window)) return;

    const seen = new Map<Element, boolean>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) seen.set(e.target, e.isIntersecting);
        // Панель нужна ровно между: герой ушёл, финальный блок ещё не пришёл
        setVisible(![...seen.values()].some(Boolean));
      },
      { threshold: 0 },
    );
    nodes.forEach((n) => io.observe(n));
    return () => io.disconnect();
  }, [hero, tail]);

  return visible;
}

/* ---------- Страница ---------- */

export default function Home() {
  const t = useT();
  const tn = useTn();
  const sla = useSla();
  const heroRef = useRef<HTMLElement>(null);
  const tailRef = useRef<HTMLElement>(null);
  const showCall = useStickyCall(heroRef, tailRef);

  return (
    <>
      {/* ===== Герой ===== */}
      <section className="hero" ref={heroRef}>
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

          {/*
            Цифры стоят как есть, без докрутки. Счётчик начинается с нуля, и
            первую секунду человек читает «0 мин · 0 дней · 0 часов» — рядом с
            обещанием гарантии это выглядит незаполненным шаблоном, а не
            анимацией. Докручивать имеет смысл достигнутый показатель
            («7 400 закрытых заявок»), а не условие договора.
          */}
          <div className="hero-stats">
            <div>
              <p className="stat-value">{tn('home.statMinutes', 10)}</p>
              <p className="stat-label">{t('home.statCallback')}</p>
            </div>
            <div>
              <p className="stat-value">{tn('home.statDays', 30)}</p>
              <p className="stat-label">{t('home.statWarranty')}</p>
            </div>
            <div>
              <p className="stat-value">24/7</p>
              <p className="stat-label">{t('home.statEmergency')}</p>
            </div>
            <div>
              <p className="stat-value">{tn('home.statHours', 2)}</p>
              <p className="stat-label">{t('home.statWindow')}</p>
            </div>
          </div>
        </div>
      </section>

      <Marquee items={FACTS.map((key) => t(key))} />

      {/* ===== Четыре аудитории ===== */}
      <section className="section">
        <div className="wrap">
          <div className="section-head" data-reveal>
            <p className="eyebrow">{t('home.audienceEyebrow')}</p>
            <h2 className="h2">{t('home.audienceTitle')}</h2>
          </div>
          <div className="grid grid-4">
            {AUDIENCES.map((a, i) => (
              <article
                key={a.to}
                className="card card-lift aud-card"
                data-reveal
                style={revealDelay(i)}
              >
                <AudiencePreview kind={a.kind} />
                <h3 className="h3">{t(a.titleKey)}</h3>
                <p className="muted">{t(a.textKey)}</p>
                <Link to={a.to} className="link-action">
                  {t(a.ctaKey)} →
                </Link>
              </article>
            ))}
          </div>
        </div>
      </section>

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

      {/* ===== Как это работает ===== */}
      <section className="section section-alt">
        <div className="wrap">
          <div className="grid-2">
            <div className="sticky-col" data-reveal>
              <div className="section-head">
                <p className="eyebrow">{t('home.howEyebrow')}</p>
                <h2 className="h2">{t('home.howTitle')}</h2>
                <p className="lead">{t('home.howLead')}</p>
              </div>
              <div className="btn-row">
                <Link to="/order" className="btn">
                  {t('home.callMaster')}
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

      {/* ===== Почему можно доверять ===== */}
      {/*
        Три отдельные главы — фотоотчёт, мастера, приложение — свёрнуты в один
        блок. Порознь они говорили одно и то же («видно, что сделано») три раза
        подряд и растягивали клиентскую часть настолько, что до аварийного
        блока и вопросов человек не доходил. Доказательство сильнее, когда оно
        одно и показано, а не когда его трижды пересказали.
      */}
      <section className="section section-dark" id="trust">
        <div className="wrap stack-lg">
          <div className="section-head" data-reveal>
            <p className="eyebrow">{t('home.trustEyebrow')}</p>
            <h2 className="h2">{t('home.trustTitle')}</h2>
            <p className="lead">{t('home.trustLead')}</p>
          </div>

          <div className="grid-2" style={{ alignItems: 'center' }}>
            <div data-reveal>
              <BeforeAfter
                before={PHOTO.beforeShot}
                after={PHOTO.afterShot}
                alt={t('home.photoAlt')}
              />
              <p className="small muted" style={{ marginTop: 'var(--s12)' }}>
                {t('home.photoHint')}
              </p>
            </div>

            <ul className="stack" data-reveal>
              {TRUST.map((item) => (
                <li key={item.titleKey} className="stack-sm">
                  <h3 className="h3">{t(item.titleKey)}</h3>
                  <p className="muted">{t(item.textKey)}</p>
                </li>
              ))}
            </ul>
          </div>

          <div data-reveal>
            <MasterRail masters={MASTERS} />
          </div>
          <p className="small muted">{t('home.mastersHint')}</p>
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
      <section className="section-lg section-dark" ref={tailRef}>
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
      <div className={showCall ? 'sticky-call is-on' : 'sticky-call'}>
        <a href={DISPATCH_TEL_HREF} className="btn btn-ghost">
          {t('home.call')}
        </a>
        <Link to="/order" className="btn">
          {t('home.callMaster')}
        </Link>
      </div>
    </>
  );
}
