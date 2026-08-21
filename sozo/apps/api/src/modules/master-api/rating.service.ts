import { BadRequestException, Injectable, OnModuleInit } from '@nestjs/common';
import { uuidv7 } from '@sozo/kernel';
import { StateStore } from '../../common/state-store';
import { PrismaService } from '../../common/prisma.service';
import { PgMirror } from '../../common/pg-mirror';
import { NotificationsService } from './notifications.service';
import type { OrderRecord } from '../orders/order.repository';
import { tr } from '../../common/locale';

/**
 * Рейтинг мастера с расшифровкой (F-54, ТЗ 7.4), апелляции (F-50) и чаевые (F-44).
 *
 * Рейтинг считается из пяти компонент по фиксированным формулам — мастер видит
 * не «69 баллов», а из чего они сложились и что подтянуть. Окно 56 дней:
 * старые провалы не тянут вечно, свежие видны сразу.
 */

export const RATING_WINDOW_DAYS = 56;

export const RATING_COMPONENTS = [
  { code: 'punctuality', title: 'Пунктуальность', weight: 25, formula: 'доля «Приступить» внутри окна × 100' },
  { code: 'ratings', title: 'Оценки клиентов', weight: 30, formula: 'средняя оценка × 20, сглаживание к 4.5 при <10 оценок' },
  { code: 'evidence', title: 'Качество фиксации', weight: 15, formula: 'доля фото-пакетов, принятых с первой попытки × 100' },
  { code: 'rework', title: 'Отсутствие переделок', weight: 20, formula: '100 − 25 × (переделки по вине)' },
  { code: 'offers', title: 'Дисциплина офферов', weight: 10, formula: 'доля принятых офферов × 100' },
] as const;

/** Грейд: Золото требует и рейтинга >85, и опыта ≥100 закрытых (ТЗ 7.4) */
export function gradeFor(score: number, closedOrders: number): 'bronze' | 'silver' | 'gold' {
  if (score > 85 && closedOrders >= 100) return 'gold';
  if (score >= 70) return 'silver';
  return 'bronze';
}

export interface AppealRec {
  id: string;
  masterId: string;
  subject: 'rating' | 'deduction' | 'sanction' | 'complaint';
  reference: string;
  text: string;
  status: 'open' | 'accepted' | 'rejected';
  resolution?: string;
  createdAt: string;
  resolvedAt?: string;
}

export interface TipRec {
  id: string;
  masterId: string;
  orderId: string;
  orderNumber: string;
  amountTiyin: number;
  at: string;
}

@Injectable()
export class RatingService implements OnModuleInit {

  /**
   * Сохранить правку, сделанную снаружи.
   *
   * Диспетчерская меняет записи напрямую (решение по апелляции, ответ по
   * отпуску), и без этого правка осталась бы в памяти: и файл, и база пишутся
   * по сигналу, а не по факту изменения объекта.
   */
  touch(): void {
    this.store.persist();
  }
  readonly appeals: AppealRec[] = [];
  readonly tips: TipRec[] = [];
  private readonly mirror: PgMirror;

  constructor(
    private readonly store: StateStore,
    private readonly notifications: NotificationsService,
    prisma: PrismaService,
  ) {
    this.store.register(
      'masterRating',
      () => ({ appeals: this.appeals.slice(-500), tips: this.tips.slice(-1000) }),
      (d) => {
        const data = d as { appeals?: AppealRec[]; tips?: TipRec[] };
        this.appeals.length = 0;
        this.appeals.push(...(data.appeals ?? []));
        this.tips.length = 0;
        this.tips.push(...(data.tips ?? []));
      },
    );
    this.mirror = new PgMirror(prisma, 'MasterRating', {
      load: async (tx) => {
        const [appeals, tips] = await Promise.all([
          tx.masterAppeal.findMany({ orderBy: { createdAt: 'asc' } }),
          tx.masterTip.findMany({ orderBy: { at: 'asc' } }),
        ]);
        if (appeals.length) {
          this.appeals.length = 0;
          this.appeals.push(
            ...appeals.map((a) => ({
              id: a.id, masterId: a.masterId, subject: a.subject as AppealRec['subject'],
              reference: a.reference, text: a.text, status: a.status as AppealRec['status'],
              resolution: a.resolution ?? undefined,
              createdAt: a.createdAt.toISOString(),
              resolvedAt: a.resolvedAt?.toISOString(),
            })),
          );
        }
        if (tips.length) {
          this.tips.length = 0;
          this.tips.push(
            ...tips.map((t) => ({
              id: t.id, masterId: t.masterId, orderId: t.orderId, orderNumber: t.orderNumber,
              amountTiyin: Number(t.amountTiyin), at: t.at.toISOString(),
            })),
          );
        }
        return appeals.length + tips.length;
      },
      save: async (tx, tenantId) => {
        for (const a of [...this.appeals]) {
          const data = {
            masterId: a.masterId, subject: a.subject, reference: a.reference, text: a.text,
            status: a.status, resolution: a.resolution ?? null,
            resolvedAt: a.resolvedAt ? new Date(a.resolvedAt) : null,
          };
          await tx.masterAppeal.upsert({
            where: { id: a.id },
            create: { id: a.id, tenantId, createdAt: new Date(a.createdAt), ...data },
            update: data,
          });
        }
        // Чаевые не переписываются: это деньги, полученные мастером
        for (const t of [...this.tips]) {
          await tx.masterTip.upsert({
            where: { id: t.id },
            create: {
              id: t.id, tenantId, masterId: t.masterId, orderId: t.orderId,
              orderNumber: t.orderNumber, amountTiyin: BigInt(t.amountTiyin), at: new Date(t.at),
            },
            update: {},
          });
        }
      },
    });
    this.store.registerMirror(this.mirror);
  }

  onModuleInit(): Promise<void> {
    return this.mirror.init();
  }

  /** Разовый перенос state.json (deploy/import-state) */
  flushToDb(): Promise<void> {
    return this.mirror.flush();
  }

  /**
   * Авто-расчёт рейтинга (фаза 2 по документации, включён сразу).
   * Пока данных мало, компонента возвращает базовое значение — иначе новичок
   * получал бы ноль за то, чего просто ещё не было.
   */
  compute(params: {
    orders: OrderRecord[];
    masterId: string;
    offerStats: { offers: number; accepted: number };
    confirmedComplaints: number;
    reworkOrders: number;
  }) {
    const since = Date.now() - RATING_WINDOW_DAYS * 86_400_000;
    const mine = params.orders.filter(
      (o) => o.masterId === params.masterId && new Date(o.createdAt).getTime() >= since,
    );
    const closed = mine.filter((o) => ['closed', 'rated'].includes(o.status));

    // Пунктуальность: «Приступить» отмечено, значит мастер доехал и начал
    const started = mine.filter((o) => o.statusLog.some((l) => l.to === 'in_progress'));
    const onTime = started.filter((o) => {
      const departed = o.statusLog.find((l) => l.to === 'master_departed')?.at;
      const startedAt = o.statusLog.find((l) => l.to === 'in_progress')?.at;
      if (!departed || !startedAt) return false;
      // Внутри окна = доехал не позже двух часов после выезда (dev-приближение окна клиента)
      return new Date(startedAt).getTime() - new Date(departed).getTime() <= 2 * 3_600_000;
    });
    const punctuality = started.length ? (onTime.length / started.length) * 100 : 60;

    // Оценки: байесовское сглаживание к 4.5 — одна пятёрка не делает мастера золотым
    const rated = closed.filter((o) => typeof o.rating === 'number');
    const sum = rated.reduce((s, o) => s + (o.rating ?? 0), 0);
    const smoothed = (sum + 4.5 * 10) / (rated.length + 10);
    const ratings = Math.min(100, smoothed * 20);

    // Качество фиксации: пакет принят с первой попытки, если есть фото «до» и «после»
    // и заявку не возвращали с модерации
    const withEvidence = closed.filter(
      (o) => o.photos.some((p) => p.stage === 'before') && o.photos.some((p) => p.stage === 'after'),
    );
    const returned = closed.filter((o) => o.statusLog.some((l) => l.action === 'return_to_work'));
    const evidence = closed.length ? Math.max(0, ((withEvidence.length - returned.length) / closed.length) * 100) : 60;

    const rework = Math.max(0, 100 - 25 * params.reworkOrders);
    const offers = params.offerStats.offers ? (params.offerStats.accepted / params.offerStats.offers) * 100 : 60;

    const raw: Record<string, number> = { punctuality, ratings, evidence, rework, offers };
    const components = RATING_COMPONENTS.map((c) => ({
      ...c,
      value: Math.round(raw[c.code]),
      contribution: Math.round((raw[c.code] * c.weight) / 100),
    }));
    // Подтверждённая жалоба = событие уровня «оценка 1» (ТЗ 17.10)
    const penalty = params.confirmedComplaints * 5;
    const score = Math.max(0, Math.min(100, components.reduce((s, c) => s + c.contribution, 0) - penalty));

    const closedTotal = params.orders.filter((o) => o.masterId === params.masterId && ['closed', 'rated'].includes(o.status)).length;
    return {
      score,
      grade: gradeFor(score, closedTotal),
      windowDays: RATING_WINDOW_DAYS,
      components,
      penalty,
      closedOrders: closedTotal,
      /** Золото даёт 57% вместо 55% (ТЗ 7.4) */
      sharePermille: gradeFor(score, closedTotal) === 'gold' ? 570 : 550,
      note: closed.length < 5 ? 'Показатели уточнятся после пяти закрытых заявок' : undefined,
      nextGrade: score <= 85
        ? score < 70
          ? 'До «Серебра» нужно 70 баллов'
          : tr('До «Золота» нужно больше 85 баллов и {0} закрытых заявок', Math.max(0, 100 - closedTotal))
        : closedTotal < 100
          ? tr('Баллов достаточно, осталось {0} закрытых заявок до «Золота»', 100 - closedTotal)
          : null,
    };
  }

  // ---------- F-50 Апелляции ----------

  appeal(data: Omit<AppealRec, 'id' | 'status' | 'createdAt'>): AppealRec {
    if (!data.text?.trim()) {
      throw new BadRequestException({ code: 'TEXT_REQUIRED', message: 'Опишите, с чем не согласны — это уйдёт диспетчеру' });
    }
    const rec: AppealRec = { id: uuidv7(), status: 'open', createdAt: new Date().toISOString(), ...data };
    this.appeals.push(rec);
    this.store.persist();
    return rec;
  }

  appealsFor(masterId: string): AppealRec[] {
    return this.appeals.filter((a) => a.masterId === masterId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  resolveAppeal(id: string, accepted: boolean, resolution: string): AppealRec {
    const a = this.appeals.find((x) => x.id === id);
    if (!a) throw new BadRequestException({ code: 'APPEAL_NOT_FOUND' });
    if (!resolution?.trim()) throw new BadRequestException({ code: 'RESOLUTION_REQUIRED' });
    a.status = accepted ? 'accepted' : 'rejected';
    a.resolution = resolution;
    a.resolvedAt = new Date().toISOString();
    this.notifications.push({
      masterId: a.masterId,
      kind: 'appeal_resolved',
      title: accepted ? 'Апелляция принята' : 'Апелляция отклонена',
      body: resolution,
      priority: 'high',
    });
    this.store.persist();
    return a;
  }

  // ---------- F-44 Чаевые ----------

  /** Чаевые идут мастеру целиком, мимо долей, отдельной проводкой (ТЗ 7.1) */
  addTip(data: Omit<TipRec, 'id' | 'at'>): TipRec {
    if (data.amountTiyin <= 0) throw new BadRequestException({ code: 'AMOUNT_REQUIRED' });
    const rec: TipRec = { id: uuidv7(), at: new Date().toISOString(), ...data };
    this.tips.push(rec);
    this.notifications.push({
      masterId: rec.masterId,
      kind: 'tips',
      title: 'Клиент оставил чаевые',
      body: '+{0} сум по заявке {1} — целиком вам',
      bodyArgs: [Math.round(rec.amountTiyin / 100), rec.orderNumber],
      priority: 'high',
      orderId: rec.orderId,
    });
    this.store.persist();
    return rec;
  }

  tipsFor(masterId: string): TipRec[] {
    return this.tips.filter((t) => t.masterId === masterId);
  }
}
