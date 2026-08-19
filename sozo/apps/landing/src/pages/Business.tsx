import { Link } from 'react-router-dom';
import Counter from '../components/Counter';
import Faq from '../components/Faq';
import { AppRow, AppTabbar, Phone } from '../components/Phone';
import { DISPATCH_TEL_DISPLAY, DISPATCH_TEL_HREF } from '../lib/contacts';
import { PHOTO } from '../lib/photos';
import { revealDelay } from '../lib/reveal';

const SEGMENTS = [
  'Аптеки',
  'Магазины и минимаркеты',
  'Кафе и рестораны',
  'Офисы',
  'Салоны красоты',
  'Клиники',
  'Пункты выдачи',
  'Мини-отели',
];

const PAINS = [
  {
    title: 'Свой техник обходится дорого',
    text: 'Оклад, налоги, отпуск и простой. На небольшой сети он загружен наполовину, а платить приходится полностью.',
  },
  {
    title: 'Разовые мастера — лотерея',
    text: 'Каждый раз новый человек, цена «по договорённости», качество непонятное. Проверить, что реально сделано, нечем.',
  },
  {
    title: 'Непонятно, куда ушли деньги',
    text: 'Ремонт размазан по авансовым отчётам. К концу года никто не скажет, сколько стоило содержать каждую точку.',
  },
];

const OFFER = [
  {
    title: 'Один договор на все точки',
    text: 'Один подрядчик, один прайс, одни закрывающие документы — вместо десятка разовых сделок и договорённостей на словах.',
  },
  {
    title: 'Аварии: 60 минут днём, 120 ночью',
    text: 'Срок приезда записан в договоре и считается по каждой точке. Не приехали вовремя — это видно в отчёте.',
  },
  {
    title: 'Фото по каждой работе',
    text: 'Что было, что стало, что поставили. Никаких «мы там всё сделали» без подтверждения.',
  },
  {
    title: 'Абонентская плата — ровный бюджет',
    text: 'Фиксированная сумма в месяц вместо скачков. Работы списываются по факту, остаток виден онлайн.',
  },
  {
    title: 'Плановые осмотры',
    text: 'Обход по чек-листу: сантехника, электрика, климат. Предупредить аварию дешевле, чем чинить последствия.',
  },
  {
    title: 'Список отложенных работ',
    text: 'По каждой точке ведём, что стоит починить и сколько это стоит. Вы решаете, что делать сейчас, а что потом.',
  },
];

const START = [
  { title: 'Заявка', text: 'Оставляете контакты — менеджер связывается в тот же рабочий день.' },
  { title: 'Осмотр точек', text: 'Приезжаем, смотрим состояние и составляем паспорт объекта.' },
  {
    title: 'Предложение',
    text: 'Присылаем расчёт: что входит в абонентскую плату, что оплачивается сверх.',
  },
  {
    title: 'Договор и старт',
    text: 'Подписываем, подключаем кабинет, и точки уже под обслуживанием.',
  },
];

const FAQ = [
  {
    q: 'Что входит в абонентскую плату?',
    a: 'Плановые осмотры, дежурство по авариям с обещанным сроком приезда, диспетчерская, отчётность и кабинет. Сами работы и материалы списываются по прайсу — их видно в отчёте отдельной строкой.',
  },
  {
    q: 'А если точек всего две?',
    a: 'Тоже работаем. Абонентская плата считается от типа и площади объектов, поэтому для двух точек и сумма будет небольшой. Точную цифру называем после осмотра.',
  },
  {
    q: 'Что если мастер не приехал в срок?',
    a: 'Срок приезда фиксируется в договоре, а нарушения видны в месячном отчёте. Порядок пересчёта и компенсаций прописывается там же — это не переписка в мессенджере.',
  },
  {
    q: 'Кто отвечает за материалы?',
    a: 'Можем закупать сами и включать в отчёт по чекам, можем работать с вашими. Как удобнее — фиксируем в договоре.',
  },
  {
    q: 'Работаете по договору и безналу?',
    a: 'Да, по договору с закрывающими документами. Акты за месяц приходят пакетом, а не по каждой заявке отдельно. Форму расчётов и налоговые условия менеджер зафиксирует в договоре — под вашу бухгалтерию.',
  },
  {
    q: 'Можно попробовать на одной точке?',
    a: 'Можно. Возьмите одну точку на месяц-другой, посмотрите на отчёты и сроки — и уже потом подключайте остальные.',
  },
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
  return (
    <>
      {/* ===== Герой ===== */}
      <section className="hero">
        <div className="wrap">
          <div className="hero-grid">
            <div className="hero-copy">
              <span className="chip chip-dark chip-dot">SOZO для бизнеса</span>
              <h1 className="display">
                Все точки <span className="mark">под присмотром</span>
              </h1>
              <p className="lead">
                Сантехника, электрика, климат и мелкий ремонт в ваших помещениях — по одному
                договору. Фиксированная плата в месяц, срок приезда по авариям и фотоотчёт по каждой
                работе.
              </p>
              <div className="btn-row">
                <Link to="/calculator" className="btn">
                  Рассчитать абонентку
                </Link>
                <a href={DISPATCH_TEL_HREF} className="btn btn-ghost">
                  {DISPATCH_TEL_DISPLAY}
                </a>
              </div>
              <p className="hero-note">Расчёт занимает минуту и ни к чему не обязывает.</p>
            </div>

            <div className="hero-media">
              <div className="hero-photo">
                <img
                  src={PHOTO.roofHvac}
                  alt="Мастера SOZO обслуживают климатическое оборудование на объекте"
                  width={1200}
                  height={900}
                  decoding="async"
                />
              </div>
              <div className="float-card float-card--status">
                <p className="float-title">Аптека №7 · авария</p>
                <p className="float-value">Мастер приедет к 11:40</p>
                <div className="progress" aria-hidden="true">
                  <span />
                </div>
              </div>
              <div className="float-card float-card--price">
                <p className="float-title">Точек на обслуживании</p>
                <p className="float-value">12</p>
              </div>
            </div>
          </div>

          <div className="hero-stats">
            <div>
              <p className="stat-value">
                <Counter to={60} suffix=" мин" />
              </p>
              <p className="stat-label">приезд по аварии днём</p>
            </div>
            <div>
              <p className="stat-value">
                <Counter to={120} suffix=" мин" />
              </p>
              <p className="stat-label">приезд по аварии ночью</p>
            </div>
            <div>
              <p className="stat-value">1</p>
              <p className="stat-label">договор на всю сеть</p>
            </div>
            <div>
              <p className="stat-value">100%</p>
              <p className="stat-label">работ с фотоотчётом</p>
            </div>
          </div>
        </div>
      </section>

      {/* ===== Кому подходит ===== */}
      <section className="section section-alt">
        <div className="wrap stack-lg">
          <div className="section-head section-head-wide" data-reveal>
            <p className="eyebrow">Кому подходит</p>
            <h2 className="h2">Если у вас помещение, где нельзя закрыться на ремонт</h2>
          </div>
          <div className="chips" data-reveal>
            {SEGMENTS.map((s) => (
              <span className="chip" key={s}>
                {s}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* ===== Боли ===== */}
      <section className="section">
        <div className="wrap">
          <div className="section-head" data-reveal>
            <p className="eyebrow">Знакомо?</p>
            <h2 className="h2">Три способа терять деньги на обслуживании</h2>
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
                <h3 className="h3">{p.title}</h3>
                <p className="muted">{p.text}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ===== Оффер ===== */}
      <section className="section section-alt">
        <div className="wrap">
          <div className="section-head" data-reveal>
            <p className="eyebrow">Что предлагаем</p>
            <h2 className="h2">Берём на себя всю техническую часть</h2>
            <p className="lead">
              Вы занимаетесь своим делом, а мы следим, чтобы в помещениях всё работало.
            </p>
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
                <h3 className="h3">{o.title}</h3>
                <p className="muted">{o.text}</p>
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
                <p className="eyebrow">Кабинет для бизнеса</p>
                <h2 className="h2">Видно всё: кто, когда, что и за сколько</h2>
                <p className="lead">
                  Ответственный за точки открывает кабинет с телефона и видит текущие заявки, сроки
                  и расходы. Ничего не нужно спрашивать в переписке.
                </p>
              </div>
              <ul className="stack-sm">
                <li className="tick">
                  <span>Заявка с точки — сотрудник жмёт кнопку, диспетчер уже знает адрес</span>
                </li>
                <li className="tick">
                  <span>Аварийные заявки идут отдельной очередью со своим сроком</span>
                </li>
                <li className="tick">
                  <span>Месячный отчёт: расходы по каждой точке и по видам работ</span>
                </li>
                <li className="tick">
                  <span>Акты с фото — пакетом за месяц, а не по одному в почте</span>
                </li>
                <li className="tick">
                  <span>Баланс абонентки виден онлайн: сколько внесено и сколько списано</span>
                </li>
              </ul>
              <div className="btn-row">
                <Link to="/calculator" className="btn">
                  Получить расчёт
                </Link>
              </div>
            </div>

            <div data-reveal>
              <Phone label="Кабинет для бизнеса">
                <AppRow
                  title="Аптека №7 · Чиланзар"
                  sub="Авария: течь в подсобке"
                  badge="Приедем к 11:40"
                  badgeTone="live"
                >
                  <div className="progress" aria-hidden="true">
                    <span />
                  </div>
                </AppRow>
                <AppRow title="Расходы за месяц" sub="12 точек · 48 заявок">
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
                  title="Акт по заявке №2210"
                  sub="Замена сифона · 240 000 сум"
                  badge="Готов"
                  badgeTone="ok"
                >
                  <div className="app-photos">
                    <img className="app-photo" src={PHOTO.beforeShot} alt="" loading="lazy" />
                    <img className="app-photo" src={PHOTO.afterShot} alt="" loading="lazy" />
                  </div>
                </AppRow>
                <div className="app-cta">Оставить заявку</div>
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
            <p className="eyebrow">Отчётность</p>
            <h2 className="h2">Три документа, которые закрывают вопросы бухгалтерии</h2>
          </div>
          <div className="grid grid-3">
            <div data-reveal>
              <Mock caption="Месячный отчёт по точкам">
                <div className="bars" aria-hidden="true">
                  {[40, 62, 35, 70, 48, 84, 52].map((h, i) => (
                    <i key={i} className={i === 5 ? 'on' : ''} style={{ height: `${h}%` }} />
                  ))}
                </div>
                <div className="rowline">
                  <span>Аптека №7</span>
                  <strong>3 120 000</strong>
                </div>
                <div className="rowline">
                  <span>Аптека №3</span>
                  <strong>1 480 000</strong>
                </div>
              </Mock>
            </div>

            <div data-reveal style={revealDelay(1)}>
              <Mock caption="Акт с фото до и после">
                <div className="mock-line accent" style={{ width: '45%' }} />
                <div className="app-photos" style={{ flex: 1 }}>
                  <img className="mock-photo" src={PHOTO.beforeShot} alt="" loading="lazy" />
                  <img className="mock-photo" src={PHOTO.afterShot} alt="" loading="lazy" />
                </div>
              </Mock>
            </div>

            <div data-reveal style={revealDelay(2)}>
              <Mock caption="Баланс абонентки">
                <div className="mock-line accent" style={{ width: '60%' }} />
                <div className="rowline">
                  <span>Внесено</span>
                  <strong>6 000 000</strong>
                </div>
                <div className="rowline">
                  <span>Списано за месяц</span>
                  <strong>4 200 000</strong>
                </div>
                <div className="rowline">
                  <span>Остаток</span>
                  <strong>1 800 000</strong>
                </div>
              </Mock>
            </div>
          </div>
          <p className="small muted" style={{ marginTop: 'var(--s16)' }}>
            Примеры интерфейса. Цифры условные.
          </p>
        </div>
      </section>

      {/* ===== Как начинаем ===== */}
      <section className="section">
        <div className="wrap">
          <div className="grid-2">
            <div className="sticky-col" data-reveal>
              <div className="section-head">
                <p className="eyebrow">Как начинаем</p>
                <h2 className="h2">От звонка до обслуживания — четыре шага</h2>
                <p className="lead">
                  Обычно проходит от нескольких дней до недели — в зависимости от того, сколько у
                  вас точек.
                </p>
              </div>
              <div className="btn-row">
                <Link to="/calculator" className="btn">
                  Начать с расчёта
                </Link>
              </div>
            </div>
            <ol>
              {START.map((s, i) => (
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

      {/* ===== FAQ ===== */}
      <section className="section section-alt">
        <div className="wrap">
          <div className="section-head" data-reveal>
            <p className="eyebrow">Вопросы</p>
            <h2 className="h2">Что обычно спрашивают</h2>
          </div>
          <div data-reveal>
            <Faq items={FAQ} />
          </div>
        </div>
      </section>

      {/* ===== CTA ===== */}
      <section className="section-lg section-dark">
        <div className="wrap">
          <div className="stack-lg" style={{ maxWidth: '58ch' }} data-reveal>
            <h2 className="h1">Посчитаем стоимость для вашей сети</h2>
            <p className="lead">
              Калькулятор даёт вилку за минуту. Точную сумму назовём в предложении — после того, как
              посмотрим объекты.
            </p>
            <div className="btn-row">
              <Link to="/calculator" className="btn">
                Рассчитать абонентку
              </Link>
              <a href={DISPATCH_TEL_HREF} className="btn btn-ghost">
                Позвонить {DISPATCH_TEL_DISPLAY}
              </a>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
