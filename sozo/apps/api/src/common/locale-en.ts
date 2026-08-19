/**
 * Английская колонка серверных строк.
 *
 * Ключ — русский оригинал, ровно как он написан в коде (см. `locale.ts`).
 * Строки, которых здесь нет, уходят по-русски: пустой ответ хуже
 * непереведённого.
 *
 * Покрыто то, что показывает приложение клиента: категории и подсказки к ним,
 * статусы заявки, тексты уведомлений, справочники, способы оплаты и типовые
 * ответы. Строки приложения мастера сюда не переносились — у него интерфейс
 * русско-узбекский, и английская колонка для него была бы мёртвым грузом.
 *
 * Названия позиций прайса ведёт админ, и колонка `nameUz` у них есть, а
 * `nameEn` — нет. На английском названия работ пока приходят русскими; это
 * работа админки, а не словаря.
 */
export const EN: Record<string, string> = {
  // ---------- Категории каталога: ключ прайса, подпись, подсказка ----------
  'Не знаю, что сломалось': 'I do not know what is broken',
  'Мастер приедет и разберётся': 'A technician will come and work it out',
  'Трубы, краны, унитазы и др.': 'Pipes, taps, toilets and more',
  'Проводка, розетки, щитки': 'Wiring, sockets, panels',
  'Установка, чистка, ремонт': 'Installation, cleaning, repair',
  'Монтаж, замена, регулировка': 'Fitting, replacement, adjustment',
  'Ремонт стиралок, холодильников': 'Washing machine and fridge repair',
  'Полки, розетки и тд': 'Shelves, sockets and so on',
  'Поклейка обоев, покраска стен': 'Wallpapering, wall painting',
  'Ламинат, натяжные потолки и др.': 'Laminate, stretch ceilings and more',
  'Снос перегородок, штробы': 'Removing partitions, wall chases',
  'Металлоконструкции, заборы': 'Metalwork, fences',
  'Сборка мебели, чистка и др.': 'Furniture assembly, cleaning and more',

  // ---------- Статусы заявки ----------
  'Новая': 'New',
  'Оценена': 'Estimated',
  'Назначена': 'Assigned',
  'Мастер выехал': 'Technician on the way',
  'В работе': 'In progress',
  'Выполнена': 'Completed',
  'Проверена': 'Verified',
  'Ожидает оплаты': 'Awaiting payment',
  'Закрыта': 'Closed',
  'Отменена': 'Cancelled',
  'Спор': 'Dispute',
  'Ждёт вашего решения': 'Waiting for your decision',

  // ---------- Уведомления: заголовки ----------
  'Заявка оценена': 'Order estimated',
  'Мастер назначен': 'Technician assigned',
  'Мастер приступил к работе': 'The technician has started work',
  'Работа выполнена': 'Work completed',
  'Заявка проверена': 'Order verified',
  'Заявка закрыта': 'Order closed',
  'Заявка отменена': 'Order cancelled',
  'Спор открыт': 'Dispute opened',
  'Гарантия заканчивается': 'The warranty is ending',
  'Жалоба в работе': 'Complaint in progress',
  'Жалоба решена': 'Complaint resolved',
  'По жалобе принято решение': 'A decision has been made on the complaint',
  'Акт осмотра ждёт решения': 'An inspection report is waiting for a decision',
  'Счёт не оплачен': 'Invoice unpaid',
  'Ждёт оплаты': 'Awaiting payment',
  'Оцените работу мастера': 'Rate the technician',
  'Подтвердите стоимость — мастер ждёт': 'Confirm the price — the technician is waiting',
  'Мастер не может продолжить без вашего решения': 'The technician cannot continue without your decision',
  'Мастер что-то советует — можно отказаться': 'The technician has a suggestion — you can decline',
  'Выберите вариант запчасти': 'Choose a part option',
  'Подтвердите план визитов': 'Confirm the visit plan',
  'Работа готова — подтвердите приёмку': 'The work is done — confirm acceptance',

  // ---------- Уведомления: тексты ----------
  'Показали предварительную вилку — точную цену назовёт мастер на месте':
    'We have shown a preliminary range — the technician will name the exact price on site',
  'Уточните детали адреса, чтобы он доехал быстрее': 'Add the address details so they get to you faster',
  'Скоро будет у вас': 'Arriving soon',
  'Проверьте результат и подтвердите приёмку': 'Check the result and confirm acceptance',
  'Осталось оплатить': 'Payment is the last step',
  'Разберёмся и вернёмся с решением': 'We will look into it and come back with a decision',
  'осталось {0} дн. Если что-то не так — сообщите сейчас, это бесплатно':
    '{0} days left. If something is wrong, tell us now — it is free',
  'дефектов: {0}': 'defects: {0}',
  '{0} дн. с выставления': '{0} days since it was issued',

  // ---------- Справочники ----------
  'Клиент отменил (>2 ч до окна)': 'Client cancelled (more than 2 h before the slot)',
  'Клиент отменил (<2 ч — ложный вызов)': 'Client cancelled (less than 2 h — wasted call-out)',
  'Клиент недоступен на месте': 'Client unavailable on site',
  'Дубль заявки': 'Duplicate order',
  'Не согласована смета': 'Estimate not agreed',
  'Другое': 'Other',
  'Качество работы': 'Quality of work',
  'Не согласен с суммой': 'I disagree with the amount',
  'Приехал не тот мастер': 'The wrong technician arrived',
  'Я задерживаюсь': 'I am running late',
  'Позвоните мне': 'Call me',
  'Домофон не работает': 'The intercom is not working',
  'Затопление, короткое замыкание, запах газа. При запахе газа сначала звоните 104.':
    'Flooding, short circuit, smell of gas. If you smell gas, call 104 first.',
  'Окна показываем двухчасовые: 10:00–12:00 и так далее':
    'Slots are shown in two-hour windows: 10:00–12:00 and so on',
  'Сроки': 'Timing',

  // ---------- Способы оплаты ----------
  'Оплата в приложении Payme': 'Payment in the Payme app',
  'Оплата через Click': 'Payment via Click',
  'Оплата через Uzum': 'Payment via Uzum',
  'Банковская карта': 'Bank card',
  'Ввод реквизитов на защищённой странице банка': 'Card details entered on the secure bank page',
  'Наличные мастеру': 'Cash to the technician',
  'Мастер зафиксирует оплату в своём приложении': 'The technician records the payment in their app',
  'Карту привяжем, когда подключим платёжного провайдера. Пока запоминаем только способ':
    'We will save your card once a payment provider is connected. For now we only remember the method',
  'Запомнили — будем предлагать этот способ первым': 'Saved — we will offer this method first',
  'Будем спрашивать каждый раз': 'We will ask each time',

  // ---------- Типовые ответы и ошибки клиента ----------
  'Промокод не найден или истёк': 'The promo code was not found or has expired',
  'Этого района нет в списке обслуживаемых': 'This district is not on the serviced list',
  'Код не найден — проверьте написание': 'Code not found — check the spelling',
  'Заявка изменилась — обновите экран': 'The order has changed — refresh the screen',
  'Действие недоступно': 'This action is not available',
  'Не найдено': 'Not found',
  'Здесь появится техника после первого визита мастера':
    'Equipment will appear here after the first technician visit',
  'Оплат пока не было': 'No payments yet',
};

/**
 * Значения справочников: их приложение отправляет обратно на сервер, поэтому
 * они переводятся только на показ и не попадают в общий словарь.
 */
export const VALUES_EN: Record<string, string> = {
  'Сантехника': 'Plumbing',
  'Электрика': 'Electrics',
  'Кондиционеры': 'Air conditioning',
  'Отопление': 'Heating',
  'Бытовая техника': 'Home appliances',
  'Мелкий ремонт': 'Small repairs',
  'Окна и двери': 'Windows and doors',
  'Сварка': 'Welding',
  'Слаботочка': 'Low voltage',
  'Отделка': 'Finishing',
  'шт': 'pc',
  'м': 'm',
  'м²': 'm²',
  'п.м': 'lin. m',
  'компл': 'set',
  'час': 'hour',
  'точка': 'point',
  'Чиланзар': 'Chilanzar',
  'Юнусабад': 'Yunusabad',
  'Мирзо-Улугбек': 'Mirzo-Ulugbek',
  'Яшнабад': 'Yashnabad',
  'Шайхантахур': 'Shaykhantakhur',
  'Алмазар': 'Almazar',
  'Учтепа': 'Uchtepa',
  'Сергели': 'Sergeli',
  'Бектемир': 'Bektemir',
  'Яккасарай': 'Yakkasaray',
  'Ташкент': 'Tashkent',

  // Подписи категорий: приложение отправляет их обратно (жалоба с точки),
  // поэтому им место здесь, а не в общем словаре
  'ВЫЕЗД И ДИАГНОСТИКА': 'VISIT AND DIAGNOSIS',
  'САНТЕХНИКА': 'PLUMBING',
  'ЭЛЕКТРИКА': 'ELECTRICS',
  'КОНДИЦИОНЕРЫ И ВЕНТИЛЯЦИЯ': 'AIR CONDITIONING AND VENTILATION',
  'ОКНА, ДВЕРИ, БАЛКОНЫ': 'WINDOWS, DOORS, BALCONIES',
  'БЫТОВАЯ ТЕХНИКА (мелкий ремонт)': 'HOME APPLIANCES (small repairs)',
  'УНИВЕРСАЛЬНЫЕ РАБОТЫ (МУЖ НА ЧАС)': 'GENERAL JOBS (HANDYMAN)',
  'МАЛЯРНЫЕ И ОТДЕЛОЧНЫЕ РАБОТЫ': 'PAINTING AND FINISHING',
  'ПОЛЫ И ПОТОЛКИ': 'FLOORS AND CEILINGS',
  'ДЕМОНТАЖ, БУРЕНИЕ, ШТРОБЛЕНИЕ': 'DEMOLITION, DRILLING, CHASING',
  'СВАРОЧНЫЕ РАБОТЫ': 'WELDING',
  'СЛАБОТОЧКА, ИНТЕРНЕТ, БЕЗОПАСНОСТЬ': 'LOW VOLTAGE, INTERNET, SECURITY',
  'СЕРВИСНЫЕ УСЛУГИ': 'SERVICES',
  'Кондиционер': 'Air conditioning',
  'Двери и окна': 'Doors and windows',
  'Отделка и покраска': 'Finishing and painting',
  'Полы и потолки': 'Floors and ceilings',
  'Демонтаж и штробление': 'Demolition and chasing',
  'Сварочные работы': 'Welding',
  'Интернет и камеры': 'Internet and cameras',
  'Сервисные услуги': 'Services',
  'выезд': 'call-out',
};
