/**
 * Строки, зашитые внутри переиспользуемых компонентов: витрина приложений,
 * обвязка форм, слайдер «до/после», лента мастеров, кнопки магазинов.
 *
 * Подписи, которые компонент получает пропсом, сюда не попадают: их переводит
 * та страница, которая компонент вызывает.
 */
export const components = {
  // ---------- Витрина приложений (AppShowcase) ----------
  'components.appShowcase.tabsAria': 'Приложения SOZO',
  'components.appShowcase.tabClient': 'Для клиента',
  'components.appShowcase.tabMaster': 'Для мастера',
  'components.appShowcase.tabBusiness': 'Для бизнеса',

  'components.appShowcase.client.title': 'Приложение для дома',
  'components.appShowcase.client.lead':
    'Заявка в два тапа, видно, где мастер и сколько это будет стоить. Никаких звонков, если не хочется.',
  'components.appShowcase.client.point1':
    'Выбираете удобное время сами — из свободных интервалов, а не «ждите с 9 до 18»',
  'components.appShowcase.client.point2':
    'Смета приходит в телефон до начала работ: согласны — мастер начинает',
  'components.appShowcase.client.point3':
    'Видно статус: заявка принята, мастер выехал, в работе, закрыта',
  'components.appShowcase.client.point4':
    'Фото до и после и акт остаются в истории — можно поднять через год',
  'components.appShowcase.client.point5': 'Оплата картой, наличными или переводом — как удобно',
  'components.appShowcase.client.note':
    'Заказать можно и без приложения — через форму или по телефону.',

  'components.appShowcase.master.title': 'Приложение для мастера',
  'components.appShowcase.master.lead':
    'Заявки приходят сами. Видно адрес, что делать, сколько заработаете и когда придут деньги.',
  'components.appShowcase.master.point1':
    'Новые заявки рядом с вами — берёте ту, что удобна по времени и месту',
  'components.appShowcase.master.point2':
    'Прайс уже в приложении: цена считается сама, торговаться не надо',
  'components.appShowcase.master.point3':
    'Фото до и после снимаются прямо в заявке — это и есть отчёт',
  'components.appShowcase.master.point4': 'Заработок виден по каждой заявке, выплаты раз в неделю',
  'components.appShowcase.master.point5':
    'График и дежурства — вы отмечаете, когда готовы работать',
  'components.appShowcase.master.note':
    'Работает на обычном Android — новый телефон покупать не нужно.',

  'components.appShowcase.business.title': 'Кабинет для бизнеса',
  'components.appShowcase.business.lead':
    'Все ваши точки в одном месте: заявки, сроки, расходы и фотоотчёты по каждой работе.',
  'components.appShowcase.business.point1':
    'Заявка с любой точки — сотрудник жмёт кнопку, дальше всё делаем мы',
  'components.appShowcase.business.point2': 'Аварии со сроком приезда: днём до 60 минут, ночью до 120',
  'components.appShowcase.business.point3':
    'Месячный отчёт: сколько потрачено по каждой точке и на что',
  'components.appShowcase.business.point4':
    'Акты с фото до/после — закрывающие документы пакетом, а не по одному',
  'components.appShowcase.business.point5':
    'Список отложенных работ по точке: видно, что чинить сейчас, а что подождёт',
  'components.appShowcase.business.note':
    'Заявку можно оставить и с телефона сотрудника, и звонком менеджеру.',

  // Макет экрана клиента внутри рамки телефона
  'components.appShowcase.clientScreen.orderTitle': 'Заявка №1043',
  'components.appShowcase.clientScreen.orderSub': 'Сантехника · Юнусабад',
  'components.appShowcase.clientScreen.orderBadge': 'Мастер выехал',
  'components.appShowcase.clientScreen.orderEta': 'Будет у вас к 14:20',
  'components.appShowcase.clientScreen.masterTitle': 'Ильхом, сантехник',
  'components.appShowcase.clientScreen.masterSub': '12 лет в профессии · Юнусабад',
  'components.appShowcase.clientScreen.masterBadge': 'Проверен',
  'components.appShowcase.clientScreen.quoteTitle': 'Смета согласована',
  'components.appShowcase.clientScreen.quoteSub': 'Замена смесителя + сифон',
  'components.appShowcase.clientScreen.quoteBadge': '240 000 сум',
  'components.appShowcase.clientScreen.photosTitle': 'Фото до и после',
  'components.appShowcase.clientScreen.cta': 'Вызвать мастера',

  // Макет экрана мастера
  'components.appShowcase.masterScreen.earnTitle': 'Заработок за неделю',
  'components.appShowcase.masterScreen.earnSub': 'Выплата в понедельник',
  'components.appShowcase.masterScreen.earnBadge': '1 340 000 сум',
  'components.appShowcase.masterScreen.newTitle': 'Новая заявка · 1,2 км',
  'components.appShowcase.masterScreen.newSub': 'Электрика · не работает розетка',
  'components.appShowcase.masterScreen.newBadge': 'Взять',
  'components.appShowcase.masterScreen.newShare': 'Ваша доля: 96 000 сум · приехать с 16:00 до 18:00',
  'components.appShowcase.masterScreen.todayTitle': 'Сегодня в работе',
  'components.appShowcase.masterScreen.todaySub': '3 заявки · маршрут построен',
  'components.appShowcase.masterScreen.photosTitle': 'Фото после работы',
  'components.appShowcase.masterScreen.photosBadge': 'Готово',
  'components.appShowcase.masterScreen.cta': 'Взять заявку',

  // Макет кабинета бизнеса
  'components.appShowcase.businessScreen.incidentTitle': 'Аптека №7 · Чиланзар',
  'components.appShowcase.businessScreen.incidentSub': 'Авария: течь в подсобке',
  'components.appShowcase.businessScreen.incidentBadge': 'Приедем к 11:40',
  'components.appShowcase.businessScreen.spendTitle': 'Расходы за месяц',
  'components.appShowcase.businessScreen.spendSub': '12 точек · 48 заявок',
  'components.appShowcase.businessScreen.balanceTitle': 'Баланс абонентки',
  'components.appShowcase.businessScreen.balanceSub': 'Списано 4 200 000 из 6 000 000',
  'components.appShowcase.businessScreen.balanceBadge': 'Октябрь',
  'components.appShowcase.businessScreen.actsTitle': 'Акты с фото',
  'components.appShowcase.businessScreen.actsSub': 'За месяц — 48 штук',
  'components.appShowcase.businessScreen.actsBadge': 'Скачать',
  'components.appShowcase.businessScreen.cta': 'Оставить заявку',

  // ---------- Рамка телефона (Phone) ----------
  'components.phone.screenAria': 'Экран приложения SOZO',

  // ---------- Слайдер «до / после» (BeforeAfter) ----------
  'components.beforeAfter.before': 'До',
  'components.beforeAfter.after': 'После',
  'components.beforeAfter.sliderAria': '{alt}: сравнение до и после',
  'components.beforeAfter.altBefore': '{alt} — до работы',
  'components.beforeAfter.altAfter': '{alt} — после работы',

  // ---------- Лента мастеров (MasterRail) ----------
  'components.masterRail.photoAlt': '{name} — {role} SOZO',
  'components.masterRail.verified': 'Проверен',

  // ---------- Обвязка форм (form.tsx) ----------
  'components.form.honeypot': 'Не заполняйте это поле',
  'components.form.phoneLabel': 'Телефон',
  'components.form.phoneHint': 'Например, +998 90 123-45-67',
  'components.form.consent': 'Согласен на обработку персональных данных (ЗРУ-547)',
  'components.form.stepperDecrease': 'Уменьшить',
  'components.form.stepperIncrease': 'Увеличить',
  'components.form.ticketLabel': 'Номер обращения',

  // ---------- Кнопки магазинов (StoreButtons) ----------
  'components.store.soon': 'скоро',
  'components.store.appStoreAria': 'Скачать в App Store — скоро',
  'components.store.googlePlayAria': 'Скачать в Google Play — скоро',
};
