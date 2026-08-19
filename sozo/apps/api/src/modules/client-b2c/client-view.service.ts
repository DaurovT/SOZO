import { Injectable } from '@nestjs/common';
import type { OrderStatus } from '@sozo/contracts';
import { signJwt } from '../../common/jwt';
import type { OrderRecord } from '../orders/order.repository';
import { MasterOpsService } from '../master-api/master-ops.service';
import { QualityService } from '../quality/quality.service';
import { MastersService } from '../masters/masters.module';
import { ParametersService } from '../platform/parameters.service';
import { SchedulingService } from '../scheduling/scheduling.service';

/**
 * Перевод заявки на язык клиента.
 *
 * Клиент видит не запись базы, а состояние своей проблемы: где мастер, что
 * ждёт его решения, сколько платить. Внутренние поля (граф, версия, доля
 * мастера, наличный долг) сюда не попадают — не из вежливости, а потому что
 * приложение с ними ничего не делает, а утечка лишнего — риск.
 */

/** Цепочка статусов, которую видит клиент (DEV-08 C-14) */
const B2C_CHAIN: OrderStatus[] = [
  'new',
  'estimated',
  'assigned',
  'master_departed',
  'in_progress',
  'completed',
  'verified',
  'closed',
];

const STATUS_LABEL: Record<string, string> = {
  new: 'Новая',
  estimated: 'Оценена',
  pending_approval: 'Ждёт утверждения',
  approved: 'Утверждена',
  assigned: 'Назначена',
  master_departed: 'Мастер выехал',
  in_progress: 'В работе',
  addwork_approval: 'Ждёт вашего решения',
  completed: 'Выполнена',
  verified: 'Проверена',
  awaiting_payment: 'Ожидает оплаты',
  closed: 'Закрыта',
  rated: 'Закрыта',
  cancelled: 'Отменена',
  dispute: 'Спор',
};

const HHMM = (min: number): string =>
  `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

@Injectable()
export class ClientViewService {
  constructor(
    private readonly ops: MasterOpsService,
    private readonly masters: MastersService,
    private readonly sched: SchedulingService,
    private readonly params: ParametersService,
    private readonly quality: QualityService,
  ) {}

  /** Спор по заявке в человеческих словах — решение принимает реестр качества */
  private disputeOf(order: OrderRecord) {
    const d = [...this.quality.disputes].reverse().find((x) => x.orderId === order.id);
    if (!d) return null;
    const verdict =
      d.resolution === 'for_client'
        ? 'Решили в вашу пользу'
        : d.resolution === 'for_master'
          ? 'Работы признаны выполненными'
          : d.resolution === 'compromise'
            ? 'Пришли к компромиссу'
            : null;
    return {
      status: d.status,
      reason: d.reason,
      openedAt: d.createdAt,
      resolvedAt: d.resolvedAt ?? null,
      verdict,
      comment: d.comment ?? null,
      refundTiyin: d.refundTiyin ?? 0,
    };
  }

  /**
   * Где мастер сейчас — только пока он едет.
   *
   * Показывать позицию весь день значит следить за человеком; показывать её
   * после приезда бессмысленно — он у клиента. Отметка старше получаса тоже не
   * показывается: точка «мастер был здесь час назад» хуже, чем никакой.
   */
  private masterGeo(order: OrderRecord, master: { lastGeo?: { lat: number; lng: number; at: string } }) {
    if (order.status !== 'master_departed') return null;
    const geo = master.lastGeo;
    if (!geo) return null;
    if (Date.now() - new Date(geo.at).getTime() > 30 * 60_000) return null;
    return { lat: geo.lat, lng: geo.lng, at: geo.at };
  }

  /**
   * Прогноз приезда: начало забронированного окна.
   *
   * Не «через сколько минут по пробкам» — маршрутизатора у платформы нет, и
   * выдумывать точность, которой нет, вреднее, чем назвать окно. Пока мастер
   * не выехал, показывать нечего: обещание «будет в 16:40» до выезда никем
   * не обеспечено.
   */
  private eta(order: OrderRecord): string | null {
    if (!['assigned', 'master_departed'].includes(order.status)) return null;
    const booking = this.sched.bookingFor(order.id);
    if (!booking?.date || booking.startMin == null) return null;
    const at = new Date(`${booking.date}T00:00:00`);
    at.setMinutes(booking.startMin);
    return at.toISOString();
  }

  /** Число из параметра вида «30 дней»; параметр редактируется админом как текст */
  private paramNumber(num: number, fallback: number): number {
    const raw = this.params.list().find((p) => p.num === num)?.value ?? '';
    const m = /(\d+)/.exec(raw);
    return m ? Number(m[1]) : fallback;
  }

  get warrantyDays(): number {
    return this.paramNumber(29, 30);
  }

  /** Окно оценки и спора — 72 ч после «Выполнена» (параметр 99) */
  get feedbackWindowHours(): number {
    return this.paramNumber(99, 72);
  }

  statusLabel(status: string): string {
    return STATUS_LABEL[status] ?? status;
  }

  /** Ссылка на фото с токеном: файлы отдаются только по валидному токену */
  private photoUrl(file: string | undefined, phone: string): string | undefined {
    if (!file) return undefined;
    // Короткоживущий токен ровно под просмотр картинок
    const token = signJwt({ sub: phone, phone, roles: ['client'] }, 60 * 60);
    return `/v1/photos/${file}?token=${token}`;
  }

  private lastAt(order: OrderRecord, status: OrderStatus): string | undefined {
    const rec = [...order.statusLog].reverse().find((l) => l.to === status);
    return rec ? new Date(rec.at).toISOString() : undefined;
  }

  /**
   * Забронированное окно приезда — из ленты планировщика.
   * Клиенту показываем двухчасовое окно брони, а не точную длительность работ:
   * обещать «17:00–17:40» нельзя, пробки и предыдущая заявка это сдвинут.
   */
  private window(order: OrderRecord): { from: string; to: string; label: string } | null {
    const booking = this.sched.bookingFor(order.id);
    if (!booking || !booking.date) return null;
    const [fromMin, toMin] = booking.clientWindow ?? [booking.startMin, booking.endMin];
    return {
      from: `${booking.date}T${HHMM(fromMin)}:00`,
      to: `${booking.date}T${HHMM(toMin)}:00`,
      label: `${HHMM(fromMin)}–${HHMM(toMin)}`,
    };
  }

  /** Короткая карточка для списков (C-06, C-24) */
  card(order: OrderRecord) {
    const w = this.window(order);
    return {
      id: order.id,
      number: order.number,
      status: order.status,
      statusLabel: this.statusLabel(order.status),
      urgency: order.urgency,
      address: order.address,
      description: order.description,
      category: order.lines[0]?.name ?? order.description,
      totalFromTiyin: order.totalFromTiyin,
      totalToTiyin: order.totalToTiyin,
      masterName: order.masterName ?? null,
      window: w,
      rating: order.rating ?? null,
      warrantyUntil: this.warrantyUntil(order),
      createdAt: new Date(order.createdAt).toISOString(),
      /** Заявка требует решения клиента прямо сейчас — точка в списке */
      needsDecision: this.pending(order).any,
      /**
       * Чего именно ждут. «Требует внимания» без объяснения заставляет открыть
       * карточку, чтобы узнать — а мастер в это время стоит и ждёт.
       */
      decision: this.decisionLabel(order),
    };
  }

  /** Короткое название ожидаемого решения — для списка и главного экрана */
  private decisionLabel(order: OrderRecord): { kind: string; title: string; urgent: boolean } | null {
    const p = this.pending(order);
    if (p.addwork) return { kind: 'addwork', title: 'Мастер не может продолжить без вашего решения', urgent: true };
    if (p.estimate) return { kind: 'estimate', title: 'Подтвердите стоимость — мастер ждёт', urgent: true };
    if (p.spareTier) return { kind: 'spare_tier', title: 'Выберите вариант запчасти', urgent: true };
    if (p.stagePlan) return { kind: 'stages', title: 'Подтвердите план визитов', urgent: false };
    if (p.recommendation) return { kind: 'recommendation', title: 'Мастер что-то советует — можно отказаться', urgent: false };
    if (order.acceptanceRequest?.pending && !order.acceptance) {
      return { kind: 'acceptance', title: 'Работа готова — подтвердите приёмку', urgent: true };
    }
    if (['completed', 'verified', 'awaiting_payment'].includes(order.status) && !order.payment) {
      return { kind: 'payment', title: 'Ждёт оплаты', urgent: false };
    }
    if (order.status === 'closed' && !order.rating) {
      return { kind: 'rating', title: 'Оцените работу мастера', urgent: false };
    }
    return null;
  }

  /**
   * До какого числа действует гарантия. Публичный: тот же расчёт нужен
   * главному экрану, чтобы показать «на гарантии три работы».
   */
  warrantyUntil(order: OrderRecord): string | null {
    const closedAt = this.lastAt(order, 'closed');
    if (!closedAt) return null;
    const d = new Date(closedAt);
    d.setDate(d.getDate() + this.warrantyDays);
    return d.toISOString();
  }

  /** Что ждёт решения клиента: смета, уровень запчасти, доп-работа, апсейл, план сессий */
  pending(order: OrderRecord) {
    const spareTier = this.ops.spareTiers.find((s) => s.orderId === order.id && s.status === 'sent');
    const addwork = this.ops.addworkFor(order.id);
    const recommendation = this.ops.recommendations.find((r) => r.orderId === order.id && r.status === 'sent');
    const stagePlan = this.ops.stagePlan(order.id);
    // Смета на подтверждение: мастер прислал точную сумму, санкции клиента ещё нет
    const estimateSent = order.status === 'in_progress' && !order.quotes.some((q) => q.kind === 'approved');
    const stagesUnconfirmed = !!stagePlan && !stagePlan.allSlotsConfirmed;
    return {
      estimate: estimateSent,
      spareTier: spareTier ?? null,
      addwork: addwork ?? null,
      recommendation: recommendation ?? null,
      stagePlan: stagesUnconfirmed ? stagePlan : null,
      any: estimateSent || !!spareTier || !!addwork || !!recommendation || stagesUnconfirmed,
    };
  }

  /**
   * Полная карточка (C-14, C-19, C-25).
   * `masterJobsDone` считает вызывающий: он и так держит список заявок,
   * а второй проход по нему ради одной цифры — лишняя работа на каждый запрос.
   */
  full(order: OrderRecord, phone: string, masterJobsDone?: number) {
    const master = order.masterId ? this.masters.list().find((m) => m.id === order.masterId) : undefined;
    const pending = this.pending(order);
    const completedAt = this.lastAt(order, 'completed');
    const feedbackOpen =
      !!completedAt &&
      Date.now() - new Date(completedAt).getTime() < this.feedbackWindowHours * 3_600_000;

    return {
      ...this.card(order),
      graphType: order.graphType,
      lines: order.lines.map((l) => ({
        // Нужен для повтора заявки: без него «Повторить» создавало пустую
        priceItemId: l.priceItemId,
        name: l.name,
        unit: l.unit,
        qty: l.qty,
        fromTiyin: l.priceFromTiyin,
        toTiyin: l.priceToTiyin,
      })),
      materials: order.materials.map((m) => ({
        kind: m.kind,
        name: m.name,
        amountTiyin: m.amountTiyin,
        priceTier: m.priceTier ?? null,
        hasReceipt: m.hasReceipt,
      })),
      totalMaterialTiyin: order.totalMaterialTiyin,
      promoCode: order.promoCode ?? null,
      promoDiscountPercent: order.promoDiscountPercent ?? 0,
      // Санкционированная сумма: она, а не вилка, стоит в акте
      approvedTiyin: [...order.quotes].reverse().find((q) => q.kind === 'approved')?.amountTiyin ?? null,
      quotes: order.quotes,
      photos: order.photos
        .filter((p) => p.file)
        .map((p) => ({ stage: p.stage, url: this.photoUrl(p.file, phone), at: p.at })),
      pause: order.pause ?? null,
      master: master
        ? {
            name: master.fullName,
            rating: master.rating ?? null,
            jobsDone: masterJobsDone ?? null,
            geo: this.masterGeo(order, master),
            eta: this.eta(order),
          }
        : order.masterName
          ? { name: order.masterName, rating: null, jobsDone: null, geo: null, eta: null }
          : null,
      acceptance: order.acceptance ?? null,
      // Код приёмки называют мастеру при наличном расчёте (C-19, C-34)
      acceptanceCode: order.acceptanceCode ?? null,
      addressDetails: order.addressDetails ?? null,
      timeline: B2C_CHAIN.map((s) => ({
        status: s,
        label: this.statusLabel(s),
        at: this.lastAt(order, s) ?? null,
        done: !!this.lastAt(order, s),
        current: order.status === s,
      })),
      pending: {
        estimate: pending.estimate,
        spareTier: pending.spareTier,
        addwork: pending.addwork,
        // Отложенную рекомендацию клиент может принять позже — она остаётся
        // решаемой, поэтому уходит в тот же блок, что и новая
        recommendation: pending.recommendation ?? this.ops.postponedFor([order.id])[0] ?? null,
        stagePlan: pending.stagePlan,
        addressDetails: !order.addressDetails && !!order.masterId,
      },
      can: {
        cancel: ['new', 'estimated', 'assigned', 'master_departed', 'in_progress'].includes(order.status),
        reschedule: ['new', 'estimated', 'assigned'].includes(order.status),
        pay: ['completed', 'verified', 'awaiting_payment'].includes(order.status) && !order.payment,
        rate: ['closed'].includes(order.status) && !order.rating,
        dispute: feedbackOpen && !['dispute', 'cancelled'].includes(order.status),
        warranty: !!this.warrantyUntil(order) && new Date(this.warrantyUntil(order)!) > new Date(),
      },
      payment: order.payment ?? null,
      // Спор клиента: что с ним и чем закончился. Без этого человек открыл спор
      // и остался наедине со статусом «Спор» без единого слова о результате
      dispute: this.disputeOf(order),
      statusLog: order.statusLog.map((l) => ({
        to: l.to,
        label: this.statusLabel(l.to),
        at: new Date(l.at).toISOString(),
      })),
    };
  }
}
