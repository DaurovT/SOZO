import { Link } from 'react-router-dom';
import { fetchPrices } from '../api';
import AppShowcase from '../components/AppShowcase';
import BeforeAfter from '../components/BeforeAfter';
import Counter from '../components/Counter';
import Faq from '../components/Faq';
import Marquee from '../components/Marquee';
import MasterRail from '../components/MasterRail';
import StoreButtons from '../components/StoreButtons';
import { displayCategory, FALLBACK_CATEGORIES } from '../lib/catalog';
import { DISPATCH_TEL_DISPLAY, DISPATCH_TEL_HREF } from '../lib/contacts';
import { formatTiyin } from '../lib/format';
import { categoryPhoto, PHOTO } from '../lib/photos';
import { revealDelay } from '../lib/reveal';
import { MASTERS } from '../lib/team';
import { useResource } from '../lib/useResource';

/* Цифры витрины ведёт маркетинг (контент, не договор). Перед запуском —
   сверить с фактическими показателями системы. */
const FACTS = [
  'Приезжаем ко времени, о котором договорились',
  'Цену говорим до начала работ',
  'Фото до и после каждой работы',
  'Гарантия 30 дней на работы',
  'Аварии — круглосуточно',
  'Оплата как удобно: карта, наличные, перевод',
];

const USP = [
  {
    title: 'Точное время, а не «ждите весь день»',
    text: 'Договариваемся на интервал в два часа. Если мастер задерживается — диспетчер предупреждает заранее, а не после.',
  },
  {
    title: 'Цена до начала работ',
    text: 'Мастер считает по прайсу и показывает сумму. Пока вы не согласились — работы не начинаются.',
  },
  {
    title: 'Фото до и после',
    text: 'Видно, что именно сделали. Снимки и акт остаются в приложении — можно открыть хоть через год.',
  },
  {
    title: 'Гарантия 30 дней',
    text: 'Если после ремонта что-то пошло не так — приезжаем снова и переделываем без доплаты.',
  },
];

const STEPS = [
  {
    title: 'Оставляете заявку',
    text: 'Через форму, в приложении или звонком. Нужен только телефон и пара слов о проблеме.',
  },
  {
    title: 'Договариваемся о времени и цене',
    text: 'Диспетчер перезванивает, подбирает мастера и называет примерную стоимость по прайсу.',
  },
  {
    title: 'Мастер приезжает и делает',
    text: 'Показывает точную смету, снимает фото до, работает, снимает фото после.',
  },
  {
    title: 'Закрываем актом',
    text: 'Вы принимаете работу, платите как удобно и получаете гарантию на 30 дней.',
  },
];

const REVIEWS = [
  {
    name: 'Дилноза',
    initials: 'Д',
    place: 'Юнусабад',
    text: 'Приехали в обещанное время, с 14 до 16. Смеситель поменяли за час, цену назвали сразу — она не изменилась.',
  },
  {
    name: 'Сергей',
    initials: 'С',
    place: 'Мирабад',
    text: 'Вызывал по электрике. Понравилось, что прислали фото щитка до и после — видно, что именно сделано.',
  },
  {
    name: 'Азиза',
    initials: 'А',
    place: 'Чиланзар',
    text: 'Ночью потёк стояк, дозвонилась с первого раза. Приехал дежурный мастер, воду перекрыли и всё починили.',
  },
  {
    name: 'Ботир',
    initials: 'Б',
    place: 'Сергели',
    text: 'Ставили два кондиционера. Пришли вдвоём, вынесли мусор за собой. Чек и акт пришли в приложение.',
  },
];

const FAQ = [
  {
    q: 'Сколько стоит выезд?',
    a: 'Выезд и осмотр оплачиваются по прайсу и засчитываются в стоимость работ, если вы соглашаетесь на ремонт. Точную сумму диспетчер называет по телефону до выезда.',
  },
  {
    q: 'А если цена вырастет по ходу работы?',
    a: 'Без вашего согласия — нет. Если мастер видит, что нужны дополнительные работы, он показывает новую смету, и вы решаете. Отказались — платите только за то, что уже сделано.',
  },
  {
    q: 'Как быстро приедете по аварии?',
    a: 'Течь, запах гари, выбитый автомат — это аварийная заявка. Диспетчер принимает их круглосуточно и сразу отправляет ближайшего дежурного мастера. Точное время приезда он назовёт в разговоре — когда увидит, кто из мастеров свободен и как далеко ехать.',
  },
  {
    q: 'Кто эти мастера?',
    a: 'Мастера, которые прошли проверку навыков по своей специальности и работают по договору. У каждого бейдж с QR-кодом: отсканируйте — увидите имя, специальность и статус мастера.',
  },
  {
    q: 'Можно без приложения?',
    a: 'Да. Оставьте телефон в форме или позвоните — всё остальное сделает диспетчер. Приложение просто удобнее: видно статус, историю и фотоотчёты.',
  },
  {
    q: 'Как платить?',
    a: 'Картой, наличными или переводом — после того, как приняли работу. Организациям — по договору и счёту.',
  },
];

/* ---------- Плитки категорий с ценами «от» ---------- */

function CategoryTiles() {
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
            <span className="tile-name">{displayCategory(item.name)}</span>
            <span className="tile-price">
              {item.price !== null ? (
                <>
                  от <strong>{formatTiyin(item.price)}</strong>
                </>
              ) : (
                'Цену скажет диспетчер'
              )}
            </span>
          </Link>
        ))}
      </div>
      <p className="small muted">
        {prices.status === 'ready'
          ? prices.data.note
          : 'Цена «от» — типовой случай. Точную сумму мастер называет до начала работ.'}
      </p>
    </div>
  );
}

/* ---------- Страница ---------- */

export default function Home() {
  return (
    <>
      {/* ===== Герой ===== */}
      <section className="hero">
        <div className="wrap">
          <div className="hero-grid">
            <div className="hero-copy">
              <span className="chip chip-dark chip-dot">Работаем в Ташкенте · аварии 24/7</span>
              <h1 className="display">
                Мастер приедет <span className="mark">вовремя</span>
              </h1>
              <p className="lead">
                Сантехника, электрика, кондиционеры и мелкий ремонт. Договариваемся о времени и цене
                заранее, присылаем фото до и после, даём гарантию 30 дней.
              </p>
              <div className="btn-row">
                <Link to="/order" className="btn">
                  Вызвать мастера
                </Link>
                <a href={DISPATCH_TEL_HREF} className="btn btn-ghost">
                  {DISPATCH_TEL_DISPLAY}
                </a>
              </div>
              <p className="hero-note">Заявка займёт минуту: телефон и пара слов о проблеме.</p>
            </div>

            <div className="hero-media">
              <div className="hero-photo">
                <img
                  src={PHOTO.heroMain}
                  alt="Мастер SOZO проверяет электрический щит на выезде"
                  width={1600}
                  height={1200}
                  fetchPriority="high"
                  decoding="async"
                />
              </div>

              <div className="float-card float-card--status">
                <p className="float-title">Заявка №1043</p>
                <p className="float-value">Мастер выехал</p>
                <div className="progress" aria-hidden="true">
                  <span />
                </div>
                <p className="float-title" style={{ marginTop: 6 }}>
                  Будет у вас к 14:20
                </p>
              </div>

              <div className="float-card float-card--price">
                <p className="float-title">Смета согласована</p>
                <p className="float-value">240 000 сум</p>
              </div>
            </div>
          </div>

          <div className="hero-stats">
            <div>
              <p className="stat-value">
                <Counter to={10} suffix=" мин" />
              </p>
              <p className="stat-label">перезваниваем после заявки</p>
            </div>
            <div>
              <p className="stat-value">
                <Counter to={30} suffix=" дней" />
              </p>
              <p className="stat-label">гарантия на работы</p>
            </div>
            <div>
              <p className="stat-value">24/7</p>
              <p className="stat-label">принимаем аварии</p>
            </div>
            <div>
              <p className="stat-value">
                <Counter to={2} suffix=" часа" />
              </p>
              <p className="stat-label">интервал, в который приедет мастер</p>
            </div>
          </div>
        </div>
      </section>

      <Marquee items={FACTS} />

      {/* ===== Категории ===== */}
      <section className="section section-alt" id="services">
        <div className="wrap">
          <div className="head-row">
            <div className="section-head" data-reveal>
              <p className="eyebrow">Что чиним</p>
              <h2 className="h2">Выберите, что сломалось</h2>
              <p className="lead">
                Нажмите на плитку — форма откроется с уже выбранной категорией. Дальше только
                телефон и пара слов.
              </p>
            </div>
            <a href={DISPATCH_TEL_HREF} className="link-action">
              Не нашли своё? Позвоните нам
            </a>
          </div>
          <CategoryTiles />
        </div>
      </section>

      {/* ===== Почему мы ===== */}
      <section className="section">
        <div className="wrap">
          <div className="section-head" data-reveal>
            <p className="eyebrow">Почему с нами спокойнее</p>
            <h2 className="h2">Четыре вещи, которые мы обещаем</h2>
          </div>
          <div className="grid grid-4">
            {USP.map((u, i) => (
              <article
                key={u.title}
                className="card card-lift stack-sm"
                data-reveal
                style={revealDelay(i)}
              >
                <p className="usp-num">0{i + 1}</p>
                <h3 className="h3">{u.title}</h3>
                <p className="muted">{u.text}</p>
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
                <p className="eyebrow">Как это работает</p>
                <h2 className="h2">Четыре шага — и проблема закрыта</h2>
                <p className="lead">
                  Вам не нужно искать мастера, торговаться и проверять, что он сделал. Это наша
                  работа.
                </p>
              </div>
              <div className="btn-row">
                <Link to="/order" className="btn">
                  Оставить заявку
                </Link>
              </div>
            </div>

            <ol>
              {STEPS.map((s, i) => (
                <li className="flow-item" key={s.title} data-reveal style={revealDelay(i)}>
                  <div className="flow-head">
                    <span className="num">{i + 1}</span>
                    <h3 className="h3">{s.title}</h3>
                  </div>
                  <p className="muted">{s.text}</p>
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
                <p className="eyebrow">Фотоотчёт</p>
                <h2 className="h2">Видно, за что вы платите</h2>
                <p className="lead">
                  Мастер снимает место работы до и после. Снимки прикладываются к акту, и вы всегда
                  можете показать их — например, соседям снизу или арендодателю.
                </p>
              </div>
              <ul className="stack-sm">
                <li className="tick">
                  <span>Фото делает сам мастер в приложении — задним числом их не подменить</span>
                </li>
                <li className="tick">
                  <span>Акт с фото и списком работ приходит вам в телефон</span>
                </li>
                <li className="tick">
                  <span>История хранится — гарантийный случай подтверждать не придётся</span>
                </li>
              </ul>
              <p className="small muted">Потяните ползунок на фото →</p>
            </div>

            <div data-reveal>
              <BeforeAfter
                before={PHOTO.beforeShot}
                after={PHOTO.afterShot}
                alt="Замена сифона под раковиной"
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
              <p className="eyebrow">Наши мастера</p>
              <h2 className="h2">К вам приедет конкретный человек</h2>
              <p className="lead">
                У каждого мастера — экзамен по своей специальности, договор и бейдж с QR-кодом.
                Отсканируйте бейдж и увидите, кто перед вами.
              </p>
            </div>
            <Link to="/masters" className="link-action">
              Хотите работать с нами?
            </Link>
          </div>
          <div data-reveal>
            <MasterRail masters={MASTERS} />
          </div>
          <p className="small muted">Листайте вбок, чтобы посмотреть остальных.</p>
        </div>
      </section>

      {/* ===== Приложения ===== */}
      <section className="section section-alt" id="app">
        <div className="wrap">
          <div className="section-head" data-reveal>
            <p className="eyebrow">Приложение SOZO</p>
            <h2 className="h2">Приложение — для клиента, мастера и бизнеса</h2>
            <p className="lead">
              У каждого свой экран: клиент видит свою заявку, мастер — свой маршрут и заработок,
              компания — все свои точки.
            </p>
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
            <p className="eyebrow">Отзывы</p>
            <h2 className="h2">Что говорят клиенты</h2>
          </div>
          <div className="reviews-rail">
            {REVIEWS.map((r) => (
              <article className="review" key={r.name}>
                <p className="review-stars" aria-label="Оценка 5 из 5">
                  ★★★★★
                </p>
                <p className="review-quote">{r.text}</p>
                <div className="review-who">
                  <span className="review-avatar" aria-hidden="true">
                    {r.initials}
                  </span>
                  <div>
                    <p className="tile-name" style={{ color: 'var(--text)' }}>
                      {r.name}
                    </p>
                    <p className="small muted">{r.place}</p>
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
              Круглосуточно
            </p>
            <h2 className="h2">Прорвало? Звоните сейчас</h2>
            <p>
              Течь, запах гари, выбитый автомат, нет воды или света — не заполняйте форму, просто
              позвоните. Диспетчер поднимет трубку и отправит ближайшего дежурного мастера.
            </p>
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
            <p className="eyebrow">Ещё два раздела</p>
            <h2 className="h2">У вас бизнес или вы сами мастер?</h2>
          </div>
          <div className="split">
            <Link to="/business" className="split-card" data-reveal>
              <img src={PHOTO.roofHvac} alt="" loading="lazy" decoding="async" />
              <span className="badge">Бизнесу</span>
              <h3 className="h2" style={{ marginTop: 'var(--s12)' }}>
                Все точки по одному договору
              </h3>
              <div className="split-list">
                <span>Аварии: днём до 60 минут, ночью до 120</span>
                <span>Фиксированная абонентка вместо всплесков</span>
                <span>Отчёт по каждой точке и акты с фото</span>
              </div>
              <span className="link-action" style={{ color: 'var(--on-dark)' }}>
                Посчитать абонентку →
              </span>
            </Link>

            <Link to="/masters" className="split-card" data-reveal style={revealDelay(1)}>
              <img src={PHOTO.electricPanel} alt="" loading="lazy" decoding="async" />
              <span className="badge">Мастерам</span>
              <h3 className="h2" style={{ marginTop: 'var(--s12)' }}>
                Работа с потоком заявок
              </h3>
              <div className="split-list">
                <span>Заявки приходят сами — клиентов искать не надо</span>
                <span>Выплаты каждую неделю на карту</span>
                <span>График выбираете сами</span>
              </div>
              <span className="link-action" style={{ color: 'var(--on-dark)' }}>
                Посмотреть условия →
              </span>
            </Link>
          </div>
        </div>
      </section>

      {/* ===== FAQ ===== */}
      <section className="section section-alt">
        <div className="wrap">
          <div className="section-head" data-reveal>
            <p className="eyebrow">Вопросы</p>
            <h2 className="h2">Коротко о главном</h2>
          </div>
          <div data-reveal>
            <Faq items={FAQ} />
          </div>
        </div>
      </section>

      {/* ===== Финальный CTA ===== */}
      <section className="section-lg section-dark">
        <div className="wrap">
          <div className="stack-lg" style={{ maxWidth: '56ch' }} data-reveal>
            <h2 className="h1">Что-то сломалось? Давайте починим.</h2>
            <p className="lead">
              Оставьте телефон — перезвоним в течение 10 минут, подберём мастера и назовём цену.
            </p>
            <div className="btn-row">
              <Link to="/order" className="btn">
                Вызвать мастера
              </Link>
              <a href={DISPATCH_TEL_HREF} className="btn btn-ghost">
                Позвонить {DISPATCH_TEL_DISPLAY}
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* Липкая панель звонка — только на мобильном (CSS скрывает от 1000px). */}
      <div className="sticky-call">
        <a href={DISPATCH_TEL_HREF} className="btn btn-ghost">
          Позвонить
        </a>
        <Link to="/order" className="btn">
          Вызвать мастера
        </Link>
      </div>
      <div className="sticky-call-spacer" aria-hidden="true" />
    </>
  );
}
