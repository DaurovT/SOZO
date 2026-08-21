import { BadRequestException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { MastersService } from '../masters/masters.module';
import { uuidv7 } from '@sozo/kernel';
import { StateStore } from '../../common/state-store';
import { PrismaService } from '../../common/prisma.service';
import { PgMirror } from '../../common/pg-mirror';
import { NotificationsService } from './notifications.service';
import { tr } from '../../common/locale';

/**
 * Офферы и смена мастера (PRD-02 §3, экраны M-02, M-04).
 *
 * Оффер живёт 60 секунд. До принятия мастер видит район, категорию, вилку и окно —
 * точный адрес и телефон клиента открываются после принятия (PRD-02 §3.2).
 * Молчание = отказ по таймауту; отказы считаются и влияют на приоритет в подборе.
 */

export const OFFER_TTL_SECONDS = 60; // параметр №31
/** Экспресс-замена: бродкаст всем свободным, окно шире — клиент уже ждёт (M-10) */
export const EXPRESS_TTL_SECONDS = 120;

/** Причины отказа — из справочника, свободный текст не принимаем (ТЗ 7.4) */
export const DECLINE_REASONS = [
  { code: 'far', title: 'Далеко — не успею к окну' },
  { code: 'no_skill', title: 'Не мой профиль работ' },
  { code: 'no_tool', title: 'Нет нужного инструмента' },
  { code: 'busy', title: 'Занят на текущей заявке' },
  { code: 'personal', title: 'Личные обстоятельства' },
] as const;

export interface OfferRec {
  id: string;
  orderId: string;
  orderNumber: string;
  masterId: string;
  masterName: string;
  /** Что видно ДО принятия (PRD-02 §3.2) */
  category: string;
  district: string;
  urgency: 'normal' | 'urgent' | 'emergency';
  slotStart?: string;
  slotEnd?: string;
  estimateFromTiyin: number;
  estimateToTiyin: number;
  masterShareFromTiyin: number;
  distanceHint?: string;
  isPaired: boolean;
  /** personal — персональный оффер; express — бродкаст замены; helper — мини-оффер помощнику */
  kind: 'personal' | 'express' | 'helper';
  ttlSeconds: number;
  /** Для замены: с какого времени клиент ждёт — это меняет тон экрана */
  waitingSince?: string;
  status: 'pending' | 'accepted' | 'declined' | 'expired' | 'revoked';
  declineReason?: string;
  createdAt: string;
  expiresAt: string;
  respondedAt?: string;
}

export interface ShiftStateRec {
  masterId: string;
  online: boolean;
  since: string;
  lastPing?: { lat: number; lng: number; accuracy?: number; at: string };
  /** Гео пишется в моменты событий, а не непрерывно (ТЗ 7.2 — привязка к событию, не слежка) */
  geoLog: Array<{ event: string; lat: number | null; lng: number | null; orderId?: string; at: string }>;
}

@Injectable()
export class MasterOffersService {
  readonly offers: OfferRec[] = [];
  private readonly shifts = new Map<string, ShiftStateRec>();
  private readonly mirror: PgMirror;

  constructor(
    private readonly store: StateStore,
    private readonly notifications: NotificationsService,
    private readonly masters: MastersService,
    prisma: PrismaService,
  ) {
    this.store.register(
      'masterOffers',
      () => ({ offers: this.offers.slice(-500), shifts: [...this.shifts.values()] }),
      (d) => {
        const data = d as { offers?: OfferRec[]; shifts?: ShiftStateRec[] };
        this.offers.length = 0;
        this.offers.push(...(data.offers ?? []));
        this.shifts.clear();
        for (const s of data.shifts ?? []) this.shifts.set(s.masterId, s);
      },
    );
    this.mirror = new PgMirror(prisma, 'MasterOffers', {
      load: async (tx) => {
        const [offers, shifts, geo] = await Promise.all([
          tx.masterOffer.findMany({ orderBy: { createdAt: 'desc' }, take: 500 }),
          tx.masterShiftState.findMany(),
          tx.masterGeoEvent.findMany({ orderBy: { at: 'desc' }, take: 500 }),
        ]);
        if (offers.length) {
          this.offers.length = 0;
          this.offers.push(
            ...offers.reverse().map((o) => ({
              id: o.id, orderId: o.orderId, orderNumber: o.orderNumber,
              masterId: o.masterId, masterName: o.masterName,
              category: o.category, district: o.district,
              urgency: o.urgency as OfferRec['urgency'],
              slotStart: o.slotStart?.toISOString(),
              slotEnd: o.slotEnd?.toISOString(),
              estimateFromTiyin: Number(o.estimateFromTiyin),
              estimateToTiyin: Number(o.estimateToTiyin),
              masterShareFromTiyin: Number(o.masterShareFromTiyin),
              distanceHint: o.distanceHint ?? undefined,
              isPaired: o.isPaired,
              kind: o.kind as OfferRec['kind'],
              ttlSeconds: o.ttlSeconds,
              waitingSince: o.waitingSince?.toISOString(),
              status: o.status as OfferRec['status'],
              declineReason: o.declineReason ?? undefined,
              createdAt: o.createdAt.toISOString(),
              expiresAt: o.expiresAt.toISOString(),
              respondedAt: o.respondedAt?.toISOString(),
            })),
          );
        }
        if (shifts.length) {
          this.shifts.clear();
          for (const st of shifts) {
            this.shifts.set(st.masterId, {
              masterId: st.masterId,
              online: st.online,
              since: st.since.toISOString(),
              lastPing:
                st.lastLat !== null && st.lastLng !== null
                  ? { lat: st.lastLat, lng: st.lastLng, accuracy: st.lastAccuracy ?? undefined, at: (st.lastPingAt ?? st.since).toISOString() }
                  : undefined,
              geoLog: geo
                .filter((g) => g.masterId === st.masterId)
                .reverse()
                .map((g) => ({ event: g.event, lat: g.lat, lng: g.lng, orderId: g.orderId ?? undefined, at: g.at.toISOString() })),
            });
          }
        }
        return offers.length + shifts.length;
      },
      save: async (tx, tenantId) => {
        for (const o of [...this.offers]) {
          const data = {
            orderId: o.orderId, orderNumber: o.orderNumber, masterId: o.masterId, masterName: o.masterName,
            category: o.category, district: o.district, urgency: o.urgency,
            slotStart: o.slotStart ? new Date(o.slotStart) : null,
            slotEnd: o.slotEnd ? new Date(o.slotEnd) : null,
            estimateFromTiyin: BigInt(Math.max(0, o.estimateFromTiyin)),
            estimateToTiyin: BigInt(Math.max(0, o.estimateToTiyin)),
            masterShareFromTiyin: BigInt(Math.max(0, o.masterShareFromTiyin)),
            distanceHint: o.distanceHint ?? null,
            isPaired: o.isPaired,
            kind: o.kind,
            ttlSeconds: o.ttlSeconds > 0 ? o.ttlSeconds : 60,
            waitingSince: o.waitingSince ? new Date(o.waitingSince) : null,
            status: o.status,
            declineReason: o.declineReason ?? null,
            expiresAt: new Date(o.expiresAt),
            // CHECK в m26: ответ на предложение обязан иметь время — по нему
            // считается скорость реакции в рейтинге
            respondedAt:
              o.status === 'accepted' || o.status === 'declined'
                ? new Date(o.respondedAt ?? o.createdAt)
                : (o.respondedAt ? new Date(o.respondedAt) : null),
          };
          await tx.masterOffer.upsert({
            where: { id: o.id },
            create: { id: o.id, tenantId, createdAt: new Date(o.createdAt), ...data },
            update: data,
          });
        }
        for (const st of [...this.shifts.values()]) {
          const data = {
            online: st.online,
            since: new Date(st.since),
            lastLat: st.lastPing?.lat ?? null,
            lastLng: st.lastPing?.lng ?? null,
            lastAccuracy: st.lastPing?.accuracy ?? null,
            lastPingAt: st.lastPing ? new Date(st.lastPing.at) : null,
          };
          await tx.masterShiftState.upsert({
            where: { tenantId_masterId: { tenantId, masterId: st.masterId } },
            create: { tenantId, masterId: st.masterId, ...data },
            update: data,
          });
          // Геожурнал append-only: по нему разбирают спор «мастер не выехал»,
          // и переписывать его нельзя
          for (const g of st.geoLog.slice(-200)) {
            await tx.masterGeoEvent.upsert({
              where: { id: `${st.masterId}-${g.at}` },
              create: {
                id: `${st.masterId}-${g.at}`.slice(0, 36),
                tenantId, masterId: st.masterId, event: g.event,
                lat: g.lat, lng: g.lng, orderId: g.orderId ?? null, at: new Date(g.at),
              },
              update: {},
            });
          }
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

  // ---------- Смена (M-02) ----------

  shift(masterId: string): ShiftStateRec {
    let s = this.shifts.get(masterId);
    if (!s) {
      s = { masterId, online: false, since: new Date().toISOString(), geoLog: [] };
      this.shifts.set(masterId, s);
    }
    return s;
  }

  setOnline(masterId: string, online: boolean, geo?: { lat: number; lng: number }): ShiftStateRec {
    const s = this.shift(masterId);
    if (s.online !== online) {
      s.online = online;
      s.since = new Date().toISOString();
      this.trackGeo(masterId, online ? 'shift.start' : 'shift.end', geo ?? null);
    }
    this.store.persist();
    return s;
  }

  /**
   * Гео-отметка к событию. Отсутствие координат — флаг, а не блокер:
   * подвал, подземный паркинг, отключённая геолокация (ТЗ 7.2).
   */
  trackGeo(masterId: string, event: string, geo: { lat: number; lng: number; accuracy?: number } | null, orderId?: string): void {
    const s = this.shift(masterId);
    const at = new Date().toISOString();
    s.geoLog.push({ event, lat: geo?.lat ?? null, lng: geo?.lng ?? null, orderId, at });
    if (s.geoLog.length > 300) s.geoLog.splice(0, s.geoLog.length - 300);
    if (geo) {
      s.lastPing = { ...geo, at };
      // Дублируем в карточку мастера: карта диспетчера читает её,
      // а лезть из модуля заявок в состояние смен — лишняя связка
      this.masters.update(masterId, { lastGeo: { lat: geo.lat, lng: geo.lng, at } });
    }
    this.store.persist();
  }

  onlineMasters(): ShiftStateRec[] {
    return [...this.shifts.values()].filter((s) => s.online);
  }

  // ---------- Офферы (M-04) ----------

  create(data: Omit<OfferRec, 'id' | 'status' | 'createdAt' | 'expiresAt'>): OfferRec {
    // Один активный оффер на заявку в одни руки — повторная отправка отзывает прежний
    for (const prev of this.offers) {
      if (prev.orderId === data.orderId && prev.masterId === data.masterId && prev.status === 'pending') {
        prev.status = 'revoked';
      }
    }
    const now = Date.now();
    const ttl = data.ttlSeconds || (data.kind === 'personal' ? OFFER_TTL_SECONDS : EXPRESS_TTL_SECONDS);
    const rec: OfferRec = {
      id: uuidv7(),
      status: 'pending',
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + ttl * 1000).toISOString(),
      ...data,
      ttlSeconds: ttl,
    };
    this.offers.push(rec);
    this.notifications.push({
      masterId: rec.masterId,
      kind: 'offer',
      title: rec.kind === 'express' ? 'Срочная замена рядом' : 'Новый оффер',
      body: '{0}, {1}. Ваша доля от {2} сум — {3} сек',
      bodyArgs: [rec.category, rec.district, Math.round(rec.masterShareFromTiyin / 100), ttl],
      priority: 'heads_up',
      deepLink: `sozo-master://offer/${rec.id}`,
      orderId: rec.orderId,
    });
    if (this.offers.length > 500) this.offers.splice(0, this.offers.length - 500);
    this.store.persist();
    return rec;
  }

  get(id: string): OfferRec {
    const o = this.offers.find((x) => x.id === id);
    if (!o) throw new NotFoundException({ code: 'OFFER_NOT_FOUND' });
    return o;
  }

  /** Протухшие переводим в expired лениво — при каждом чтении */
  private sweep(): void {
    const now = Date.now();
    let changed = false;
    for (const o of this.offers) {
      if (o.status === 'pending' && new Date(o.expiresAt).getTime() < now) {
        o.status = 'expired';
        o.respondedAt = new Date(now).toISOString();
        // Молчание по бродкасту не вина — о нём не напоминаем
        if (o.kind === 'personal') {
          this.notifications.push({
            masterId: o.masterId,
            kind: 'offer_expired',
            title: 'Оффер истёк',
            body: '{0} — заявка ушла другому мастеру',
            bodyArgs: [o.category],
            orderId: o.orderId,
          });
        }
        changed = true;
      }
    }
    if (changed) this.store.persist();
  }

  pendingFor(masterId: string): OfferRec[] {
    this.sweep();
    return this.offers
      .filter((o) => o.masterId === masterId && o.status === 'pending')
      .map((o) => ({ ...o, secondsLeft: Math.max(0, Math.round((new Date(o.expiresAt).getTime() - Date.now()) / 1000)) }) as OfferRec);
  }

  accept(id: string, masterId: string): OfferRec {
    this.sweep();
    const o = this.get(id);
    if (o.masterId !== masterId) throw new NotFoundException({ code: 'OFFER_NOT_FOUND' });
    if (o.status === 'expired') {
      throw new BadRequestException({ code: 'OFFER_EXPIRED', message: 'Оффер истёк — заявка ушла другому мастеру' });
    }
    if (o.status !== 'pending') {
      throw new BadRequestException({ code: 'OFFER_CLOSED', message: 'Оффер уже обработан' });
    }
    // Гонка двух мастеров за одну заявку: побеждает первый принявший
    if (this.offers.some((x) => x.orderId === o.orderId && x.status === 'accepted')) {
      o.status = 'revoked';
      this.store.persist();
      throw new BadRequestException({ code: 'ORDER_TAKEN', message: 'Заявку уже взял другой мастер' });
    }
    o.status = 'accepted';
    o.respondedAt = new Date().toISOString();
    // остальные офферы по этой заявке отзываем
    for (const x of this.offers) {
      if (x.orderId === o.orderId && x.id !== o.id && x.status === 'pending') x.status = 'revoked';
    }
    this.store.persist();
    return o;
  }

  decline(id: string, masterId: string, reasonCode: string): OfferRec {
    this.sweep();
    const o = this.get(id);
    if (o.masterId !== masterId) throw new NotFoundException({ code: 'OFFER_NOT_FOUND' });
    if (o.status !== 'pending') throw new BadRequestException({ code: 'OFFER_CLOSED' });
    // Бродкаст пропускают без причины и без штрафа: заявку получит первый принявший
    if (o.kind !== 'personal') {
      o.status = 'declined';
      o.respondedAt = new Date().toISOString();
      this.store.persist();
      return o;
    }
    if (!DECLINE_REASONS.some((r) => r.code === reasonCode)) {
      throw new BadRequestException({
        code: 'REASON_REQUIRED',
        message: tr('Причина отказа из справочника: {0}', DECLINE_REASONS.map((r) => r.code).join(', ')),
      });
    }
    o.status = 'declined';
    o.declineReason = reasonCode;
    o.respondedAt = new Date().toISOString();
    this.store.persist();
    return o;
  }

  /** Статистика откликов — вход в рейтинг и подбор (ТЗ 7.4) */
  responseStats(masterId: string, days = 30) {
    const since = Date.now() - days * 86_400_000;
    // Дисциплину считаем только по персональным офферам — молчание по бродкасту не вина
    const mine = this.offers.filter((o) => o.masterId === masterId && o.kind === 'personal' && new Date(o.createdAt).getTime() >= since);
    const answered = mine.filter((o) => o.status === 'accepted' || o.status === 'declined');
    const accepted = mine.filter((o) => o.status === 'accepted').length;
    const expired = mine.filter((o) => o.status === 'expired').length;
    const times = mine
      .filter((o) => o.respondedAt && (o.status === 'accepted' || o.status === 'declined'))
      .map((o) => (new Date(o.respondedAt!).getTime() - new Date(o.createdAt).getTime()) / 1000);
    return {
      offers: mine.length,
      accepted,
      declined: mine.filter((o) => o.status === 'declined').length,
      expired,
      acceptRatePercent: mine.length ? Math.round((accepted / mine.length) * 100) : null,
      avgResponseSeconds: times.length ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) : null,
      answeredShare: mine.length ? Math.round((answered.length / mine.length) * 100) : null,
    };
  }
}
