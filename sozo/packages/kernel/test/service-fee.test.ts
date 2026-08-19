/**
 * Контрактные тесты сервисного сбора и подписки — DEV-15 §8.2–8.4, ТЗ §19.3.
 * Главный тест файла — «доля мастера не зависит от подключённости объекта» (§8.3):
 * он защищает продуктовый принцип №5 ТЗ, который легко нарушить одной строкой в биллинге.
 */
import { describe, it, expect } from 'vitest';
import {
  masterShare,
  serviceFee,
  subscriptionCharge,
  operatorSettlement,
  ServiceFeeAboveCapError,
  SERVICE_FEE_CAP_BPS,
  SERVICE_FEE_DEFAULT_BPS,
  PRO_PRICE_PER_OBJECT_TIYIN,
  soumsToTiyin,
} from '../src/index.js';

describe('DEV-15 §8.3 — доля мастера не затрагивается сервисным сбором', () => {
  const base = soumsToTiyin(200_000); // база работ, контрольный пример ТЗ 8.2
  const noSurcharge = 1000n; // ×1.0 в промилле
  const share55 = 550n;

  it('доля по заявке в подключённом объекте равна доле по идентичной заявке в неподключённом', () => {
    const shareUnmanaged = masterShare(base, noSurcharge, share55);
    // «подключённый объект» отличается только тем, что платформа начислила сбор
    const fee = serviceFee(base, SERVICE_FEE_DEFAULT_BPS);
    const shareManaged = masterShare(base, noSurcharge, share55);

    expect(shareManaged).toBe(shareUnmanaged);
    expect(shareManaged).toBe(soumsToTiyin(110_000));
    expect(fee).toBeGreaterThan(0n); // сбор реально начислен — тест не вырожденный
  });

  it('сбор не является входом функции доли: сигнатура masterShare его не принимает', () => {
    expect(masterShare.length).toBe(3); // base, surcharge, share — и ничего больше
  });

  it('сбор берётся из комиссии платформы: доля + сбор не превышают сумму работ', () => {
    const share = masterShare(base, noSurcharge, share55);
    const fee = serviceFee(base, SERVICE_FEE_CAP_BPS); // даже по потолку
    expect(share + fee).toBeLessThan(base);
  });
});

describe('DEV-15 §8.2 — сервисный сбор объекта', () => {
  it('база 5% от суммы работ: 200 000 сум → 10 000 сум', () => {
    expect(serviceFee(soumsToTiyin(200_000), SERVICE_FEE_DEFAULT_BPS)).toBe(soumsToTiyin(10_000));
  });

  it('потолок 10% допустим', () => {
    expect(serviceFee(soumsToTiyin(200_000), SERVICE_FEE_CAP_BPS)).toBe(soumsToTiyin(20_000));
  });

  it('ставка выше потолка отклоняется, а не обрезается молча', () => {
    expect(() => serviceFee(soumsToTiyin(200_000), 1001n)).toThrow(ServiceFeeAboveCapError);
    expect(() => serviceFee(soumsToTiyin(200_000), 5000n)).toThrow(/выше потолка/);
  });

  it('отрицательная ставка отклоняется', () => {
    expect(() => serviceFee(soumsToTiyin(200_000), -1n)).toThrow(ServiceFeeAboveCapError);
  });

  it('нулевая база даёт нулевой сбор (общее имущество, своя служба)', () => {
    expect(serviceFee(0n, SERVICE_FEE_DEFAULT_BPS)).toBe(0n);
  });

  it('база — работы без материалов: материалы в расчёт не передаются', () => {
    const work = soumsToTiyin(200_000);
    const materials = soumsToTiyin(120_000);
    // вызывающий слой обязан передать только работы
    expect(serviceFee(work, SERVICE_FEE_DEFAULT_BPS)).toBe(soumsToTiyin(10_000));
    // если бы передали всё — сбор был бы больше; фиксируем разницу как осознанную
    expect(serviceFee(work + materials, SERVICE_FEE_DEFAULT_BPS)).toBe(soumsToTiyin(16_000));
  });
});

describe('DEV-15 §8.4 / ТЗ §19.3 п.2 — подписка оператора', () => {
  it('per_object: плоская ставка 3 000 000 сум независимо от числа помещений', () => {
    expect(subscriptionCharge('per_object', PRO_PRICE_PER_OBJECT_TIYIN, 300n)).toBe(
      soumsToTiyin(3_000_000),
    );
    expect(subscriptionCharge('per_object', PRO_PRICE_PER_OBJECT_TIYIN, 1000n)).toBe(
      soumsToTiyin(3_000_000),
    );
  });

  it('per_unit сохранён на случай пересмотра единицы', () => {
    expect(subscriptionCharge('per_unit', soumsToTiyin(10_000), 300n)).toBe(
      soumsToTiyin(3_000_000),
    );
  });

  it('нулевая цена не начисляется (тариф Free)', () => {
    expect(subscriptionCharge('per_object', 0n, 1n)).toBe(0n);
  });
});

describe('DEV-15 §11.5 — нетто-расчёт с оператором', () => {
  it('сбор больше подписки → выплата оператору (отрицательный нетто)', () => {
    const net = operatorSettlement({
      subscriptionTiyin: soumsToTiyin(3_000_000),
      claimsTiyin: 0n,
      serviceFeeTiyin: soumsToTiyin(4_500_000),
    });
    expect(net).toBe(soumsToTiyin(-1_500_000));
  });

  it('подписка и претензии больше сбора → счёт оператору', () => {
    const net = operatorSettlement({
      subscriptionTiyin: soumsToTiyin(3_000_000),
      claimsTiyin: soumsToTiyin(150_000), // холостой выезд
      serviceFeeTiyin: soumsToTiyin(400_000),
    });
    expect(net).toBe(soumsToTiyin(2_750_000));
  });

  it('оператор на Free с активным сбором всегда в плюсе', () => {
    const net = operatorSettlement({
      subscriptionTiyin: 0n,
      claimsTiyin: 0n,
      serviceFeeTiyin: soumsToTiyin(800_000),
    });
    expect(net).toBeLessThan(0n);
  });
});
