import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../identity/auth.guard';
import { BuildingsService } from './buildings.service';
import type { JwtClaims } from '../../common/jwt';

/**
 * Контур «Дом»: объекты и адресный матчинг (DEV-03 tag buildings).
 * Тенант 't0' — до мультитенантности из JWT, как в остальных контроллерах.
 */
@Controller('buildings')
@UseGuards(AuthGuard)
export class BuildingsController {
  constructor(private readonly buildings: BuildingsService) {}

  @Post()
  create(@Body() body: { name: string; address: string; buildingType?: 'residential' | 'business_center' | 'mixed'; emergencyPhone?: string; internalBufferMin?: number; hasServiceLift?: boolean; parkingRules?: string; wasteRules?: string }) {
    return this.buildings.createBuilding('t0', body);
  }

  @Post(':id/units')
  addUnit(@Param('id') id: string, @Body() body: { number: string; entrance?: string; floor?: number; riserIds?: string[] }) {
    return this.buildings.addUnit('t0', id, body);
  }

  @Post('units/:unitId/residents')
  addResident(
    @Param('unitId') unitId: string,
    @Body() body: { userPhone: string; fullName?: string; residentRole?: 'owner' | 'tenant' | 'family' },
  ) {
    return this.buildings.addResident('t0', unitId, body);
  }

  @Get('units/:unitId/residents')
  residents(@Param('unitId') unitId: string) {
    return this.buildings.listResidents('t0', unitId);
  }

  @Get(':id/residents-summary')
  residentsSummary(@Param('id') id: string) {
    return this.buildings.residentsSummary('t0', id);
  }

  @Get(':id/units')
  units(@Param('id') id: string) {
    return this.buildings.listUnits('t0', id);
  }

  @Post(':id/zones')
  addZone(@Param('id') id: string, @Body() body: { zoneType: string; label: string; riserId?: string; isCritical?: boolean; isLicensed?: boolean }) {
    return this.buildings.addZone('t0', id, body);
  }

  @Get(':id/zones')
  zones(@Param('id') id: string) {
    return this.buildings.listZones('t0', id);
  }

  /**
   * D-23: реестр объектов для диспетчерской и админки — операционная картина контура.
   * Отдаёт счётчики деградации, чтобы просрочки согласований были видны платформе,
   * а не только оператору.
   */
  @Get()
  list(@Query('operatorOrgId') operatorOrgId?: string) {
    return this.buildings.listBuildings('t0', operatorOrgId);
  }

  /** GET /v1/buildings/resolve?address=… — матчинг адреса заявки на объект */
  @Get('resolve')
  resolve(@Query('address') address = '') {
    return this.buildings.resolve('t0', address);
  }

  /**
   * Спрос жителей с публичной страницы объекта (L-10).
   * Обязан быть объявлен выше @Get(':id') — иначе параметрический роут
   * перехватит 'demand' как идентификатор объекта.
   */
  @Get('demand')
  demand() {
    return this.buildings.demandByAddress('t0');
  }

  @Get(':id')
  get(@Param('id') id: string) {
    const b = this.buildings.get('t0', id);
    return { ...b, readinessGaps: this.buildings.readinessGaps('t0', b) };
  }

  /** Заявка организации на подключение объекта (self-serve). Прав не даёт — только очередь модерации */
  @Post(':id/claim')
  claim(
    @Param('id') id: string,
    @Body()
    body: {
      operatorOrgId: string;
      operatorName?: string;
      applicantPhone?: string;
      documentKind?: string;
      documentId?: string;
      contactPhone?: string;
    },
    @Req() req: { auth: JwtClaims },
  ) {
    return this.buildings.claim('t0', id, {
      operatorOrgId: body.operatorOrgId,
      operatorName: body.operatorName,
      applicantPhone: body.applicantPhone ?? req.auth.phone,
      documentKind: body.documentKind ?? 'договор управления',
      documentId: body.documentId,
      contactPhone: body.contactPhone,
    });
  }

  // ---------- A-39: модерация подключений ----------

  @Get('claims/queue')
  claims(@Query('status') status?: 'pending' | 'frozen' | 'approved' | 'rejected') {
    return this.buildings.listClaims('t0', status);
  }

  @Get('claims/:claimId/signals')
  claimSignals(@Param('claimId') claimId: string) {
    return this.buildings.claimSignals('t0', claimId);
  }

  @Post('claims/:claimId/callback')
  callback(@Param('claimId') claimId: string, @Body() body: { result: 'confirmed' | 'denied' | 'no_answer' }) {
    return this.buildings.setCallback('t0', claimId, body.result);
  }

  @Post('claims/:claimId/decide')
  decide(
    @Param('claimId') claimId: string,
    @Body() body: { decision: 'approve' | 'reject'; reason?: string },
    @Req() req: { auth: JwtClaims },
  ) {
    return this.buildings.decideClaim('t0', claimId, body.decision, body.reason ?? '', req.auth.phone);
  }

  /** Верификация модератором платформы — автоматически не происходит никогда */
  @Post(':id/verify')
  verify(@Param('id') id: string, @Req() req: { auth: JwtClaims }) {
    return this.buildings.verify('t0', id, req.auth.phone);
  }

  @Post(':id/activate')
  activate(@Param('id') id: string) {
    return this.buildings.activate('t0', id);
  }

  @Post(':id/staff')
  addStaff(
    @Param('id') id: string,
    @Body()
    body: {
      userPhone: string;
      fullName: string;
      staffRole: 'master' | 'approver' | 'dispatcher' | 'engineer' | 'head' | 'admin';
      isBackup?: boolean;
      isDuty?: boolean;
    },
  ) {
    return this.buildings.addStaff('t0', id, {
      userPhone: body.userPhone,
      fullName: body.fullName,
      staffRole: body.staffRole,
      isBackup: body.isBackup ?? false,
      isDuty: body.isDuty ?? false,
    });
  }

  @Get(':id/staff')
  staff(@Param('id') id: string) {
    return this.buildings.listStaff('t0', id);
  }

  @Post(':id/service-fee')
  setFee(@Param('id') id: string, @Body() body: { bps: number }) {
    return this.buildings.setServiceFee('t0', id, body.bps);
  }

  // ---------- Замечания и обходы (U-16, M-49, C-52) ----------

  @Post(':id/observations')
  addObservation(
    @Param('id') id: string,
    @Body()
    body: {
      zoneKey: string;
      categoryId: string;
      photoIds: string[];
      severity?: 'emergency' | 'work_required' | 'housekeeping' | 'info';
      source?: 'walkthrough' | 'resident' | 'master' | 'complaint';
      unitId?: string;
      comment?: string;
      joinObservationId?: string;
    },
    @Req() req: { auth: JwtClaims },
  ) {
    return this.buildings.addObservation('t0', id, { ...body, authorPhone: req.auth.phone });
  }

  @Get(':id/observations')
  listObservations(@Param('id') id: string, @Query('status') status?: 'open' | 'routed' | 'resolved' | 'rejected') {
    return this.buildings.listObservations('t0', id, status);
  }

  @Post('observations/:obsId/route')
  routeObservation(@Param('obsId') obsId: string, @Body() body: { routedTo: 'task' | 'defect' | 'order' | 'contractor' | 'journal' }) {
    return this.buildings.routeObservation('t0', obsId, body.routedTo);
  }

  @Post('observations/:obsId/resolve')
  resolveObservation(@Param('obsId') obsId: string, @Body() body: { resolvedPhotoId: string }) {
    return this.buildings.resolveObservation('t0', obsId, body.resolvedPhotoId);
  }

  // ---------- Паспорт здания и ТО (U-08) ----------

  @Post(':id/equipment')
  addEquipment(
    @Param('id') id: string,
    @Body() body: { equipmentType: string; model?: string; serial?: string; commissionedAt?: string; intervalDays?: number; commonZoneId?: string },
  ) {
    return this.buildings.addEquipment('t0', id, body);
  }

  @Get(':id/equipment')
  equipment(@Param('id') id: string) {
    return this.buildings.listEquipment('t0', id);
  }

  @Get(':id/maintenance-due')
  maintenanceDue(@Param('id') id: string, @Query('aheadDays') aheadDays = '7', @Query('now') now?: string) {
    return this.buildings.maintenanceDue('t0', id, Number(aheadDays), now ? new Date(now) : new Date());
  }

  @Post('equipment/:eqId/serviced')
  markServiced(@Param('eqId') eqId: string) {
    return this.buildings.markServiced('t0', eqId);
  }

  // ---------- Техдолг объекта (U-09) ----------

  @Post(':id/defects')
  addDefect(
    @Param('id') id: string,
    @Body() body: { title: string; severity?: 'emergency' | 'critical' | 'substantial' | 'cosmetic'; estimatedCostTiyin?: number; deadline?: string; source?: 'inspection' | 'order' | 'observation' | 'complaint' | 'supervision' | 'maintenance'; equipmentId?: string; observationId?: string },
  ) {
    return this.buildings.addDefect('t0', id, body);
  }

  @Get(':id/defects')
  defects(@Param('id') id: string) {
    return this.buildings.listDefects('t0', id);
  }

  @Get(':id/defects/summary')
  defectSummary(@Param('id') id: string) {
    return this.buildings.defectSummary('t0', id);
  }

  @Post('defects/:defectId/decide')
  decideDefect(
    @Param('defectId') defectId: string,
    @Body() body: { decision: 'planned' | 'postponed' | 'rejected'; reason?: string },
    @Req() req: { auth: JwtClaims },
  ) {
    return this.buildings.decideDefect('t0', defectId, body.decision, body.reason ?? '', req.auth.phone);
  }

  // ---------- Собственный прайс оператора и витрина услуг (C-07) ----------

  @Post('operators/:orgId/prices')
  addOperatorPrice(
    @Param('orgId') orgId: string,
    @Body() body: { name: string; unit?: string; priceFromTiyin: number; priceToTiyin?: number; scope?: 'private' | 'common_area'; buildingId?: string },
  ) {
    return this.buildings.addOperatorPrice('t0', orgId, body);
  }

  @Get('operators/:orgId/prices')
  operatorPrices(@Param('orgId') orgId: string, @Query('buildingId') buildingId?: string) {
    return this.buildings.listOperatorPrices('t0', orgId, buildingId);
  }

  /** Витрина для жителя: что можно заказать в этом доме и у кого */
  @Get(':id/services')
  services(@Param('id') id: string) {
    return this.buildings.servicesForResident('t0', id);
  }

  // ---------- Обходы по расписанию (M-48, U-16) ----------

  @Post(':id/routes')
  addRoute(@Param('id') id: string, @Body() body: { name: string; intervalDays: number; zoneKeys: string[] }) {
    return this.buildings.addRoute('t0', id, body);
  }

  @Get(':id/routes')
  routes(@Param('id') id: string) {
    return this.buildings.listRoutes('t0', id);
  }

  @Get(':id/walkthroughs-due')
  walkthroughsDue(@Param('id') id: string, @Query('now') now?: string) {
    return this.buildings.walkthroughsDue('t0', id, now ? new Date(now) : new Date());
  }

  @Post('routes/:routeId/walks')
  startWalk(@Param('routeId') routeId: string, @Req() req: { auth: JwtClaims }) {
    return this.buildings.startWalk('t0', routeId, req.auth.phone);
  }

  @Post('walks/:walkId/zones')
  passZone(@Param('walkId') walkId: string, @Body() body: { zoneKey: string; observationId?: string }) {
    return this.buildings.passZone('t0', walkId, body.zoneKey, body.observationId);
  }

  @Post('walks/:walkId/finish')
  finishWalk(@Param('walkId') walkId: string) {
    return this.buildings.finishWalk('t0', walkId);
  }

  @Get(':id/walks')
  walks(@Param('id') id: string) {
    return this.buildings.listWalks('t0', id);
  }
}
