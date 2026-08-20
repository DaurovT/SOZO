import { Body, Controller, Get, Param, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { uuidv7 } from '@sozo/kernel';
import { AccessService } from './access.service';
import { BuildingsService } from '../buildings/buildings.service';
import { PermitLinksService } from './permit-links.service';
import {
  renderPermitPage, renderReschedulePage, renderRejectPage, renderResultPage,
} from './permit-page.view';

const ZONE: Record<string, string> = {
  electrical_panel: 'электрощитовая', water_riser: 'стояк ХВС', sewage_riser: 'канализационный стояк',
  basement: 'подвал', roof: 'кровля', technical_floor: 'техэтаж', lift_machine_room: 'лифтовая',
  ventilation_chamber: 'вентиляционная камера', heat_point: 'ИТП', gas_equipment: 'газовое оборудование',
  fire_system: 'пожарные системы', yard: 'двор',
};

const REJECT_REASONS = [
  'Работы в это время недопустимы',
  'Нужно предупредить жителей заранее',
  'Требуется сопровождение, некому выделить',
  'Зона на ремонте',
  'Другое',
];

/**
 * W-06 — публичная страница согласования наряда по ссылке из SMS.
 *
 * Без авторизации и без установки приложения: этот человек согласует доступ
 * два раза в день, и любой барьер здесь останавливает весь контур.
 * Ссылка одноразовая и отзываемая (PermitLinksService), страница — noindex.
 */
@Controller('p')
export class PermitPageController {
  constructor(
    private readonly access: AccessService,
    private readonly buildings: BuildingsService,
    private readonly links: PermitLinksService,
  ) {}

  private html(res: Response, body: string, status = 200): void {
    res.status(status);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.send(body);
  }

  /**
   * Причина отказа одинакова для истёкшей, использованной и несуществующей ссылки:
   * иначе перебор кодов расскажет, какие наряды существуют.
   */
  private gone(res: Response, code: string): void {
    const link = this.links.peek(code);
    const note = link?.usedAt
      ? 'Решение по этому наряду уже принято.'
      : 'Срок ссылки истёк. Если наряд ещё актуален, управляющая организация пришлёт новую.';
    this.html(res, renderResultPage('Ссылка недействительна', note), 410);
  }

  private windowText(from: string | null, to: string | null): string {
    if (!from || !to) return 'время не выбрано';
    const f = new Date(from);
    const t = new Date(to);
    const day = f.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
    const hm = (d: Date) => d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    return `${day}, ${hm(f)} — ${hm(t)}`;
  }

  @Get(':code')
  async show(@Param('code') code: string, @Res() res: Response) {
    const link = this.links.resolve(code);
    if (!link) return this.gone(res, code);

    const permit = this.access.get('t0', link.permitId);
    if (permit.status !== 'requested' && permit.status !== 'rescheduled') {
      this.links.markUsed(code);
      return this.gone(res, code);
    }

    const building = this.buildings.get('t0', permit.buildingId);
    this.html(
      res,
      renderPermitPage({
        code: link.code,
        buildingName: building.name,
        zones: permit.zoneTypes.map((z) => ZONE[z] ?? z),
        hasCriticalZone: permit.hasCriticalZone,
        requiresShutdown: permit.requiresShutdown,
        affectedUnits: permit.affectedUnitIds.length,
        windowText: this.windowText(permit.windowFrom, permit.windowTo),
        masterName: permit.masterIsPlatform ? 'Мастер платформы' : 'Ваш сотрудник',
        masterIsPlatform: permit.masterIsPlatform,
        verifyUrl: null,
        // Критичной зоне авто-согласия не бывает — срок не показываем, чтобы не обещать лишнего
        autoApproveAt:
          permit.hasCriticalZone || !permit.slaDeadline
            ? null
            : new Date(permit.slaDeadline).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }),
      }),
    );
  }

  @Post(':code/approve')
  async approve(@Param('code') code: string, @Res() res: Response) {
    const link = this.links.resolve(code);
    if (!link) return this.gone(res, code);
    try {
      this.access.transition(
        't0',
        link.permitId,
        { action: 'approve', clientOpUuid: uuidv7() },
        // Согласующий подтверждён владением ссылкой: она личная и отзываемая.
        // Номер получателя SMS пишется в аудит вместе с решением.
        { phone: link.approverPhone, isApprover: true, scopedToBuilding: true },
      );
      this.links.markUsed(code);
      this.html(res, renderResultPage('Доступ согласован', 'Спасибо. Мастер приедет в согласованное время.'));
    } catch (e) {
      this.html(res, renderResultPage('Не удалось согласовать', e instanceof Error ? e.message : 'Попробуйте позже'), 409);
    }
  }

  @Get(':code/reschedule')
  async rescheduleForm(@Param('code') code: string, @Res() res: Response) {
    const link = this.links.resolve(code);
    if (!link) return this.gone(res, code);
    const permit = this.access.get('t0', link.permitId);
    const base = permit.windowFrom ? new Date(permit.windowFrom) : new Date();
    const local = new Date(base.getTime() - base.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
    this.html(res, renderReschedulePage(code, local));
  }

  @Post(':code/reschedule')
  async reschedule(
    @Param('code') code: string,
    @Body() body: { from?: string; hours?: string },
    @Res() res: Response,
  ) {
    const link = this.links.resolve(code);
    if (!link) return this.gone(res, code);
    const from = body.from ? new Date(body.from) : null;
    if (!from || Number.isNaN(from.getTime())) {
      return this.html(res, renderResultPage('Время не распознано', 'Вернитесь назад и выберите дату и время.'), 400);
    }
    const hours = Number(body.hours ?? 4) || 4;
    const to = new Date(from.getTime() + hours * 3_600_000);
    try {
      this.access.transition(
        't0',
        link.permitId,
        { action: 'propose_window', clientOpUuid: uuidv7(), windowFrom: from.toISOString(), windowTo: to.toISOString() },
        { phone: link.approverPhone, isApprover: true, scopedToBuilding: true },
      );
      this.links.markUsed(code);
      this.html(res, renderResultPage('Время предложено', 'Мы передали его клиенту — он подтвердит или предложит своё.'));
    } catch (e) {
      this.html(res, renderResultPage('Не удалось перенести', e instanceof Error ? e.message : 'Попробуйте позже'), 409);
    }
  }

  @Get(':code/reject')
  async rejectForm(@Param('code') code: string, @Res() res: Response) {
    const link = this.links.resolve(code);
    if (!link) return this.gone(res, code);
    this.html(res, renderRejectPage(code, REJECT_REASONS));
  }

  @Post(':code/reject')
  async reject(@Param('code') code: string, @Body() body: { reason?: string }, @Res() res: Response) {
    const link = this.links.resolve(code);
    if (!link) return this.gone(res, code);
    const reason = (body.reason ?? '').trim();
    if (!reason) {
      return this.html(res, renderResultPage('Нужна причина', 'Отказ без причины не принимается — вернитесь назад.'), 400);
    }
    try {
      this.access.transition(
        't0',
        link.permitId,
        { action: 'reject', clientOpUuid: uuidv7(), reason },
        { phone: link.approverPhone, isApprover: true, scopedToBuilding: true },
      );
      this.links.markUsed(code);
      this.html(res, renderResultPage('Наряд отклонён', 'Мы передали отказ клиенту и диспетчеру.'));
    } catch (e) {
      this.html(res, renderResultPage('Не удалось отклонить', e instanceof Error ? e.message : 'Попробуйте позже'), 409);
    }
  }
}
