import { BadRequestException, Injectable } from '@nestjs/common';
import { uuidv7 } from '@sozo/kernel';
import { StateStore } from '../../common/state-store';
import { NotificationsService } from './notifications.service';
import { tr } from '../../common/locale';

/**
 * Ветки конвейера мастера (PRD-02 §4, экраны M-14…M-41).
 *
 * Здесь живёт всё, что происходит, когда работа идёт не по плану: нет доступа,
 * клиента нет дома, объект небезопасен, нужен помощник, требуется консервация.
 * Эти записи не меняют статус заявки сами — статус двигает машина состояний,
 * а тут фиксируются обстоятельства, которые видит диспетчер.
 */

/** Справочники причин — свободный текст не принимаем (ТЗ 7.4) */
export const NO_ACCESS_REASONS = [
  { code: 'basement', title: 'Нет доступа к подвалу' },
  { code: 'riser', title: 'Нет доступа к стояку' },
  { code: 'roof', title: 'Нет доступа к крыше' },
  { code: 'switchboard', title: 'Нет доступа к щитовой' },
  { code: 'riser_shutdown', title: 'Нужно отключение стояка' },
  { code: 'uk_tomorrow', title: 'УК: «завтра»' },
  /**
   * Подключённый объект: наряд согласован, а на месте не пускают.
   *
   * Отдельно от остальных, потому что обрабатывается иначе: пауза здесь
   * неуместна — согласование уже получено, окно идёт, и ждать «пока УК
   * созреет» некому. Вместо паузы эскалация дежурному объекта с таймером
   * (DEV-15 §10, M-14).
   */
  { code: 'permit_denied', title: 'Наряд есть, не пускают' },
] as const;

/** Сколько ждём дежурного, прежде чем поднимать выше (параметр) */
export const PERMIT_DENIED_ESCALATION_MINUTES = 15;

export const CANT_GO_REASONS = [
  { code: 'sick', title: 'Заболел' },
  { code: 'force_majeure', title: 'Форс-мажор' },
  { code: 'late', title: 'Не успеваю' },
  { code: 'other', title: 'Другое' },
] as const;

export const HELPER_DURATIONS = [
  { code: 'h1', title: '~1 ч', hours: 1 },
  { code: 'h2', title: '~2 ч', hours: 2 },
  { code: 'h3', title: '~3 ч', hours: 3 },
  { code: 'half', title: 'Полсмены', hours: 4 },
] as const;

/** Порог, выше которого ценовую вилку выбирает клиент (ТЗ 8.4.3) */
export const SPARE_TIER_THRESHOLD_TIYIN = 20_000_000; // 200 000 сум
/** Лимит закупки без согласования диспетчера, на заявку */
export const PURCHASE_LIMIT_TIYIN = 50_000_000; // 500 000 сум
/** Фикс помощника за сессию (параметр ТЗ 17.3) */
export const HELPER_FEE_TIYIN = 8_000_000; // 80 000 сум

export interface BranchRec {
  id: string;
  orderId: string;
  masterId: string;
  kind:
    | 'no_access'
    | 'client_unavailable'
    | 'unsafe_abort'
    | 'cant_go'
    | 'conservation'
    | 'shopping_list'
    | 'helper_request'
    | 'delay';
  reasonCode?: string;
  comment?: string;
  payload?: Record<string, unknown>;
  status: 'open' | 'resolved';
  resolution?: string;
  createdAt: string;
  resolvedAt?: string;
}

/** M-16: вилка запчасти — выбирает клиент, мастер только предлагает */
export interface SpareTierRec {
  id: string;
  orderId: string;
  masterId: string;
  partName: string;
  mode: 'catalog' | 'photo';
  variants: Array<{ tier: 'economy' | 'standard' | 'premium'; title: string; amountTiyin: number; note?: string }>;
  chosenTier?: 'economy' | 'standard' | 'premium';
  status: 'sent' | 'chosen' | 'expired';
  createdAt: string;
  chosenAt?: string;
  /**
   * Когда запчасть фактически куплена.
   *
   * Склада запчастей у платформы нет — их покупают в партнёрских магазинах,
   * поэтому «зарезервировать» нечего. Отслеживать нужно другое: клиент выбрал
   * вариант, а купил ли кто-нибудь деталь до выезда — до этой отметки не знал
   * никто, и мастер приезжал с пустыми руками.
   */
  procuredAt?: string;
  procuredNote?: string;
}

/** M-17: вынужденная доп-работа — два варианта на выбор клиента */
export interface AddworkRec {
  id: string;
  orderId: string;
  masterId: string;
  photoCount: number;
  variants: Array<{ kind: 'minimal' | 'full'; title: string; lines: Array<{ name: string; amountTiyin: number; qty: number }>; totalTiyin: number }>;
  status: 'sent' | 'approved' | 'declined' | 'silent';
  chosenVariant?: 'minimal' | 'full';
  /** Таймлайн эскалации (M-11 плашка): отправлено → повтор 30 мин → звонок 2 ч */
  escalation: Array<{ step: string; at: string; done: boolean }>;
  createdAt: string;
  resolvedAt?: string;
}

/** M-20: апсейл — не блокирует конвейер и не эскалируется */
export interface RecommendationRec {
  id: string;
  orderId: string;
  masterId: string;
  lines: Array<{ name: string; amountTiyin: number; qty: number }>;
  comment?: string;
  status: 'sent' | 'accepted' | 'declined' | 'postponed';
  createdAt: string;
}

/** M-24: паспорт техники клиента — сервисный след */
export interface AssetRec {
  id: string;
  orderId: string;
  clientPhone: string;
  type: string;
  brand?: string;
  model?: string;
  year?: number;
  plateUnreadable: boolean;
  linkedWork: string[];
  createdAt: string;
}

/** M-25: этапная работа — этап 1 не стартует без подтверждённых слотов всех этапов */
export interface StagePlanRec {
  orderId: string;
  stages: Array<{
    index: number;
    title: string;
    normHours: number;
    pauseMinHours: number;
    pauseMaxHours: number;
    slotAt?: string;
    status: 'planned' | 'booked' | 'done';
  }>;
  allSlotsConfirmed: boolean;
}

@Injectable()
export class MasterOpsService {
  readonly branches: BranchRec[] = [];
  readonly spareTiers: SpareTierRec[] = [];
  readonly addworks: AddworkRec[] = [];
  readonly recommendations: RecommendationRec[] = [];
  readonly assets: AssetRec[] = [];
  readonly stagePlans: StagePlanRec[] = [];
  /** M-35: внесения наличных через провайдера */
  readonly deposits: Array<{ id: string; masterId: string; amountTiyin: number; status: 'pending' | 'settled'; createdAt: string }> = [];
  /** M-40: заявки на отпуск/больничный */
  readonly timeOff: Array<{ id: string; masterId: string; from: string; to: string; kind: 'vacation' | 'sick'; comment?: string; status: 'pending' | 'approved' | 'rejected'; reason?: string; createdAt: string }> = [];
  /** M-39: проверки инструмента и квартальный NPS */
  readonly toolChecks: Array<{ id: string; masterId: string; skill: string; complete: boolean; missing?: string; at: string }> = [];
  readonly npsAnswers: Array<{ id: string; masterId: string; score: number; comment?: string; at: string }> = [];

  constructor(
    private readonly store: StateStore,
    private readonly notifications: NotificationsService,
  ) {
    this.store.register(
      'masterOps',
      () => ({
        branches: this.branches.slice(-1000),
        spareTiers: this.spareTiers.slice(-500),
        addworks: this.addworks.slice(-500),
        recommendations: this.recommendations.slice(-500),
        assets: this.assets,
        stagePlans: this.stagePlans,
        deposits: this.deposits.slice(-500),
        timeOff: this.timeOff,
        toolChecks: this.toolChecks.slice(-500),
        npsAnswers: this.npsAnswers.slice(-500),
      }),
      (d) => {
        const data = d as Record<string, unknown[]>;
        const fill = <T>(target: T[], src: unknown[] | undefined) => {
          target.length = 0;
          target.push(...((src ?? []) as T[]));
        };
        fill(this.branches, data.branches);
        fill(this.spareTiers, data.spareTiers);
        fill(this.addworks, data.addworks);
        fill(this.recommendations, data.recommendations);
        fill(this.assets, data.assets);
        fill(this.stagePlans, data.stagePlans);
        fill(this.deposits, data.deposits);
        fill(this.timeOff, data.timeOff);
        fill(this.toolChecks, data.toolChecks);
        fill(this.npsAnswers, data.npsAnswers);
      },
    );
  }

  private persist<T>(list: T[], rec: T, cap = 1000): T {
    list.push(rec);
    if (list.length > cap) list.splice(0, list.length - cap);
    this.store.persist();
    return rec;
  }

  // ---------- Ветки «что-то пошло не так» ----------

  openBranch(data: Omit<BranchRec, 'id' | 'status' | 'createdAt'>): BranchRec {
    return this.persist(this.branches, {
      id: uuidv7(),
      status: 'open',
      createdAt: new Date().toISOString(),
      ...data,
    });
  }

  branchesFor(orderId: string): BranchRec[] {
    return this.branches.filter((b) => b.orderId === orderId);
  }

  openBranches(): BranchRec[] {
    return this.branches.filter((b) => b.status === 'open');
  }

  resolveBranch(id: string, resolution: string): BranchRec {
    const b = this.branches.find((x) => x.id === id);
    if (!b) throw new BadRequestException({ code: 'BRANCH_NOT_FOUND' });
    b.status = 'resolved';
    b.resolution = resolution;
    b.resolvedAt = new Date().toISOString();
    this.store.persist();
    return b;
  }

  // ---------- M-16 вилка запчастей ----------

  sendSpareTiers(data: Omit<SpareTierRec, 'id' | 'status' | 'createdAt'>): SpareTierRec {
    if (data.variants.length < 2) {
      throw new BadRequestException({ code: 'VARIANTS_REQUIRED', message: 'Нужно минимум два варианта — иначе выбора у клиента нет' });
    }
    return this.persist(this.spareTiers, { id: uuidv7(), status: 'sent', createdAt: new Date().toISOString(), ...data }, 500);
  }

  chooseSpareTier(id: string, tier: 'economy' | 'standard' | 'premium'): SpareTierRec {
    const r = this.spareTiers.find((x) => x.id === id);
    if (!r) throw new BadRequestException({ code: 'TIER_NOT_FOUND' });
    r.chosenTier = tier;
    r.status = 'chosen';
    r.chosenAt = new Date().toISOString();
    this.notifications.push({
      masterId: r.masterId,
      kind: 'spare_tier_chosen',
      title: 'Клиент выбрал вариант запчасти',
      body: '{0}: {1}',
      bodyArgs: [r.partName, tier === 'economy' ? 'Эконом' : tier === 'premium' ? 'Премиум' : 'Стандарт'],
      priority: 'high',
      deepLink: `sozo-master://order/${r.orderId}`,
      orderId: r.orderId,
    });
    this.store.persist();
    return r;
  }

  // ---------- M-17 вынужденная доп-работа ----------

  sendAddwork(data: { orderId: string; masterId: string; photoCount: number; variants: AddworkRec['variants'] }): AddworkRec {
    if (data.photoCount < 1) {
      throw new BadRequestException({ code: 'PHOTO_REQUIRED', message: 'Доп-работа согласуется только с фотодоказательством' });
    }
    if (!data.variants.length) throw new BadRequestException({ code: 'VARIANTS_REQUIRED' });
    const now = Date.now();
    return this.persist(
      this.addworks,
      {
        id: uuidv7(),
        status: 'sent',
        // Молчание по вынужденной работе всегда эскалируется (в отличие от апсейла)
        escalation: [
          { step: 'Отправлено клиенту', at: new Date(now).toISOString(), done: true },
          { step: 'Повторное напоминание', at: new Date(now + 30 * 60_000).toISOString(), done: false },
          { step: 'Звонок диспетчера', at: new Date(now + 2 * 3_600_000).toISOString(), done: false },
        ],
        createdAt: new Date(now).toISOString(),
        ...data,
      },
      500,
    );
  }

  resolveAddwork(id: string, status: 'approved' | 'declined', variant?: 'minimal' | 'full'): AddworkRec {
    const a = this.addworks.find((x) => x.id === id);
    if (!a) throw new BadRequestException({ code: 'ADDWORK_NOT_FOUND' });
    a.status = status;
    a.chosenVariant = variant;
    a.resolvedAt = new Date().toISOString();
    this.notifications.push({
      masterId: a.masterId,
      kind: 'addwork_resolved',
      title: status === 'approved' ? 'Доп-смета утверждена' : 'Доп-смета отклонена',
      body: status === 'approved' ? 'Вариант «{0}» — можно выполнять' : 'Клиент отказался. Предложите консервацию',
      bodyArgs: [variant === 'full' ? 'Полный' : 'Минимальный'],
      priority: 'high',
      deepLink: `sozo-master://order/${a.orderId}/estimate`,
      orderId: a.orderId,
    });
    this.store.persist();
    return a;
  }

  addworkFor(orderId: string): AddworkRec | undefined {
    return [...this.addworks].reverse().find((a) => a.orderId === orderId && a.status === 'sent');
  }

  // ---------- M-20 апсейл ----------

  sendRecommendation(data: Omit<RecommendationRec, 'id' | 'status' | 'createdAt'>): RecommendationRec {
    if (!data.lines.length) throw new BadRequestException({ code: 'LINES_REQUIRED' });
    return this.persist(this.recommendations, { id: uuidv7(), status: 'sent', createdAt: new Date().toISOString(), ...data }, 500);
  }

  /**
   * Решение клиента по рекомендации (C-17). «Отложить» — не отказ:
   * позиция остаётся в списке клиента, мастер видит, что его не отвергли.
   */
  resolveRecommendation(id: string, status: 'accepted' | 'declined' | 'postponed'): RecommendationRec {
    const r = this.recommendations.find((x) => x.id === id);
    if (!r) throw new BadRequestException({ code: 'RECOMMENDATION_NOT_FOUND' });
    // Отложенную можно принять позже — в этом и смысл «Отложить» (C-17);
    // повторно решать принятую или отклонённую нельзя
    if (r.status !== 'sent' && r.status !== 'postponed') {
      throw new BadRequestException({ code: 'ALREADY_RESOLVED', message: 'Решение уже принято' });
    }
    r.status = status;
    this.notifications.push({
      masterId: r.masterId,
      kind: 'addwork_resolved',
      title:
        status === 'accepted'
          ? 'Клиент принял рекомендацию'
          : status === 'postponed'
            ? 'Клиент отложил рекомендацию'
            : 'Клиент отказался от рекомендации',
      body: r.lines.map((l) => l.name).join(', '),
      priority: status === 'accepted' ? 'high' : 'normal',
      deepLink: `sozo-master://order/${r.orderId}`,
      orderId: r.orderId,
    });
    this.store.persist();
    return r;
  }

  /** Отложенные рекомендации клиента — карточка на C-06 и список в C-28 */
  postponedFor(orderIds: string[]): RecommendationRec[] {
    return this.recommendations.filter((r) => r.status === 'postponed' && orderIds.includes(r.orderId));
  }

  /** Конверсия рекомендаций — мотивация мастера, на рейтинг не влияет */
  recommendationStats(masterId: string) {
    const mine = this.recommendations.filter((r) => r.masterId === masterId);
    const accepted = mine.filter((r) => r.status === 'accepted');
    return {
      total: mine.length,
      accepted: accepted.length,
      conversionPercent: mine.length ? Math.round((accepted.length / mine.length) * 100) : 0,
      revenueTiyin: accepted.reduce((s, r) => s + r.lines.reduce((x, l) => x + l.amountTiyin * l.qty, 0), 0),
      note: 'Рекомендации на рейтинг не влияют. Работа по непринятой рекомендации не оплачивается.',
    };
  }

  // ---------- M-24 техника клиента ----------

  addAsset(data: Omit<AssetRec, 'id' | 'createdAt'>): AssetRec {
    if (!data.type?.trim()) throw new BadRequestException({ code: 'TYPE_REQUIRED' });
    return this.persist(this.assets, { id: uuidv7(), createdAt: new Date().toISOString(), ...data }, 5000);
  }

  /**
   * Что выбрано клиентом и ещё не куплено.
   *
   * Список закупки: пока он не пуст, кто-то должен доехать до магазина.
   * Пустой `masterId` — все заявки, так его видит диспетчер.
   */
  toProcure(masterId?: string): SpareTierRec[] {
    return this.spareTiers.filter(
      (s) => s.status === 'chosen' && !s.procuredAt && (masterId === undefined || s.masterId === masterId),
    );
  }

  markProcured(id: string, note?: string): SpareTierRec {
    const r = this.spareTiers.find((x) => x.id === id);
    if (!r) throw new BadRequestException({ code: 'TIER_NOT_FOUND' });
    if (r.status !== 'chosen') {
      throw new BadRequestException({ code: 'TIER_NOT_CHOSEN', message: 'Клиент ещё не выбрал вариант' });
    }
    r.procuredAt = new Date().toISOString();
    r.procuredNote = note?.trim() || undefined;
    this.store.persist();
    return r;
  }

  /**
   * Отметить купленным по названию материала.
   *
   * Мастер вносит материал в заявку — это и есть факт покупки. Заставлять его
   * отмечать то же самое второй раз значит гарантировать, что список закупки
   * будет вечно висеть неактуальным.
   */
  markProcuredByMaterial(orderId: string, materialName: string): void {
    const name = materialName.trim().toLowerCase();
    if (!name) return;
    for (const s of this.spareTiers) {
      if (s.orderId !== orderId || s.status !== 'chosen' || s.procuredAt) continue;
      const part = s.partName.trim().toLowerCase();
      if (!name.includes(part) && !part.includes(name)) continue;
      s.procuredAt = new Date().toISOString();
      // Записываем русскую отметку: её читает и диспетчер при сверке накладной.
      // Мастеру она переведётся на выдаче — строка целиком лежит в словаре,
      // а название материала внутри кавычек он вводил сам и переводу не подлежит
      s.procuredNote = `Внесено в заявку как «${materialName.trim()}»`;
      this.store.persist();
    }
  }

  assetsOf(clientPhone: string): AssetRec[] {
    return this.assets.filter((a) => a.clientPhone === clientPhone);
  }

  /**
   * Правка карточки техники — тем, кто ей владеет.
   *
   * Мастер заводит запись по шильдику, но шильдик выцветает, стирается и
   * заклеивается: до этого поправить модель было нельзя вовсе. Тип, марку и
   * год клиент знает лучше — он покупал.
   */
  updateAsset(id: string, clientPhone: string, patch: Partial<Pick<AssetRec, 'type' | 'brand' | 'model' | 'year'>>): AssetRec {
    const a = this.assets.find((x) => x.id === id && x.clientPhone === clientPhone);
    if (!a) throw new BadRequestException({ code: 'ASSET_NOT_FOUND', message: 'Такой техники у вас нет' });
    if (patch.type !== undefined) {
      if (!patch.type.trim()) throw new BadRequestException({ code: 'TYPE_REQUIRED', message: 'Укажите, что это за техника' });
      a.type = patch.type.trim();
    }
    if (patch.brand !== undefined) a.brand = patch.brand.trim() || undefined;
    if (patch.model !== undefined) a.model = patch.model.trim() || undefined;
    if (patch.year !== undefined) a.year = patch.year || undefined;
    // Клиент уточнил данные — отметка «шильдик не читался» больше не нужна
    if (a.brand || a.model) a.plateUnreadable = false;
    this.store.persist();
    return a;
  }

  removeAsset(id: string, clientPhone: string): void {
    const i = this.assets.findIndex((x) => x.id === id && x.clientPhone === clientPhone);
    if (i < 0) throw new BadRequestException({ code: 'ASSET_NOT_FOUND' });
    this.assets.splice(i, 1);
    this.store.persist();
  }

  assetForOrder(orderId: string): AssetRec | undefined {
    return this.assets.find((a) => a.orderId === orderId);
  }

  // ---------- M-25 этапные сессии ----------

  planStages(orderId: string, stages: StagePlanRec['stages']): StagePlanRec {
    const existing = this.stagePlans.find((p) => p.orderId === orderId);
    const plan: StagePlanRec = {
      orderId,
      stages,
      allSlotsConfirmed: stages.every((s) => !!s.slotAt),
    };
    if (existing) {
      Object.assign(existing, plan);
    } else {
      this.stagePlans.push(plan);
    }
    this.store.persist();
    return plan;
  }

  stagePlan(orderId: string): StagePlanRec | undefined {
    return this.stagePlans.find((p) => p.orderId === orderId);
  }

  completeStage(orderId: string, index: number): StagePlanRec {
    const plan = this.stagePlan(orderId);
    if (!plan) throw new BadRequestException({ code: 'NO_STAGE_PLAN' });
    if (!plan.allSlotsConfirmed) {
      throw new BadRequestException({
        code: 'SLOTS_NOT_CONFIRMED',
        message: 'Начать нельзя: не подтверждены слоты следующих этапов',
      });
    }
    const stage = plan.stages.find((s) => s.index === index);
    if (!stage) throw new BadRequestException({ code: 'STAGE_NOT_FOUND' });
    stage.status = 'done';
    this.store.persist();
    return plan;
  }

  // ---------- M-35 внесение наличных ----------

  deposit(masterId: string, amountTiyin: number) {
    if (amountTiyin <= 0) throw new BadRequestException({ code: 'AMOUNT_REQUIRED' });
    return this.persist(this.deposits, { id: uuidv7(), masterId, amountTiyin, status: 'pending' as const, createdAt: new Date().toISOString() }, 500);
  }

  settleDeposit(id: string) {
    const d = this.deposits.find((x) => x.id === id);
    if (!d) throw new BadRequestException({ code: 'DEPOSIT_NOT_FOUND' });
    d.status = 'settled';
    this.store.persist();
    return d;
  }

  // ---------- M-40 график ----------

  requestTimeOff(data: { masterId: string; from: string; to: string; kind: 'vacation' | 'sick'; comment?: string }) {
    if (!data.from || !data.to) throw new BadRequestException({ code: 'DATES_REQUIRED' });
    if (data.to < data.from) throw new BadRequestException({ code: 'RANGE_INVALID', message: 'Дата окончания раньше начала' });
    return this.persist(this.timeOff, { id: uuidv7(), status: 'pending' as const, createdAt: new Date().toISOString(), ...data }, 1000);
  }

  timeOffFor(masterId: string) {
    return this.timeOff.filter((t) => t.masterId === masterId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  // ---------- M-39 инструмент и NPS ----------

  toolCheck(masterId: string, skill: string, complete: boolean, missing?: string) {
    return this.persist(this.toolChecks, { id: uuidv7(), masterId, skill, complete, missing, at: new Date().toISOString() }, 500);
  }

  submitNps(masterId: string, score: number, comment?: string) {
    if (score < 0 || score > 10) throw new BadRequestException({ code: 'SCORE_RANGE', message: 'Оценка от 0 до 10' });
    return this.persist(this.npsAnswers, { id: uuidv7(), masterId, score, comment, at: new Date().toISOString() }, 500);
  }

  /** Раз в квартал: спрашиваем, только если последний ответ старше 90 дней */
  npsDue(masterId: string): boolean {
    const last = [...this.npsAnswers].reverse().find((n) => n.masterId === masterId);
    if (!last) return true;
    return Date.now() - new Date(last.at).getTime() > 90 * 86_400_000;
  }
}
