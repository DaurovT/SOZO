import { useState } from 'react';
import { Link } from 'react-router-dom';
import Counter from '../components/Counter';
import Faq from '../components/Faq';
import { AppRow, AppTabbar, Phone } from '../components/Phone';
import { PHOTO } from '../lib/photos';
import { formatSum, plural } from '../lib/format';
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

const TERMS = [
  {
    title: 'Доля до 57%',
    text: 'Чем выше ваш уровень, тем больше доля: начинаете с базовой, на верхнем уровне «Золото» — до 57% от суммы заявки.',
  },
  {
    title: 'Деньги каждую неделю',
    text: 'Заработок за неделю приходит на карту. Не нужно ждать конца месяца и напоминать о себе.',
  },
  {
    title: 'Заявки приходят сами',
    text: 'Клиентов ищем мы. Вам не нужна реклама, объявления и разговоры про цену.',
  },
  {
    title: 'График выбираете сами',
    text: 'Отмечаете, когда готовы работать. За аварийное дежурство есть гарантированная оплата смены — даже если заявок не было.',
  },
  {
    title: 'Обучение бесплатно',
    text: 'Новое оборудование, техника безопасности, работа с клиентом. Учим за счёт компании.',
  },
  {
    /* Материалы в долг через партнёрские магазины — это фаза 2 (PRD-06 §3.5),
       на лендинге не обещаем, пока не работает. */
    title: 'Спор с клиентом — не ваша забота',
    text: 'Разногласия по цене и качеству разбирает диспетчер. Ваши фото до и после — подтверждение, что работа сделана.',
  },
];

const REQUIREMENTS = [
  'Свой инструмент по вашей специальности',
  'Опыт, который можно показать на практике',
  'Фото до и после каждой работы — это часть работы, а не лишняя бумажка',
  'Аккуратность с клиентом: приехал вовремя, убрал за собой',
  'Транспорт — плюс, но не обязателен',
];

const STEPS = [
  { title: 'Анкета', text: 'Заполняете форму: специальность, опыт, районы, где удобно работать.' },
  { title: 'Звонок', text: 'Рекрутер звонит, отвечает на вопросы и назначает день проверки.' },
  {
    title: 'Проверка навыков',
    text: 'Практическое задание по вашей специальности и разговор о безопасности.',
  },
  { title: 'Первые заявки', text: 'Получаете бейдж и доступ в приложение — и выходите на линию.' },
];

const STORIES = [
  {
    id: 'ilhom',
    name: 'Ильхом',
    role: 'Сантехник, 12 лет опыта',
    photo: '/photos/masters/ilhom.webp',
    text: 'Раньше сам искал заказы и половину времени сидел без работы. Сейчас заявки приходят в приложение, а деньги — раз в неделю.',
  },
  {
    id: 'bekzod',
    name: 'Бекзод',
    role: 'Электрик, 9 лет опыта',
    photo: '/photos/masters/bekzod.webp',
    text: 'Понравилось, что цена уже в приложении. Не надо спорить с клиентом — открыл, показал, сделал.',
  },
  {
    id: 'rustam',
    name: 'Рустам',
    role: 'Кондиционеры, 7 лет опыта',
    photo: '/photos/masters/rustam.webp',
    text: 'Летом беру больше смен, зимой меньше. График ставлю сам, никто не заставляет выходить.',
  },
];

const FAQ = [
  {
    q: 'Это работа в штате или подработка?',
    a: 'Можно и так, и так. Есть мастера на полной загрузке и есть те, кто берёт заявки в свободное время. Главное — держать слово по времени приезда.',
  },
  {
    q: 'Сколько заявок в день реально?',
    a: 'Обычно 3–6, зависит от специальности, района и сезона. В сезон по климату бывает больше.',
  },
  {
    q: 'Кто платит за материалы?',
    a: 'Материалы согласуются с диспетчером до начала работ и входят в смету клиента. Вкладывать свои деньги не нужно.',
  },
  {
    q: 'Что если клиент недоволен?',
    a: 'Разбирает диспетчер, а фото до и после — ваша защита. Именно поэтому мы просим снимать каждую работу.',
  },
  {
    q: 'Нужен ли свой транспорт?',
    a: 'Не обязательно. С транспортом заявок можно брать больше, поэтому это плюс, но не требование.',
  },
  {
    q: 'Сколько ждать ответа по анкете?',
    a: 'До двух рабочих дней. Если специальность сейчас нужна — звоним в тот же день.',
  },
];

export default function Masters() {
  const [ordersPerDay, setOrdersPerDay] = useState(3);
  const [check, setCheck] = useState(180_000);
  const monthly = Math.floor((ordersPerDay * check * SHARE * WORK_DAYS) / 10_000) * 10_000;
  const checkPos = ((check - CHECK_MIN) / (CHECK_MAX - CHECK_MIN)) * 100;
  const ordersPos = ((ordersPerDay - ORDERS_MIN) / (ORDERS_MAX - ORDERS_MIN)) * 100;

  return (
    <>
      {/* ===== Герой ===== */}
      <section className="hero">
        <div className="wrap">
          <div className="hero-grid">
            <div className="hero-copy">
              <span className="chip chip-dark chip-dot">Набираем мастеров в Ташкенте</span>
              <h1 className="display">
                Работа <span className="mark">по заявкам</span>, а не по объявлениям
              </h1>
              <p className="lead">
                Ищем сантехников, электриков и мастеров по кондиционерам. Вы делаете работу — мы
                берём на себя клиентов, диспетчерскую и деньги.
              </p>
              <div className="btn-row">
                <Link to="/apply" className="btn">
                  Заполнить анкету
                </Link>
                <a href="#calc" className="btn btn-ghost">
                  Сколько выйдет
                </a>
              </div>
              <p className="hero-note">Анкета — 2 минуты. Ответим за 2 рабочих дня.</p>
            </div>

            <div className="hero-media">
              <div className="hero-photo">
                <img
                  src={PHOTO.electricPanel}
                  alt="Мастер SOZO на выезде"
                  width={1200}
                  height={900}
                  decoding="async"
                />
              </div>
              <div className="float-card float-card--status">
                <p className="float-title">Заработок за неделю</p>
                <p className="float-value">1 340 000 сум</p>
                <p className="float-title" style={{ marginTop: 6 }}>
                  Выплата в понедельник
                </p>
              </div>
              <div className="float-card float-card--price">
                <p className="float-title">Новая заявка рядом</p>
                <p className="float-value">1,2 км</p>
              </div>
            </div>
          </div>

          <div className="hero-stats">
            <div>
              <p className="stat-value">
                до <Counter to={57} suffix="%" />
              </p>
              <p className="stat-label">ваша доля от заявки</p>
            </div>
            <div>
              <p className="stat-value">раз в неделю</p>
              <p className="stat-label">выплаты на карту</p>
            </div>
            <div>
              <p className="stat-value">
                <Counter to={3} suffix="–6" />
              </p>
              <p className="stat-label">заявок в день у активного мастера</p>
            </div>
            <div>
              <p className="stat-value">бесплатно</p>
              <p className="stat-label">обучение и стандарты</p>
            </div>
          </div>
        </div>
      </section>

      {/* ===== Условия ===== */}
      <section className="section section-alt">
        <div className="wrap">
          <div className="section-head" data-reveal>
            <p className="eyebrow">Условия</p>
            <h2 className="h2">Что вы получаете</h2>
          </div>
          <div className="grid grid-3">
            {TERMS.map((t, i) => (
              <article
                key={t.title}
                className="card card-lift stack-sm"
                data-reveal
                style={revealDelay(i % 3)}
              >
                <span className="tile-mark" />
                <h3 className="h3">{t.title}</h3>
                <p className="muted">{t.text}</p>
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
                <p className="eyebrow">Прикидка</p>
                <h2 className="h2">Сколько можно зарабатывать</h2>
                <p className="lead">
                  Подвигайте ползунки — посчитаем примерный доход за месяц при вашей загрузке.
                </p>
              </div>

              <div className="card stack-lg">
                <div className="field">
                  <label className="field-label" htmlFor="orders">
                    Заявок в день: <strong>{ordersPerDay}</strong>
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
                    {plural(ordersPerDay, 'заявка', 'заявки', 'заявок')} в день · {WORK_DAYS}{' '}
                    рабочих дней в месяц
                  </p>
                </div>

                <div className="field">
                  <label className="field-label" htmlFor="check">
                    Средняя сумма заявки: <strong>{formatSum(check)} сум</strong>
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
                  <p className="field-hint">Зависит от специальности и сложности работ</p>
                </div>
              </div>
            </div>

            <div className="result stack" data-reveal>
              <div className="stack-sm">
                <p className="muted">При такой загрузке выходит примерно</p>
                <p className="result-value" aria-live="polite">
                  {formatSum(monthly)} сум в месяц
                </p>
              </div>
              <dl className="result-rows">
                <div className="result-row">
                  <span>Ваша доля</span>
                  <span>{Math.round(SHARE * 100)}%</span>
                </div>
                <div className="result-row">
                  <span>Заявок в месяц</span>
                  <span>{ordersPerDay * WORK_DAYS}</span>
                </div>
                <div className="result-row">
                  <span>Выплаты</span>
                  <span>каждую неделю</span>
                </div>
              </dl>
              <p className="small muted">
                Это прикидка, а не обещание. Реальная сумма зависит от специальности, сезона, вашей
                доли и того, сколько заявок вы возьмёте. Первые недели обычно выходит меньше — пока
                набираете скорость.
              </p>
              <div className="btn-row">
                <Link to="/apply" className="btn">
                  Заполнить анкету
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
                <p className="eyebrow">Приложение мастера</p>
                <h2 className="h2">Весь день — в телефоне</h2>
                <p className="lead">
                  Никаких блокнотов и звонков «а сколько это стоит». Всё, что нужно на выезде, уже в
                  приложении.
                </p>
              </div>
              <ul className="stack-sm">
                <li className="tick">
                  <span>Новые заявки рядом с вами — видно адрес, работу и вашу долю</span>
                </li>
                <li className="tick">
                  <span>Прайс внутри: смета считается сама, торговаться не нужно</span>
                </li>
                <li className="tick">
                  <span>Фото до и после снимаются в заявке — это и есть ваш отчёт</span>
                </li>
                <li className="tick">
                  <span>Заработок виден по каждой заявке и за неделю</span>
                </li>
                <li className="tick">
                  <span>Работает на обычном Android — новый телефон покупать не надо</span>
                </li>
              </ul>
            </div>

            <div data-reveal>
              <Phone label="Приложение мастера">
                <AppRow
                  title="Заработок за неделю"
                  sub="Выплата в понедельник"
                  badge="1 340 000 сум"
                />
                <AppRow
                  title="Новая заявка · 1,2 км"
                  sub="Электрика · не работает розетка"
                  badge="Взять"
                  badgeTone="live"
                >
                  <span className="app-sub">Ваша доля: 96 000 сум · приехать с 16:00 до 18:00</span>
                </AppRow>
                <AppRow title="Сегодня в работе" sub="3 заявки · маршрут построен" badge="14:20" />
                <AppRow title="Фото после работы" badge="Готово" badgeTone="ok">
                  <div className="app-photos">
                    <img className="app-photo" src={PHOTO.panelClose} alt="" loading="lazy" />
                    <img className="app-photo" src={PHOTO.electricPanel} alt="" loading="lazy" />
                  </div>
                </AppRow>
                <div className="app-cta">Взять заявку</div>
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
            <p className="eyebrow">Кто уже работает</p>
            <h2 className="h2">Мастера о работе в SOZO</h2>
          </div>
          <div className="grid grid-3">
            {STORIES.map((s, i) => (
              <article key={s.id} className="card stack" data-reveal style={revealDelay(i)}>
                <p className="review-quote">«{s.text}»</p>
                <div className="review-who">
                  <img
                    src={s.photo}
                    alt={s.name}
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
                      {s.name}
                    </p>
                    <p className="small muted">{s.role}</p>
                  </div>
                </div>
              </article>
            ))}
          </div>
          <p className="small muted" style={{ marginTop: 'var(--s16)' }}>
            Набираем мастеров по {MASTERS.length} направлениям: сантехника, электрика, кондиционеры,
            слаботочка, отделка и мелкий ремонт.
          </p>
        </div>
      </section>

      {/* ===== Требования и шаги ===== */}
      <section className="section section-alt">
        <div className="wrap">
          <div className="grid-2">
            <div className="stack-lg" data-reveal>
              <div className="section-head">
                <p className="eyebrow">Что нужно от вас</p>
                <h2 className="h2">Требования простые</h2>
              </div>
              <ul className="stack-sm">
                {REQUIREMENTS.map((r) => (
                  <li key={r} className="tick">
                    <span>{r}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <div className="section-head" data-reveal>
                <p className="eyebrow">Как попасть</p>
                <h2 className="h2">Четыре шага</h2>
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
        </div>
      </section>

      {/* ===== Реферальная программа ===== */}
      <section className="section">
        <div className="wrap">
          <div className="card card-accent stack" data-reveal>
            <span className="badge">Бонус</span>
            <h2 className="h2">Приведите знакомого мастера</h2>
            <p className="lead" style={{ color: 'var(--text)' }}>
              Работаете у нас и знаете хорошего мастера? Дайте ему свою ссылку. Когда он закроет 20
              заявок, вы получите бонус.
            </p>
            <p className="small muted">
              Ссылка и размер бонуса — в приложении, после выхода на линию.
            </p>
          </div>
        </div>
      </section>

      {/* ===== FAQ ===== */}
      <section className="section section-alt">
        <div className="wrap">
          <div className="section-head" data-reveal>
            <p className="eyebrow">Вопросы</p>
            <h2 className="h2">Что спрашивают мастера</h2>
          </div>
          <div data-reveal>
            <Faq items={FAQ} />
          </div>
        </div>
      </section>

      {/* ===== CTA ===== */}
      <section className="section-lg section-dark">
        <div className="wrap">
          <div className="stack-lg" style={{ maxWidth: '54ch' }} data-reveal>
            <h2 className="h1">Готовы начать?</h2>
            <p className="lead">
              Анкета занимает пару минут. Ответим за два рабочих дня и назначим проверку навыков.
            </p>
            <div className="btn-row">
              <Link to="/apply" className="btn">
                Заполнить анкету
              </Link>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
