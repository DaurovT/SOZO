import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { ConsentCheckbox, Done, Field, Honeypot, PhoneField, SubmitError } from '../components/form';
import { DISPATCH_TEL_DISPLAY, DISPATCH_TEL_HREF } from '../lib/contacts';
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

const SEGMENTS = [
  {
    key: 'bc',
    tab: 'Бизнес-центр',
    headline: 'SLA перед арендаторами, подтверждённый фотографиями',
    text:
      'Срыв срока по договору аренды — это штраф, а не недовольство. Система показывает ' +
      'приближение к дедлайну до того, как он наступил, и хранит доказательство выполнения ' +
      'по каждой заявке.',
  },
  {
    key: 'inhouse',
    tab: 'Свой техотдел',
    headline: 'Ваши мастера, ваши правила, наш инструмент',
    text:
      'Объекты разбросаны, загрузка людей невидима, техдолг живёт в таблице. Смены, ленты, ' +
      'фотофиксация и регламенты ТО — в одном месте, без передачи работ на сторону.',
  },
  {
    key: 'hoa',
    tab: 'УК и ТСЖ',
    headline: 'Жители видят, что вы работаете',
    text:
      'Заявка вместо звонка на вахту, оповещения об отключениях вместо объявления на подъезде, ' +
      'фото устранения вместо слов. Подключение бесплатное.',
  },
  {
    key: 'fm',
    tab: 'FM-подрядчик',
    headline: 'Доказательство выполнения для заказчика',
    text:
      'Несколько объектов разных владельцев, у каждого свой отчёт. Обходы, замечания и ' +
      'закрытые заявки собираются в отчёт одной кнопкой.',
  },
];

const FREE = [
  'Согласование допусков мастеров в общие зоны',
  'Заявки жителей по общему имуществу',
  'Оповещения об отключениях и объявления',
  'Пропуска и журнал доступа',
  'Право первой руки для вашей службы',
  'Получение сервисного сбора',
];

const PRO = [
  'Ваши мастера в системе: смены, ленты, назначение',
  'SLA-политики и контроль до срыва',
  'Техдолг объекта с суммами',
  'Паспорт здания, оборудование, плановое ТО',
  'Отчёты правлению, собственнику и арендаторам',
];

/** Ставка сбора по умолчанию — 5% (параметр 124) */
const FEE_RATE = 0.05;
/** Оценка среднего чека частной заявки, сум */
const AVG_ORDER = 250_000;
/** Оценка доли квартир, заказывающих работы в месяц */
const ORDERS_PER_UNIT = 0.08;

export default function Operators() {
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
        objectType: segment.tab,
      },
      honeypot,
    );
  }

  if (result) {
    return (
      <Done
        title="Заявка на подключение принята"
        lead="Свяжемся, чтобы сверить основание на объект и открыть кабинет. Подключение бесплатное."
        ticket={result.ticket}
      >
        <div className="btn-row">
          <Link to="/" className="btn btn-secondary">На главную</Link>
        </div>
      </Done>
    );
  }

  return (
    <>
      <section className="hero">
        <div className="wrap stack-lg">
          <div className="stack" data-reveal>
            <p className="eyebrow" style={revealDelay(0)}>Управляющим и службам эксплуатации</p>
            <h1 className="display" style={revealDelay(1)}>
              Мы не отнимаем работу <span className="mark">у вашего отдела</span>
            </h1>
            <p className="lead" style={revealDelay(2)}>
              Заявки по общему имуществу выполняет только ваша служба. Частные заявки жителей
              сначала предлагаются ей и лишь потом уходят в общий пул. Наши мастера — резерв,
              а не замена.
            </p>
            <div className="btn-row" style={revealDelay(3)}>
              <a className="btn" href="#connect">Подключить объект бесплатно</a>
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
                {s.tab}
              </button>
            ))}
          </div>
          <div className="tabpanel stack" data-reveal>
            <h2 className="h2">{segment.headline}</h2>
            <p className="lead">{segment.text}</p>
          </div>
        </div>
      </section>

      <section className="section section-soft">
        <div className="wrap stack-lg">
          <div className="section-head" data-reveal>
            <p className="eyebrow">Ваш доход</p>
            <h2 className="h2">Сколько объект может приносить</h2>
          </div>
          <p className="lead">
            Когда житель заказывает работу в своей квартире у мастера платформы, вы получаете
            5% от заявки. Это ваша мотивация подключиться — и она не стоит вам ничего.
          </p>

          <div className="field">
            <label className="field-label" htmlFor="units">
              Помещений в объекте: <b>{units}</b>
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
              <p className="muted">Ориентировочно</p>
              <p className="result-value">≈ {monthly.toLocaleString('ru-RU')} сум/мес</p>
            </div>
          </div>
          <p className="small muted">
            Оценка при среднем чеке {AVG_ORDER.toLocaleString('ru-RU')} сум и {Math.round(ORDERS_PER_UNIT * 100)}%
            помещений, заказывающих работы за месяц. Точная цифра зависит от дома — она видна
            в кабинете с первого месяца.
          </p>
          <p className="small muted">
            Тариф «Подписка» стоит 3 000 000 сум за объект в месяц и включает управление
            собственными мастерами. На нём сервисный сбор не начисляется: либо вы платите нам
            за инструмент, либо мы платим вам за доступ.
          </p>
        </div>
      </section>

      <section className="section">
        <div className="wrap stack-lg">
          <div className="grid grid-2" data-reveal>
            <article className="card stack">
              <h3 className="h3">Бесплатно навсегда</h3>
              <ul className="split-list">
                {FREE.map((f) => <li key={f}>{f}</li>)}
              </ul>
            </article>
            <article className="card stack">
              <h3 className="h3">Подписка</h3>
              <ul className="split-list">
                {PRO.map((f) => <li key={f}>{f}</li>)}
              </ul>
            </article>
          </div>
        </div>
      </section>

      <section className="section section-alt">
        <div className="wrap stack-lg">
          <div className="section-head" data-reveal>
            <h2 className="h2">Как подключиться</h2>
          </div>
          <ol className="stack" data-reveal>
            <li><b>Зарегистрируйтесь</b> по номеру телефона — без договора и менеджера.</li>
            <li><b>Заявите объект</b> и приложите основание: договор управления, протокол ОСС или договор ТО.</li>
            <li><b>Дождитесь проверки.</b> Мы сверяем данные, чтобы чужой дом не заявил посторонний. Пока идёт проверка, кабинет работает на демонстрационных данных.</li>
            <li><b>Настройте объект</b> и активируйте: согласующий, резервный, аварийный телефон, реестр помещений.</li>
          </ol>
        </div>
      </section>

      <section className="section" id="connect">
        <div className="wrap stack-lg">
          <div className="section-head">
            <h2 className="h2">Оставьте объект — откроем кабинет</h2>
            <p className="lead">
              Подключение бесплатное. Понадобится основание на объект: договор управления,
              протокол ОСС или договор техобслуживания.
            </p>
          </div>

          <form className="stack-lg" onSubmit={onSubmit} noValidate>
            <Honeypot value={honeypot} onChange={setHoneypot} />

            <Field id="company" label="Организация" required>
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

            <Field id="name" label="Имя" required>
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

            <Field id="objects" label="Сколько объектов в управлении" required>
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
              {pending ? 'Отправляем…' : 'Подключить объект'}
            </button>
          </form>
        </div>
      </section>
    </>
  );
}
