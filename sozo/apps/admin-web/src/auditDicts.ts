/**
 * Человеческие названия событий аудита.
 *
 * Журнал пишется кодами (`client.complaint_filed`) — так их удобно искать
 * и группировать. Но разбирает журнал человек, и читать ему приходится
 * подряд десятки строк: «подал жалобу» он понимает мгновенно, код — нет.
 *
 * Неизвестный код показываем как есть, а не прячем: новое событие лучше
 * увидеть непереведённым, чем не увидеть вовсе.
 */

const ACTIONS: Record<string, string> = {
  // Заявки и конвейер
  'order.created': 'Заявка создана',
  'order.create': 'Заявка создана',
  'order.estimate': 'Заявка оценена',
  'order.assign': 'Мастер назначен',
  'order.auto_assigned': 'Мастер подобран автоматически',
  'order.reassigned': 'Мастер заменён',
  'order.depart': 'Мастер выехал',
  'order.start': 'Работа начата',
  'order.complete': 'Работа выполнена',
  'order.verify': 'Заявка проверена',
  'order.close': 'Заявка закрыта',
  'order.cancel': 'Заявка отменена',
  'order.rate': 'Клиент оценил работу',
  'order.approve': 'Смета утверждена',
  'order.request_approval': 'Отправлено на утверждение',
  'order.open_dispute': 'Открыт спор',
  'order.resolve_addwork': 'Решение по доп-работам',
  'order.confirm_estimate': 'Смета согласована',
  'order.material_added': 'Внесён материал',
  'order.photo_uploaded': 'Загружено фото',

  // Клиент в приложении
  'client.order_created': 'Клиент создал заявку',
  'client.estimate_approved': 'Клиент подтвердил смету',
  'client.estimate_declined': 'Клиент отказался от работ',
  'client.addwork_approved': 'Клиент согласовал доп-работы',
  'client.addwork_declined': 'Клиент отказался от доп-работ',
  'client.spare_tier_chosen': 'Клиент выбрал вариант запчасти',
  'client.complaint_filed': 'Клиент подал жалобу',
  'client.dispute_opened': 'Клиент открыл спор',
  'client.rating_submitted': 'Клиент оценил работу',
  'client.payment_started': 'Клиент начал оплату',
  'client.payment_succeeded': 'Клиент оплатил',
  'client.warranty_claim': 'Гарантийное обращение',
  'client.reschedule_requested': 'Клиент просит перенести визит',
  'client.quick_message': 'Сообщение от клиента',
  'client.address_details_set': 'Клиент уточнил адрес',
  'client.consents_set': 'Согласия обновлены',
  'client.blocked': 'Клиент заблокирован',
  'client.unblocked': 'Блокировка снята',
  'client.emergency_called': 'Вызов аварийной бригады',
  'client.act_decided': 'Решение по акту осмотра',
  'client.work_accepted': 'Работа принята',
  'client.work_rejected': 'Работа не принята',
  'client.site_issue_reported': 'Сообщено о поломке на точке',
  'client.site_user_added': 'Добавлен человек на точку',
  'client.site_user_updated': 'Изменены права на точке',
  'client.site_user_removed': 'Снят доступ к точке',
  'client.equipment_updated': 'Клиент поправил карточку техники',
  'client.equipment_removed': 'Техника убрана из списка',
  'client.favorite_master_cleared': 'Клиент отменил закрепление мастера',
  'client.demo_seeded': 'Созданы демо-данные',

  // Мастер
  'master.shift_started': 'Смена начата',
  'master.shift_ended': 'Смена закончена',
  'master.acceptance_requested': 'Работа отправлена на приёмку',
  'master.acceptance_fixed': 'Приёмка зафиксирована',
  'master.addwork_sent': 'Отправлены доп-работы на согласование',
  'master.spare_tiers_sent': 'Отправлены варианты запчасти',
  'master.recommendation_sent': 'Отправлена рекомендация',
  'master.quote_drafted': 'Составлена смета',
  'master.delay': 'Мастер сообщил о задержке',
  'master.cant_go': 'Мастер не может выехать',
  'master.no_access': 'Нет доступа на объект',
  'master.client_unavailable': 'Клиент недоступен',
  'master.unsafe_abort': 'Работа прервана по безопасности',
  'master.conservation': 'Выполнена консервация',
  'master.cash_received': 'Приняты наличные',
  'master.cash_deposited': 'Наличные сданы',
  'master.part_procured': 'Запчасть куплена',
  'master.purchase_code_issued': 'Выдан код закупки',
  'master.offline_sync': 'Выгружена офлайн-очередь',
  'master.skill_exam_requested': 'Заявка на экзамен по навыку',
  'master.skill_suspended': 'Навык приостановлен',
  'master.appeal_filed': 'Подана апелляция',
  'master.geo_mismatch': 'Расхождение по геометке',
  'master.helper_requested': 'Запрошен помощник',
  'master.helper_confirmed': 'Помощник подтверждён',
  'master.stages_planned': 'Спланированы этапы',
  'master.stock_refilled': 'Пополнена сумка расходников',
  'master.act_submitted': 'Отправлен акт осмотра',
  'master.asset_fixed': 'Зафиксирована техника клиента',
  'master.replacement_proof': 'Подтверждена замена детали',
  'master.candidate_created': 'Заведён кандидат',
  'master.shopping_list': 'Сформирован список закупки',

  // Онбординг
  'onboarding.application_submitted': 'Подана анкета',
  'onboarding.submitted_for_review': 'Документы отправлены на проверку',
  'onboarding.interview_scheduled': 'Назначено собеседование',
  'onboarding.interview_passed': 'Собеседование пройдено',
  'onboarding.exam_passed': 'Экзамен сдан',
  'onboarding.activated': 'Мастер выведен на линию',
  'onboarding.rejected': 'Кандидату отказано',

  // Диспетчерская
  'dispatch.client_request_taken': 'Обращение взято в работу',
  'dispatch.client_request_closed': 'Обращение закрыто',
  'replacement.opened': 'Открыт протокол замены',
  'replacement.broadcast': 'Бродкаст замены',
  'replacement.assigned': 'Замена назначена',
  'replacement.escalated': 'Замена эскалирована',
  'replacement.closed': 'Протокол замены закрыт',
  'incident.opened': 'Открыт массовый инцидент',
  'incident.closed': 'Инцидент закрыт',
  'handover.started': 'Начата передача смены',
  'handover.accepted': 'Смена принята',

  // Качество
  'complaint.filed': 'Зарегистрирована жалоба',
  'complaint.first_response': 'Дан первый ответ по жалобе',
  'dispute.opened': 'Открыт спор',
  'dispute.escalated': 'Спор эскалирован',
  'dispute.resolved': 'Спор разрешён',
  'damage.filed': 'Заведено дело об ущербе',
  'damage.paid': 'Ущерб выплачен',

  // Деньги
  'invoice.issued': 'Выставлен счёт',
  'invoice.paid': 'Счёт оплачен',
  'billing.penalty_issued': 'Выставлены пени',
  'billing.manual_tx': 'Ручная проводка',
  'billing.storno': 'Сторно проводки',
  'payout.paid': 'Выплата мастеру',
  'period.closed': 'Период закрыт',
  'period.reopened': 'Период переоткрыт',
  'clearing.settled': 'Клиринг проведён',
  'opening_balances.posted': 'Внесены стартовые остатки',
  'referral.bonus_paid': 'Выплачен реферальный бонус',

  // Договоры и справочники
  'organization.created': 'Организация заведена',
  'organization.updated': 'Организация изменена',
  'organization.terminated': 'Договор расторгнут',
  'contract.terms_updated': 'Изменены условия договора',
  'crm.thresholds_applied': 'Пороги договора применены к людям',
  'location.updated': 'Изменён паспорт точки',
  'location.representative_added': 'Добавлен ответственный',
  'location.representative_updated': 'Изменён ответственный',
  'location.representative_removed': 'Снят ответственный',
  'lead.converted': 'Лид переведён в договор',
  'parameter.updated': 'Изменён параметр системы',
  'price_release.draft_created': 'Создан черновик прайса',
  'price_release.imported': 'Импортирован прайс',
  'price_release.activated': 'Прайс активирован',
  'price_release.draft_deleted': 'Черновик прайса удалён',
  'promo.created': 'Создан промокод',
  'promo.toggled': 'Промокод включён или выключен',
  'voucher.added': 'Добавлен ваучер',
  'equipment.act_confirmed': 'Подтверждён акт по оборудованию',
  'shift.created': 'Создана смена',
  'shift.seed_day': 'Смены проставлены на день',
  'booking.created': 'Создана бронь в ленте',
  'booking.released': 'Бронь снята',

  // Таймеры и служебное
  'timer.approval_escalated': 'Утверждение эскалировано по таймеру',
  'timer.dunning': 'Напоминание о задолженности',
  'timer.org_suspended': 'Обслуживание приостановлено за неоплату',
  'timer.urgent_surcharge_released': 'Снята наценка за срочность',
  'timer.balance_check_failed': 'Баланс-чекер нашёл расхождение',
  'scheduler.manual_run': 'Планировщик запущен вручную',
  'scheduler.simulate': 'Симуляция времени',
  'scheduler.reset_clock': 'Часы сброшены',
};

/** Группы действий для фильтра — то, что стоит до точки */
const GROUPS: Record<string, string> = {
  order: 'Заявки',
  client: 'Клиент',
  client_app: 'Приложение клиента',
  master: 'Мастер',
  onboarding: 'Онбординг',
  dispatch: 'Диспетчерская',
  replacement: 'Замены',
  incident: 'Инциденты',
  handover: 'Передача смены',
  complaint: 'Жалобы',
  dispute: 'Споры',
  damage: 'Ущерб',
  invoice: 'Счета',
  billing: 'Бухгалтерия',
  payout: 'Выплаты',
  period: 'Периоды',
  clearing: 'Клиринг',
  organization: 'Организации',
  contract: 'Договоры',
  crm: 'CRM',
  location: 'Точки',
  lead: 'Лиды',
  parameter: 'Параметры',
  price_release: 'Прайс',
  promo: 'Промокоды',
  timer: 'Таймеры',
  scheduler: 'Планировщик',
  shift: 'Смены',
  booking: 'Брони',
  voucher: 'Ваучеры',
  equipment: 'Оборудование',
  referral: 'Рефералы',
  opening_balances: 'Остатки',
};

export function auditActionLabel(action: string): string {
  return ACTIONS[action] ?? action;
}

export function auditGroupLabel(group: string): string {
  return GROUPS[group] ?? group;
}

/** Сущности журнала на человеческом — их немного, и они повторяются */
const ENTITIES: Record<string, string> = {
  Order: 'Заявка',
  Client: 'Клиент',
  ClientProfile: 'Профиль клиента',
  ClientRequest: 'Обращение клиента',
  Complaint: 'Жалоба',
  Dispute: 'Спор',
  Invoice: 'Счёт',
  Organization: 'Организация',
  Location: 'Точка',
  Representative: 'Ответственный',
  MasterProfile: 'Мастер',
  Master: 'Мастер',
  Asset: 'Техника клиента',
  Incident: 'Инцидент',
  InspectionAct: 'Акт осмотра',
  Parameter: 'Параметр',
  PriceRelease: 'Релиз прайса',
  Telemetry: 'Телеметрия',
};

export function auditEntityLabel(entity: string): string {
  return ENTITIES[entity] ?? entity;
}
