import { Body, Controller, ForbiddenException, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { BuildingsService } from '../buildings/buildings.service';
import { MasterGuard, type MasterRequest } from './master.guard';

/**
 * M-47 «Плановое ТО на объекте» (DEV-09, DEV-15 §7.1).
 *
 * Отдельный контроллер от обхода: обход — это маршрут по зонам, ТО — работа по
 * конкретному оборудованию с регламентом, и смешивать их в одном наборе
 * маршрутов значит получить экран, где половина кнопок неприменима.
 *
 * Офлайн (DEV-15 §10.8.1): план кешируется целиком — регламент, история и
 * сроки едут в устройство заранее, потому что ИТП и щитовая находятся ровно
 * там, где нет связи. Отметки уходят очередью и перезаписываются по пункту,
 * а не копятся: повторная доставка из очереди не должна выглядеть как вторая
 * проверка.
 */
@Controller('master')
@UseGuards(MasterGuard)
export class MasterMaintenanceController {
  constructor(private readonly buildings: BuildingsService) {}

  /** План ТО по объекту: оборудование, регламенты, сроки и последние работы */
  @Get('buildings/:id/maintenance')
  plan(@Param('id') id: string, @Req() req: MasterRequest) {
    this.assertStaff(id, req);
    return { equipment: this.buildings.maintenancePlan('t0', id) };
  }

  /** История по единице оборудования — «что было в прошлый раз» */
  @Get('equipment/:id/maintenance')
  history(@Param('id') id: string, @Req() req: MasterRequest) {
    const list = this.buildings.maintenanceHistory('t0', id);
    if (list.length) this.assertStaff(list[0].buildingId, req);
    return { history: list };
  }

  /**
   * Начать ТО. Повторный вызов по тому же оборудованию возвращает открытую
   * сессию: мастер закрыл приложение в подвале и вернулся, и вторая сессия
   * разорвала бы уже проставленные отметки.
   */
  @Post('equipment/:id/maintenance')
  start(@Param('id') id: string, @Req() req: MasterRequest) {
    // Права проверяются ДО начала работы: иначе посторонний успевал создать
    // сессию и только потом получал отказ, а запись оставалась
    const e = this.buildings.equipmentById('t0', id);
    if (e) this.assertStaff(e.buildingId, req);
    return this.buildings.startMaintenance('t0', id, req.master!.phone);
  }

  @Post('maintenance/:id/items')
  mark(
    @Param('id') id: string,
    @Body() body: { itemId: string; done?: boolean; note?: string; photoIds?: string[] },
    @Req() req: MasterRequest,
  ) {
    const m = this.buildings.maintenanceById('t0', id);
    if (m) this.assertStaff(m.buildingId, req);
    return this.buildings.markMaintenanceItem('t0', id, {
      itemId: body.itemId,
      done: body.done ?? true,
      note: body.note,
      photoIds: body.photoIds,
    });
  }

  /**
   * Завершить ТО. Отказ приходит перечнем незакрытых обязательных пунктов —
   * см. `finishMaintenance`: общее «заполните всё» заставляет мастера сверять
   * пункты глазами, стоя у щитовой.
   */
  @Post('maintenance/:id/finish')
  finish(@Param('id') id: string, @Req() req: MasterRequest) {
    const m = this.buildings.maintenanceById('t0', id);
    if (m) this.assertStaff(m.buildingId, req);
    return this.buildings.finishMaintenance('t0', id);
  }

  private assertStaff(buildingId: string, req: MasterRequest): void {
    const phone = req.master!.phone;
    const inStaff = this.buildings.listStaff('t0', buildingId).some((s) => s.userPhone === phone);
    if (!inStaff) {
      throw new ForbiddenException({ code: 'NOT_BUILDING_STAFF', message: 'Вы не в штате службы этого объекта' });
    }
  }
}
