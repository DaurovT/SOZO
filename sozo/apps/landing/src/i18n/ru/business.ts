/**
 * L-03 «Бизнесу» — обслуживание помещений: магазины, аптеки, кафе, офисы.
 *
 * Блок болей («Три способа терять деньги на обслуживании») убран: он продавал
 * через страх, а страница должна описывать услугу. Оффер сжат с шести плиток
 * до четырёх — шесть равнозначных обещаний означают, что главного нет.
 *
 * Смысл для этой аудитории: переложить техническую часть и видеть, что с ней
 * происходит. Поэтому наверху — что мы берём на себя, а не чего вам стоит
 * не иметь подрядчика.
 */
export const business = {
  'business.heroChip': 'SOZO для бизнеса',
  // Заголовок разрезан на два ключа: вторая половина выделена цветом.
  // Целую фразу одним ключом сделать нельзя — внутри разметка
  'business.heroTitleLead': 'Техническая часть —',
  'business.heroTitleMark': 'не ваша забота',
  'business.heroLead':
    'Сантехника, электрика, климат и мелкий ремонт в ваших помещениях по одному договору. ' +
    'Заявка с точки, срок приезда по аварии, фотоотчёт по каждой работе и расходы по каждому ' +
    'объекту в кабинете.',
  'business.heroCalcCta': 'Обсудить обслуживание',
  'business.heroNote': 'Менеджер связывается в тот же рабочий день.',
  'business.heroPhotoAlt': 'Мастера SOZO обслуживают климатическое оборудование на объекте',
  'business.heroCardStatusTitle': 'Аптека №7 · авария',
  'business.heroCardStatusValue': 'Мастер приедет к 11:40',
  'business.heroCardPointsTitle': 'Точек на обслуживании',

  // Цифры под героем. Единица стоит рядом с числом, которое «докручивается»
  'business.unitMin': '{n} мин',
  'business.statDaySla': 'приезд по аварии днём',
  'business.statNightSla': 'приезд по аварии ночью',
  'business.statContract': 'договор на всю сеть',
  'business.statPhoto': 'работ с фотоотчётом',

  'business.fitEyebrow': 'Кому подходит',
  'business.fitTitle': 'Помещениям, которые нельзя закрыть на ремонт',
  'business.segmentPharmacies': 'Аптеки',
  'business.segmentShops': 'Магазины и минимаркеты',
  'business.segmentCafes': 'Кафе и рестораны',
  'business.segmentOffices': 'Офисы',
  'business.segmentSalons': 'Салоны красоты',
  'business.segmentClinics': 'Клиники',
  'business.segmentPickup': 'Пункты выдачи',
  'business.segmentHotels': 'Мини-отели',

  // Что берём на себя — четыре пункта, не шесть
  'business.offerEyebrow': 'Что берём на себя',
  'business.offerTitle': 'Всё, что связано с помещением',
  'business.offerLead':
    'Вместо десятка разовых мастеров и договорённостей на словах — один подрядчик, один прайс ' +
    'и одни закрывающие документы.',
  'business.offerSlaTitle': 'Аварии: 60 минут днём, 120 ночью',
  'business.offerSlaText':
    'Срок приезда записан в договоре и считается по каждой точке. Не приехали вовремя — это ' +
    'видно в отчёте, а не выясняется в переписке.',
  'business.offerPreventTitle': 'Плановые осмотры и список отложенных работ',
  'business.offerPreventText':
    'Обход по чек-листу: сантехника, электрика, климат. Что стоит починить и сколько это стоит ' +
    '— ведём по каждой точке, а вы решаете, что делать сейчас, а что потом.',
  'business.offerPhotoTitle': 'Фото по каждой работе',
  'business.offerPhotoText':
    'Что было, что стало, что поставили. Акт с фотографиями закрывает вопрос «а действительно ' +
    'ли там были».',
  'business.offerBudgetTitle': 'Абонентская плата — ровный бюджет',
  'business.offerBudgetText':
    'Фиксированная сумма в месяц вместо скачков. Работы списываются по факту, остаток виден ' +
    'онлайн, к концу года понятно, сколько стоила каждая точка.',

  'business.cabinetEyebrow': 'Кабинет',
  'business.cabinetTitle': 'Видно, кто, когда, что и за сколько',
  'business.cabinetLead':
    'Ответственный за точки открывает кабинет с телефона и видит текущие заявки, сроки и ' +
    'расходы. Спрашивать в переписке не нужно.',
  'business.cabinetPointRequest':
    'Заявка с точки — сотрудник жмёт кнопку, диспетчер уже знает адрес',
  'business.cabinetPointEmergency': 'Аварийные заявки идут отдельной очередью со своим сроком',
  'business.cabinetPointReport': 'Месячный отчёт: расходы по каждой точке и по видам работ',
  'business.cabinetPointActs': 'Акты с фото — пакетом за месяц, а не по одному в почте',
  'business.cabinetPointBalance': 'Баланс абонентки виден онлайн: сколько внесено и сколько списано',
  'business.cabinetCta': 'Обсудить обслуживание',

  // Экран приложения в рамке телефона — демо-данные, но их тоже читают
  'business.appSiteTitle': 'Аптека №7 · Чиланзар',
  'business.appSiteSub': 'Авария: течь в подсобке',
  'business.appSiteBadge': 'Приедем к 11:40',
  'business.appExpensesTitle': 'Расходы за месяц',
  'business.appExpensesSub': '{points} · {requests}',
  'business.appPoints.one': '{n} точка',
  'business.appPoints.few': '{n} точки',
  'business.appPoints.many': '{n} точек',
  'business.appPoints.other': '{n} точек',
  'business.appRequests.one': '{n} заявка',
  'business.appRequests.few': '{n} заявки',
  'business.appRequests.many': '{n} заявок',
  'business.appRequests.other': '{n} заявок',
  'business.appActTitle': 'Акт по заявке №2210',
  'business.appActSub': 'Замена сифона · 240 000 {unit}',
  'business.appActBadge': 'Готов',
  'business.appCta': 'Оставить заявку',

  'business.reportsEyebrow': 'Документы',
  'business.reportsTitle': 'Три документа для бухгалтерии',
  'business.mockMonthlyCaption': 'Месячный отчёт по точкам',
  'business.mockSiteFirst': 'Аптека №7',
  'business.mockSiteSecond': 'Аптека №3',
  'business.mockActCaption': 'Акт с фото до и после',
  'business.mockBalanceCaption': 'Баланс абонентки',
  'business.mockBalanceIn': 'Внесено',
  'business.mockBalanceOut': 'Списано за месяц',
  'business.mockBalanceRest': 'Остаток',
  'business.mockNote': 'Так выглядят экраны. Цифры взяты для примера.',

  'business.startEyebrow': 'Как начинаем',
  'business.startTitle': 'От звонка до обслуживания — четыре шага',
  'business.startLead':
    'Обычно занимает от нескольких дней до недели — в зависимости от того, сколько у вас точек.',
  'business.startCta': 'Обсудить обслуживание',
  'business.startRequestTitle': 'Заявка',
  'business.startRequestText':
    'Оставляете контакты — менеджер связывается в тот же рабочий день.',
  'business.startSurveyTitle': 'Осмотр точек',
  'business.startSurveyText': 'Приезжаем, смотрим состояние и составляем паспорт объекта.',
  'business.startOfferTitle': 'Предложение',
  'business.startOfferText':
    'Присылаем расчёт: что входит в абонентскую плату, что оплачивается сверх.',
  'business.startContractTitle': 'Договор и старт',
  'business.startContractText': 'Подписываем, открываем кабинет, и точки под обслуживанием.',

  'business.faqEyebrow': 'Вопросы',
  'business.faqTitle': 'Что обычно спрашивают',
  'business.faqIncludedQ': 'Что входит в абонентскую плату?',
  'business.faqIncludedA':
    'Плановые осмотры, дежурство по авариям с обещанным сроком приезда, диспетчерская, ' +
    'отчётность и кабинет. Сами работы и материалы списываются по прайсу — их видно в отчёте ' +
    'отдельной строкой.',
  'business.faqTwoSitesQ': 'А если точек всего две?',
  'business.faqTwoSitesA':
    'Тоже работаем. Абонентская плата считается от типа и площади объектов, поэтому для двух ' +
    'точек и сумма будет небольшой. Точную цифру называем после осмотра.',
  'business.faqLateQ': 'Что если мастер не приехал в срок?',
  'business.faqLateA':
    'Срок приезда фиксируется в договоре, а нарушения видны в месячном отчёте. Порядок ' +
    'пересчёта и компенсаций прописывается там же.',
  'business.faqMaterialsQ': 'Кто отвечает за материалы?',
  'business.faqMaterialsA':
    'Можем закупать сами и включать в отчёт по чекам, можем работать с вашими. Как удобнее — ' +
    'фиксируем в договоре.',
  'business.faqContractQ': 'Работаете по договору и безналу?',
  'business.faqContractA':
    'Да, с закрывающими документами. Акты за месяц приходят пакетом, а не по каждой заявке ' +
    'отдельно. Форму расчётов менеджер зафиксирует в договоре под вашу бухгалтерию.',
  'business.faqTrialQ': 'Можно попробовать на одной точке?',
  'business.faqTrialA':
    'Можно. Возьмите одну точку на месяц-другой, посмотрите на отчёты и сроки — и уже потом ' +
    'подключайте остальные.',

  'business.ctaTitle': 'Посчитаем стоимость для вашей сети',
  'business.ctaLead':
    'Оставьте контакты — менеджер свяжется, посмотрит объекты и пришлёт расчёт. ' +
    'Если хотите прикинуть сами, есть калькулятор.',
  'business.ctaCalc': 'Обсудить обслуживание',
  'business.ctaCall': 'Позвонить {tel}',
};
