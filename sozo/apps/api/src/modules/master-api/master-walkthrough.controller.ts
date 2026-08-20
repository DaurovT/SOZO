import { BadRequestException, Body, Controller, ForbiddenException, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { OBSERVATION_CATEGORIES } from '@sozo/contracts';
import { BuildingsService } from '../buildings/buildings.service';
import { MasterGuard, type MasterRequest } from './master.guard';

/**
 * Режим «Обход» в приложении мастера: M-48 маршрут и чек-лист, M-49 быстрая
 * фиксация замечания, M-50 «Мои замечания» (DEV-15 §7.7, DEV-09).
 *
 * Отдельный контроллер, а не ветка в /buildings: у мастера своя авторизация
 * (карточка мастера, а не роль в JWT) и куда более узкий набор прав — он
 * фиксирует и проходит зоны, но не маршрутизирует замечания и не закрывает их.
 *
 * Объекты берутся из штата оператора по телефону: обход — работа сотрудника
 * эксплуатирующей организации, а не мастера платформы, приехавшего на заявку.
 */
@Controller('master')
@UseGuards(MasterGuard)
export class MasterWalkthroughController {
  constructor(private readonly buildings: BuildingsService) {}

  /** Плитки категорий для экрана быстрой фиксации — тот же справочник A-44 */
  @Get('observation-categories')
  categories() {
    return OBSERVATION_CATEGORIES;
  }

  /**
   * Объекты, где этот человек числится в штате оператора.
   *
   * Роль в штате не проверяем: обход делают и инженер, и руководитель службы,
   * и мастер оператора — ограничивать здесь значит заставить людей просить
   * доступ ради снимка мусора во дворе.
   */
  @Get('buildings')
  myBuildings(@Req() req: MasterRequest) {
    const phone = req.master!.phone;
    return this.buildings
      .listBuildings('t0')
      .filter((b) => this.buildings.listStaff('t0', b.id).some((s) => s.userPhone === phone))
      .map((b) => ({ id: b.id, name: b.name, address: b.address, operatorOrgId: b.operatorOrgId }));
  }

  @Get('buildings/:id/routes')
  routes(@Param('id') id: string, @Req() req: MasterRequest) {
    this.assertStaff(id, req);
    return {
      routes: this.buildings.listRoutes('t0', id),
      due: this.buildings.walkthroughsDue('t0', id),
      // Открытые замечания едут в устройство вместе с маршрутом: дедупликация
      // при съёмке обязана работать в подвале, где связи нет
      openObservations: this.buildings.listObservations('t0', id, 'open'),
    };
  }

  @Post('routes/:routeId/walks')
  startWalk(@Param('routeId') routeId: string, @Req() req: MasterRequest) {
    const walk = this.buildings.startWalk('t0', routeId, req.master!.phone);
    this.assertStaff(walk.buildingId, req);
    return walk;
  }

  @Post('walks/:walkId/zones')
  passZone(
    @Param('walkId') walkId: string,
    @Body() b: { zoneKey?: string; observationId?: string },
    @Req() req: MasterRequest,
  ) {
    if (!b?.zoneKey) throw new BadRequestException('Зона не указана');
    const walk = this.buildings.passZone('t0', walkId, b.zoneKey, b.observationId);
    this.assertStaff(walk.buildingId, req);
    return walk;
  }

  @Post('walks/:walkId/finish')
  finishWalk(@Param('walkId') walkId: string, @Req() req: MasterRequest) {
    const res = this.buildings.finishWalk('t0', walkId);
    this.assertStaff(res.buildingId, req);
    return res;
  }

  /**
   * M-49. Обязательны только фото и категория.
   *
   * Форма на десять полей означает, что через неделю руководитель вернётся в
   * WhatsApp, — поэтому зона, серьёзность и комментарий необязательны, а
   * дозаполняются в кабинете (DEV-15 §7.7.3).
   */
  @Post('buildings/:id/observations')
  async addObservation(
    @Param('id') id: string,
    @Body()
    b: {
      zoneKey?: string;
      categoryId?: string;
      photoIds?: string[];
      severity?: 'emergency' | 'work_required' | 'housekeeping' | 'info';
      comment?: string;
      joinObservationId?: string;
      walkId?: string;
    },
    @Req() req: MasterRequest,
  ) {
    this.assertStaff(id, req);
    if (!b?.categoryId) throw new BadRequestException('Категория не выбрана');

    const res = await this.buildings.addObservation('t0', id, {
      zoneKey: b.zoneKey?.trim() || 'не указана',
      categoryId: b.categoryId,
      photoIds: b.photoIds ?? [],
      severity: b.severity,
      source: 'walkthrough',
      comment: b.comment,
      authorPhone: req.master!.phone,
      joinObservationId: b.joinObservationId,
    });

    // Привязка к обходу — здесь, а не отдельным запросом: в очереди офлайна
    // два действия вместо одного означают два шанса рассинхронизироваться
    if (b.walkId) {
      this.buildings.passZone('t0', b.walkId, b.zoneKey?.trim() || 'не указана', res.observation.id);
    }
    return res;
  }

  /** M-50. Что зафиксировал этот человек — по всем своим объектам */
  @Get('observations')
  myObservations(@Req() req: MasterRequest) {
    const phone = req.master!.phone;
    return this.buildings
      .listBuildings('t0')
      .filter((b) => this.buildings.listStaff('t0', b.id).some((s) => s.userPhone === phone))
      .flatMap((b) =>
        this.buildings
          .listObservations('t0', b.id)
          .filter((o) => o.authorPhone === phone || o.joinedBy.includes(phone))
          .map((o) => ({ ...o, buildingName: b.name })),
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  /**
   * Человек фиксирует замечания только там, где он в штате.
   *
   * Без этой проверки мастер платформы, приехавший на одну заявку, мог бы
   * писать в журнал чужого объекта — а журнал оператор показывает правлению.
   */
  private assertStaff(buildingId: string, req: MasterRequest): void {
    const phone = req.master!.phone;
    const inStaff = this.buildings.listStaff('t0', buildingId).some((s) => s.userPhone === phone);
    if (!inStaff) {
      throw new ForbiddenException({
        code: 'NOT_BUILDING_STAFF',
        message: 'Вы не в штате службы этого объекта',
      });
    }
  }
}
