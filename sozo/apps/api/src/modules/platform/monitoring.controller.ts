import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuthGuard, Roles } from '../identity/auth.guard';
import { MastersService } from '../masters/masters.module';
import { AuditService } from './audit.service';

/**
 * Показатели, которые до этого некому было считать.
 *
 * Офлайн-очередь живёт на телефонах мастеров, воронка приложения — в аудите.
 * И то и другое существовало, но нигде не собиралось: экран мониторинга
 * показывал ноль, потому что источника не было, а не потому что всё хорошо.
 */

/**
 * Шаги визарда создания заявки.
 *
 * Названия совпадают с тем, что приложение шлёт на самом деле: три показа
 * шагов (`order_step_view` с номером) и отправка. Придумывать свои имена
 * событий, которых никто не отправляет, — верный способ получить воронку
 * из одних нулей.
 */
const FUNNEL_STEPS: Array<{ key: string; title: string; step?: number }> = [
  { key: 'step1', title: 'Открыл: что сломалось', step: 1 },
  { key: 'step2', title: 'Дошёл до адреса и времени', step: 2 },
  { key: 'step3', title: 'Дошёл до проверки заявки', step: 3 },
  { key: 'submitted', title: 'Отправил заявку' },
];

@Controller('admin/monitoring')
@UseGuards(AuthGuard)
@Roles('admin', 'accountant')
export class MonitoringController {
  constructor(
    private readonly masters: MastersService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Глубина офлайн-очередей по мастерам.
   *
   * Отчёт приходит от приложения при первом удавшемся запросе, поэтому цифра
   * всегда чуть отстаёт. Считаем устаревшим всё старше суток: телефон мог быть
   * выключен, и вчерашняя очередь ничего не говорит о сегодняшнем дне.
   */
  @Get('offline-queue')
  offlineQueue() {
    const day = 24 * 3_600_000;
    const rows = this.masters
      .list()
      .map((m) => ({
        masterId: m.id,
        masterName: m.fullName,
        depth: m.offlineQueue?.depth ?? 0,
        oldestAt: m.offlineQueue?.oldestAt ?? null,
        reportedAt: m.offlineQueue?.at ?? null,
        stale: !m.offlineQueue || Date.now() - new Date(m.offlineQueue.at).getTime() > day,
      }))
      .filter((r) => r.depth > 0 || !r.stale);
    return {
      totalDepth: rows.reduce((s, r) => s + (r.stale ? 0 : r.depth), 0),
      mastersWithQueue: rows.filter((r) => !r.stale && r.depth > 0).length,
      reportedMasters: rows.filter((r) => !r.stale).length,
      rows: rows.sort((a, b) => b.depth - a.depth),
      note: 'Очередь считает приложение мастера и сообщает при первой связи — цифра отстаёт на время офлайна',
    };
  }

  /**
   * Воронка создания заявки в клиентском приложении.
   *
   * Отвал считаем от предыдущего шага, а не от первого: «на четвёртом шаге
   * осталось 40%» не говорит, где именно теряются люди.
   */
  @Get('funnel')
  async funnel(@Query('days') days?: string) {
    const window = Math.max(1, Math.min(90, Number(days) || 7));
    const since = Date.now() - window * 24 * 3_600_000;
    const events = await this.audit.byPrefix('client_app.', since);

    // Считаем людей, а не события: один человек мог начинать заявку трижды,
    // и три брошенных черновика одного клиента — не три отвалившихся клиента
    const peopleOn = (s: (typeof FUNNEL_STEPS)[number]): number => {
      const matched = events.filter((e) =>
        s.step === undefined
          ? e.action === 'client_app.order_submitted'
          : e.action === 'client_app.order_step_view' && (e.payload as { step?: number } | undefined)?.step === s.step,
      );
      return new Set(matched.map((e) => e.actorPhone)).size;
    };

    let prev = 0;
    const steps = FUNNEL_STEPS.map((s, i) => {
      const count = peopleOn(s);
      const row = {
        event: s.key,
        title: s.title,
        count,
        dropFromPrev: i === 0 || prev === 0 || count > prev ? 0 : Math.round(((prev - count) / prev) * 100),
      };
      prev = count;
      return row;
    });

    const started = steps[0]?.count ?? 0;
    const finished = steps[steps.length - 1]?.count ?? 0;
    const known = new Set(['order_step_view', 'order_submitted']);
    return {
      days: window,
      steps,
      conversionPercent: started === 0 ? 0 : Math.round((finished / started) * 100),
      otherEvents: [...new Set(events.map((e) => e.action.replace('client_app.', '')))]
        .filter((a) => !known.has(a))
        .sort(),
    };
  }
}
