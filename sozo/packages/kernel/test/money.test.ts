import { describe, expect, it } from 'vitest';
import { formatSoums, masterShare, roundTo100Soums, soumsToTiyin, tiyinToSoums } from '../src/money.js';

describe('Money (ТЗ 8.1: округление до 100 сум, направления)', () => {
  it('списание округляется вниз — в пользу клиента', () => {
    // 123 456 сум → 123 400 сум
    expect(roundTo100Soums(soumsToTiyin(123_456), 'favor_client')).toBe(soumsToTiyin(123_400));
  });

  it('начисление округляется вверх — в пользу мастера', () => {
    expect(roundTo100Soums(soumsToTiyin(123_456), 'favor_master')).toBe(soumsToTiyin(123_500));
  });

  it('кратные 100 сум не меняются', () => {
    expect(roundTo100Soums(soumsToTiyin(234_000), 'favor_client')).toBe(soumsToTiyin(234_000));
    expect(roundTo100Soums(soumsToTiyin(234_000), 'favor_master')).toBe(soumsToTiyin(234_000));
  });

  it('доля мастера 55% от базовой B2C — контрольный пример ТЗ 8.2: база 200 000 → мастеру 110 000', () => {
    const base = soumsToTiyin(200_000);
    expect(masterShare(base, 1000n, 550n)).toBe(soumsToTiyin(110_000));
  });

  it('наценка повышает долю: база 200 000 × 1.3 × 55% = 143 000', () => {
    const base = soumsToTiyin(200_000);
    expect(masterShare(base, 1300n, 550n)).toBe(soumsToTiyin(143_000));
  });

  it('формат: разряды пробелами, без копеек', () => {
    expect(formatSoums(soumsToTiyin(1_250_000))).toBe('1 250 000 сум');
    expect(tiyinToSoums(soumsToTiyin(42))).toBe(42n);
  });
});
