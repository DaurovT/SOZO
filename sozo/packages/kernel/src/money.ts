/**
 * Money — все суммы BIGINT в тийинах (1 сум = 100 тийин), DEV-02.
 * Float в денежном коде запрещён: целочисленная арифметика гарантирует
 * побитовую воспроизводимость проводок и сходимость баланс-чекера.
 *
 * Округление до 100 сум (ТЗ 8.1), правило едино на всех слоях:
 *  - списания (charge)  — в пользу КЛИЕНТА  → вниз;
 *  - начисления (accrual, доля мастера) — в пользу МАСТЕРА → вверх.
 */

export const TIYIN_PER_SOUM = 100n;
/** Шаг округления: 100 сум = 10 000 тийин */
export const ROUND_STEP_TIYIN = 10_000n;

export type RoundDirection = 'favor_client' | 'favor_master';

export function soumsToTiyin(soums: bigint | number): bigint {
  return BigInt(soums) * TIYIN_PER_SOUM;
}

export function tiyinToSoums(tiyin: bigint): bigint {
  return tiyin / TIYIN_PER_SOUM; // целые сумы, без копеек (ТЗ 14)
}

/** Округление суммы в тийинах до 100 сум с заданным направлением. */
export function roundTo100Soums(amountTiyin: bigint, direction: RoundDirection): bigint {
  if (amountTiyin < 0n) throw new Error('Money: отрицательные суммы округляются на уровне операции, не знака');
  const remainder = amountTiyin % ROUND_STEP_TIYIN;
  if (remainder === 0n) return amountTiyin;
  return direction === 'favor_client'
    ? amountTiyin - remainder // списание меньше — в пользу клиента
    : amountTiyin - remainder + ROUND_STEP_TIYIN; // начисление больше — в пользу мастера
}

/** Доля мастера: от базовой B2C × наценки; скидки клиенту долю не трогают (ТЗ 3.7). sharePermille: 550 = 55%. */
export function masterShare(baseWorkTiyin: bigint, surchargeMultiplierPermille: bigint, sharePermille: bigint): bigint {
  const withSurcharge = (baseWorkTiyin * surchargeMultiplierPermille) / 1000n;
  const share = (withSurcharge * sharePermille) / 1000n;
  return roundTo100Soums(share, 'favor_master');
}

/** Форматирование для UI/логов: «1 250 000 сум» (неразрывные пробелы — на слое представления). */
export function formatSoums(tiyin: bigint): string {
  const soums = tiyinToSoums(tiyin).toString();
  return soums.replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' сум';
}

// ============================================================
// Контур «Дом» (M7) — сервисный сбор объекта и подписка
// DEV-15 §8.2–8.4, ТЗ §19.3 п.2, п.4
// ============================================================

/** Потолок ставки сервисного сбора — 10% (1000 базисных пунктов). Жёсткий, торгу не подлежит. */
export const SERVICE_FEE_CAP_BPS = 1000n;

/** Ставка по умолчанию — 5% (параметр 124) */
export const SERVICE_FEE_DEFAULT_BPS = 500n;

/** Цена Pro по умолчанию: 3 000 000 сум за объект в месяц (параметр 138) */
export const PRO_PRICE_PER_OBJECT_TIYIN = 300_000_000n;

export class ServiceFeeAboveCapError extends Error {
  constructor(public readonly bps: bigint) {
    super(`Ставка сервисного сбора ${bps} б.п. выше потолка ${SERVICE_FEE_CAP_BPS} б.п.`);
    this.name = 'ServiceFeeAboveCap';
  }
}

/**
 * Сервисный сбор объекта (DEV-15 §8.2).
 *
 * База — **сумма работ клиента, без материалов**: тот же принцип, что у доли мастера
 * и у наценок (ТЗ 3.7 — наценки только к работам). Материалы проходят транзитом
 * и не должны порождать вознаграждение третьей стороне.
 *
 * Сбор — расход платформы из своей комиссии. На долю мастера не влияет:
 * функция masterShare() его не принимает и принимать не должна (ТЗ 8.1, принцип №5).
 *
 * Начисляется только при order_scope = 'private' и только если работу выполнил
 * не штатный мастер оператора — оба условия проверяет вызывающий слой (billing).
 */
export function serviceFee(clientWorkTiyin: bigint, feeBps: bigint): bigint {
  if (feeBps < 0n) throw new ServiceFeeAboveCapError(feeBps);
  if (feeBps > SERVICE_FEE_CAP_BPS) throw new ServiceFeeAboveCapError(feeBps);
  if (clientWorkTiyin <= 0n) return 0n;
  // округление в пользу платформы = вниз: сбор — её расход, завышать его не нужно
  return (clientWorkTiyin * feeBps) / 10_000n;
}

export type BillingUnit = 'per_object' | 'per_unit';

/**
 * Начисление подписки оператора за период (DEV-15 §8.4).
 * per_object — плоская ставка за объект (действующая единица, параметр 139);
 * per_unit — за помещение, поддерживается на случай пересмотра.
 */
export function subscriptionCharge(
  unit: BillingUnit,
  priceTiyin: bigint,
  unitsBilled: bigint,
): bigint {
  if (priceTiyin <= 0n) return 0n;
  return unit === 'per_object' ? priceTiyin : priceTiyin * (unitsBilled > 0n ? unitsBilled : 0n);
}

/**
 * Нетто-расчёт месяца с оператором (DEV-15 §11.5): одна сумма вместо двух встречных платежей.
 * Положительный результат — счёт оператору, отрицательный — выплата ему.
 */
export function operatorSettlement(params: {
  subscriptionTiyin: bigint;
  claimsTiyin: bigint;      // холостые выезды и претензии по ущербу
  serviceFeeTiyin: bigint;  // начисленный сбор в пользу оператора
}): bigint {
  return params.subscriptionTiyin + params.claimsTiyin - params.serviceFeeTiyin;
}
