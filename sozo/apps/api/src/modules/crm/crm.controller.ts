import { BadRequestException, Body, Controller, Delete, Get, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard, Roles } from '../identity/auth.guard';
import { CrmService } from './crm.service';
import { AuditService } from '../platform/audit.service';
import { RegistryService } from '../registry/registry.module';
import type { JwtClaims } from '../../common/jwt';

@Controller('admin/organizations')
@UseGuards(AuthGuard)
export class CrmController {
  constructor(
    private readonly crm: CrmService,
    private readonly audit: AuditService,
    private readonly registry: RegistryService,
  ) {}

  @Get()
  @Roles('admin', 'accountant')
  list() {
    return this.crm.list();
  }

  /**
   * Все ответственные по всем организациям, с поиском.
   *
   * Раньше найти человека по телефону можно было, только зная его организацию:
   * открыть карточку, найти точку, развернуть список. При звонке «мне закрыли
   * доступ» это три-четыре перехода вслепую.
   *
   * Объявлен до `:id`, иначе Nest примет «representatives» за идентификатор
   * организации и вернёт 404.
   */
  @Get('representatives')
  @Roles('admin', 'accountant')
  representatives(@Query('q') q?: string) {
    const needle = q?.trim().toLowerCase();
    const rows = this.crm.list().flatMap((o) =>
      this.crm.get(o.id).locations.flatMap((loc) =>
        (loc.representatives ?? []).map((r) => ({
          organizationId: o.id,
          organizationName: o.name,
          organizationStatus: o.status,
          locationId: loc.id,
          locationName: loc.name,
          address: loc.address,
          id: r.id,
          fullName: r.fullName,
          phone: r.phone,
          role: r.role,
          position: r.position ?? null,
          approvalLimitTiyin: r.approvalLimitTiyin,
          primary: r.primary,
          // Та же логика, что в приложении: роль выводится из потолка, а не из JWT
          contour: r.approvalLimitTiyin === null ? 'org_manager' : r.approvalLimitTiyin > 0 ? 'site_manager' : 'staff',
        })),
      ),
    );
    if (!needle) return { representatives: rows, total: rows.length };
    const found = rows.filter((r) =>
      `${r.fullName} ${r.phone} ${r.role} ${r.position ?? ''} ${r.organizationName} ${r.locationName}`
        .toLowerCase()
        .includes(needle),
    );
    return { representatives: found, total: found.length };
  }

  @Get(':id')
  @Roles('admin', 'accountant')
  get(@Param('id') id: string) {
    return this.crm.get(id);
  }

  @Post()
  @Roles('admin')
  create(@Body() body: any, @Req() req: { auth: JwtClaims }) {
    const org = this.crm.create({
      name: body.name,
      inn: body.inn,
      vatPayer: !!body.vatPayer,
      contractType: body.contractType ?? 'one_off',
      contractKind: body.contractKind ?? 'monthly',
      subscriptionTiyin: body.subscriptionTiyin ?? null,
    });
    this.audit.write({ actorPhone: req.auth.phone, action: 'organization.created', entity: 'Organization', entityId: org.id });
    return org;
  }

  @Put(':id')
  @Roles('admin')
  update(@Param('id') id: string, @Body() patch: any, @Req() req: { auth: JwtClaims }) {
    const org = this.crm.update(id, patch);
    this.audit.write({ actorPhone: req.auth.phone, action: 'organization.updated', entity: 'Organization', entityId: id, payload: patch });
    return org;
  }

  /** A-07: условия договора (пороги, SLA, перенос остатка, программа баллов, пени) */
  @Put(':id/contract')
  @Roles('admin')
  updateTerms(@Param('id') id: string, @Body() patch: any, @Req() req: { auth: JwtClaims }) {
    const org = this.crm.updateTerms(id, patch);
    this.audit.write({ actorPhone: req.auth.phone, action: 'contract.terms_updated', entity: 'Organization', entityId: id, payload: patch });
    return org;
  }

  /**
   * Привести лимиты ответственных в соответствие с договором.
   *
   * Пороги живут в условиях договора, а потолок каждому человеку ставится
   * руками — и после правки договора лимиты остаются старыми. Кнопка не
   * автоматическая: где-то отклонение сделано осознанно, и молча его затирать
   * нельзя. Поэтому сначала показываем расхождения, применяем по команде.
   */
  @Get(':id/threshold-mismatch')
  @Roles('admin', 'accountant')
  thresholdMismatch(@Param('id') id: string) {
    return { mismatches: this.crm.thresholdMismatches(id) };
  }

  @Post(':id/apply-thresholds')
  @Roles('admin')
  applyThresholds(@Param('id') id: string, @Req() req: { auth: JwtClaims }) {
    const applied = this.crm.applyThresholds(id);
    this.audit.write({
      actorPhone: req.auth.phone,
      action: 'crm.thresholds_applied',
      entity: 'Organization',
      entityId: id,
      payload: { changed: applied.length },
    });
    return { applied, message: applied.length ? `Лимитов обновлено: ${applied.length}` : 'Все лимиты уже соответствуют договору' };
  }

  /**
   * Сколько должна стоить абонентка по паспортам объектов.
   *
   * Паспорт (площадь, тип объекта) заводился и лежал мёртвым грузом: сумма
   * договора ставилась руками, а связи между ней и объектами не было никакой.
   * Считаем как подсказку, а не как факт — переговоры ведёт человек, и скидка
   * или наценка за сеть остаются его правом.
   */
  @Get(':id/subscription-estimate')
  @Roles('admin', 'accountant')
  subscriptionEstimate(@Param('id') id: string) {
    const org = this.crm.get(id);
    const rates = this.registry.objectTypeRates;
    const rows = org.locations.map((loc) => {
      const rate = rates.find((r) => r.objectType === loc.passport.objectType);
      // Площадь не заполнена — берём типовую по этому типу объекта и говорим об этом
      const areaM2 = loc.passport.areaM2 ?? rate?.typicalAreaM2 ?? null;
      const amountTiyin = rate && areaM2 ? rate.ratePerM2Tiyin * areaM2 : null;
      return {
        locationId: loc.id,
        locationName: loc.name,
        objectType: loc.passport.objectType,
        areaM2,
        areaAssumed: loc.passport.areaM2 === null,
        ratePerM2Tiyin: rate?.ratePerM2Tiyin ?? null,
        amountTiyin,
        note: !rate
          ? 'Тип объекта не заполнен или для него нет ставки — посчитать нечем'
          : loc.passport.areaM2 === null
            ? 'Площадь не заполнена, взята типовая для этого типа объекта'
            : null,
      };
    });
    const estimate = rows.reduce((s, r) => s + (r.amountTiyin ?? 0), 0);
    const current = org.subscriptionTiyin ?? 0;
    return {
      locations: rows,
      estimateTiyin: estimate,
      currentTiyin: current,
      diffTiyin: estimate - current,
      unknownLocations: rows.filter((r) => r.amountTiyin === null).length,
      note: 'Расчёт справочный: сумма договора ставится руками и может отличаться осознанно',
    };
  }

  /** Расторжение — двойное подтверждение (PRD-04 §1.3) */
  @Post(':id/terminate')
  @Roles('admin')
  terminate(@Param('id') id: string, @Body() body: { secondAdminConfirmed?: boolean }, @Req() req: { auth: JwtClaims }) {
    if (!body?.secondAdminConfirmed) {
      throw new BadRequestException({ code: 'SECOND_ADMIN_REQUIRED', message: 'Расторжение договора требует двойного подтверждения' });
    }
    const org = this.crm.terminate(id);
    this.audit.write({ actorPhone: req.auth.phone, action: 'organization.terminated', entity: 'Organization', entityId: id });
    return org;
  }

  /** A-09: паспорт точки, график доступа, закреплённый мастер, чёрный список */
  @Put(':id/locations/:locId')
  @Roles('admin')
  updateLocation(@Param('id') id: string, @Param('locId') locId: string, @Body() patch: any, @Req() req: { auth: JwtClaims }) {
    const loc = this.crm.updateLocation(id, locId, patch);
    this.audit.write({ actorPhone: req.auth.phone, action: 'location.updated', entity: 'Location', entityId: locId, payload: patch });
    return loc;
  }

  /**
   * Ответственные на точке (A-09). Это выдача доступа к приложению клиента:
   * вписанный телефон открывает контур точки, снятый — закрывает.
   */
  @Post(':id/locations/:locId/representatives')
  @Roles('admin')
  addRepresentative(
    @Param('id') id: string,
    @Param('locId') locId: string,
    @Body() body: { fullName?: string; phone?: string; role?: string; position?: string; approvalLimitTiyin?: number | null; primary?: boolean },
    @Req() req: { auth: JwtClaims },
  ) {
    const rep = this.crm.addRepresentative(id, locId, {
      fullName: body.fullName ?? '',
      phone: body.phone ?? '',
      role: body.role ?? '',
      position: body.position?.trim() || undefined,
      // `null` — сознательный выбор «без потолка», это уровень организации.
      // `?? 0` его проглатывал и делал ровно обратное: человек с галочкой
      // «без потолка» не мог утвердить вообще ничего
      approvalLimitTiyin: body.approvalLimitTiyin === undefined ? 0 : body.approvalLimitTiyin,
      primary: body.primary ?? false,
    });
    this.audit.write({
      actorPhone: req.auth.phone,
      action: 'location.representative_added',
      entity: 'Location',
      entityId: locId,
      payload: { phone: rep.phone, role: rep.role, approvalLimitTiyin: rep.approvalLimitTiyin },
    });
    return rep;
  }

  @Put(':id/locations/:locId/representatives/:repId')
  @Roles('admin')
  updateRepresentative(
    @Param('id') id: string,
    @Param('locId') locId: string,
    @Param('repId') repId: string,
    @Body() patch: { fullName?: string; role?: string; position?: string; approvalLimitTiyin?: number | null; primary?: boolean },
    @Req() req: { auth: JwtClaims },
  ) {
    const rep = this.crm.updateRepresentative(id, locId, repId, patch);
    this.audit.write({
      actorPhone: req.auth.phone,
      action: 'location.representative_updated',
      entity: 'Location',
      entityId: locId,
      payload: { repId, ...patch },
    });
    return rep;
  }

  @Delete(':id/locations/:locId/representatives/:repId')
  @Roles('admin')
  removeRepresentative(
    @Param('id') id: string,
    @Param('locId') locId: string,
    @Param('repId') repId: string,
    @Req() req: { auth: JwtClaims },
  ) {
    const r = this.crm.removeRepresentative(id, locId, repId);
    this.audit.write({
      actorPhone: req.auth.phone,
      action: 'location.representative_removed',
      entity: 'Location',
      entityId: locId,
      payload: { repId },
    });
    return r;
  }

  @Post(':id/locations')
  @Roles('admin')
  addLocation(@Param('id') id: string, @Body() body: any) {
    return this.crm.addLocation(id, {
      name: body.name,
      address: body.address ?? '',
      lat: body.lat ?? null,
      lng: body.lng ?? null,
      orderLimitTiyin: body.orderLimitTiyin ?? null,
      monthlyLimitTiyin: body.monthlyLimitTiyin ?? null,
      photoForbidden: !!body.photoForbidden,
    });
  }
}
