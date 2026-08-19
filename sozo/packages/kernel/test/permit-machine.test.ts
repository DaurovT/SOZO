/**
 * Контрактные тесты графа наряда-допуска — критерии приёмки DEV-10 §7.6.
 * Каждый тест соответствует пункту списка критериев; менять только вместе с документом.
 */
import { describe, it, expect } from 'vitest';
import { createPermitStateMachine, type PermitContext } from '../src/index.js';

const sm = createPermitStateMachine();

/** Контекст «всё в порядке» — тесты выключают ровно одно условие */
function ctx(over: Partial<PermitContext> = {}): PermitContext {
  return {
    now: new Date('2026-08-19T10:00:00Z'),
    status: 'draft',
    version: 0,
    hasCriticalZone: false,
    hasLicensedZone: false,
    masterIsPlatform: true,
    qualificationOk: true,
    operatorSelfDeclared: false,
    windowSelected: true,
    zonesSelected: true,
    approverAssigned: true,
    slaDeadlineSet: true,
    slaExpired: true,
    escalationChainExhausted: true,
    operatorActive: true,
    actorIsOperatorApprover: true,
    actorScopedToBuilding: true,
    alternativeWindowValid: true,
    clientOrDispatcherConfirmed: true,
    bookingWithinPermitWindow: true,
    buildingWorkHoursRespected: true,
    photoBeforeOpening: true,
    photoAfterRestore: true,
    activeVisitPass: true,
    withinPermitWindow: true,
    dispatcherOverride: false,
    shutdownScheduledIfRequired: true,
    requiresShutdown: false,
    resourceRestored: false,
    zoneSecuredConfirmed: true,
    permitWindowPassed: true,
    reasonFromDictionary: true,
    ...over,
  };
}

describe('DEV-10 §7.6 — критерии приёмки графа наряда-допуска', () => {
  it('1. переход вне графа отклоняется для любой роли', () => {
    const r = sm.validate('draft', 'open', ctx());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.violation.code).toBe('STATE_MACHINE_VIOLATION');
  });

  it('2. auto_approve на критичной зоне запрещён даже при истёкшем SLA', () => {
    const r = sm.validate('requested', 'auto_approve', ctx({ hasCriticalZone: true }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.violation.guard).toBe('zone_not_critical');
  });

  it('2a. auto_approve на обычной зоне при истёкшем SLA проходит', () => {
    expect(sm.validate('requested', 'auto_approve', ctx()).ok).toBe(true);
  });

  it('3. open без действующего пропуска отклоняется', () => {
    const r = sm.validate('scheduled', 'open', ctx({ activeVisitPass: false }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.violation.guard).toBe('active_visit_pass_for_master');
  });

  it('4. schedule мастеру платформы без квалификации отклоняется', () => {
    const r = sm.validate('approved', 'schedule', ctx({ qualificationOk: false }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.violation.guard).toBe('master_qualified_for_zones');
  });

  it('4a. мастер оператора проходит по самодекларации (платформа не проверяет)', () => {
    const r = sm.validate(
      'approved',
      'schedule',
      ctx({ masterIsPlatform: false, qualificationOk: false, operatorSelfDeclared: true }),
    );
    expect(r.ok).toBe(true);
  });

  it('4b. мастер оператора без самодекларации не проходит', () => {
    const r = sm.validate(
      'approved',
      'schedule',
      ctx({ masterIsPlatform: false, qualificationOk: true, operatorSelfDeclared: false }),
    );
    expect(r.ok).toBe(false);
  });

  it('5. наряд в лицензируемую зону мастеру платформы не создаётся вовсе (ТЗ 17.8)', () => {
    const r = sm.validate(null, 'create', ctx({ hasLicensedZone: true, masterIsPlatform: true }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.violation.guard).toBe('licensed_zone_not_for_platform_master');
  });

  it('5a. в ту же зону штатному мастеру оператора наряд создаётся', () => {
    const r = sm.validate(null, 'create', ctx({ hasLicensedZone: true, masterIsPlatform: false }));
    expect(r.ok).toBe(true);
  });

  it('6. close при requires_shutdown без восстановления ресурса отклоняется', () => {
    const r = sm.validate('opened', 'close', ctx({ requiresShutdown: true, resourceRestored: false }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.violation.guard).toBe('resource_restored_if_shutdown');
  });

  it('6a. close при восстановленном ресурсе проходит', () => {
    expect(
      sm.validate('opened', 'close', ctx({ requiresShutdown: true, resourceRestored: true })).ok,
    ).toBe(true);
  });

  it('close без фото после восстановления отклоняется', () => {
    const r = sm.validate('opened', 'close', ctx({ photoAfterRestore: false }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.violation.guard).toBe('photo_after_restore_min1');
  });

  it('open без фото до вскрытия отклоняется', () => {
    const r = sm.validate('scheduled', 'open', ctx({ photoBeforeOpening: false }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.violation.guard).toBe('photo_before_opening_min1_camera_only');
  });

  it('вскрытие вне окна допускается только санкцией диспетчера', () => {
    const denied = sm.validate('scheduled', 'open', ctx({ withinPermitWindow: false }));
    expect(denied.ok).toBe(false);
    const allowed = sm.validate(
      'scheduled',
      'open',
      ctx({ withinPermitWindow: false, dispatcherOverride: true }),
    );
    expect(allowed.ok).toBe(true);
  });

  it('отклонение и отмена требуют причины из справочника', () => {
    expect(sm.validate('requested', 'reject', ctx({ reasonFromDictionary: false })).ok).toBe(false);
    expect(sm.validate('approved', 'cancel', ctx({ reasonFromDictionary: false })).ok).toBe(false);
  });

  it('перенос окна: propose_window → accept_window → approved', () => {
    expect(sm.validate('requested', 'propose_window', ctx()).ok).toBe(true);
    expect(sm.validate('rescheduled', 'accept_window', ctx()).ok).toBe(true);
  });

  it('терминальные статусы не имеют исходящих переходов', () => {
    for (const s of ['rejected', 'closed', 'expired', 'cancelled'] as const) {
      expect(sm.allowedActions(s)).toEqual([]);
    }
  });

  it('submit без выбранного окна или согласующего отклоняется', () => {
    expect(sm.validate('draft', 'submit', ctx({ windowSelected: false })).ok).toBe(false);
    expect(sm.validate('draft', 'submit', ctx({ approverAssigned: false })).ok).toBe(false);
  });

  it('отмена возможна из всех нетерминальных статусов до opened', () => {
    for (const s of ['draft', 'requested', 'rescheduled', 'approved', 'scheduled'] as const) {
      expect(sm.allowedActions(s)).toContain('cancel');
    }
    // из opened отменить нельзя — зона уже вскрыта, её надо закрыть
    expect(sm.allowedActions('opened')).not.toContain('cancel');
  });
});
