/**
 * Английская колонка серверных строк.
 *
 * Ключ — русский оригинал, ровно как он написан в коде (см. `locale.ts`).
 * Строки, которых здесь нет, уходят по-русски: пустой ответ хуже
 * непереведённого.
 *
 * Покрыты обе половины: то, что показывает приложение клиента (категории,
 * статусы заявки, уведомления, справочники, способы оплаты), и то, что видит
 * мастер (офферы, смета, фотофиксация, деньги, обучение и экзамен).
 * Терминология — как в английском интерфейсе приложения: мастер —
 * technician, заявка — order, стояк — riser, оффер — offer.
 *
 * Названия позиций прайса ведёт админ, и колонка `nameUz` у них есть, а
 * `nameEn` — нет. На английском названия работ пока приходят русскими; это
 * работа админки, а не словаря.
 *
 * Порядок ключей — как в сверялке (`tools/check-dicts.mjs`): по алфавиту
 * русского оригинала, чтобы колонки языков сравнивались построчно.
 */
export const EN: Record<string, string> = {
  '+{0} сум по заявке {1} — целиком вам': "+{0} sum for order {1} — entirely yours",
  '100 − 25 × (переделки по вине)': "100 − 25 × (rework through your fault)",
  '{0} дн. с выставления': "{0} days since it was issued",
  '{0} — заявка ушла другому мастеру': "{0} — the order went to another technician",
  '{0}, {1}. Ваша доля от {2} сум — {3} сек': "{0}, {1}. Your share of {2} sum — {3} sec",
  '~1 ч': "~1 h",
  '~2 ч': "~2 h",
  '~3 ч': "~3 h",
  '«{0}» требует допуск: {1}. Вызовите помощника или передайте заявку.': "«{0}» requires a permit: {1}. Call an assistant or hand the order over.",
  'Автомат 16А': "16 A circuit breaker",
  'Адрес не найден': "Address not found",
  'Аккумулятор': "Battery",
  'Акт {0} отправлен: {1}. Осмотр можно завершать.': "Report {0} sent: {1}. The inspection can be completed.",
  'Акт осмотра ведётся только по заявке на точку B2B': "An inspection report is only kept for a B2B site order",
  'Акт осмотра ждёт решения': "An inspection report is waiting for a decision",
  'Акт оформлен. PDF в архиве': "The report is issued. The PDF is in the archive",
  'Активация': "Activation",
  'Анкета': "Application form",
  'Анкета на проверке. Доступ к заявкам откроется после оформления и экзамена.': "The form is under review. Access to orders opens after onboarding and the exam.",
  'Анкета отклонена: {0}': "Form rejected: {0}",
  'Апелляция отклонена': "Appeal rejected",
  'Апелляция отправлена диспетчеру — решение придёт с обоснованием': "The appeal has been sent to the dispatcher — the decision will come with a reason",
  'Апелляция принята': "Appeal accepted",
  'Апсейл: клиент решает сам, конвейер не блокируется': "Upsell: the client decides, the pipeline is not blocked",
  'Базовый набор': "Basic set",
  'Баллов достаточно, осталось {0} закрытых заявок до «Золота»': "Points are enough, {0} closed orders left to reach Gold",
  'Банковская карта': "Bank card",
  'Бахилы и коврик под инструмент': "Shoe covers and a mat for tools",
  'Бахилы, коврик под инструмент, уборка после себя. Демонтированную деталь оставляйте клиенту — это снимает половину споров.': "Shoe covers, a mat for tools, clean up after yourself. Leave the removed part with the client — that prevents half of all disputes.",
  'Без даты диспетчер дозвонится до ТСЖ': "Without a date the dispatcher will get through to the homeowners association",
  'Без полного набора навык снимается и заявки по нему не приходят': "Without the full set the skill is removed and no orders come for it",
  'Бонус начисляется после {0} закрытых заявок приведённого мастера': "The bonus is credited after {0} closed orders by the technician you referred",
  'Бонус после {0} закрытых заявок, сейчас {1}': "Bonus after {0} closed orders, now {1}",
  'Будем спрашивать каждый раз': "We will ask each time",
  'В работе': "In progress",
  'Вакуумный насос': "Vacuum pump",
  'Валики и кисти': "Rollers and brushes",
  'Вариант «{0}» — можно выполнять': "Option «{0}» — you may proceed",
  'Введите код': "Enter the code",
  'Ввод реквизитов на защищённой странице банка': "Card details entered on the secure bank page",
  'Вентиляция: тяга, решётки, каналы': "Ventilation: draught, grilles, ducts",
  'Водоснабжение: течи, давление, состояние подводок': "Water supply: leaks, pressure, condition of the hoses",
  'Возмещения материалов': "Material reimbursements",
  'Возмещения — не доход, налогом не облагаются': "Reimbursements are not income and are not taxed",
  'Все этапы закрыты': "All stages are closed",
  'Вчера': "Yesterday",
  'Вы поставили запчасть без чека. Что будет?': "You fitted a part without a receipt. What happens?",
  'Вы уже выехали — позвоните диспетчеру': "You have already set off — call the dispatcher",
  'Выберите вариант запчасти': "Choose a part option",
  'Выберите причину из списка': "Choose a reason from the list",
  'Выберите районы, куда готовы выезжать': "Choose the districts you are ready to travel to",
  'Выберите способ оплаты': "Choose a payment method",
  'Выберите точку': "Select a site",
  'Выберите хотя бы одного мастера': "Select at least one technician",
  'Выбрасываю': "I throw it away",
  'Выехал': "On the way",
  'Выплаты заморожены: идёт сверка': "Payouts are frozen: reconciliation in progress",
  'Выплачен': "Paid out",
  'Выполнена': "Completed",
  'Выполняю консервацию и снимаю её на фото': "I do the make-safe and photograph it",
  'Гарантия заканчивается': "The warranty is ending",
  'Геолокация не определилась в подвале. Что происходит?': "Geolocation could not be determined in the basement. What happens?",
  'Гибкая подводка 1/2': "1/2 flexible hose",
  'Гофра 16 мм': "16 mm corrugated conduit",
  'График': "Schedule",
  'Далеко — не успею к окну': "Too far — I will not make the slot",
  'Данные для договора ГПХ': "Details for the services contract",
  'Дата окончания раньше начала': "The end date is earlier than the start date",
  'Действие недоступно': "This action is not available",
  'Делаю всё равно': "I do it anyway",
  'Делаю, раз согласен': "I do it, since the client agrees",
  'Демонтированную деталь оставьте клиенту': "Leave the removed part with the client",
  'Деньги': "Money",
  'Дефект фиксируется с фото': "A defect is recorded with a photo",
  'Диспетчер прозванивает клиента — до 15 минут. Оставайтесь рядом': "The dispatcher is calling the client — up to 15 minutes. Stay nearby",
  'Дисциплина офферов': "Offer discipline",
  'Для этой категории техника не фиксируется — закройте шаг одним тапом': "Equipment is not recorded for this category — close the step with one tap",
  'До «Золота» нужно больше 85 баллов и {0} закрытых заявок': "Gold needs more than 85 points and {0} closed orders",
  'До «Серебра» нужно 70 баллов': "Silver needs 70 points",
  'Добавьте хотя бы одну позицию': "Add at least one item",
  'Документ «{0}» в списке не значится': "Document «{0}» is not on the list",
  'Документы': "Documents",
  'Долг близок к лимиту — внесите наличные': "Your debt is close to the limit — hand in the cash",
  'Долг у лимита 2 000 000 сум — внесите через Payme, иначе снятие с линии': "Debt is at the 2 000 000 sum limit — pay via Payme or you will be taken off the line",
  'Доля за работы': "Share for the work",
  'Доля заблокирована спором до резолюции': "The share is blocked by a dispute until it is resolved",
  'Домофон не работает': "The intercom is not working",
  'Доп-работа согласуется только с фотодоказательством': "Extra work is only agreed with photo evidence",
  'Доп-смета отклонена': "Additional estimate rejected",
  'Доп-смета утверждена': "Additional estimate approved",
  'Дороже 200 000 сум — укажите выбранную клиентом вилку: {0}': "Over 200 000 sum — state the range the client chose: {0}",
  'Доступ открыт — можно выходить на линию': "Access granted — you can go on line",
  'Доступ приостановлен. Свяжитесь с диспетчером.': "Access suspended. Contact the dispatcher.",
  'Другое': "Other",
  'Дубль заявки': "Duplicate order",
  'Единица уже выдана или в ремонте': "This unit has already been issued or is under repair",
  'Ещё {0} заявок': "{0} more orders",
  'Жалоба в работе': "Complaint in progress",
  'Жалоба на клиента': "Complaint about the client",
  'Жалоба решена': "Complaint resolved",
  'Жду диспетчера': "Waiting for the dispatcher",
  'Ждём проверку документов — обычно 1–2 дня. Пока изучайте модули': "We are waiting for the document check — usually 1–2 days. Study the modules meanwhile",
  'Ждёт вашего решения': "Waiting for your decision",
  'Ждёт оплаты': "Awaiting payment",
  'Забираю себе': "I keep it",
  'Заболел': "Fell ill",
  'Задержка отмечается до начала работ': "A delay is reported before the work starts",
  'Закрыта': "Closed",
  'Закупка в долг компании — деньги мастера не нужны': "Purchase on the company account — the technician's own money is not needed",
  'Замена запустится немедленно. Уважительная причина — без санкций': "The replacement starts immediately. A valid reason means no penalty",
  'Занят на текущей заявке': "Busy with the current order",
  'Записывать на бумаге': "Write it down on paper",
  'Записываю в блокнот': "I write it in a notebook",
  'Запись «Смеситель, -, -» хуже отсутствия записи': "An entry like «Mixer tap, -, -» is worse than no entry at all",
  'Заполните анкету — это 5 минут': "Fill in the form — it takes 5 minutes",
  'Запомнили — будем предлагать этот способ первым': "Saved — we will offer this method first",
  'Заработан': "Earned",
  'Зарядное устройство': "Charger",
  'Затопление, короткое замыкание, запах газа. При запахе газа сначала звоните 104.': "Flooding, short circuit, smell of gas. If you smell gas, call 104 first.",
  'Зачислено': "Credited",
  'Зачислено на {0} сум — сумма пойдёт в возмещение': "{0} sum credited — the amount goes towards reimbursement",
  'Зачислено. Вы снова на линии': "Credited. You are back on the line",
  'Заявка': "Order",
  'Заявка будет закрыта с пометкой «выполнена частично». Фото проблемы и отказ клиента войдут в акт': "The order will be closed as «partly completed». The photo of the problem and the client's refusal will go into the report",
  'Заявка закрепляется за вами': "The order is assigned to you",
  'Заявка закрыта': "Order closed",
  'Заявка изменилась — обновите экран': "The order has changed — refresh the screen",
  'Заявка коллеге': "Order for a colleague",
  'Заявка на экзамен по навыку: {0}': "Exam request for skill: {0}",
  'Заявка отменена': "Order cancelled",
  'Заявка оценена': "Order estimated",
  'Заявка принята. Новый допуск открывается только через экзамен и подтверждение инструмента': "The request is accepted. A new permit is only opened through an exam and tool confirmation",
  'Заявка проверена': "Order verified",
  'Заявка снята с вас. Спасибо, что предупредили заранее': "The order has been taken off you. Thank you for the early warning",
  'Заявки': "Orders",
  'Заявки, требующие оборудование, приходят только мастерам с выданным оборудованием и транспортом': "Orders requiring equipment only go to technicians with issued equipment and transport",
  'Заявку нельзя будет завершить': "The order cannot be completed",
  'Заявку получит первый принявший': "The first to accept gets the order",
  'Заявку уже взял другой мастер': "Another technician has already taken the order",
  'Звонить диспетчеру после каждого шага': "Call the dispatcher after every step",
  'Звонок диспетчера': "Dispatcher call",
  'Звоню диспетчеру': "I call the dispatcher",
  'Звоню клиенту': "I call the client",
  'Здесь появится техника после первого визита мастера': "Equipment will appear here after the first technician visit",
  'Изолента': "Insulating tape",
  'Изолента и клеммы': "Insulating tape and terminals",
  'Индикатор напряжения': "Voltage tester",
  'Ищем помощника рядом…': "Looking for an assistant nearby…",
  'Кабель': "Cable",
  'Канализация: проходимость, запах, стыки': "Sewerage: flow, smell, joints",
  'Картридж смесителя 35 мм': "35 mm tap cartridge",
  'Карту привяжем, когда подключим платёжного провайдера. Пока запоминаем только способ': "We will save your card once a payment provider is connected. For now we only remember the method",
  'Категория с оборудованием — зафиксируйте шильдик': "Category with equipment — record the nameplate",
  'Качество работы': "Quality of work",
  'Качество фиксации': "Recording quality",
  'Кейс': "Tool case",
  'Клеммник Wago': "Wago terminal block",
  'Клиент выбрал вариант запчасти': "The client has chosen a part option",
  'Клиент ещё не выбрал вариант': "The client has not chosen an option yet",
  'Клиент недоступен на месте': "Client unavailable on site",
  'Клиент оставил чаевые': "The client left a tip",
  'Клиент отказался от вынужденных работ. Что делаете?': "The client refused the required work. What do you do?",
  'Клиент отказался от рекомендации': "The client declined the recommendation",
  'Клиент отказался. Предложите консервацию': "The client refused. Offer a make-safe",
  'Клиент отложил рекомендацию': "The client postponed the recommendation",
  'Клиент отменил (<2 ч — ложный вызов)': "Client cancelled (less than 2 h — wasted call-out)",
  'Клиент отменил (>2 ч до окна)': "Client cancelled (more than 2 h before the slot)",
  'Клиент получил наличные деньги от вас… то есть вы получили наличные. Что с ними?': "The client received cash from you… that is, you received the cash. What do you do with it?",
  'Клиент получит новое время': "The client will get a new time",
  'Клиент принял рекомендацию': "The client accepted the recommendation",
  'Клиент стоит рядом и согласен на доп-работу устно. Ваши действия?': "The client is standing next to you and agrees to extra work verbally. What do you do?",
  'Клиента не было — приёмка фиксируется фотографиями «после». Снимите результат.': "The client was not there — acceptance is recorded with «after» photos. Photograph the result.",
  'КлиматСервис': "KlimatServis",
  'Код на бейдже клиент сверяет на пороге. Печать и выдача — вне системы': "The client checks the code on your badge at the door. Printing and issuing are outside the system",
  'Код не найден — проверьте написание': "Code not found — check the spelling",
  'Код не совпал. Попросите клиента назвать код с экрана приёмки': "The code did not match. Ask the client to read the code from the acceptance screen",
  'Код приёмки — 4 цифры из приложения клиента': "The acceptance code is 4 digits from the client's app",
  'Комплектность неполная ({0}) — опишите расхождение, будет разбор с кладовщиком': "The set is incomplete ({0}) — describe the discrepancy, there will be a review with the storekeeper",
  'Консервация: клиент отказался от вынужденных работ': "Make-safe: the client refused the required work",
  'Кримпер': "Crimper",
  'Куда девается демонтированная деталь?': "Where does the removed part go?",
  'Ламинат, натяжные потолки и др.': "Laminate, stretch ceilings and more",
  'Лента ФУМ': "PTFE tape",
  'Лента на завтра собирается вечером': "Tomorrow's feed is assembled in the evening",
  'Лимит закупки по заявке исчерпан — согласуйте с диспетчером': "The purchase limit for the order is used up — agree it with the dispatcher",
  'Личные обстоятельства': "Personal circumstances",
  'Манометрический коллектор': "Manifold gauge set",
  'Маска': "Mask",
  'Мастер выехал': "Technician on the way",
  'Мастер зафиксирует оплату в своём приложении': "The technician records the payment in their app",
  'Мастер на линии': "Technician on the line",
  'Мастер назначен': "Technician assigned",
  'Мастер не может продолжить без вашего решения': "The technician cannot continue without your decision",
  'Мастер приедет и разберётся': "A technician will come and work it out",
  'Мастер приступил к работе': "The technician has started work",
  'Мастер что-то советует — можно отказаться': "The technician has a suggestion — you can decline",
  'Менять можно только черновик релиза: действующий прайс нередактируем': "Only a draft release can be edited: the active price list is immutable",
  'Месяц': "Month",
  'Металлоконструкции, заборы': "Metalwork, fences",
  'Минимальный': "Minimal",
  'Минимальный: безопасная времянка': "Minimal: a safe temporary fix",
  'Мирзо-Улугбек, ул. Мустакиллик 4': "Mirzo-Ulugbek, 4 Mustaqillik St",
  'Можно выполнять согласованную часть. Без ответа несогласованные позиции будут сняты': "You may do the agreed part. Without an answer the unagreed items will be removed",
  'Монтаж, замена, регулировка': "Fitting, replacement, adjustment",
  'Мультиметр': "Multimeter",
  'Набор прокладок': "Set of gaskets",
  'Назначена': "Assigned",
  'Называйте цену до начала работ, а не после. Если вскрылась доп-работа — фото и два варианта, решение за клиентом. Работа по несогласованной смете не оплачивается.': "Name the price before the work, not after. If extra work comes up — a photo and two options, the client decides. Work under an unagreed estimate is not paid.",
  'Накладная зафиксирована, позиции добавлены в материалы': "The delivery note is recorded, the items are added to materials",
  'Накладная на {0} сум превышает лимит кода {1} сум': "The delivery note of {0} sum exceeds the code limit of {1} sum",
  'Наличные мастеру': "Cash to the technician",
  'Наличные на руках сдаются в кассу; при просрочке офферы приостанавливаются (ТЗ 8.2)': "Cash on hand is handed in to the cash desk; if it is overdue, offers are suspended (spec 8.2)",
  'Наличные приняты. Сумма стала вашим долгом перед компанией': "The cash is accepted. The amount has become your debt to the company",
  'Напишите сообщение': "Write a message",
  'Насадки': "Attachments",
  'Насколько вероятно, что вы порекомендуете работу в SOZO знакомому мастеру?': "How likely are you to recommend working at SOZO to a fellow technician?",
  'Насос': "Pump",
  'Насос циркуляционный': "Circulation pump",
  'Начало работ дальше 300 м от адреса заявки': "The work is starting more than 300 m from the order address",
  'Начать нельзя: не подтверждены слоты следующих этапов': "Cannot start: the slots for the next stages are not confirmed",
  'Не знаю, что сломалось': "I do not know what is broken",
  'Не мой профиль работ': "Not my type of work",
  'Не найдено': "Not found",
  'Не сдано: {0} из {1}. Разберите темы и попробуйте снова': "Not passed: {0} of {1}. Go over the topics and try again",
  'Не согласен с суммой': "I disagree with the amount",
  'Не согласована смета': "Estimate not agreed",
  'Не указано событие': "No event specified",
  'Не успеваю': "I will not make it in time",
  'Не хватает снимков: {0}': "Photos missing: {0}",
  'Не хватает: {0}': "Missing: {0}",
  'Неверный код подтверждения': "Wrong confirmation code",
  'Недопустимое имя файла': "Invalid file name",
  'Неизвестные навыки: {0}': "Unknown skills: {0}",
  'Нет доступа к крыше': "No access to the roof",
  'Нет доступа к подвалу': "No access to the basement",
  'Нет доступа к стояку': "No access to the riser",
  'Нет доступа к щитовой': "No access to the switch room",
  'Нет нужного инструмента': "The right tool is missing",
  'Нет ответа 30 мин — повторный push и SMS, 2 часа — позвонит диспетчер': "No answer for 30 min — a repeat push and SMS, after 2 hours the dispatcher calls",
  'Ни одного': "None",
  'Ничего': "Nothing",
  'Ничего не меняется': "Nothing changes",
  'Ничего особенного': "Nothing special",
  'Новая': "New",
  'Новая в упаковке': "New, in the packaging",
  'Новый оффер': "New offer",
  'Нужно 4 ракурса, снято {0}': "4 angles are needed, {0} taken",
  'Нужно выйти на улицу и переснять': "You need to go outside and retake it",
  'Нужно минимум два варианта — иначе выбора у клиента нет': "At least two options are needed — otherwise the client has no choice",
  'Нужно отключение стояка': "The riser has to be shut off",
  'Нужны доп-работы': "Extra work is needed",
  'Обжимной инструмент': "Crimping tool",
  'Обновите приложение, чтобы продолжить работу': "Update the app to carry on working",
  'Оборудование не выдано': "The equipment has not been issued",
  'Обучение': "Training",
  'Общение с клиентом': "Communication with the client",
  'Общие зоны: подвал, стояки, крыша (если доступ есть)': "Common areas: basement, risers, roof (if there is access)",
  'Обязательная доп-работа': "Required extra work",
  'Одно': "One",
  'Одобренный отпуск исключает вас из распределения заявок': "Approved leave takes you out of order distribution",
  'Ожидает оплаты': "Awaiting payment",
  'Ожидается data:image/...;base64,...': "Expected data:image/...;base64,...",
  'Ожидается изображение: {0}': "An image is expected: {0}",
  'Ожидание материалов: клиент покупает сам': "Waiting for materials: the client buys them",
  'Окна показываем двухчасовые: 10:00–12:00 и так далее': "Slots are shown in two-hour windows: 10:00–12:00 and so on",
  'Опишите причину': "Describe the reason",
  'Опишите, с чем не согласны — это уйдёт диспетчеру': "Describe what you disagree with — this goes to the dispatcher",
  'Оплат пока не было': "No payments yet",
  'Оплата в приложении Payme': "Payment in the Payme app",
  'Оплата через Click': "Payment via Click",
  'Оплата через Uzum': "Payment via Uzum",
  'Основной блок': "Main unit",
  'Оставляю клиенту': "I leave it with the client",
  'Осталось оплатить': "Payment is the last step",
  'Отвёртки прецизионные': "Precision screwdrivers",
  'Отменена': "Cancelled",
  'Отметили как купленное': "Marked as bought",
  'Отметку ставит ведущий мастер': "The lead technician marks it",
  'Отметьте зоны обхода': "Mark the areas to walk round",
  'Отметьте хотя бы один навык — заявки приходят только по вашим тегам': "Mark at least one skill — orders only come by your tags",
  'Отопление: котёл, радиаторы, запорная арматура': "Heating: boiler, radiators, shut-off valves",
  'Отправлено диспетчеру. Санкций за прерывание нет': "Sent to the dispatcher. There is no penalty for stopping",
  'Отправлено клиенту': "Sent to the client",
  'Отправлено на приёмку — ждём подтверждения ответственного': "Sent for acceptance — waiting for the person in charge to confirm",
  'Отправлено на проверку — обычно 1–2 дня': "Sent for review — usually 1–2 days",
  'Отправлено. Вы свободны для других заявок': "Sent. You are free for other orders",
  'Отправляю фото и варианты ему в приложение': "I send the photo and the options to his app",
  'Отправьте смету клиенту: подтверждение в приложении, звонком диспетчера или подписью офлайн': "Send the estimate to the client: confirmation in the app, by a dispatcher call or an offline signature",
  'Отсутствие переделок': "No rework",
  'Оформление': "Onboarding",
  'Оффер висит 60 секунд, вы не ответили. Что происходит?': "The offer hung for 60 seconds and you did not answer. What happens?",
  'Оффер истёк': "The offer has expired",
  'Оффер истёк — заявка ушла другому мастеру': "The offer has expired — the order went to another technician",
  'Оффер уже обработан': "The offer has already been handled",
  'Оценена': "Estimated",
  'Оцените работу мастера': "Rate the technician",
  'Оцените, сколько нужна помощь': "Estimate how long the help is needed",
  'Оценка от 0 до 10': "A score from 0 to 10",
  'Оценки клиентов': "Client ratings",
  'Паспорт: разворот и прописка': "Passport: photo page and registration",
  'Пауза': "Pause",
  'Переходники': "Adapters",
  'Перечислите позиции накладной — диспетчер сверит со сметой': "List the delivery note items — the dispatcher will check them against the estimate",
  'План сдвинут. Очередь пересчитана': "The plan has shifted. The queue is recalculated",
  'Плата управления котла': "Boiler control board",
  'По жалобе принято решение': "A decision has been made on the complaint",
  'Повторное напоминание': "Repeat reminder",
  'Повторное фото «до» при возобновлении не нужно': "A second «before» photo is not needed when you resume",
  'Повторные заявки по этой технике придут вам': "Repeat orders for this equipment will come to you",
  'Поддерживаются JPEG, PNG, WebP': "JPEG, PNG and WebP are supported",
  'Подтвердите акт кодом — код выдаёт сервер, офлайн подтвердить нельзя': "Confirm the report with a code — the server issues the code, it cannot be confirmed offline",
  'Подтвердите инструмент: {0}. Без полного набора навык не активируется': "Confirm your tools: {0}. Without the full set the skill is not activated",
  'Подтвердите план визитов': "Confirm the visit plan",
  'Подтвердите стоимость — мастер ждёт': "Confirm the price — the technician is waiting",
  'Позвоните мне': "Call me",
  'Позиция не из каталога расходников': "The item is not from the consumables catalogue",
  'Позиция отсутствует в активном релизе прайса': "The item is not in the active price list release",
  'Покажите QR клиенту': "Show the QR code to the client",
  'Показали предварительную вилку — точную цену назовёт мастер на месте': "We have shown a preliminary range — the technician will name the exact price on site",
  'Показатели уточнятся после пяти закрытых заявок': "The figures will settle after five closed orders",
  'Поклейка обоев, покраска стен': "Wallpapering, wall painting",
  'Покупать нечего — все выбранные позиции уже в заявках': "There is nothing to buy — all the selected items are already in orders",
  'Полки, розетки и тд': "Shelves, sockets and so on",
  'Полный': "Full",
  'Полный: замена целиком': "Full: complete replacement",
  'Половина моя': "Half is mine",
  'Полсмены': "Half a shift",
  'Помощник уже назначен': "An assistant has already been assigned",
  'Помощь подтверждена ведущим': "The lead has confirmed the help",
  'Помощь подтверждена — фикс придёт помощнику после закрытия заявки': "The help is confirmed — the assistant gets the fixed fee after the order is closed",
  'Пополнение зачисляется только по чеку': "A top-up is only credited against a receipt",
  'Попросите клиента расписаться на экране': "Ask the client to sign on the screen",
  'Попытки исчерпаны — свяжитесь с диспетчером': "No attempts left — contact the dispatcher",
  'Предыдущая операция по заявке не прошла': "The previous operation on the order did not go through",
  'Прекратить работу': "Stop the work",
  'Премиум': "Premium",
  'Пресс-инструмент REMS': "REMS press tool",
  'Пресс-клещи': "Press jaws",
  'Прибор': "Device",
  'Приведите мастера — получите бонус после его 20 закрытых заявок': "Refer a technician — get a bonus after their 20 closed orders",
  'Придёт повторно': "Will come again",
  'Приехал не тот мастер': "The wrong technician arrived",
  'Приложение сжимает снимок до ~500 КБ перед отправкой (PRD-05 §9)': "The app compresses the photo to about 500 KB before sending (PRD-05 §9)",
  'Приступить к работе': "Start the work",
  'Приходите на собеседование: {0}': "Come for an interview: {0}",
  'Причина отказа из справочника: {0}': "Reason for refusal from the list: {0}",
  'Причина отказа обязательна — кандидат её увидит': "A reason for rejection is required — the candidate will see it",
  'Приёмка зафиксирована — можно завершать заявку': "Acceptance is recorded — the order can be completed",
  'Приёмка подтвердится автоматически вебхуком успешного платежа': "Acceptance will be confirmed automatically by the successful payment webhook",
  'Приёмка через приложение — только для заявок B2B': "Acceptance through the app is only for B2B orders",
  'Проверена': "Verified",
  'Проверьте результат и подтвердите приёмку': "Check the result and confirm acceptance",
  'Проводка, розетки, щитки': "Wiring, sockets, panels",
  'Продолжать — всё уйдёт очередью при появлении сети': "Carry on — everything is queued and sent when the network is back",
  'Продолжить': "Continue",
  'Пройдите модули и сдайте экзамен': "Take the modules and pass the exam",
  'Пройдите учебную заявку целиком: выезд → фото «до» → смета → материалы с чеками → фото «после» → приёмка → оплата. Каждый шаг открывается только после предыдущего.': "Go through a training order end to end: the visit → «before» photos → estimate → materials with receipts → «after» photos → acceptance → payment. Each step opens only after the previous one.",
  'Прокладка резиновая': "Rubber gasket",
  'Промокод не найден или истёк': "The promo code was not found or has expired",
  'Прочее': "Other",
  'Прошлая': "Previous",
  'Пунктуальность': "Punctuality",
  'Пять': "Five",
  'Работа блокируется': "The work is blocked",
  'Работа выполнена': "Work completed",
  'Работа готова — подтвердите приёмку': "The work is done — confirm acceptance",
  'Работа уже принята': "The work has already been accepted",
  'Разберёмся и вернёмся с решением': "We will look into it and come back with a decision",
  'Разводной ключ': "Adjustable wrench",
  'Раздел доступен только сотрудникам организаций': "This section is for organisation staff only",
  'Расходники из сумки списываются в заявку автоматически. Сумма расходников идёт вам полностью': "Consumables from your bag are written off to the order automatically. The amount for consumables goes to you in full",
  'Расходники сумки': "Bag consumables",
  'Рекомендации на рейтинг не влияют. Работа по непринятой рекомендации не оплачивается.': "Recommendations do not affect the rating. Work under a recommendation the client did not accept is not paid.",
  'Ремонт стиралок, холодильников': "Washing machine and fridge repair",
  'Репутация': "Reputation",
  'Рефералов пока нет: код вводится кандидатом в анкете при оформлении': "No referrals yet: the candidate enters the code in the form during onboarding",
  'Решение уже принято': "A decision has already been made",
  'Русский': "Russian",
  'С указанной датой заявка вернётся в ленту автоматически': "With a date set the order returns to the feed automatically",
  'Сантехмир': "Santehmir",
  'Сборка мебели, чистка и др.': "Furniture assembly, cleaning and more",
  'Сварочный аппарат': "Welding machine",
  'Свободных мастеров на линии нет': "There are no free technicians on the line",
  'Свободных помощников нет. Позвоните диспетчеру — перенос согласует он': "There are no free assistants. Call the dispatcher — he will arrange the reschedule",
  'Сдайте мини-экзамен': "Take the mini exam",
  'Сдаю на склад': "I hand it in to the warehouse",
  'Сегодня': "Today",
  'Сеть пропала посреди работы. Что делать?': "The network dropped in the middle of the job. What do you do?",
  'Сзади': "From behind",
  'Силиконовый герметик': "Silicone sealant",
  'Ситуация на объекте кажется опасной. Ваши действия?': "The situation on site looks dangerous. What do you do?",
  'Сколько минимум фото «до» нужно, чтобы начать работу?': "How many «before» photos are needed as a minimum to start work?",
  'Скоро будет у вас': "Arriving soon",
  'Слева': "From the left",
  'Смена не начата — офферы не приходят': "The shift has not started — offers do not come",
  'Смета согласована': "The estimate is agreed",
  'Сначала заполните анкету': "Fill in the form first",
  'Сначала назначьте собеседование': "Schedule an interview first",
  'Сначала пройдите все учебные модули': "Go through all the training modules first",
  'Снимите выполненную консервацию — это юридическая защита': "Photograph the make-safe you did — it is your legal protection",
  'Снимите дверь — это подтверждение выезда': "Photograph the door — it is the proof of the visit",
  'Снимите документ камерой': "Photograph the document with the camera",
  'Снимите документы и подтвердите инструмент': "Photograph your documents and confirm your tools",
  'Снимите закрытую дверь — без фото пауза не оформляется': "Photograph the closed door — without a photo the pause is not registered",
  'Снимите накладную — диспетчер сверит её со сметой': "Photograph the delivery note — the dispatcher will check it against the estimate",
  'Снимите общий вид техники': "Photograph the general view of the equipment",
  'Снимите чек — пополнение зачисляется по себестоимости из него': "Photograph the receipt — the top-up is credited at the cost price on it",
  'Снимите шильдик — модель дозаполнит модерация по фото': "Photograph the nameplate — moderation will fill in the model from the photo",
  'Снос перегородок, штробы': "Removing partitions, wall chases",
  'Сняты с линии: долг по наличным. Внесите через Payme, чтобы вернуться': "Taken off the line: cash debt. Pay via Payme to come back",
  'Собеседование': "Interview",
  'Спереди': "From the front",
  'Список у клиента. Вы свободны': "The client has the list. You are free",
  'Спор': "Dispute",
  'Спор открыт': "Dispute opened",
  'Справа': "From the right",
  'Справка о статусе самозанятого (Soliq)': "Self-employed status certificate (Soliq)",
  'Сроки': "Timing",
  'Срочная замена рядом': "Urgent replacement nearby",
  'Ссылка отправлена клиенту — ждём оплату': "The link has been sent to the client — waiting for payment",
  'Ставится флаг «без гео», работа продолжается': "A «no geo» flag is set and the work goes on",
  'Стадия: before | during | after | receipt': "Stage: before | during | after | receipt",
  'Стандарт': "Standard",
  'Стандарты сервиса': "Service standards",
  'Старая деталь': "Old part",
  'Сумка пуста. Пополните чеком — расходники в заявках будут списываться отсюда': "The bag is empty. Top it up with a receipt — consumables in orders will be written off from here",
  'Сумма больше вашего долга': "The amount is larger than your debt",
  'Сфотографируйте чек — запчасть без чека внести нельзя. Без чека проводятся только расходники «сумки».': "Photograph the receipt — a part cannot be added without one. Only «bag» consumables go through without a receipt.",
  'Считается отказом, заявка уходит другому': "It counts as a refusal and the order goes to someone else",
  'Счёт не оплачен': "Invoice unpaid",
  'ТЭН для бойлера': "Boiler heating element",
  'Такой техники у вас нет': "You do not have such equipment",
  'Тепловизор': "Thermal imager",
  'Терплю и доделываю': "I put up with it and finish",
  'Тестер линий': "Line tester",
  'Течеискатель': "Leak detector",
  'Только инструмент': "Tools only",
  'Точный адрес и телефон клиента открываются после принятия (PRD-02 §3.2)': "The exact address and the client's phone open after you accept (PRD-02 §3.2)",
  'Тренажёр конвейера': "Pipeline simulator",
  'Три': "Three",
  'Труборез': "Pipe cutter",
  'Трубы, краны, унитазы и др.': "Pipes, taps, toilets and more",
  'У осмотра нет фото «после» — вместо него чек-лист и подпись ответственного на точке': "An inspection has no «after» photo — instead there is a checklist and the signature of the person in charge at the site",
  'У точки нет ответственного — принимать работу некому. Сообщите диспетчеру.': "The site has no person in charge — there is no one to accept the work. Tell the dispatcher.",
  'УК: «завтра»': "Management company: «tomorrow»",
  'Удержания': "Deductions",
  'Удержания появляются при гарантийных переделках по вине и регрессе ущерба': "Deductions appear for warranty rework through your fault and for damage recovery",
  'Укажите ФИО': "Enter your full name",
  'Укажите деталь': "Specify the part",
  'Укажите причину — это смягчает последствия': "Give a reason — it softens the consequences",
  'Укажите, что это за техника': "Say what this equipment is",
  'Укрывной материал': "Covering material",
  'Установка, чистка, ремонт': "Installation, cleaning, repair",
  'Установленная': "Installed",
  'Уточните детали адреса, чтобы он доехал быстрее': "Add the address details so they get to you faster",
  'Ухожу': "I leave",
  'Ухожу, но получу штраф': "I leave, but I get a fine",
  'Ухожу, санкций за прерывание нет': "I leave, there is no penalty for stopping",
  'Учебные модули открыты сразу — начните, пока идёт проверка документов': "The training modules are open straight away — start while the documents are being checked",
  'Фикс помощника оплачивает не клиент': "The assistant's fixed fee is not paid by the client",
  'Форму по желанию': "Uniform is optional",
  'Форс-мажор': "Force majeure",
  'Фото «до» и «после» — единственное доказательство в споре. Снимайте узел целиком и с того же ракурса, что «до». Без фото «до» статус «В работе» не откроется.': "«Before» and «after» photos are the only evidence in a dispute. Shoot the whole assembly from the same angle as «before». Without a «before» photo the status «In progress» will not open.",
  'Фото не сохранится': "The photo will not be saved",
  'Фотофиксация': "Photo records",
  'Фреон R32 (дозаправка)': "R32 refrigerant (top-up)",
  'Чаевые': "Tips",
  'Чаевые приходят целиком вам, мимо долей и удержаний': "Tips come to you in full, past shares and deductions",
  'Чаевые целиком ваши: комиссия с них не берётся': "The tips are entirely yours: no commission is taken from them",
  'Чек можно донести потом': "The receipt can be brought later",
  'Черновик — маршрут может измениться до утра': "A draft — the route may change before morning",
  'Чехол': "Pouch",
  'Чиланзар, ул. Бунёдкор 12': "Chilanzar, 12 Bunyodkor St",
  'Что берёте на каждый выезд?': "What do you take on every visit?",
  'Что такое «Рекомендовать»?': "What does «Recommend» mean?",
  'Шланги': "Hoses",
  'Шпатели': "Spatulas",
  'Штраф': "Fine",
  'Экзамен': "Exam",
  'Экзамен доступен только при сети': "The exam is only available with a network connection",
  'Экзамен не сдан — активация невозможна': "The exam is not passed — activation is not possible",
  'Экзамен откроется после собеседования — пока изучайте модули': "The exam opens after the interview — study the modules meanwhile",
  'Экзамен сдан — ждём подписание договора и активацию': "The exam is passed — waiting for the contract signing and activation",
  'Экзамен сдан. Карточка создана — доступ откроет администратор после подписания договора': "The exam is passed. The card is created — an administrator will open access after the contract is signed",
  'Эконом': "Economy",
  'Электрика: щит, автоматы, розеточные группы, УЗО': "Electrics: panel, breakers, socket circuits, RCD",
  'ЭлектроДом': "ElektroDom",
  'Электроды': "Electrodes",
  'Эта единица за вами не числится': "This unit is not assigned to you",
  'Эта неделя': "This week",
  'Этап завершён': "The stage is finished",
  'Этап закрывается фото «в процессе»': "The stage is closed with an «in progress» photo",
  'Этап закрыт. Перерыв до {0} — заявка не занимает вашу ленту': "The stage is closed. A break until {0} — the order does not take up your feed",
  'Это действие выполняет диспетчер. Мастеру доступны: {0}': "This action is done by the dispatcher. A technician can: {0}",
  'Это долг перед компанией, сдаётся в кассу': "This is a debt to the company and is handed in to the cash desk",
  'Это мой доход': "This is my income",
  'Этого района нет в списке обслуживаемых': "This district is not on the serviced list",
  'Этой услуги нет в действующем прайсе — выберите работу заново': "This service is no longer in the active price list — pick the work again",
  'Этот допуск у вас уже есть': "You already have this permit",
  "Доступ к заявкам закрыт администратором. Свяжитесь с диспетчером.":
    "Access to orders has been closed by an administrator. Contact the dispatcher.",
  "Доступ к заявкам ещё не открыт. Его открывает администратор — позвоните диспетчеру.":
    "Access to orders is not open yet. An administrator opens it — call the dispatcher.",
  'Этот номер не привязан к карточке мастера. Обратитесь к диспетчеру.': "This number is not linked to a technician card. Contact the dispatcher.",
  'Юнусабад, ул. Амира Темура 88': "Yunusabad, 88 Amir Temur St",
  'Я задерживаюсь': "I am running late",
  'без причины': "no reason",
  'дефектов: {0}': "defects: {0}",
  'доля «Приступить» внутри окна × 100': "share of «Start» taps inside the slot × 100",
  'доля принятых офферов × 100': "share of accepted offers × 100",
  'доля фото-пакетов, принятых с первой попытки × 100': "share of photo sets accepted on the first try × 100",
  'кг': "kg",
  'клиент недоступен: фото двери': "client unavailable: photo of the door",
  'консервация': "make-safe",
  'накладная по коду закупки': "delivery note by purchase code",
  'нет доступа: третья сторона': "no access: third party",
  'обоснование доп-работы': "justification for extra work",
  'общий вид техники': "general view of the equipment",
  'осталось {0} дн. Если что-то не так — сообщите сейчас, это бесплатно': "{0} days left. If something is wrong, tell us now — it is free",
  'ответственному': "to the person in charge",
  'прерывание: небезопасно': "stopping: unsafe",
  'рекомендация': "recommendation",
  'согласования': "approvals",
  'средняя оценка × 20, сглаживание к 4.5 при <10 оценок': "average rating × 20, smoothed towards 4.5 with fewer than 10 ratings",
  'туба': "tube",
  'фото лица': "photo of the face",
  'фото набора инструмента': "photo of the tool set",
  'чек: {0}': "receipt: {0}",
  'шильдик': "nameplate",
  "Объект обслуживает другая эксплуатирующая организация":
    "The property is served by another operating company",
  "Наряды-допуски и пропуска ведут диспетчерская, служба объекта и мастер на заявке":
    "Work permits and visitor passes are handled by the dispatch desk, the site service and the technician on the order",
  "Помещение не найдено":
    "Unit not found",
  "Житель должен понять, зачем к нему идут":
    "The resident has to understand why someone is coming",
  "Окно доступа: конец должен быть позже начала":
    "Access window: the end must be later than the start",
  "Запрос не найден":
    "Request not found",
  "Укажите причину — мастеру надо понять, что делать дальше":
    "Give a reason — the technician needs to know what to do next",
  "Предложите окно: конец позже начала":
    "Propose a window: the end later than the start",
  "Окно пропуска: конец должен быть позже начала":
    "Pass window: the end must be later than the start",
  "Пропуск выписывается не больше чем на неделю":
    "A pass is issued for no more than a week",
  "Укажите, кого ждёте — охране надо кого-то встретить":
    "Say who you are expecting — security has to meet someone",
  "Пропуск не найден":
    "Pass not found",
  "Отозвать можно только свой пропуск":
    "You can only revoke your own pass",
  "Подходящих мастеров нет — см. причины отсева":
    "No suitable technicians — see the filtering reasons",
  "Ручная проводка требует двойного подтверждения (PRD-04 §1.3)":
    "A manual entry requires double confirmation (PRD-04 §1.3)",
  "Сторно требует двойного подтверждения (PRD-04 §1.3)":
    "A reversal requires double confirmation (PRD-04 §1.3)",
  "У организации нет абонентки":
    "The organisation has no subscription",
  "Закрытие периода требует двойного подтверждения":
    "Closing a period requires double confirmation",
  "Переоткрытие периода требует двойного подтверждения":
    "Reopening a period requires double confirmation",
  "Стартовые остатки требуют подтверждения админа и бухгалтера (A-32)":
    "Opening balances require confirmation by an admin and an accountant (A-32)",
  "Сумма проводки — целое число тийинов; дробь, NaN и бесконечность недопустимы":
    "An entry amount is a whole number of tiyin; fractions, NaN and infinity are not allowed",
  "Пени не предусмотрены договором этой организации":
    "This organisation's contract provides for no late fees",
  "Баланс-чекер красный — закрытие запрещено (A-22 блокер)":
    "The balance checker is red — closing is blocked (A-22 blocker)",
  "Стартовые остатки уже внесены (идемпотентность A-32)":
    "Opening balances have already been entered (A-32 idempotency)",
  "Комиссия провайдера — от 0 до 999 промилле (0–99,9%)":
    "Provider fee — from 0 to 999 per mille (0–99.9%)",
  "Контур «Дом» доступен персоналу эксплуатирующей организации и диспетчерской":
    "The Home contour is available to operating company staff and the dispatch desk",
  "На объект несколько заявок — решение принимается в очереди модерации A-39":
    "There are several claims on this property — the decision is made in the A-39 moderation queue",
  "Оборудование не найдено":
    "Equipment not found",
  "Сессия ТО не найдена":
    "Maintenance session not found",
  "ТО уже завершено — отметки не меняются":
    "Maintenance is complete — the marks cannot be changed",
  "Пункта нет в регламенте этого оборудования":
    "This item is not in the regulation for this equipment",
  "Эта точка не закреплена за вами":
    "This site is not assigned to you",
  "Заявка не привязана к точке":
    "The order is not linked to a site",
  "Мастер ещё не отправил работу на приёмку":
    "The technician has not submitted the work for acceptance yet",
  "Укажите, что именно не принято":
    "Say what exactly was not accepted",
  "Этот номер не закреплён ни за одной точкой. Обратитесь к своему менеджеру SOZO.":
    "This number is not assigned to any site. Contact your SOZO manager.",
  "Обслуживание организации приостановлено — операции недоступны.":
    "Service to the organisation is suspended — operations are unavailable.",
  "Сумма крупная — подтвердите, что это вы: введите последние 4 цифры своего номера":
    "The amount is large — confirm it is you: enter the last 4 digits of your number",
  "Опишите, что случилось":
    "Describe what happened",
  "Утверждение сметы не входит в ваши права — решение принимает руководитель":
    "Approving an estimate is not within your rights — the decision is made by the head",
  "Сумма выше вашего лимита — решение принимает уровень выше":
    "The amount is above your limit — the decision is made one level up",
  "Выберите вариант работ":
    "Choose a work option",
  "Финансы видит руководитель организации":
    "Finances are visible to the head of the organisation",
  "Раздел доступен руководителям":
    "The section is available to heads",
  "Укажите имя":
    "Enter a name",
  "Свой потолок утверждения менять нельзя — он задан договором":
    "You cannot change your own approval limit — it is set by the contract",
  "Себя снять нельзя":
    "You cannot remove yourself",
  "Решение по акту принимает руководитель":
    "The decision on the report is made by the head",
  "Сумма выбранных позиций выше вашего лимита — уберите часть или передайте выше":
    "The selected items exceed your limit — remove some or pass it up",
  "Это не ваша заявка":
    "This is not your order",
  "Приложите фотографию — без неё обращение не примут":
    "Attach a photo — the request will not be accepted without one",
  "Выберите, что случилось":
    "Choose what happened",
  "Укажите, как к вам обращаться":
    "Tell us how to address you",
  "Слишком длинное имя":
    "The name is too long",
  "Введите код приглашения":
    "Enter the invitation code",
  "Укажите улицу и дом":
    "Enter the street and building",
  "Выберите работу или опишите проблему словами":
    "Choose a job or describe the problem in words",
  "Введите промокод":
    "Enter a promo code",
  "Выбор запчасти уже сделан":
    "The part has already been chosen",
  "Выберите вариант":
    "Choose an option",
  "План визитов ещё не составлен":
    "The visit plan has not been drawn up yet",
  "Неизвестный вид решения":
    "Unknown decision type",
  "Выберите причину отмены":
    "Choose a cancellation reason",
  "Перенести уже нельзя — можно только отменить":
    "Rescheduling is no longer possible — only cancellation",
  "Выберите новое время":
    "Choose a new time",
  "До визита меньше двух часов — мастер уже планирует день. Позвоните диспетчеру, он решит на месте":
    "Less than two hours until the visit — the technician has already planned the day. Call the dispatcher, they will sort it out",
  "Заявку уже переносили дважды. Дальше — только через диспетчера, чтобы не потерять ваше время":
    "The order has already been rescheduled twice. Anything further goes through the dispatcher, so your time is not wasted",
  "Работа ещё не завершена":
    "The work is not finished yet",
  "Поставьте оценку от 1 до 5":
    "Give a rating from 1 to 5",
  "Расскажите, что случилось — разберёмся и перезвоним":
    "Tell us what happened — we will look into it and call you back",
  "Опишите, что случилось снова":
    "Describe what happened again",
  "Гарантийный срок истёк":
    "The warranty period has expired",
  "Выберите причину":
    "Choose a reason",
  "Опишите, в чём проблема":
    "Describe the problem",
  "Приложение сжимает снимок перед отправкой":
    "The app compresses the photo before sending",
  "Отозвать согласие на обработку данных можно только через поддержку":
    "Consent to personal data processing can only be withdrawn through support",
  "Выберите тип жалобы":
    "Choose the type of complaint",
  "Опишите, что случилось — хотя бы пару предложений":
    "Describe what happened — a couple of sentences at least",
  "Неизвестный способ оплаты":
    "Unknown payment method",
  "Расторжение договора требует двойного подтверждения":
    "Terminating the contract requires double confirmation",
  "Вы не в этой организации":
    "You are not in this organisation",
  "Приглашать можно только на свою точку":
    "You can only invite to your own site",
  "Потолок приглашённого не может быть выше вашего":
    "The invitee's limit cannot be higher than yours",
  "Приглашение уже принято":
    "The invitation has already been accepted",
  "Приглашение отозвано":
    "The invitation has been revoked",
  "Приглашение уже использовано":
    "The invitation has already been used",
  "Срок приглашения истёк — попросите новый код":
    "The invitation has expired — ask for a new code",
  "Телефон ответственного: +998XXXXXXXXX":
    "Contact person's phone: +998XXXXXXXXX",
  "Этот номер уже закреплён за точкой":
    "This number is already assigned to a site",
  "Итог звонка обязателен: «обзвонили» без результата неотличимо от «закрыли, чтобы не мозолило»":
    "A call result is required: “called” with no outcome is indistinguishable from “closed to clear the list”",
  "Отказ по отпуску объясняется: иначе мастер не знает, подавать ли заново":
    "A refused leave request is explained: otherwise the technician does not know whether to apply again",
  "Решение по апелляции объясняется — его читает человек, которого оно касается":
    "An appeal decision is explained — it is read by the person it concerns",
  "Напишите, чем закончилось":
    "Write how it ended",
  "Есть несданная смена — примите её сначала":
    "There is an unhanded-over shift — accept it first",
  "Этот документ не ваш":
    "This document is not yours",
  "Акт осмотра не найден":
    "Inspection report not found",
  "Акт уже отправлен ответственному — правки только через новый осмотр":
    "The report has been sent to the responsible person — changes only through a new inspection",
  "Чек-лист осмотра не заполнен":
    "The inspection checklist is not filled in",
  "У точки нет ответственного — акт подписывать некому. Сообщите диспетчеру.":
    "The site has no responsible person — there is nobody to sign the report. Tell the dispatcher.",
  "По акту уже принято решение":
    "A decision on the report has already been made",
  "Полный отказ по акту требует причины":
    "A full rejection of the report requires a reason",
  "Формат: +998XXXXXXXXX":
    "Format: +998XXXXXXXXX",
  "Доступ закрыт. Обратитесь к администратору":
    "Access is closed. Contact an administrator",
  "Слишком много запросов кода. Попробуйте через час":
    "Too many code requests. Try again in an hour",
  "Не удалось отправить код. Попробуйте ещё раз":
    "The code could not be sent. Try again",
  "Причина блокировки обязательна":
    "A blocking reason is required",
  "Вход по коду временно недоступен: SMS-провайдер не подключён":
    "Sign-in by code is temporarily unavailable: the SMS provider is not connected",
  "Нельзя снять роль у последнего администратора":
    "You cannot remove the role from the last administrator",
  "Терминальный исход — только с причиной (лид-контур PRD-06 §4.1)":
    "A terminal outcome requires a reason (lead flow, PRD-06 §4.1)",
  "Вы не в штате службы этого объекта":
    "You are not on the staff of this site's service",
  "Этот мастер уже числится за оператором":
    "This technician is already registered with the operator",
  "Договор не может кончаться раньше, чем начался":
    "A contract cannot end before it starts",
  "Причина приостановки обязательна: человек должен знать, что исправить":
    "A suspension reason is required: the person must know what to fix",
  "Договор прекращён — вернуть можно только новым оформлением":
    "The contract is terminated — the only way back is a new one",
  "Мастер за этим оператором не числится":
    "The technician is not registered with this operator",
  "Мастер в офбординге: доступ возвращается только отменой офбординга":
    "The technician is in offboarding: access returns only by cancelling the offboarding",
  "Не передан токен устройства":
    "No device token supplied",
  "Приложение: client или master":
    "App: client or master",
  "Платформа: android, ios или web":
    "Platform: android, ios or web",
  "Укажите телефон человека":
    "Give the person's phone number",
  "Телефон мастера: +998XXXXXXXXX":
    "Technician's phone: +998XXXXXXXXX",
  "Имя мастера обязательно":
    "The technician's name is required",
  "Заявка не на вашем объекте":
    "The order is not on your property",
  "Частная заявка жителя достаётся вам только по праву первой руки":
    "A resident's private order reaches you only by right of first refusal",
  "Мастер за вами не числится или его договор приостановлен":
    "The technician is not registered with you or their contract is suspended",
  "Заявка ещё не оценена — назначить мастера можно после оценки":
    "The order has not been estimated yet — a technician can be assigned after the estimate",
  "Кабинет принадлежит другой эксплуатирующей организации":
    "The cabinet belongs to another operating company",
  "Выберите мастера":
    "Choose a technician",
  "Телефон клиента: +998XXXXXXXXX":
    "Customer's phone: +998XXXXXXXXX",
  "Оценка — целое неотрицательное число тийинов":
    "The estimate is a whole non-negative number of tiyin",
  "По этой заявке окна первой руки нет":
    "There is no first-refusal window on this order",
  "Окно истекло, заявка ушла в общий пул":
    "The window expired and the order went to the general pool",
  "Заявка принадлежит другому человеку":
    "The order belongs to another person",
  "Конкурирующий переход: обновите заявку и повторите":
    "Competing transition: refresh the order and try again",
  "Для назначения укажите мастера":
    "To assign, specify a technician",
  "Работы по общему имуществу выполняет только служба эксплуатирующей организации. ":
    "Work on common property is carried out only by the operating company's own service. ",
  "Материалы вносятся в статусах «В работе» … «Выполнена»":
    "Materials are entered in the statuses “In progress” … “Completed”",
  "Сумма материала — целое положительное число тийинов":
    "A material amount is a whole positive number of tiyin",
  "Запчасть — всегда с чеком; без чека только расходники «сумки» (ТЗ 8.4)":
    "A spare part always comes with a receipt; without one only “bag” consumables are allowed (TZ 8.4)",
  "Запчасть дороже 200 000 сум — укажите вилку эконом/стандарт/премиум (ТЗ 8.4.3)":
    "A spare part above 200,000 soums — give the economy/standard/premium range (TZ 8.4.3)",
  "Переназначение возможно на статусах «Назначена»…«Доп-согласование» (ТЗ 4.5)":
    "Reassignment is possible in the statuses “Assigned”…“Extra approval” (TZ 4.5)",
  "Причина переназначения обязательна (справочник D-15)":
    "A reassignment reason is required (directory D-15)",
  "Заявку уже переназначили: обновите карточку и повторите":
    "The order has already been reassigned: refresh the card and try again",
  "Ожидается изображение в формате data:image/...;base64,...":
    "An image in the form data:image/...;base64,... is expected",
  "Файл больше 6 МБ; приложение мастера сжимает до ~500 КБ (PRD-05 §9)":
    "The file is over 6 MB; the technician app compresses to ~500 KB (PRD-05 §9)",
  "Снимок относится к чужой заявке":
    "The photo belongs to another order",
  "Передайте строки прайса (CSV/Excel → JSON)":
    "Supply the price list rows (CSV/Excel → JSON)",
  "Черновик уже существует — активируйте или удалите его":
    "A draft already exists — activate or delete it",
  "Правки только в черновике (ТЗ 3.7)":
    "Edits only in the draft (TZ 3.7)",
  "Удалить можно только черновик; откат боевого — новым релизом (ТЗ 3.7)":
    "Only a draft can be deleted; rolling back the live one is a new release (TZ 3.7)",
  "Обход валидатора требует комментария (уходит в аудит)":
    "Bypassing the validator requires a comment (it goes into the audit log)",
  "Крупный релиз (>20% позиций или рост цены >30%): требуется подтверждение второго админа":
    "A large release (>20% of items or a price rise >30%): a second admin's confirmation is required",
  "Промокод не найден или отключён":
    "The promo code was not found or is disabled",
  "Лимит использований промокода исчерпан":
    "The promo code's usage limit is exhausted",
  "Скидка 1–50%":
    "Discount 1–50%",
  "Требуется согласие на обработку персональных данных (ЗРУ-547)":
    "Consent to personal data processing is required (ZRU-547)",
  "Телефон в формате +998XXXXXXXXX":
    "Phone in the format +998XXXXXXXXX",
  "Диспетчер не судит собственные заявки — эскалируйте старшему смены (ТЗ 4.2)":
    "A dispatcher does not judge their own orders — escalate to the shift senior (TZ 4.2)",
  "По заявке уже открыт спор":
    "A dispute is already open on this order",
  "Окно спора 72 ч после «Выполнена» истекло (ТЗ 4.2)":
    "The 72-hour dispute window after “Completed” has expired (TZ 4.2)",
  "Спор уже в работе — его нельзя убрать":
    "The dispute is in progress — it cannot be removed",
  "Комментарий резолюции обязателен (уходит в аудит)":
    "A resolution comment is required (it goes into the audit log)",
  "Для резолюции в пользу клиента или компромисса укажите сумму возврата":
    "For a resolution in the customer's favour or a compromise, give the refund amount",
  "Возврат больше суммы заявки":
    "The refund is larger than the order amount",
  "Выплата из фонда ущербов требует двойного подтверждения":
    "A payout from the damage fund requires double confirmation",
  "У мастера уже есть смена на эту дату":
    "The technician already has a shift on this date",
  "В смене есть брони — сначала переназначьте заявки":
    "The shift has bookings — reassign the orders first",
  "У мастера нет смены на эту дату":
    "The technician has no shift on this date",
  "Заявка уже забронирована — сначала снимите бронь":
    "The order is already booked — release the booking first",
  "Дежурный держится под аварии — плановые работы на него не бронируются (ТЗ 17.3)":
    "The duty technician is kept for emergencies — planned work is not booked onto them (TZ 17.3)",
  "Ночь 22:00–07:00 — плановые работы не бронируются (ТЗ 17.3); аварийные ставятся с подтверждением":
    "Night 22:00–07:00 — planned work is not booked (TZ 17.3); emergencies are placed with confirmation",
  "Продажа мастеру: нужны мастер и цена":
    "Sale to a technician: a technician and a price are required",
  "Цена тарифа не задана (параметр 138) — активация платного плана невозможна":
    "The plan price is not set (parameter 138) — a paid plan cannot be activated",
};

/**
 * Значения справочников: их приложение отправляет обратно на сервер, поэтому
 * они переводятся только на показ и не попадают в общий словарь.
 */
export const VALUES_EN: Record<string, string> = {
  'Алмазар': "Almazar",
  'БЫТОВАЯ ТЕХНИКА (мелкий ремонт)': "HOME APPLIANCES (small repairs)",
  'Бектемир': "Bektemir",
  'Бытовая техника': "Home appliances",
  'ВЫЕЗД И ДИАГНОСТИКА': "VISIT AND DIAGNOSIS",
  'ДЕМОНТАЖ, БУРЕНИЕ, ШТРОБЛЕНИЕ': "DEMOLITION, DRILLING, CHASING",
  'Двери и окна': "Doors and windows",
  'Демонтаж и штробление': "Demolition and chasing",
  'Интернет и камеры': "Internet and cameras",
  'КОНДИЦИОНЕРЫ И ВЕНТИЛЯЦИЯ': "AIR CONDITIONING AND VENTILATION",
  'Кондиционер': "Air conditioning",
  'Кондиционеры': "Air conditioning",
  'МАЛЯРНЫЕ И ОТДЕЛОЧНЫЕ РАБОТЫ': "PAINTING AND FINISHING",
  'Мелкий ремонт': "Small repairs",
  'Мирабад': "Mirabad",
  'Мирзо-Улугбек': "Mirzo-Ulugbek",
  'ОКНА, ДВЕРИ, БАЛКОНЫ': "WINDOWS, DOORS, BALCONIES",
  'Окна и двери': "Windows and doors",
  'Отделка': "Finishing",
  'Отделка и покраска': "Finishing and painting",
  'Отопление': "Heating",
  'ПОЛЫ И ПОТОЛКИ': "FLOORS AND CEILINGS",
  'Полы и потолки': "Floors and ceilings",
  'САНТЕХНИКА': "PLUMBING",
  'СВАРОЧНЫЕ РАБОТЫ': "WELDING",
  'СЕРВИСНЫЕ УСЛУГИ': "SERVICES",
  'СЛАБОТОЧКА, ИНТЕРНЕТ, БЕЗОПАСНОСТЬ': "LOW VOLTAGE, INTERNET, SECURITY",
  'Сантехника': "Plumbing",
  'Сварка': "Welding",
  'Сварочные работы': "Welding",
  'Сервисные услуги': "Services",
  'Сергели': "Sergeli",
  'Слаботочка': "Low voltage",
  'Ташкент': "Tashkent",
  'УНИВЕРСАЛЬНЫЕ РАБОТЫ (МУЖ НА ЧАС)': "GENERAL JOBS (HANDYMAN)",
  'Учтепа': "Uchtepa",
  'Чиланзар': "Chilanzar",
  'Шайхантахур': "Shaykhantakhur",
  'ЭЛЕКТРИКА': "ELECTRICS",
  'Электрика': "Electrics",
  'Юнусабад': "Yunusabad",
  'Яккасарай': "Yakkasaray",
  'Яшнабад': "Yashnabad",
  'авария': "emergency",
  'бойлер': "water heater",
  'бойлеры': "water heaters",
  'вентиляция': "ventilation",
  'водоснабжение': "water supply",
  'выезд': "call-out",
  'диагностика': "diagnostics",
  'другое': "other",
  'канализация': "sewerage",
  'компл': "set",
  'кондиционер': "air conditioner",
  'кондиционеры': "air conditioners",
  'котёл': "boiler",
  'м': "m",
  'м²': "m²",
  'насос': "pump",
  'обычная': "regular",
  'отопление': "heating",
  'п.м': "lin. m",
  'прочее': "miscellaneous",
  'сантехника': "plumbing",
  'смеситель': "mixer tap",
  'стиральная машина': "washing machine",
  'счётчик': "meter",
  'точка': "point",
  'час': "hour",
  'шт': "pc",
  'электрика': "electrics",
};
