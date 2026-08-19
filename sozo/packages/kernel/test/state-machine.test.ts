import { describe, expect, it } from 'vitest';
import { ORDER_STATUSES, TRANSITION_ACTIONS, type OrderStatus } from '@sozo/contracts';
import { createOrderStateMachine, emptyContext } from '../src/index.js';

const sm = createOrderStateMachine();

function ok(result: ReturnType<typeof sm.validate>) {
  if (!result.ok) throw new Error(`Ожидали ok, получили: ${JSON.stringify(result.violation)}`);
  return result.def;
}

describe('B2C: сквозная цепочка создать → закрыть (DEV-07 §7, день 4–5)', () => {
  it('проходит только по рёбрам DEV-10 §4.1', () => {
    const now = new Date();
    expect(ok(sm.validate('b2c', 'create', emptyContext())).to).toBe('new');
    expect(ok(sm.validate('b2c', 'estimate', emptyContext({ status: 'new' }))).to).toBe('estimated');
    expect(ok(sm.validate('b2c', 'assign', emptyContext({ status: 'estimated' }))).to).toBe('assigned');
    expect(ok(sm.validate('b2c', 'depart', emptyContext({ status: 'assigned' }))).to).toBe('master_departed');
    expect(
      ok(sm.validate('b2c', 'start', emptyContext({ status: 'master_departed', photosBefore: 1 }))).to,
    ).toBe('in_progress');
    expect(
      ok(
        sm.validate(
          'b2c',
          'complete',
          emptyContext({
            status: 'in_progress',
            photosAfter: 1,
            totalEqualsSanctioned: true,
            paymentCollected: true, // онлайн-оплата = приёмка (ТЗ 17.17 п.3)
          }),
        ),
      ).to,
    ).toBe('completed');
    expect(
      ok(sm.validate('b2c', 'verify', emptyContext({ status: 'completed', moderationPassed: true }))).to,
    ).toBe('verified');
    expect(ok(sm.validate('b2c', 'close', emptyContext({ status: 'verified', billingPosted: true }))).to).toBe(
      'closed',
    );
    expect(
      ok(sm.validate('b2c', 'rate', emptyContext({ status: 'closed', closedAt: now, now }))).to,
    ).toBe('rated');
  });

  it('критерий приёмки №1: «Выполнена» без фото «после» невозможна', () => {
    const res = sm.validate(
      'b2c',
      'complete',
      emptyContext({ status: 'in_progress', totalEqualsSanctioned: true, paymentCollected: true }),
    );
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.violation.code).toBe('GUARD_FAILED');
      expect(res.violation.failedGuard).toBe('photo_after_min1');
    }
  });

  it('«В работе» без фото «до» невозможна', () => {
    const res = sm.validate('b2c', 'start', emptyContext({ status: 'master_departed' }));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.violation.failedGuard).toBe('photo_before_min1');
  });

  it('переход вне графа → STATE_MACHINE_VIOLATION (409)', () => {
    const res = sm.validate('b2c', 'close', emptyContext({ status: 'new' }));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.violation.code).toBe('STATE_MACHINE_VIOLATION');
  });

  it('B2C минует статусы 3–4: request_approval не определён', () => {
    const res = sm.validate('b2c', 'request_approval', emptyContext({ status: 'estimated' }));
    expect(res.ok).toBe(false);
  });
});

describe('Наложенные правила DEV-10 §3', () => {
  it('отмена возможна из статусов ≤ 8 с причиной, из closed — нет', () => {
    expect(sm.validate('b2c', 'cancel', emptyContext({ status: 'in_progress', reason: 'client_refused' })).ok).toBe(true);
    expect(sm.validate('b2c', 'cancel', emptyContext({ status: 'in_progress' })).ok).toBe(false); // без причины
    expect(sm.validate('b2c', 'cancel', emptyContext({ status: 'closed', reason: 'x' })).ok).toBe(false);
  });

  it('спор — 72 ч после «Выполнена», позже отклоняется', () => {
    const completedAt = new Date('2026-07-01T10:00:00Z');
    const inWindow = new Date('2026-07-03T10:00:00Z');
    const late = new Date('2026-07-10T10:00:00Z');
    expect(sm.validate('b2c', 'open_dispute', emptyContext({ status: 'closed', completedAt, now: inWindow })).ok).toBe(true);
    expect(sm.validate('b2c', 'open_dispute', emptyContext({ status: 'closed', completedAt, now: late })).ok).toBe(false);
  });
});

describe('B2B: лимиты и предоплата (DEV-10 §4.2)', () => {
  const auto = {
    withinOrderLimit: true,
    monthlyLimitOk: true,
    prepaymentMarked: true,
  };

  it('авто-старт в лимитах проходит', () => {
    expect(sm.validate('b2b', 'assign', emptyContext({ status: 'estimated', ...auto })).ok).toBe(true);
  });

  it('апсейл и заявка из осмотра никогда не автостартуют', () => {
    expect(sm.validate('b2b', 'assign', emptyContext({ status: 'estimated', ...auto, isUpsell: true })).ok).toBe(false);
    expect(sm.validate('b2b', 'assign', emptyContext({ status: 'estimated', ...auto, fromInspection: true })).ok).toBe(false);
  });

  it('B2B разовая без отметки предоплаты не назначается (ТЗ 8.3)', () => {
    const res = sm.validate(
      'b2b',
      'assign',
      emptyContext({ status: 'estimated', ...auto, prepaymentMarked: false }),
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.violation.failedGuard).toBe('prepayment_if_no_contract');
  });

  it('сверх лимита — путь через утверждение', () => {
    expect(sm.validate('b2b', 'request_approval', emptyContext({ status: 'estimated' })).ok).toBe(true);
    expect(sm.validate('b2b', 'approve', emptyContext({ status: 'pending_approval' })).ok).toBe(true);
    expect(sm.validate('b2b', 'assign', emptyContext({ status: 'approved' })).ok).toBe(true);
  });
});

describe('Спецтипы', () => {
  it('аварийная минует оценку: new → assigned', () => {
    expect(ok(sm.validate('emergency', 'assign', emptyContext({ status: 'new' }))).to).toBe('assigned');
    // фото «до» не блокирует старт
    expect(sm.validate('emergency', 'start', emptyContext({ status: 'master_departed' })).ok).toBe(true);
  });

  it('осмотр: «Выполнена» требует чек-лист и представителя', () => {
    const noRep = sm.validate('inspection', 'complete', emptyContext({ status: 'in_progress', checklistFilled: true }));
    expect(noRep.ok).toBe(false);
    if (!noRep.ok) expect(noRep.violation.failedGuard).toBe('representative_fixed');
    expect(
      sm.validate(
        'inspection',
        'complete',
        emptyContext({ status: 'in_progress', checklistFilled: true, representativeFixed: true }),
      ).ok,
    ).toBe(true);
  });

  it('гарантийная не закрывается без квалификации вины', () => {
    const res = sm.validate('warranty', 'close', emptyContext({ status: 'verified', billingPosted: true }));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.violation.failedGuard).toBe('fault_qualified');
  });

  it('заявка из дефекта создаётся сразу в «Утверждена», оценка свежа ≤ 30 дней', () => {
    expect(ok(sm.validate('from_defect', 'create', emptyContext({ defectEstimateFresh: true }))).to).toBe('approved');
    expect(sm.validate('from_defect', 'create', emptyContext()).ok).toBe(false);
  });

  it('этапная: complete_stage требует подтверждённой цепочки слотов', () => {
    const res = sm.validate('b2c', 'complete_stage', emptyContext({ status: 'in_progress' }));
    expect(res.ok).toBe(false);
    expect(
      sm.validate('b2c', 'complete_stage', emptyContext({ status: 'in_progress', stageChainConfirmed: true })).ok,
    ).toBe(true);
  });
});

describe('Контрактный тест DEV-10 §6.1: полный перебор пар (статус, действие)', () => {
  it('каждая пара вне графа даёт STATE_MACHINE_VIOLATION, ни одна не проходит молча', () => {
    for (const type of ['b2c', 'b2b', 'emergency', 'inspection', 'warranty', 'from_defect'] as const) {
      for (const status of ORDER_STATUSES) {
        for (const action of TRANSITION_ACTIONS) {
          const defined = sm.find(type, status as OrderStatus, action) !== undefined;
          const res = sm.validate(type, action, emptyContext({ status: status as OrderStatus }));
          if (!defined) {
            expect(res.ok, `${type}: ${status} --${action}--> должно быть отклонено`).toBe(false);
            if (!res.ok) expect(res.violation.code).toBe('STATE_MACHINE_VIOLATION');
          }
        }
      }
    }
  });
});
