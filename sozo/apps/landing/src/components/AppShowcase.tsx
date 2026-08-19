import { useState } from 'react';
import { AppRow, AppTabbar, Phone } from './Phone';

type TabId = 'client' | 'master' | 'business';

const TABS: { id: TabId; label: string }[] = [
  { id: 'client', label: 'Для клиента' },
  { id: 'master', label: 'Для мастера' },
  { id: 'business', label: 'Для бизнеса' },
];

const COPY: Record<TabId, { title: string; lead: string; points: string[]; note: string }> = {
  client: {
    title: 'Приложение для дома',
    lead: 'Заявка в два тапа, видно, где мастер и сколько это будет стоить. Никаких звонков, если не хочется.',
    points: [
      'Выбираете удобное время сами — из свободных интервалов, а не «ждите с 9 до 18»',
      'Смета приходит в телефон до начала работ: согласны — мастер начинает',
      'Видно статус: заявка принята, мастер выехал, в работе, закрыта',
      'Фото до и после и акт остаются в истории — можно поднять через год',
      'Оплата картой, наличными или переводом — как удобно',
    ],
    note: 'Заказать можно и без приложения — через форму или по телефону.',
  },
  master: {
    title: 'Приложение для мастера',
    lead: 'Заявки приходят сами. Видно адрес, что делать, сколько заработаете и когда придут деньги.',
    points: [
      'Новые заявки рядом с вами — берёте ту, что удобна по времени и месту',
      'Прайс уже в приложении: цена считается сама, торговаться не надо',
      'Фото до и после снимаются прямо в заявке — это и есть отчёт',
      'Заработок виден по каждой заявке, выплаты раз в неделю',
      'График и дежурства — вы отмечаете, когда готовы работать',
    ],
    note: 'Работает на обычном Android — новый телефон покупать не нужно.',
  },
  business: {
    title: 'Кабинет для бизнеса',
    lead: 'Все ваши точки в одном месте: заявки, сроки, расходы и фотоотчёты по каждой работе.',
    points: [
      'Заявка с любой точки — сотрудник жмёт кнопку, дальше всё делаем мы',
      'Аварии со сроком приезда: днём до 60 минут, ночью до 120',
      'Месячный отчёт: сколько потрачено по каждой точке и на что',
      'Акты с фото до/после — закрывающие документы пакетом, а не по одному',
      'Список отложенных работ по точке: видно, что чинить сейчас, а что подождёт',
    ],
    note: 'Заявку можно оставить и с телефона сотрудника, и звонком менеджеру.',
  },
};

function ClientScreen() {
  return (
    <>
      <AppRow
        title="Заявка №1043"
        sub="Сантехника · Юнусабад"
        badge="Мастер выехал"
        badgeTone="live"
      >
        <div className="progress" aria-hidden="true">
          <span />
        </div>
        <span className="app-sub">Будет у вас к 14:20</span>
      </AppRow>
      <AppRow title="Ильхом, сантехник" sub="12 лет в профессии · Юнусабад" badge="Проверен" />
      <AppRow title="Смета согласована" sub="Замена смесителя + сифон" badge="240 000 сум" />
      <AppRow title="Фото до и после">
        <div className="app-photos">
          <img className="app-photo" src="/photos/work/ba-before.webp" alt="" loading="lazy" />
          <img className="app-photo" src="/photos/work/ba-after.webp" alt="" loading="lazy" />
        </div>
      </AppRow>
      <div className="app-cta">Вызвать мастера</div>
      <AppTabbar active={0} />
    </>
  );
}

function MasterScreen() {
  return (
    <>
      <AppRow title="Заработок за неделю" sub="Выплата в понедельник" badge="1 340 000 сум" />
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
          <img className="app-photo" src="/photos/work/panel-close.webp" alt="" loading="lazy" />
          <img className="app-photo" src="/photos/work/electric-panel.webp" alt="" loading="lazy" />
        </div>
      </AppRow>
      <div className="app-cta">Взять заявку</div>
      <AppTabbar active={1} />
    </>
  );
}

function BusinessScreen() {
  return (
    <>
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
      <AppRow title="Баланс абонентки" sub="Списано 4 200 000 из 6 000 000" badge="Октябрь" />
      <AppRow title="Акты с фото" sub="За месяц — 48 штук" badge="Скачать" badgeTone="ok" />
      <div className="app-cta">Оставить заявку</div>
      <AppTabbar active={2} />
    </>
  );
}

const SCREENS: Record<TabId, () => JSX.Element> = {
  client: ClientScreen,
  master: MasterScreen,
  business: BusinessScreen,
};

/**
 * Рассказ о трёх приложениях SOZO одним блоком: клиент, мастер, бизнес.
 * Табы переключают и текст, и макет телефона — без перезагрузки секции.
 */
export default function AppShowcase() {
  const [tab, setTab] = useState<TabId>('client');
  const copy = COPY[tab];
  const Screen = SCREENS[tab];

  return (
    <div className="stack-lg">
      <div className="tabs" role="tablist" aria-label="Приложения SOZO">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            type="button"
            className="tab"
            aria-selected={tab === t.id}
            aria-controls={`app-panel-${t.id}`}
            id={`app-tab-${t.id}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div
        className="grid-2 tabpanel"
        role="tabpanel"
        id={`app-panel-${tab}`}
        aria-labelledby={`app-tab-${tab}`}
        key={tab}
        style={{ alignItems: 'center' }}
      >
        <div className="stack-lg">
          <div className="stack-sm">
            <h3 className="h2">{copy.title}</h3>
            <p className="lead">{copy.lead}</p>
          </div>
          <ul className="stack-sm">
            {copy.points.map((p) => (
              <li className="tick" key={p}>
                <span>{p}</span>
              </li>
            ))}
          </ul>
          <p className="small muted">{copy.note}</p>
        </div>

        <Phone label={copy.title}>
          <Screen />
        </Phone>
      </div>
    </div>
  );
}
