import { BadRequestException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { uuidv7 } from '@sozo/kernel';
import { StateStore } from '../../common/state-store';
import { PrismaService } from '../../common/prisma.service';
import { currentDbContext, systemContext } from '../../common/db-context';

/**
 * Планировщик ёмкости (PRD-05 §2, ТЗ 17.3). Сетка 30-минутных слотов.
 * Бронь = ceil((нормо-часы + дорожный буфер 20%) / 0.5) слотов.
 * Инварианты: план дня ≤ 80% смены; ближайшие 2 часа ленты заморожены для автоматики;
 * клиент не видит окно без реальной ёмкости; подтверждённая бронь не ломается автоматикой.
 */
export const SLOT_MINUTES = 30;
export const ROAD_BUFFER_RATE = 0.2; // параметр №27
export const DAY_PLAN_CAP = 0.8; // параметр №28
export const LANE_FREEZE_HOURS = 2; // параметр №29

export interface ShiftRec {
  id: string;
  masterId: string;
  masterName: string;
  date: string; // YYYY-MM-DD
  startMin: number; // минуты от полуночи (9:00 = 540)
  endMin: number;
  isDuty: boolean; // дежурный: плановые не бронируются (ТЗ 17.3)
  zone?: string;
}

export interface BookingRec {
  id: string;
  shiftId: string;
  masterId: string;
  orderId: string;
  orderNumber: string;
  startMin: number;
  endMin: number;
  slots: number;
  normHours: number;
  bufferMin: number;
  anchored: boolean; // якорная (жёсткое окно клиента) vs гибкая (осмотр, лист ожидания)
  priority: number; // 1..8 — очередь ТЗ 17.3
  clientWindow: [number, number]; // 2-часовое окно, которое видит клиент
  createdAt: string;
}

export interface WaitlistEntry {
  orderId: string;
  orderNumber: string;
  normHours: number;
  priority: number;
  at: string;
}

/** Приоритеты доступа к слотам (ТЗ 17.3, 8 уровней) */
export const QUEUE_PRIORITY: Record<string, number> = {
  emergency: 1,
  b2b_contract_window: 2,
  warranty: 3,
  staged_continuation: 4,
  urgent: 5,
  b2c_booking: 6,
  waitlist: 7,
  inspection: 8,
};

const HHMM = (min: number): string => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

@Injectable()
export class SchedulingService implements OnModuleInit {
  private readonly shifts: ShiftRec[] = [];
  private readonly bookings: BookingRec[] = [];
  /** Лист ожидания: заявки без брони, ждут освободившийся слот (ТЗ 17.3) */
  private readonly waitlist: WaitlistEntry[] = [];

  private loaded = false;

  constructor(
    private readonly store: StateStore,
    private readonly prisma: PrismaService,
  ) {
    this.store.register(
      'scheduling',
      () => ({ shifts: this.shifts, bookings: this.bookings, waitlist: this.waitlist }),
      (d) => {
        const data = d as { shifts: ShiftRec[]; bookings: BookingRec[]; waitlist: WaitlistEntry[] };
        this.shifts.length = 0;
        this.shifts.push(...(data.shifts ?? []));
        this.bookings.length = 0;
        this.bookings.push(...(data.bookings ?? []));
        this.waitlist.length = 0;
        this.waitlist.push(...(data.waitlist ?? []));
      },
    );
  }

  /**
   * Загрузка и запись при работе на базе.
   *
   * Форма — полная перезапись трёх коллекций. В отличие от журнала проводок,
   * здесь записи удаляются: бронь снимают, смену убирают из расписания. Знать
   * поимённо, что именно исчезло, значило бы вести вторую модель предметной
   * области ради самой записи. Коллекции живут в пределах ближайших дней и
   * малы: расписание — не архив.
   */
  async onModuleInit(): Promise<void> {
    if (!this.prisma.enabled) {
      this.loaded = true;
      return;
    }
    const d = await this.prisma.withContext(async (tx) => ({
      shifts: await tx.shift.findMany(),
      bookings: await tx.booking.findMany(),
      waitlist: await tx.waitlistEntry.findMany({ orderBy: { at: 'asc' } }),
    }));
    if (d.shifts.length) {
      this.shifts.length = 0;
      this.shifts.push(
        ...d.shifts.map((x) => ({
          id: x.id,
          masterId: x.masterId,
          masterName: x.masterName,
          date: x.date.toISOString().slice(0, 10),
          startMin: x.startMin,
          endMin: x.endMin,
          isDuty: x.isDuty,
          zone: x.zone ?? undefined,
        })),
      );
    }
    if (d.bookings.length) {
      this.bookings.length = 0;
      this.bookings.push(
        ...d.bookings.map((x) => ({
          id: x.id,
          shiftId: x.shiftId,
          masterId: x.masterId,
          orderId: x.orderId,
          orderNumber: x.orderNumber,
          startMin: x.startMin,
          endMin: x.endMin,
          slots: x.slots,
          normHours: Number(x.normHours),
          bufferMin: x.bufferMin,
          anchored: x.anchored,
          priority: x.priority,
          clientWindow: [x.clientWindowFromMin, x.clientWindowToMin] as [number, number],
          createdAt: x.createdAt.toISOString(),
        })),
      );
    }
    if (d.waitlist.length) {
      this.waitlist.length = 0;
      this.waitlist.push(
        ...d.waitlist.map((x) => ({
          orderId: x.orderId,
          orderNumber: x.orderNumber,
          normHours: Number(x.normHours),
          priority: x.priority,
          at: x.at.toISOString(),
        })),
      );
    }
    this.loaded = true;
    if (this.shifts.length || this.bookings.length) {
      // eslint-disable-next-line no-console
      console.log(`[Scheduling] из базы: смен ${this.shifts.length}, броней ${this.bookings.length}, в листе ожидания ${this.waitlist.length}`);
    }
  }

  /**
   * Разовый перенос расписания в базу (deploy/import-state).
   *
   * Планировщик, в отличие от прайса и CRM, читает state.json и с включённой
   * базой, поэтому переносить нечего — достаточно записать то, что уже в
   * памяти, и дождаться записи.
   */
  async flushToDb(): Promise<{ shifts: number; bookings: number; waitlist: number }> {
    this.loaded = true;
    this.scheduleWrite();
    await this.writing;
    return { shifts: this.shifts.length, bookings: this.bookings.length, waitlist: this.waitlist.length };
  }

  private writing: Promise<void> = Promise.resolve();

  private scheduleWrite(): void {
    if (!this.prisma.enabled || !this.loaded) return;
    this.writing = this.writing
      .then(() => this.writeAll())
      .catch((e: unknown) => {
        // eslint-disable-next-line no-console
        console.error('[Scheduling] запись в базу не удалась:', (e as Error).message);
      });
  }

  private async writeAll(): Promise<void> {
    const tenantId = (currentDbContext() ?? systemContext()).tenantId;
    await this.prisma.withContext(async (tx) => {
      // Порядок обязателен: бронь ссылается на смену
      await tx.booking.deleteMany({});
      await tx.waitlistEntry.deleteMany({});
      await tx.shift.deleteMany({});
      for (const x of this.shifts) {
        await tx.shift.create({
          data: {
            id: x.id, tenantId, masterId: x.masterId, masterName: x.masterName,
            date: new Date(`${x.date}T00:00:00Z`), startMin: x.startMin, endMin: x.endMin,
            isDuty: x.isDuty, zone: x.zone ?? null,
          },
        });
      }
      for (const x of this.bookings) {
        await tx.booking.create({
          data: {
            id: x.id, tenantId, shiftId: x.shiftId, masterId: x.masterId, orderId: x.orderId,
            orderNumber: x.orderNumber, startMin: x.startMin, endMin: x.endMin, slots: x.slots,
            normHours: x.normHours, bufferMin: x.bufferMin, anchored: x.anchored, priority: x.priority,
            clientWindowFromMin: x.clientWindow[0], clientWindowToMin: x.clientWindow[1],
            createdAt: new Date(x.createdAt),
          },
        });
      }
      for (const x of this.waitlist) {
        await tx.waitlistEntry.create({
          data: {
            tenantId, orderId: x.orderId, orderNumber: x.orderNumber,
            normHours: x.normHours, priority: x.priority, at: new Date(x.at),
          },
        });
      }
    });
  }

  // ---------- Смены ----------

  listShifts(date: string): ShiftRec[] {
    return this.shifts.filter((s) => s.date === date);
  }

  /**
   * Бронь заявки вместе с датой — её показывает клиент как «окно приезда».
   * Дата живёт на смене, а не на брони, поэтому join делаем здесь, а не в вызывающем коде.
   */
  bookingFor(orderId: string): (BookingRec & { date: string }) | null {
    const booking = [...this.bookings].reverse().find((b) => b.orderId === orderId);
    if (!booking) return null;
    const shift = this.shifts.find((s) => s.id === booking.shiftId);
    return { ...booking, date: shift?.date ?? '' };
  }

  createShift(data: Omit<ShiftRec, 'id'>): ShiftRec {
    if (data.endMin <= data.startMin) throw new BadRequestException({ code: 'SHIFT_RANGE_INVALID' });
    const dup = this.shifts.find((s) => s.masterId === data.masterId && s.date === data.date);
    if (dup) throw new BadRequestException({ code: 'SHIFT_EXISTS', message: 'У мастера уже есть смена на эту дату' });
    const shift: ShiftRec = { id: uuidv7(), ...data };
    this.shifts.push(shift);
    this.scheduleWrite();
    this.store.persist();
    return shift;
  }

  removeShift(id: string): void {
    const idx = this.shifts.findIndex((s) => s.id === id);
    if (idx < 0) throw new NotFoundException({ code: 'SHIFT_NOT_FOUND' });
    if (this.bookings.some((b) => b.shiftId === id)) {
      throw new BadRequestException({ code: 'SHIFT_HAS_BOOKINGS', message: 'В смене есть брони — сначала переназначьте заявки' });
    }
    this.shifts.splice(idx, 1);
    this.scheduleWrite();
    this.store.persist();
  }

  /** Быстрое заполнение графика: смены 09:00–18:00 всем активным мастерам на дату */
  seedDay(date: string, masters: Array<{ id: string; fullName: string; zones?: string[] }>, dutyMasterId?: string): ShiftRec[] {
    const created: ShiftRec[] = [];
    for (const m of masters) {
      if (this.shifts.some((s) => s.masterId === m.id && s.date === date)) continue;
      created.push(
        this.createShift({
          masterId: m.id,
          masterName: m.fullName,
          date,
          startMin: 9 * 60,
          endMin: 18 * 60,
          isDuty: m.id === dutyMasterId,
          zone: m.zones?.[0],
        }),
      );
    }
    return created;
  }

  // ---------- Ёмкость и брони ----------

  /** Число слотов под заявку: нормо-часы + дорожный буфер, округление вверх до 30 мин */
  slotsFor(normHours: number): { slots: number; bufferMin: number; totalMin: number } {
    const workMin = Math.max(normHours, 0.5) * 60;
    const bufferMin = Math.round(workMin * ROAD_BUFFER_RATE);
    const totalMin = workMin + bufferMin;
    return { slots: Math.ceil(totalMin / SLOT_MINUTES), bufferMin, totalMin: Math.ceil(totalMin / SLOT_MINUTES) * SLOT_MINUTES };
  }

  lane(masterId: string, date: string) {
    const shift = this.shifts.find((s) => s.masterId === masterId && s.date === date);
    const bookings = this.bookings
      .filter((b) => b.masterId === masterId && this.shifts.find((s) => s.id === b.shiftId)?.date === date)
      .sort((a, b) => a.startMin - b.startMin);
    const busyMin = bookings.reduce((s, b) => s + (b.endMin - b.startMin), 0);
    const shiftMin = shift ? shift.endMin - shift.startMin : 0;
    return {
      shift,
      bookings,
      busyMin,
      shiftMin,
      loadPercent: shiftMin ? Math.round((busyMin / shiftMin) * 100) : 0,
      capReached: shiftMin > 0 && busyMin >= shiftMin * DAY_PLAN_CAP, // план дня ≤80% смены
    };
  }

  /** Ленты всех мастеров на дату — экран D-05 */
  lanes(date: string) {
    return this.listShifts(date).map((s) => {
      const l = this.lane(s.masterId, date);
      return {
        masterId: s.masterId,
        masterName: s.masterName,
        zone: s.zone,
        isDuty: s.isDuty,
        shift: { start: HHMM(s.startMin), end: HHMM(s.endMin), startMin: s.startMin, endMin: s.endMin },
        loadPercent: l.loadPercent,
        capReached: l.capReached,
        bookings: l.bookings.map((b) => ({
          ...b,
          start: HHMM(b.startMin),
          end: HHMM(b.endMin),
          clientWindowText: `${HHMM(b.clientWindow[0])}–${HHMM(b.clientWindow[1])}`,
        })),
      };
    });
  }

  /**
   * Реально доступные окна на дату (ТЗ 17.3: клиент не видит окно без ёмкости).
   * Учитывает: смены, занятые слоты, заморозку ближайших 2 часов, план дня ≤80%,
   * дежурных (плановые не бронируются), ночь 22:00–07:00 для плановых B2C.
   */
  availableWindows(date: string, normHours: number, opts: { now?: Date; skipDuty?: boolean } = {}) {
    const { slots, totalMin } = this.slotsFor(normHours);
    const now = opts.now ?? new Date();
    const isToday = date === now.toISOString().slice(0, 10);
    const freezeUntilMin = isToday ? now.getHours() * 60 + now.getMinutes() + LANE_FREEZE_HOURS * 60 : -1;

    const windows = new Map<number, { startMin: number; masters: string[] }>();
    for (const shift of this.listShifts(date)) {
      if (shift.isDuty && opts.skipDuty !== false) continue; // дежурному плановые не бронируем
      const lane = this.lane(shift.masterId, date);
      if (lane.capReached) continue;
      const busy = lane.bookings.map((b) => [b.startMin, b.endMin] as const);
      for (let start = shift.startMin; start + totalMin <= shift.endMin; start += SLOT_MINUTES) {
        if (start < freezeUntilMin) continue; // заморозка ближайших 2 часов
        if (start >= 22 * 60 || start < 7 * 60) continue; // ночь: плановые не бронируются
        const end = start + totalMin;
        const overlaps = busy.some(([bs, be]) => start < be && end > bs);
        if (overlaps) continue;
        // не выводим за 80% плана
        if ((lane.busyMin + totalMin) / Math.max(lane.shiftMin, 1) > DAY_PLAN_CAP) continue;
        const w = windows.get(start) ?? { startMin: start, masters: [] };
        w.masters.push(shift.masterId);
        windows.set(start, w);
      }
    }
    // Клиенту показываем 2-часовые окна (ТЗ 17.3)
    return [...windows.values()]
      .sort((a, b) => a.startMin - b.startMin)
      .map((w) => ({
        startMin: w.startMin,
        label: `${HHMM(w.startMin)}–${HHMM(w.startMin + 120)}`,
        mastersAvailable: w.masters.length,
        slots,
      }));
  }

  /** Бронирование: проверка ёмкости, пересечений и лимита плана дня */
  book(params: {
    masterId: string;
    date: string;
    startMin: number;
    orderId: string;
    orderNumber: string;
    normHours: number;
    anchored?: boolean;
    priority?: number;
    force?: boolean; // диспетчер правит «горячую зону» с подтверждением
    now?: Date;
  }): BookingRec {
    const shift = this.shifts.find((s) => s.masterId === params.masterId && s.date === params.date);
    if (!shift) throw new BadRequestException({ code: 'NO_SHIFT', message: 'У мастера нет смены на эту дату' });
    if (this.bookings.some((b) => b.orderId === params.orderId)) {
      throw new BadRequestException({ code: 'ALREADY_BOOKED', message: 'Заявка уже забронирована — сначала снимите бронь' });
    }
    const { slots, bufferMin, totalMin } = this.slotsFor(params.normHours);
    const endMin = params.startMin + totalMin;
    if (params.startMin < shift.startMin || endMin > shift.endMin) {
      throw new BadRequestException({ code: 'OUT_OF_SHIFT', message: `Не помещается в смену ${HHMM(shift.startMin)}–${HHMM(shift.endMin)}` });
    }
    const lane = this.lane(params.masterId, params.date);
    const clash = lane.bookings.find((b) => params.startMin < b.endMin && endMin > b.startMin);
    if (clash) {
      throw new BadRequestException({ code: 'SLOT_BUSY', message: `Пересечение с бронью ${clash.orderNumber} (${HHMM(clash.startMin)}–${HHMM(clash.endMin)})` });
    }
    const now = params.now ?? new Date();
    const isToday = params.date === now.toISOString().slice(0, 10);
    const freezeUntil = now.getHours() * 60 + now.getMinutes() + LANE_FREEZE_HOURS * 60;
    if (isToday && params.startMin < freezeUntil && !params.force) {
      throw new BadRequestException({
        code: 'LANE_FROZEN',
        message: `Ближайшие ${LANE_FREEZE_HOURS} ч ленты заморожены (ТЗ 17.3). Правка возможна с явным подтверждением: вы трогаете горячую зону`,
      });
    }
    if (!params.force && (lane.busyMin + totalMin) / Math.max(lane.shiftMin, 1) > DAY_PLAN_CAP) {
      throw new BadRequestException({
        code: 'DAY_PLAN_CAP',
        message: `План дня ограничен ${DAY_PLAN_CAP * 100}% смены (сейчас ${lane.loadPercent}%) — резерв под аварии и задержки`,
      });
    }
    const rec: BookingRec = {
      id: uuidv7(),
      shiftId: shift.id,
      masterId: params.masterId,
      orderId: params.orderId,
      orderNumber: params.orderNumber,
      startMin: params.startMin,
      endMin,
      slots,
      normHours: params.normHours,
      bufferMin,
      anchored: params.anchored ?? true,
      priority: params.priority ?? QUEUE_PRIORITY.b2c_booking,
      clientWindow: [params.startMin, params.startMin + 120],
      createdAt: new Date().toISOString(),
    };
    this.bookings.push(rec);
    this.scheduleWrite();
    this.store.persist();
    return rec;
  }

  /** Снятие брони → событие slot.freed: предложение срочным, затем листу ожидания */
  release(orderId: string): { freed: BookingRec | null; nextCandidate: { orderId: string; orderNumber: string } | null } {
    const idx = this.bookings.findIndex((b) => b.orderId === orderId);
    if (idx < 0) return { freed: null, nextCandidate: null };
    const [freed] = this.bookings.splice(idx, 1);
    this.scheduleWrite();
    // приоритет предложения: срочные → лист ожидания (FIFO внутри приоритета)
    const next = [...this.waitlist].sort((a, b) => a.priority - b.priority || a.at.localeCompare(b.at))[0] ?? null;
    this.store.persist();
    return { freed, nextCandidate: next ? { orderId: next.orderId, orderNumber: next.orderNumber } : null };
  }

  // ---------- Лист ожидания ----------

  addToWaitlist(orderId: string, orderNumber: string, normHours: number, priority = QUEUE_PRIORITY.waitlist): void {
    if (this.waitlist.some((w) => w.orderId === orderId)) return;
    this.waitlist.push({ orderId, orderNumber, normHours, priority, at: new Date().toISOString() });
    this.scheduleWrite();
    this.store.persist();
  }

  removeFromWaitlist(orderId: string): void {
    const i = this.waitlist.findIndex((w) => w.orderId === orderId);
    if (i >= 0) {
      this.waitlist.splice(i, 1);
      this.scheduleWrite();
      this.store.persist();
    }
  }

  listWaitlist() {
    return [...this.waitlist].sort((a, b) => a.priority - b.priority || a.at.localeCompare(b.at));
  }

  /** Сводка ёмкости дня — плитки D-04 (упрощённая тепловая карта) */
  capacity(date: string) {
    const lanes = this.lanes(date);
    const totalMin = lanes.reduce((s, l) => s + (l.shift.endMin - l.shift.startMin), 0);
    const busyMin = lanes.reduce((s, l) => s + l.bookings.reduce((x, b) => x + (b.endMin - b.startMin), 0), 0);
    const byHour: Array<{ hour: number; busy: number; free: number }> = [];
    for (let h = 7; h < 22; h += 1) {
      const start = h * 60;
      let busy = 0;
      let free = 0;
      for (const l of lanes) {
        if (start < l.shift.startMin || start >= l.shift.endMin) continue;
        const occupied = l.bookings.some((b) => start < b.endMin && start + 60 > b.startMin);
        if (occupied) busy += 1;
        else free += 1;
      }
      byHour.push({ hour: h, busy, free });
    }
    return {
      date,
      masters: lanes.length,
      totalMin,
      busyMin,
      loadPercent: totalMin ? Math.round((busyMin / totalMin) * 100) : 0,
      capPercent: DAY_PLAN_CAP * 100,
      overloaded: lanes.filter((l) => l.capReached).length,
      byHour,
      waitlist: this.listWaitlist().length,
    };
  }
}
