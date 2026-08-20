import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { resourceLabel } from '@sozo/contracts';
import { BuildingsService } from '../buildings/buildings.service';
import { AccessService } from './access.service';

/** Ответ на неизвестный объект — он же ответ на неподключённый (см. ниже) */
const BLANK = {
  name: null,
  address: null,
  operatorName: null,
  connectionStatus: 'unmanaged' as const,
  emergencyPhone: null,
  shutdowns: [] as Array<{ resourceLabel: string; windowText: string; reason: string }>,
};


/**
 * Публичная карточка объекта (L-10) и сбор спроса по неподключённым домам.
 *
 * Без авторизации: страницу открывает житель по QR с наклейки в подъезде,
 * и требовать от него вход означает не получить ни одного обращения. Так же
 * устроены веб-карточка заявки и согласование наряда по ссылке (W-06).
 *
 * Живёт в access, а не в buildings: нужны оба сервиса сразу, а buildings по
 * DEV-07 §2.1 никого доменного не импортирует — обратная связь через
 * forwardRef сломала бы это правило ради одного экрана.
 *
 * Отдаём минимум: название, кто обслуживает, аварийный телефон и ближайшие
 * отключения. Персональных данных жителей и заявок здесь нет никогда.
 */
@Controller('public')
export class PublicBuildingController {
  constructor(
    private readonly buildings: BuildingsService,
    private readonly access: AccessService,
  ) {}

  @Get('buildings/:id')
  card(@Param('id') id: string) {
    const b = this.buildings.listBuildings('t0').find((x) => x.id === id);
    // Несуществующий и неподключённый объект отвечают одинаково: перебор
    // идентификаторов не должен рассказывать, какие дома у нас заведены
    if (!b || b.connectionStatus !== 'active') return BLANK;

    const claim = this.buildings
      .listClaims('t0', 'approved')
      .find((c) => c.buildingId === b.id && c.operatorOrgId === b.operatorOrgId);

    return {
      name: b.name,
      address: b.address,
      operatorName: claim?.operatorName ?? b.operatorOrgId,
      connectionStatus: b.connectionStatus,
      emergencyPhone: b.emergencyPhone,
      shutdowns: this.upcomingShutdowns(b.id),
    };
  }

  /** «Моего дома здесь нет» — спрос копится в реестре модерации (A-39) */
  @Post('demand')
  demand(@Body() body: { address?: string; phone?: string }) {
    if (!body?.address?.trim()) return { ok: false };
    this.buildings.addDemand('t0', body.address.trim(), body.phone?.trim() || undefined);
    return { ok: true };
  }

  /**
   * Только то, что жителю ещё предстоит пережить: завершённые и отменённые
   * отключения на наклейке в подъезде — шум, а не информация.
   */
  private upcomingShutdowns(buildingId: string) {
    const now = Date.now();
    return this.access
      .listShutdowns('t0', buildingId)
      .filter(
        (s) =>
          s.status !== 'restored' &&
          s.status !== 'cancelled' &&
          Date.parse(s.plannedTo) > now,
      )
      .sort((a, b) => Date.parse(a.plannedFrom) - Date.parse(b.plannedFrom))
      .map((s) => ({
        resourceLabel: resourceLabel(s.resourceType),
        windowText: `${fmtDateTime(s.plannedFrom)} — ${fmtTime(s.plannedTo)}`,
        reason: s.reason,
      }));
  }
}

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString('ru-RU', {
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}
