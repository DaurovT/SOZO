/**
 * Реестр guard-проверок графов DEV-10 §5. Все условия проверяются на API, не в UI (ТЗ, критерии приёмки №1–2).
 * Каждый guard возвращает true либо машиночитаемую причину отказа (уходит в 409).
 */
import type { GuardFn, TransitionContext } from './state-machine.js';

const HOURS_72 = 72 * 60 * 60 * 1000;

function within72h(from: Date | undefined, now: Date): boolean {
  return !!from && now.getTime() - from.getTime() <= HOURS_72;
}

export const DEFAULT_GUARDS: Record<string, GuardFn> = {
  // Фото-гейты (ТЗ 4.1 п.7, 9; критерий приёмки №1)
  photo_before_min1: (c) => (c.photosBefore >= 1 ? true : 'Нет фото «до» — переход «В работе» невозможен'),
  photo_after_min1: (c) => (c.photosAfter >= 1 ? true : 'Нет фото «после» — «Выполнена» невозможна'),
  photo_before_or_restricted_site: (c) =>
    c.photosBefore >= 1 || c.restrictedSite ? true : 'Нет фото «до» (объект не режимный)',
  photo_after_or_restricted_site: (c) =>
    c.photosAfter >= 1 || c.restrictedSite ? true : 'Нет фото «после» (объект не режимный)',
  photo_evidence: (c) => (c.photosBefore + c.photosAfter > 0 ? true : 'Вынужденная доп-работа требует фото проблемы'),

  // Деньги и приёмка
  materials_receipts_complete: (c) =>
    c.materialsWithoutReceipt === 0 ? true : `Запчастей без чека: ${c.materialsWithoutReceipt}`,
  total_equals_sanctioned: (c) =>
    c.totalEqualsSanctioned ? true : 'Итог не равен санкционированной сумме и доп-смета не утверждена',
  payment_collected_or_dispatcher_sanction: (c) =>
    c.paymentCollected || c.dispatcherSanction ? true : 'Оплата не собрана; уход без оплаты — только санкция диспетчера',
  acceptance_fixed: (c) =>
    c.acceptanceFixed ? true : 'Приёмка не зафиксирована (код / онлайн-платёж / «принято без кода» + фото)',
  dispatcher_sanction_with_reason: (c) =>
    c.dispatcherSanction && !!c.reason ? true : '«Ожидает оплаты» — исключение: нужна санкция диспетчера с причиной',
  billing_posted: (c) => (c.billingPosted ? true : 'Проводки закрытия не проведены биллингом'),
  payment_confirmed: (c) => (c.paymentConfirmed ? true : 'Оплата не подтверждена (вебхук/отметка)'),

  // Модерация и споры
  moderation_passed: (c) => (c.moderationPassed ? true : 'Пакет фото/чеков не прошёл модерацию'),
  reason_from_dictionary: (c) => (!!c.reason ? true : 'Причина из справочника обязательна'),
  within_72h_after_completed: (c) =>
    within72h(c.completedAt, c.now) ? true : 'Окно спора 72 ч после «Выполнена» истекло',
  within_72h_after_close: (c) => (within72h(c.closedAt, c.now) ? true : 'Окно оценки 72 ч истекло'),

  // B2B-лимиты (матрица ТЗ 5.1)
  within_order_limit: (c) => (c.withinOrderLimit ? true : 'Смета выше лимита заявки точки — требуется утверждение'),
  monthly_limit_ok: (c) => (c.monthlyLimitOk ? true : 'Месячный лимит точки исчерпан — требуется утверждение'),
  not_from_inspection: (c) => (!c.fromInspection ? true : 'Заявка из осмотра всегда требует утверждения'),
  not_upsell: (c) => (!c.isUpsell ? true : 'Апсейл никогда не автостартует'),
  prepayment_if_no_contract: (c) =>
    c.prepaymentMarked ? true : 'B2B разовая без договора: назначение до отметки предоплаты запрещено (ТЗ 8.3)',

  // Спецтипы
  restoration_declined: (c) => (c.restorationDeclined ? true : 'Требуется явный отказ от сметы восстановления'),
  checklist_filled: (c) => (c.checklistFilled ? true : 'Чек-лист осмотра не заполнен'),
  representative_fixed: (c) =>
    c.representativeFixed ? true : 'Не зафиксирован представитель точки (код/подпись или «отсутствовал» + фото)',
  fault_qualified: (c) => (c.faultQualified ? true : 'Не квалифицирована вина по гарантийной переделке (0/50/100%)'),
  defect_estimate_fresh: (c) =>
    c.defectEstimateFresh ? true : 'Оценка дефекта старше 30 дней — требуется переоценка (ТЗ 3.5)',
  stage_chain_confirmed: (c) =>
    c.stageChainConfirmed ? true : 'Этап 1 не стартует без подтверждённых слотов всех следующих этапов',
};

/** Контекст по умолчанию для тестов и черновых вызовов: всё «чисто», ничего не выполнено */
export function emptyContext(overrides: Partial<TransitionContext> = {}): TransitionContext {
  return {
    now: new Date(),
    status: 'new',
    version: 0,
    photosBefore: 0,
    photosAfter: 0,
    materialsWithoutReceipt: 0,
    totalEqualsSanctioned: false,
    paymentCollected: false,
    dispatcherSanction: false,
    billingPosted: false,
    paymentConfirmed: false,
    moderationPassed: false,
    restrictedSite: false,
    acceptanceFixed: false,
    withinOrderLimit: false,
    monthlyLimitOk: false,
    fromInspection: false,
    isUpsell: false,
    prepaymentMarked: false,
    restorationDeclined: false,
    checklistFilled: false,
    representativeFixed: false,
    faultQualified: false,
    defectEstimateFresh: false,
    stageChainConfirmed: false,
    isLastSession: false,
    ...overrides,
  };
}
