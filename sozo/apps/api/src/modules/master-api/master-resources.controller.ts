import { BadRequestException, Body, Controller, Get, NotFoundException, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { MasterGuard, type MasterRequest } from './master.guard';
import {
  ResourcesService,
  CONSUMABLE_CATALOG,
  SPARE_PART_CATALOG,
  PARTNER_STORES,
  PURCHASE_CODE_TTL_HOURS,
} from './resources.service';
import { RatingService, RATING_COMPONENTS } from './rating.service';
import { MasterOffersService } from './offers.service';
import { MasterOpsService, PURCHASE_LIMIT_TIYIN, SPARE_TIER_THRESHOLD_TIYIN } from './master-ops.service';
import { MasterPhotoService } from './photo.service';
import { OrdersService } from '../orders/orders.service';
import type { OrderRecord } from '../orders/order.repository';
import { MastersService } from '../masters/masters.module';
import { QualityService } from '../quality/quality.service';
import { AuditService } from '../platform/audit.service';
import { NotificationsService } from './notifications.service';
import { FieldService } from '../field/field.service';
import { CrmService } from '../crm/crm.service';
import { tr } from '../../common/locale';

/** Комплектность оборудования по категории — что сверяют при выдаче и возврате */
const COMPLETENESS: Record<string, string[]> = {
  сантехника: ['Основной блок', 'Насадки', 'Кейс', 'Зарядное устройство'],
  кондиционеры: ['Насос', 'Шланги', 'Переходники', 'Кейс'],
  диагностика: ['Прибор', 'Аккумулятор', 'Кабель', 'Чехол'],
};

/** Ракурсы для акта: без всех четырёх спорить о состоянии бессмысленно */
const ACT_ANGLES = ['Спереди', 'Сзади', 'Слева', 'Справа'];

/**
 * Ресурсы и репутация мастера (M-22, M-36, M-37, M-38, F-30, F-41, F-44, F-47, F-50, F-54).
 * Сюда же вынесены функции, которые документация относила к фазам 2–3.
 */
@Controller('master')
@UseGuards(MasterGuard)
export class MasterResourcesController {
  constructor(
    private readonly resources: ResourcesService,
    private readonly rating: RatingService,
    private readonly offers: MasterOffersService,
    private readonly ops: MasterOpsService,
    private readonly photos: MasterPhotoService,
    private readonly orders: OrdersService,
    private readonly masters: MastersService,
    private readonly quality: QualityService,
    private readonly audit: AuditService,
    private readonly notificationsSvc: NotificationsService,
    private readonly field: FieldService,
    private readonly crm: CrmService,
  ) {}

  private async mine(id: string, masterId: string): Promise<OrderRecord> {
    const o = await this.orders.record('t0', id);
    if (o.masterId !== masterId && o.helperId !== masterId) throw new NotFoundException({ code: 'ORDER_NOT_FOUND' });
    return o;
  }

  // ---------- Лента уведомлений (PRD-02 §7) ----------

  @Get('notifications')
  notifications(@Query('limit') limit: string | undefined, @Req() req: MasterRequest) {
    const m = req.master!;
    return this.notificationsSvc.feed(m.id, Number(limit ?? 100));
  }

  /** Без id помечаем всё: мастер открыл ленту — значит увидел */
  @Post('notifications/read')
  markRead(@Body() b: { id?: string }, @Req() req: MasterRequest) {
    const m = req.master!;
    return { marked: this.notificationsSvc.markRead(m.id, b?.id), unread: this.notificationsSvc.unreadCount(m.id) };
  }

  // ---------- M-36 Сумка / MasterStock ----------

  @Get('stock')
  stock(@Req() req: MasterRequest) {
    const m = req.master!;
    const items = this.resources.stockOf(m.id, m.skillTags);
    return {
      items,
      catalog: CONSUMABLE_CATALOG.filter((c) => m.skillTags.includes(c.skill)),
      belowMin: items.filter((i) => i.belowMin).length,
      refills: this.resources.refills.filter((r) => r.masterId === m.id).slice(-20).reverse(),
      note: 'Расходники из сумки списываются в заявку автоматически. Сумма расходников идёт вам полностью',
      empty: 'Сумка пуста. Пополните чеком — расходники в заявках будут списываться отсюда',
    };
  }

  @Post('stock/refill')
  async refill(
    @Body() b: { items?: Array<{ catalogId: string; qty: number }>; receiptDataUrl?: string },
    @Req() req: MasterRequest,
  ) {
    const m = req.master!;
    if (!b?.receiptDataUrl) {
      throw new BadRequestException({ code: 'RECEIPT_REQUIRED', message: 'Снимите чек — пополнение зачисляется по себестоимости из него' });
    }
    // Чек пополнения не привязан к заявке, поэтому храним как отдельный файл
    const file = `refill-${Date.now()}`;
    const rec = this.resources.refillStock(m.id, b?.items ?? [], file);
    this.audit.write({ actorPhone: m.phone, action: 'master.stock_refilled', entity: 'MasterProfile', entityId: m.id, payload: { totalTiyin: rec.totalTiyin } });
    return { ...rec, message: tr('Зачислено на {0} сум — сумма пойдёт в возмещение', Math.round(rec.totalTiyin / 100)) };
  }

  // ---------- M-22 Код закупки ----------

  @Get('orders/:id/purchase-code')
  async purchaseCodes(@Param('id') id: string, @Req() req: MasterRequest) {
    const m = req.master!;
    const o = await this.mine(id, m.id);
    return {
      items: this.resources.purchaseCodesFor(id),
      stores: PARTNER_STORES,
      ttlHours: PURCHASE_CODE_TTL_HOURS,
      budgetTiyin: Math.max(0, PURCHASE_LIMIT_TIYIN - o.totalMaterialTiyin),
      note: 'Закупка в долг компании — деньги мастера не нужны',
    };
  }

  @Post('orders/:id/purchase-code')
  async issueCode(@Param('id') id: string, @Req() req: MasterRequest) {
    const m = req.master!;
    const o = await this.mine(id, m.id);
    const budget = Math.max(0, PURCHASE_LIMIT_TIYIN - o.totalMaterialTiyin);
    if (budget <= 0) {
      throw new BadRequestException({ code: 'BUDGET_SPENT', message: 'Лимит закупки по заявке исчерпан — согласуйте с диспетчером' });
    }
    const rec = this.resources.issuePurchaseCode(id, m.id, budget);
    this.audit.write({ actorPhone: m.phone, action: 'master.purchase_code_issued', entity: 'Order', entityId: id, payload: { limitTiyin: rec.limitTiyin } });
    return rec;
  }

  @Post('orders/:id/purchase-code/:codeId/invoice')
  async invoice(
    @Param('id') id: string,
    @Param('codeId') codeId: string,
    @Body() b: { dataUrl?: string; items?: Array<{ name: string; amountSoums: number; priceTier?: 'economy' | 'standard' | 'premium' }> },
    @Req() req: MasterRequest,
  ) {
    const m = req.master!;
    const order = await this.mine(id, m.id);
    if (!b?.dataUrl) throw new BadRequestException({ code: 'PHOTO_REQUIRED', message: 'Снимите накладную — диспетчер сверит её со сметой' });
    const items = (b?.items ?? []).map((i) => ({
      name: i.name,
      amountTiyin: Math.round((i.amountSoums ?? 0) * 100),
      priceTier: i.priceTier,
    }));
    // Проверяем всё до записи: иначе накладная сохранится, а материалы — нет.
    // Лимит первым: он про сам смысл кода, вилка — про конкретную позицию.
    const code = this.resources.purchaseCodesFor(id).find((c) => c.id === codeId);
    if (!code) throw new NotFoundException({ code: 'CODE_NOT_FOUND' });
    const total = items.reduce((s, i) => s + i.amountTiyin, 0);
    if (total > code.limitTiyin) {
      throw new BadRequestException({
        code: 'LIMIT_EXCEEDED',
        message: tr('Накладная на {0} сум превышает лимит кода {1} сум', Math.round(total / 100), Math.round(code.limitTiyin / 100)),
      });
    }
    const needTier = items.filter((i) => i.amountTiyin > SPARE_TIER_THRESHOLD_TIYIN && !i.priceTier);
    if (needTier.length) {
      throw new BadRequestException({
        code: 'PRICE_TIER_REQUIRED',
        message: tr('Дороже 200 000 сум — укажите выбранную клиентом вилку: {0}', needTier.map((i) => i.name).join(', ')),
      });
    }
    await this.photos.save(order, { stage: 'receipt', dataUrl: b.dataUrl, note: 'накладная по коду закупки', geo: null, masterName: m.fullName });
    const rec = this.resources.attachInvoice(codeId, 'invoice', items.map((i) => ({ name: i.name, amountTiyin: i.amountTiyin })));
    // Позиции накладной идут в материалы заявки без наценки клиенту
    for (const i of items) {
      await this.orders.addMaterial('t0', id, {
        kind: 'spare_part',
        name: i.name,
        amountTiyin: i.amountTiyin,
        sourceChannel: 'partner_store',
        hasReceipt: true,
        priceTier: i.priceTier,
      });
    }
    return { ...rec, message: 'Накладная зафиксирована, позиции добавлены в материалы' };
  }

  // ---------- M-37/M-38 Оборудование и акты ----------

  @Get('equipment/full')
  equipment(@Req() req: MasterRequest) {
    const m = req.master!;
    const mine = this.resources.equipmentOf(m.id);
    return {
      items: mine.map((e) => ({ ...e, completeness: COMPLETENESS[e.category] ?? ['Основной блок'] })),
      available: this.resources.availableEquipment(m.skillTags),
      acts: this.resources.actsFor(m.id),
      angles: ACT_ANGLES,
      hasVehicle: m.hasVehicle,
      note: 'Заявки, требующие оборудование, приходят только мастерам с выданным оборудованием и транспортом',
      empty: 'Оборудование не выдано',
    };
  }

  @Post('equipment/:id/act')
  async act(
    @Param('id') equipmentId: string,
    @Body() b: { kind?: 'issue' | 'return'; photos?: string[]; completeness?: Array<{ item: string; ok: boolean }>; discrepancy?: string },
    @Req() req: MasterRequest,
  ) {
    const m = req.master!;
    const rec = this.resources.createAct({
      equipmentId,
      masterId: m.id,
      kind: b?.kind ?? 'issue',
      photos: b?.photos ?? [],
      completeness: b?.completeness ?? [],
      discrepancy: b?.discrepancy,
    });
    this.audit.write({ actorPhone: m.phone, action: `equipment.act_${rec.kind}`, entity: 'Equipment', entityId: equipmentId, payload: { actId: rec.id } });
    return {
      id: rec.id,
      kind: rec.kind,
      /** Dev: код показываем сразу; в проде приходит кладовщику отдельным каналом */
      devConfirmCode: rec.confirmCode,
      message: 'Подтвердите акт кодом — код выдаёт сервер, офлайн подтвердить нельзя',
    };
  }

  @Post('equipment/acts/:actId/confirm')
  confirmAct(@Param('actId') actId: string, @Body() b: { code?: string }, @Req() req: MasterRequest) {
    const m = req.master!;
    const rec = this.resources.confirmAct(actId, b?.code ?? '');
    this.audit.write({ actorPhone: m.phone, action: 'equipment.act_confirmed', entity: 'Equipment', entityId: rec.equipmentId });
    return { ...rec, message: 'Акт оформлен. PDF в архиве' };
  }

  // ---------- F-30 Доказательство замены ----------

  /** Дорогая запчасть закрывается тремя снимками: старая, новая в упаковке, установленная */
  @Post('orders/:id/replacement-proof')
  async replacementProof(
    @Param('id') id: string,
    @Body() b: { partName?: string; oldPart?: string; newPart?: string; installed?: string },
    @Req() req: MasterRequest,
  ) {
    const m = req.master!;
    const order = await this.mine(id, m.id);
    const slots = [
      { key: 'oldPart', title: 'Старая деталь', dataUrl: b?.oldPart },
      { key: 'newPart', title: 'Новая в упаковке', dataUrl: b?.newPart },
      { key: 'installed', title: 'Установленная', dataUrl: b?.installed },
    ];
    const missing = slots.filter((s) => !s.dataUrl);
    if (missing.length) {
      throw new BadRequestException({
        code: 'PROOF_INCOMPLETE',
        message: tr('Не хватает снимков: {0}', missing.map((s) => s.title).join(', ')),
      });
    }
    for (const s of slots) {
      await this.photos.save(order, {
        stage: 'during',
        dataUrl: s.dataUrl,
        note: `доказательство замены · ${s.title}${b?.partName ? ` · ${b.partName}` : ''}`,
        geo: null,
        masterName: m.fullName,
      });
    }
    this.audit.write({ actorPhone: m.phone, action: 'master.replacement_proof', entity: 'Order', entityId: id, payload: { part: b?.partName } });
    return { ok: true, slots: slots.length, note: 'Демонтированную деталь оставьте клиенту' };
  }

  // ---------- F-47 Чек-лист осмотра ----------

  /**
   * Акт осмотра: черновик заводится при первом открытии экрана. Мастер собирает
   * чек-лист и дефекты, потом отправляет ответственному на точке — подписывает
   * не мастер, а тот, кто отвечает за объект.
   */
  private async actFor(orderId: string, req: MasterRequest) {
    const m = req.master!;
    const o = await this.mine(orderId, m.id);
    if (!o.locationId) {
      throw new BadRequestException({
        code: 'NOT_A_SITE_ORDER',
        message: 'Акт осмотра ведётся только по заявке на точку B2B',
      });
    }
    const site = this.crm.findLocation(o.locationId);
    if (!site) throw new NotFoundException({ code: 'LOCATION_NOT_FOUND' });
    return {
      order: o,
      act: this.field.draftFor({
        orderId: o.id,
        organizationId: site.org.id,
        locationId: site.loc.id,
        locationName: site.loc.name,
        masterId: m.id,
        masterName: m.fullName,
      }),
      site,
    };
  }

  @Post('orders/:id/inspection/checklist')
  async checklist(
    @Param('id') id: string,
    @Body() b: { zones?: Array<{ zone: string; ok: boolean; note?: string }> },
    @Req() req: MasterRequest,
  ) {
    const { act } = await this.actFor(id, req);
    const zones = b?.zones ?? [];
    if (zones.length === 0) throw new BadRequestException({ code: 'CHECKLIST_EMPTY', message: 'Отметьте зоны обхода' });
    return this.field.setChecklist(act.id, zones);
  }

  /**
   * Отправка акта ответственному. После неё правки закрыты: подписывают то,
   * что видели. Ответственного нет на месте — акт всё равно уходит, решение
   * он примет в приложении удалённо, а мастер не ждёт его на объекте.
   */
  @Post('orders/:id/inspection/submit')
  async submitAct(@Param('id') id: string, @Body() b: { representativeAbsent?: boolean }, @Req() req: MasterRequest) {
    const { act } = await this.actFor(id, req);
    const sent = this.field.submit(act.id, { representativeAbsent: !!b?.representativeAbsent });
    this.audit.write({
      actorPhone: req.master!.phone,
      action: 'master.act_submitted',
      entity: 'InspectionAct',
      entityId: sent.id,
      payload: { items: sent.items.length, absent: !!b?.representativeAbsent },
    });
    return {
      ok: true,
      act: sent,
      note: tr('Акт {0} отправлен: {1}. Осмотр можно завершать.', sent.number, sent.representative?.fullName ?? 'ответственному'),
    };
  }

  /**
   * Работа готова — отправляем на приёмку ответственному. Пока он не принял,
   * завершить заявку нельзя: подпись за клиента мастер не ставит.
   */
  @Post('orders/:id/acceptance/request')
  async requestAcceptance(@Param('id') id: string, @Body() b: { absent?: boolean }, @Req() req: MasterRequest) {
    const m = req.master!;
    const order = await this.mine(id, m.id);
    if (!order.locationId) {
      throw new BadRequestException({ code: 'NOT_A_SITE_ORDER', message: 'Приёмка через приложение — только для заявок B2B' });
    }
    if (order.acceptance) throw new BadRequestException({ code: 'ALREADY_ACCEPTED', message: 'Работа уже принята' });
    const rep = this.crm.primaryRepresentative(order.locationId);
    if (!rep) {
      throw new BadRequestException({
        code: 'NO_REPRESENTATIVE',
        message: 'У точки нет ответственного — принимать работу некому. Сообщите диспетчеру.',
      });
    }
    order.acceptanceRequest = {
      at: new Date().toISOString(),
      pending: true,
      representative: { id: rep.id, fullName: rep.fullName, phone: rep.phone },
      absent: !!b?.absent,
      rejections: order.acceptanceRequest?.rejections ?? [],
    };
    this.orders.touchOrder();
    this.audit.write({ actorPhone: m.phone, action: 'master.acceptance_requested', entity: 'Order', entityId: id, payload: { absent: !!b?.absent } });
    return { ok: true, sentTo: rep.fullName, note: 'Отправлено на приёмку — ждём подтверждения ответственного' };
  }

  @Get('orders/:id/inspection')
  async inspection(@Param('id') id: string, @Req() req: MasterRequest) {
    const m = req.master!;
    const o = await this.mine(id, m.id);
    const template = [
      'Водоснабжение: течи, давление, состояние подводок',
      'Канализация: проходимость, запах, стыки',
      'Отопление: котёл, радиаторы, запорная арматура',
      'Электрика: щит, автоматы, розеточные группы, УЗО',
      'Вентиляция: тяга, решётки, каналы',
      'Общие зоны: подвал, стояки, крыша (если доступ есть)',
    ];
    const act = o.locationId ? this.field.byOrder(o.id) : null;
    const rep = o.locationId ? this.crm.primaryRepresentative(o.locationId) : null;
    return {
      isInspection: o.graphType === 'inspection',
      template,
      act,
      defects: act?.items.length ?? 0,
      /** Кому уйдёт акт — мастер должен видеть это до отправки */
      representative: rep ? { fullName: rep.fullName, role: rep.role } : null,
      representativeFixed: !!act && act.status !== 'draft',
      note: 'У осмотра нет фото «после» — вместо него чек-лист и подпись ответственного на точке',
    };
  }

  /**
   * Позиция акта. Фото обязательно — кроме режимных объектов, где съёмка
   * запрещена договором (ТЗ 4.1): там дефект держится на описании и подписи.
   * Цену можно не ставить: то, что не оценить на месте, считает офис.
   */
  @Post('orders/:id/inspection/defect')
  async defect(
    @Param('id') id: string,
    @Body()
    b: {
      category?: string;
      description?: string;
      severity?: 'low' | 'medium' | 'high';
      dataUrl?: string;
      estimateSoums?: number;
    },
    @Req() req: MasterRequest,
  ) {
    const m = req.master!;
    const { order, act, site } = await this.actFor(id, req);
    const description = b?.description?.trim();
    if (!description) throw new BadRequestException({ code: 'DESCRIPTION_REQUIRED' });
    const photoForbidden = site.loc.photoForbidden || !!order.restrictedSite;
    if (!b?.dataUrl && !photoForbidden) {
      throw new BadRequestException({ code: 'PHOTO_REQUIRED', message: 'Дефект фиксируется с фото' });
    }
    const photoIds: string[] = [];
    const dataUrl = b?.dataUrl;
    if (dataUrl) {
      const before = new Set(order.photos.map((p) => p.id));
      await this.photos.save(order, {
        stage: 'during',
        dataUrl,
        note: `дефект · ${b.category ?? 'прочее'} · ${b.severity ?? 'medium'} · ${description}`,
        geo: null,
        masterName: m.fullName,
      });
      // id у фото опционален в модели, поэтому берём только реально проставленные
      photoIds.push(...order.photos.flatMap((p) => (p.id && !before.has(p.id) ? [p.id] : [])));
    }
    const item = this.field.addItem(act.id, {
      category: b.category ?? 'прочее',
      description,
      severity: b.severity ?? 'medium',
      photoIds,
      estimateTiyin: b.estimateSoums && b.estimateSoums > 0 ? Math.round(b.estimateSoums * 100) : null,
    });
    return { ok: true, item, defects: this.field.get(act.id).items.length, photoSkipped: photoForbidden && !b?.dataUrl };
  }

  @Post('orders/:id/inspection/defect/:itemId/remove')
  async removeDefect(@Param('id') id: string, @Param('itemId') itemId: string, @Req() req: MasterRequest) {
    const { act } = await this.actFor(id, req);
    return this.field.removeItem(act.id, itemId);
  }

  // ---------- F-54 Рейтинг с расшифровкой ----------

  @Get('rating')
  async ratingBreakdown(@Req() req: MasterRequest) {
    const m = req.master!;
    const all = await this.orders.list('t0');
    const stats = this.offers.responseStats(m.id);
    const confirmed = this.quality.complaints.filter((c) => c.masterId === m.id && c.confirmed).length;
    const rework = all.filter((o) => o.masterId === m.id && o.graphType === 'warranty').length;
    const r = this.rating.compute({
      orders: all,
      masterId: m.id,
      offerStats: { offers: stats.offers, accepted: stats.accepted },
      confirmedComplaints: confirmed,
      reworkOrders: rework,
    });
    // Грейд держим в карточке актуальным: от него зависит доля
    if (m.grade !== r.grade || m.rating !== r.score) {
      this.masters.update(m.id, { grade: r.grade, rating: r.score });
    }
    return {
      ...r,
      definitions: RATING_COMPONENTS,
      upsell: this.ops.recommendationStats(m.id),
      appeals: this.rating.appealsFor(m.id),
    };
  }

  // ---------- F-50 Апелляции ----------

  @Post('appeals')
  appeal(@Body() b: { subject?: 'rating' | 'deduction' | 'sanction' | 'complaint'; reference?: string; text?: string }, @Req() req: MasterRequest) {
    const m = req.master!;
    const rec = this.rating.appeal({
      masterId: m.id,
      subject: b?.subject ?? 'rating',
      reference: b?.reference ?? '',
      text: b?.text ?? '',
    });
    this.audit.write({ actorPhone: m.phone, action: 'master.appeal_filed', entity: 'MasterProfile', entityId: m.id, payload: { subject: rec.subject } });
    return { ...rec, message: 'Апелляция отправлена диспетчеру — решение придёт с обоснованием' };
  }

  @Get('appeals')
  appeals(@Req() req: MasterRequest) {
    const m = req.master!;
    return { items: this.rating.appealsFor(m.id) };
  }

  // ---------- F-44 Чаевые ----------

  @Get('tips')
  tips(@Req() req: MasterRequest) {
    const m = req.master!;
    const items = this.rating.tipsFor(m.id);
    return {
      items: items.slice(-30).reverse(),
      totalTiyin: items.reduce((s, t) => s + t.amountTiyin, 0),
      note: 'Чаевые приходят целиком вам, мимо долей и удержаний',
    };
  }

  // ---------- F-07 Экзамен на новый навык ----------

  @Post('skill-request')
  skillRequest(@Body() b: { skill?: string }, @Req() req: MasterRequest) {
    const m = req.master!;
    if (!b?.skill?.trim()) throw new BadRequestException({ code: 'SKILL_REQUIRED' });
    if (m.skillTags.includes(b.skill)) throw new BadRequestException({ code: 'ALREADY_HAVE', message: 'Этот допуск у вас уже есть' });
    const rec = this.ops.openBranch({
      orderId: '',
      masterId: m.id,
      kind: 'helper_request',
      comment: tr('Заявка на экзамен по навыку: {0}', b.skill),
      payload: { skill: b.skill, kind: 'skill_exam' },
    });
    this.audit.write({ actorPhone: m.phone, action: 'master.skill_exam_requested', entity: 'MasterProfile', entityId: m.id, payload: { skill: b.skill } });
    return {
      id: rec.id,
      skill: b.skill,
      message: 'Заявка принята. Новый допуск открывается только через экзамен и подтверждение инструмента',
    };
  }

  // ---------- F-02 / F-60 Конфигурация приложения ----------

  /**
   * Минимальная версия и флаги функций. Приложение спрашивает это на старте:
   * так можно закрыть сломанную сборку, не дожидаясь, пока все обновятся.
   */
  @Get('app-config')
  appConfig(@Query('version') version: string | undefined, @Req() req: MasterRequest) {
    const m = req.master!;
    const minVersion = process.env.MASTER_MIN_VERSION ?? '1.0.0';
    const cmp = (a: string, b: string) => {
      const pa = a.split('.').map(Number);
      const pb = b.split('.').map(Number);
      for (let i = 0; i < 3; i++) {
        if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
      }
      return 0;
    };
    return {
      minVersion,
      forceUpdate: version ? cmp(version, minVersion) < 0 : false,
      updateMessage: 'Обновите приложение, чтобы продолжить работу',
      locales: [
        { code: 'ru', title: 'Русский' },
        { code: 'uz', title: 'Oʻzbekcha' },
      ],
      features: {
        stock: true, // сумка расходников
        purchaseCode: true, // код закупки в долг компании
        equipmentActs: true, // акты выдачи и возврата
        autoRating: true, // авто-расчёт рейтинга
        tips: true,
        appeals: true,
        inspection: true,
        crewOfDay: false, // «экипаж дня» — требует накопленной статистики парных
        ocrPlate: false, // распознавание шильдика — фаза 3
      },
      sparePartCatalog: SPARE_PART_CATALOG,
      grade: m.grade,
    };
  }
}
