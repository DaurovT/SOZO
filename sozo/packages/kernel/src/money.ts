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
