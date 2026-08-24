/**
 * L-05 «Мастерам» — набор исполнителей.
 *
 * Калькулятор заработка убран. Он показывал крупную сумму и тут же забирал её
 * обратно («это прикидка, а не обещание», «первые недели обычно выходит
 * меньше») — выглядело как обещание, читалось как отговорка, доверия не
 * давало. Вместо ползунков — прямая фраза о том, из чего складывается доход,
 * и честная вилка по заявкам в день.
 *
 * Это расходится с PRD-06 §3.5, где калькулятор перечислен среди элементов
 * экрана. Решение владельца; вернуть его — правка этого файла и секции в
 * Masters.tsx.
 *
 * Совмещение вынесено наверх: для действующего мастера это главное, что он
 * хочет узнать, — можно ли брать заявки, не бросая нынешнюю работу.
 */
export const mastersPage = {
  'mastersPage.heroChip': 'Набираем мастеров в Ташкенте',
  // {mark} — часть фразы под выделением; в переводе она может стоять в другом месте
  'mastersPage.heroTitle': 'Работа {mark}, а не по объявлениям',
  'mastersPage.heroTitleMark': 'по заявкам',
  'mastersPage.heroLead':
    'Ищем сантехников, электриков и мастеров по кондиционерам. Заявки приходят в приложение, ' +
    'клиентов и цену берём на себя. Можно работать на полную загрузку, а можно совмещать ' +
    'с нынешней работой — вы сами отмечаете, когда готовы выехать.',
  'mastersPage.applyCta': 'Стать мастером',
  'mastersPage.heroNote': 'Анкета — 2 минуты. Ответим за 2 рабочих дня.',
  'mastersPage.heroPhotoAlt': 'Мастер SOZO на выезде',
  // Карточка над фото читается как утверждение от лица компании, поэтому
  // суммы в ней нет: назвать чужой заработок мы не вправе. Сумма осталась
  // только внутри рамки телефона, где она читается как экран приложения
  'mastersPage.payoutCardTitle': 'Выплаты',
  'mastersPage.payoutCardValue': 'Каждый понедельник',
  'mastersPage.weekEarnings': 'Заработок за неделю',
  'mastersPage.payoutMonday': 'Выплата в понедельник',
  'mastersPage.appWeekSum': '1 340 000 сум',
  'mastersPage.newOrderNear': 'Новая заявка рядом',
  'mastersPage.newOrderDistance': '1,2 км',

  // Цифры под героем
  'mastersPage.statSharePrefix': 'до',
  'mastersPage.statShareLabel': 'ваша доля от заявки',
  'mastersPage.statPayoutValue': 'раз в неделю',
  'mastersPage.statPayoutLabel': 'выплаты на карту',
  'mastersPage.statOrdersLabel': 'заявок в день у активного мастера',
  'mastersPage.statLearningValue': 'бесплатно',
  'mastersPage.statLearningLabel': 'обучение и стандарты',

  'mastersPage.termsEyebrow': 'Условия',
  'mastersPage.termsTitle': 'Как это устроено',
  'mastersPage.termFlowTitle': 'Заявки приходят сами',
  'mastersPage.termFlowText':
    'Клиентов ищем мы. Реклама, объявления и разговоры про цену — не ваша работа. ' +
    'В приложении видно адрес, что сломалось и вашу долю до того, как вы согласились.',
  'mastersPage.termScheduleTitle': 'График и совмещение',
  'mastersPage.termScheduleText':
    'Отмечаете часы, когда готовы выехать. Хотите две заявки в неделю по вечерам — берите две. ' +
    'За аварийное дежурство есть гарантированная оплата смены, даже если заявок не было.',
  'mastersPage.termShareTitle': 'Доля растёт с уровнем',
  'mastersPage.termShareText':
    'Начинаете с базовой доли от суммы заявки, на верхнем уровне «Золото» — до 57%. Уровень ' +
    'зависит от закрытых заявок и качества, а не от стажа знакомства с руководством.',
  'mastersPage.termWeeklyTitle': 'Деньги каждую неделю',
  'mastersPage.termWeeklyText':
    'Заработок за неделю приходит на карту в понедельник. Не нужно ждать конца месяца ' +
    'и напоминать о себе.',
  'mastersPage.termTrainingTitle': 'Обучение за счёт компании',
  'mastersPage.termTrainingText':
    'Новое оборудование, техника безопасности, работа с клиентом. Учим бесплатно.',
  'mastersPage.termDisputeTitle': 'Спор с клиентом разбирает диспетчер',
  'mastersPage.termDisputeText':
    'Разногласия по цене и качеству — не ваша забота. Фото до и после в заявке подтверждают, ' +
    'что работа сделана.',

  // Заработок — словами, без ползунков
  'mastersPage.moneyEyebrow': 'Заработок',
  'mastersPage.moneyTitle': 'Из чего складывается',
  'mastersPage.moneyLead':
    'Ваш доход — это сумма заявки по прайсу, умноженная на вашу долю. Прайс один для всех, ' +
    'торговаться не нужно: цена уже в приложении, и вы видите свою часть до того, как взяли ' +
    'заявку.',
  'mastersPage.moneyOrdersTitle': 'Сколько заявок',
  'mastersPage.moneyOrdersText':
    'У активного мастера обычно 3–6 заявок в день. Зависит от специальности, района и сезона: ' +
    'летом по климату больше, зимой меньше.',
  'mastersPage.moneyShareTitle': 'Какая доля',
  'mastersPage.moneyShareText':
    'От базовой на старте до 57% на уровне «Золото». Долю по каждой заявке видно в приложении ' +
    'до того, как вы её взяли.',
  'mastersPage.moneyPayoutTitle': 'Когда деньги',
  'mastersPage.moneyPayoutText':
    'Раз в неделю на карту. Материалы согласуются с диспетчером и входят в смету клиента — ' +
    'своих денег вкладывать не нужно.',
  'mastersPage.moneyHonest':
    'Первые недели обычно выходит меньше, пока набираете скорость и уровень. Мы говорим об ' +
    'этом сразу, чтобы потом не было разговора «обещали больше».',

  'mastersPage.appEyebrow': 'Приложение мастера',
  'mastersPage.appTitle': 'Весь день — в телефоне',
  'mastersPage.appLead':
    'Никаких блокнотов и звонков «а сколько это стоит». Всё, что нужно на выезде, уже в приложении.',
  'mastersPage.appFeatureOrders': 'Новые заявки рядом с вами — видно адрес, работу и вашу долю',
  'mastersPage.appFeaturePrice': 'Прайс внутри: смета считается сама, торговаться не нужно',
  'mastersPage.appFeaturePhotos': 'Фото до и после снимаются в заявке — это и есть ваш отчёт',
  'mastersPage.appFeatureEarnings': 'Заработок виден по каждой заявке и за неделю',
  'mastersPage.appFeatureAndroid': 'Работает на обычном Android — новый телефон покупать не надо',
  'mastersPage.phoneLabel': 'Приложение мастера',
  'mastersPage.appNewOrderTitle': 'Новая заявка · 1,2 км',
  'mastersPage.appNewOrderSub': 'Электрика · не работает розетка',
  'mastersPage.appTakeBadge': 'Взять',
  'mastersPage.appNewOrderShare': 'Ваша доля: 96 000 сум · приехать с 16:00 до 18:00',
  'mastersPage.appTodayTitle': 'Сегодня в работе',
  'mastersPage.appTodaySub': '3 заявки · маршрут построен',
  'mastersPage.appTodayTime': '14:20',
  'mastersPage.appPhotosTitle': 'Фото после работы',
  'mastersPage.appPhotosBadge': 'Готово',
  'mastersPage.appCta': 'Взять заявку',

  'mastersPage.storiesEyebrow': 'Кто уже работает',
  'mastersPage.storiesTitle': 'Мастера о работе в SOZO',
  'mastersPage.storyIlhomName': 'Ильхом',
  'mastersPage.storyIlhomRole': 'Сантехник, 12 лет опыта',
  'mastersPage.storyIlhomText':
    'Раньше сам искал заказы и половину времени сидел без работы. Сейчас заявки приходят ' +
    'в приложение, а деньги — раз в неделю.',
  'mastersPage.storyBekzodName': 'Бекзод',
  'mastersPage.storyBekzodRole': 'Электрик, 9 лет опыта',
  'mastersPage.storyBekzodText':
    'Понравилось, что цена уже в приложении. Не надо спорить с клиентом — открыл, показал, сделал.',
  'mastersPage.storyRustamName': 'Рустам',
  'mastersPage.storyRustamRole': 'Кондиционеры, 7 лет опыта',
  'mastersPage.storyRustamText':
    'Летом беру больше смен, зимой меньше. График ставлю сам, никто не заставляет выходить.',
  'mastersPage.directions.one':
    'Набираем мастеров по {n} направлению: сантехника, электрика, кондиционеры, слаботочка, отделка и мелкий ремонт.',
  'mastersPage.directions.few':
    'Набираем мастеров по {n} направлениям: сантехника, электрика, кондиционеры, слаботочка, отделка и мелкий ремонт.',
  'mastersPage.directions.many':
    'Набираем мастеров по {n} направлениям: сантехника, электрика, кондиционеры, слаботочка, отделка и мелкий ремонт.',
  'mastersPage.directions.other':
    'Набираем мастеров по {n} направлениям: сантехника, электрика, кондиционеры, слаботочка, отделка и мелкий ремонт.',

  'mastersPage.reqEyebrow': 'Что нужно от вас',
  'mastersPage.reqTitle': 'Требования простые',
  'mastersPage.reqTools': 'Свой инструмент по вашей специальности',
  'mastersPage.reqExperience': 'Опыт, который можно показать на практике',
  'mastersPage.reqPhotos': 'Фото до и после каждой работы — это часть работы, а не лишняя бумажка',
  'mastersPage.reqManners': 'Аккуратность с клиентом: приехал вовремя, убрал за собой',
  'mastersPage.reqTransport': 'Транспорт — плюс, но не обязателен',

  'mastersPage.stepsEyebrow': 'Как попасть',
  'mastersPage.stepsTitle': 'Четыре шага',
  'mastersPage.stepFormTitle': 'Анкета',
  'mastersPage.stepFormText':
    'Заполняете форму: специальность, опыт, районы, где удобно работать.',
  'mastersPage.stepCallTitle': 'Звонок',
  'mastersPage.stepCallText': 'Рекрутер звонит, отвечает на вопросы и назначает день проверки.',
  'mastersPage.stepCheckTitle': 'Проверка навыков',
  'mastersPage.stepCheckText':
    'Практическое задание по вашей специальности и разговор о безопасности.',
  'mastersPage.stepFirstOrdersTitle': 'Первые заявки',
  'mastersPage.stepFirstOrdersText':
    'Получаете бейдж и доступ в приложение — и выходите на линию.',

  'mastersPage.referralBadge': 'Бонус',
  'mastersPage.referralTitle': 'Приведите знакомого мастера',
  'mastersPage.referralLead':
    'Работаете у нас и знаете хорошего мастера? Дайте ему свою ссылку. Когда он закроет ' +
    '20 заявок, вы получите бонус.',
  'mastersPage.referralNote': 'Ссылка и размер бонуса — в приложении, после выхода на линию.',

  'mastersPage.faqEyebrow': 'Вопросы',
  'mastersPage.faqTitle': 'Что спрашивают мастера',
  'mastersPage.faqCombineQ': 'Можно совмещать с основной работой?',
  'mastersPage.faqCombineA':
    'Да, так работает часть мастеров. Вы отмечаете часы, когда готовы выехать, и заявки ' +
    'приходят только в это время. Минимального числа заявок нет — важно держать слово по тем, ' +
    'которые вы взяли.',
  'mastersPage.faqEmploymentQ': 'Это работа в штате?',
  'mastersPage.faqEmploymentA':
    'Мастера работают по договору. Есть те, кто на полной загрузке, есть те, кто берёт заявки ' +
    'в свободное время. Условия одинаковые, разница только в количестве заявок.',
  'mastersPage.faqOrdersQ': 'Сколько заявок в день реально?',
  'mastersPage.faqOrdersA':
    'Обычно 3–6, зависит от специальности, района и сезона. В сезон по климату бывает больше.',
  'mastersPage.faqMaterialsQ': 'Кто платит за материалы?',
  'mastersPage.faqMaterialsA':
    'Материалы согласуются с диспетчером до начала работ и входят в смету клиента. Вкладывать ' +
    'свои деньги не нужно.',
  'mastersPage.faqComplaintQ': 'Что если клиент недоволен?',
  'mastersPage.faqComplaintA':
    'Разбирает диспетчер, а фото до и после — ваша защита. Именно поэтому мы просим снимать ' +
    'каждую работу.',
  'mastersPage.faqTransportQ': 'Нужен ли свой транспорт?',
  'mastersPage.faqTransportA':
    'Не обязательно. С транспортом заявок можно брать больше, поэтому это плюс, но не требование.',
  'mastersPage.faqAnswerTimeQ': 'Сколько ждать ответа по анкете?',
  'mastersPage.faqAnswerTimeA':
    'До двух рабочих дней. Если специальность сейчас нужна — звоним в тот же день.',

  'mastersPage.ctaTitle': 'Готовы начать?',
  'mastersPage.ctaLead':
    'Анкета занимает пару минут. Ответим за два рабочих дня и назначим проверку навыков.',
};
