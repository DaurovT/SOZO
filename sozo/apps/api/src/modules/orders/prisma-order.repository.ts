import { Injectable, OnModuleInit } from '@nestjs/common';
import type { OrderStatus } from '@sozo/contracts';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma.service';
import { currentDbContext, systemContext } from '../../common/db-context';
import type { OrderRecord, OrderRepository } from './order.repository';

/**
 * Заявки в PostgreSQL (M0-E2-S1).
 *
 * Рабочий набор держится в памяти, как у CRM и прайса, и по той же причине:
 * приложение работает одним процессом, а заявку читают десятки мест синхронно
 * — от расчёта цены до лент мастера. Запись идёт насквозь.
 *
 * ЧТО ЭТО ЗНАЧИТ ДЛЯ ВЕРСИЙ. Оптимистичная блокировка (DEV-10 §3.6) и
 * идемпотентность по client_op_uuid проверяются в памяти, а не блокировкой
 * строки. При одном процессе это равносильно: два перехода не могут идти
 * параллельно внутри одного event loop между чтением версии и записью.
 * Со вторым экземпляром приложения проверку придётся переносить в
 * транзакцию — `SELECT ... FOR UPDATE` по заявке. Пока это не так, но
 * молчать об этом нельзя: именно здесь ошибка стоит дороже всего.
 *
 * `touch()` не знает, что изменилось: код правит вложенные коллекции заявки
 * напрямую и зовёт его без аргументов. Поэтому запись отложенная и полная —
 * ровно как делает файловое хранилище, которое переписывает весь снимок.
 */
@Injectable()
export class PrismaOrderRepository implements OrderRepository, OnModuleInit {
  private readonly orders = new Map<string, OrderRecord>();
  private loaded = false;
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly prisma: PrismaService) {}

  private tenant(): string {
    return (currentDbContext() ?? systemContext()).tenantId;
  }

  async onModuleInit(): Promise<void> {
    // Провайдер создаётся всегда, даже когда база выключена: Nest поднимает
    // всех, а выбор делает фабрика. Без этой проверки выключенная база
    // роняла приложение на старте
    if (!this.prisma.enabled) return;
    const rows = await this.prisma.withContext(async (tx) =>
      tx.order.findMany({
        include: { lines: true, quotes: true, photos: true, materials: true, statusLog: true },
        orderBy: { createdAt: 'asc' },
      }),
    );
    for (const r of rows) this.orders.set(r.id, fromDb(r));
    this.loaded = true;
    // eslint-disable-next-line no-console
    console.log(`[Orders] заявок из базы: ${this.orders.size}`);
  }

  async create(order: OrderRecord): Promise<OrderRecord> {
    this.orders.set(order.id, order);
    await this.writeOne(order);
    return order;
  }

  async findById(tenantId: string, id: string): Promise<OrderRecord | undefined> {
    const o = this.orders.get(id);
    return o && o.tenantId === tenantId ? o : undefined;
  }

  async list(tenantId: string): Promise<OrderRecord[]> {
    return [...this.orders.values()].filter((o) => o.tenantId === tenantId);
  }

  async applyTransition(
    tenantId: string,
    id: string,
    expectedVersion: number,
    entry: { from: OrderStatus | null; to: OrderStatus; action: string; actorPhone?: string; reason?: string; clientOpUuid?: string },
    patch?: Partial<Pick<OrderRecord, 'masterId' | 'masterName'>>,
  ): Promise<OrderRecord | 'version_conflict' | 'duplicate'> {
    const order = await this.findById(tenantId, id);
    if (!order) return 'version_conflict';
    if (
      entry.clientOpUuid &&
      order.statusLog.some((l) => l.from === entry.from && l.to === entry.to && l.clientOpUuid === entry.clientOpUuid)
    ) {
      return 'duplicate'; // идемпотентность (DEV-10 §3.5)
    }
    if (order.version !== expectedVersion) return 'version_conflict';
    order.status = entry.to;
    order.version += 1;
    if (patch) Object.assign(order, patch);
    order.statusLog.push({ ...entry, at: new Date() });
    // Переход пишется сразу, а не отложенно: статус заявки — то, ради чего
    // всё остальное существует, и терять его при падении процесса нельзя
    await this.writeOne(order);
    return order;
  }

  touch(): void {
    if (!this.loaded) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      void this.flush().catch((e: unknown) => {
        // eslint-disable-next-line no-console
        console.error('[Orders] отложенная запись не удалась:', (e as Error).message);
      });
    }, 500);
  }

  private async flush(): Promise<void> {
    for (const o of this.orders.values()) await this.writeOne(o);
  }

  /** Заявка целиком: коллекции переписываются, разницу не вычисляем */
  private async writeOne(o: OrderRecord): Promise<void> {
    const tenantId = this.tenant();
    await this.prisma.withContext(async (tx) => {
      const base = {
        number: o.number,
        type: o.graphType as never,
        urgency: (o.urgency ?? 'normal') as never,
        status: o.status as never,
        version: o.version,
        source: o.source ?? 'app',
        clientPhone: o.clientPhone,
        clientName: o.clientName ?? null,
        organizationId: o.organizationId ?? null,
        locationId: o.locationId ?? null,
        buildingId: o.buildingId ?? null,
        unitId: o.unitId ?? null,
        // Перечни с умолчанием в схеме: undefined оставляет значение по
        // умолчанию, null его стирает и ломает NOT NULL
        orderScope: (o.orderScope ?? undefined) as never,
        laborSettlement: (o.laborSettlement ?? undefined) as never,
        /**
         * Канал оплаты. B2B платит с абонентки, B2C — онлайн или наличными
         * мастеру; до закрытия заявки канал ещё не определён, и «онлайн» тут
         * не догадка, а состояние по умолчанию: наличные ставит мастер явно.
         */
        paymentChannel: (o.graphType === 'b2b'
          ? 'subscription'
          : ((o.payment as { method?: string } | undefined)?.method === 'cash' ? 'cash' : 'online')) as never,
        serviceFeeTiyin: BigInt(o.serviceFeeTiyin ?? 0),
        firstRefusalUntil: o.firstRefusalUntil ? new Date(o.firstRefusalUntil) : null,
        claimedByOperator: o.claimedByOperator ?? null,
        releasedReason: o.releasedReason ?? null,
        description: o.description ?? null,
        address: o.address ?? '',
        geoLat: o.lat ?? null,
        geoLng: o.lng ?? null,
        masterId: o.masterId ?? null,
        masterName: o.masterName ?? null,
        helperId: o.helperId ?? null,
        helperName: o.helperName ?? null,
        restrictedSite: Boolean(o.restrictedSite),
        arrivedAt: o.arrivedAt ? new Date(o.arrivedAt) : null,
        rating: o.rating ?? null,
        baseFromTiyin: BigInt(o.baseFromTiyin ?? 0),
        baseToTiyin: BigInt(o.baseToTiyin ?? 0),
        totalFromTiyin: BigInt(o.totalFromTiyin ?? 0),
        totalToTiyin: BigInt(o.totalToTiyin ?? 0),
        totalMaterialTiyin: BigInt(o.totalMaterialTiyin ?? 0),
        tipTiyin: BigInt(o.tipTiyin ?? 0),
        promoDiscountPercent: o.promoDiscountPercent ?? 0,
        urgentSurchargePercent: o.urgentSurchargePercent ?? 0,
        preferredMasterId: o.preferredMasterId ?? null,
        slaDueAt: o.slaDueAt ? new Date(o.slaDueAt) : null,
        rescheduleCount: o.rescheduleCount ?? 0,
        acceptanceCode: o.acceptanceCode ?? null,
        // Prisma требует своё значение для NULL в jsonb: обычный null тут
        // означал бы «не трогать поле», а не «очистить»
        acceptanceJson: (o.acceptance ?? Prisma.DbNull) as Prisma.InputJsonValue,
        // Prisma требует своё значение для NULL в jsonb: обычный null тут
        // означал бы «не трогать поле», а не «очистить»
        acceptanceRequestJson: (o.acceptanceRequest ?? Prisma.DbNull) as Prisma.InputJsonValue,
        // Prisma требует своё значение для NULL в jsonb: обычный null тут
        // означал бы «не трогать поле», а не «очистить»
        addressDetailsJson: (o.addressDetails ?? Prisma.DbNull) as Prisma.InputJsonValue,
        // Prisma требует своё значение для NULL в jsonb: обычный null тут
        // означал бы «не трогать поле», а не «очистить»
        paymentJson: (o.payment ?? Prisma.DbNull) as Prisma.InputJsonValue,
        // Prisma требует своё значение для NULL в jsonb: обычный null тут
        // означал бы «не трогать поле», а не «очистить»
        requestedWindowJson: (o.requestedWindow ?? Prisma.DbNull) as Prisma.InputJsonValue,
        // Prisma требует своё значение для NULL в jsonb: обычный null тут
        // означал бы «не трогать поле», а не «очистить»
        commonAreaAccessJson: (o.commonAreaAccess ?? Prisma.DbNull) as Prisma.InputJsonValue,
      };
      await tx.order.upsert({
        where: { id: o.id },
        create: { id: o.id, tenantId, ...base },
        update: base,
      });

      await tx.orderLine.deleteMany({ where: { orderId: o.id } });
      for (const l of o.lines ?? []) {
        await tx.orderLine.create({
          data: {
            id: crypto.randomUUID(),
            tenantId,
            orderId: o.id,
            priceItemId: l.priceItemId,
            nameCopy: l.name,
            unitCopy: l.unit,
            priceFromTiyinCopy: BigInt(l.priceFromTiyin ?? 0),
            priceToTiyinCopy: BigInt(l.priceToTiyin ?? 0),
            // Историческая одиночная цена: держим равной нижней границе вилки,
            // чтобы старые запросы не начали видеть ноль
            priceTiyinCopy: BigInt(l.priceFromTiyin ?? 0),
            normHoursCopy: 0,
            qty: l.qty,
          },
        });
      }

      await tx.quote.deleteMany({ where: { orderId: o.id } });
      for (const q of o.quotes ?? []) {
        await tx.quote.create({
          data: {
            id: crypto.randomUUID(),
            tenantId,
            orderId: o.id,
            kind: q.kind as never,
            amountTiyin: BigInt(q.amountTiyin ?? 0),
            // Позиции сметы в записи не хранятся отдельно от заявки — кладём
            // пустой массив, а не выдумываем состав задним числом
            positionsJson: [],
            approvedVia: q.approvedVia ?? null,
            note: q.note ?? null,
            createdAt: new Date(q.at),
          },
        });
      }

      await tx.orderPhoto.deleteMany({ where: { orderId: o.id } });
      for (const ph of o.photos ?? []) {
        await tx.orderPhoto.create({
          data: {
            id: ph.id ?? crypto.randomUUID(),
            tenantId,
            orderId: o.id,
            stage: ph.stage as never,
            source: ph.source ?? '',
            s3Key: ph.file ?? null,
            geoMissing: Boolean(ph.geoMissing),
            createdAt: new Date(ph.at),
          },
        });
      }

      await tx.orderMaterial.deleteMany({ where: { orderId: o.id } });
      for (const m of o.materials ?? []) {
        await tx.orderMaterial.create({
          data: {
            id: crypto.randomUUID(),
            tenantId,
            orderId: o.id,
            kind: m.kind,
            name: m.name,
            amountTiyin: BigInt(m.amountTiyin ?? 0),
            sourceChannel: m.sourceChannel,
            hasReceipt: Boolean(m.hasReceipt),
            priceTier: m.priceTier ?? null,
            createdAt: new Date(m.at),
          },
        });
      }

      await tx.orderStatusLog.deleteMany({ where: { orderId: o.id } });
      for (const l of o.statusLog ?? []) {
        await tx.orderStatusLog.create({
          data: {
            id: crypto.randomUUID(),
            tenantId,
            orderId: o.id,
            fromStatus: (l.from ?? null) as never,
            toStatus: l.to as never,
            action: l.action,
            actorPhone: l.actorPhone ?? null,
            reason: l.reason ?? null,
            clientUuid: l.clientOpUuid ?? null,
            createdAt: new Date(l.at),
          },
        });
      }
    });
  }
}

/**
 * Арендатор в приложении и в базе обозначаются по-разному.
 *
 * Код везде передаёт литерал 't0' — так сложилось с первого дня и встречается
 * в каждом контроллере. В базе tenant_id это uuid, потому что на нём стоят
 * политики RLS. Репозиторий переводит одно в другое: наружу отдаёт то, что
 * ожидает остальной код, внутрь пишет то, что понимает база.
 *
 * Это временный мост, а не решение. Правильно — перевести приложение на
 * настоящий идентификатор арендатора, но это отдельная работа: 't0' зашит
 * в сотнях мест, и менять его заодно с переносом хранилища значит смешать
 * две несвязанные правки.
 */
const APP_TENANT = 't0';

/** Строка базы → запись приложения */
function fromDb(r: Record<string, unknown>): OrderRecord {
  const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
  const rows = <T>(v: unknown): T[] => ((v ?? []) as T[]);
  return {
    id: r.id as string,
    tenantId: APP_TENANT,
    number: r.number as string,
    graphType: r.type as OrderRecord['graphType'],
    status: r.status as OrderStatus,
    version: num(r.version),
    urgency: r.urgency as OrderRecord['urgency'],
    source: r.source as OrderRecord['source'],
    clientPhone: r.clientPhone as string,
    clientName: (r.clientName ?? undefined) as string | undefined,
    address: (r.address ?? '') as string,
    lat: r.geoLat === null ? undefined : Number(r.geoLat),
    lng: r.geoLng === null ? undefined : Number(r.geoLng),
    description: (r.description ?? undefined) as string | undefined,
    organizationId: (r.organizationId ?? undefined) as string | undefined,
    locationId: (r.locationId ?? undefined) as string | undefined,
    buildingId: (r.buildingId ?? undefined) as string | undefined,
    unitId: (r.unitId ?? undefined) as string | undefined,
    orderScope: (r.orderScope ?? undefined) as OrderRecord['orderScope'],
    firstRefusalUntil: (r.firstRefusalUntil as Date | null)?.toISOString(),
    claimedByOperator: (r.claimedByOperator ?? undefined) as string | undefined,
    releasedReason: (r.releasedReason ?? undefined) as string | undefined,
    laborSettlement: (r.laborSettlement ?? undefined) as OrderRecord['laborSettlement'],
    serviceFeeTiyin: num(r.serviceFeeTiyin),
    masterId: (r.masterId ?? undefined) as string | undefined,
    masterName: (r.masterName ?? undefined) as string | undefined,
    helperId: (r.helperId ?? undefined) as string | undefined,
    helperName: (r.helperName ?? undefined) as string | undefined,
    rating: (r.rating ?? undefined) as number | undefined,
    restrictedSite: Boolean(r.restrictedSite),
    arrivedAt: (r.arrivedAt as Date | null)?.toISOString(),
    acceptance: (r.acceptanceJson ?? undefined) as OrderRecord['acceptance'],
    acceptanceRequest: (r.acceptanceRequestJson ?? undefined) as OrderRecord['acceptanceRequest'],
    acceptanceCode: (r.acceptanceCode ?? undefined) as string | undefined,
    addressDetails: (r.addressDetailsJson ?? undefined) as OrderRecord['addressDetails'],
    payment: (r.paymentJson ?? undefined) as OrderRecord['payment'],
    tipTiyin: num(r.tipTiyin),
    baseFromTiyin: num(r.baseFromTiyin),
    baseToTiyin: num(r.baseToTiyin),
    totalFromTiyin: num(r.totalFromTiyin),
    totalToTiyin: num(r.totalToTiyin),
    totalMaterialTiyin: num(r.totalMaterialTiyin),
    promoDiscountPercent: num(r.promoDiscountPercent),
    urgentSurchargePercent: num(r.urgentSurchargePercent),
    preferredMasterId: (r.preferredMasterId ?? undefined) as string | undefined,
    slaDueAt: (r.slaDueAt as Date | null)?.toISOString(),
    rescheduleCount: num(r.rescheduleCount),
    requestedWindow: (r.requestedWindowJson ?? undefined) as OrderRecord['requestedWindow'],
    commonAreaAccess: (r.commonAreaAccessJson ?? undefined) as OrderRecord['commonAreaAccess'],
    lines: rows<Record<string, unknown>>(r.lines).map((l) => ({
      priceItemId: l.priceItemId as string,
      name: l.nameCopy as string,
      unit: l.unitCopy as string,
      priceFromTiyin: num(l.priceFromTiyinCopy),
      priceToTiyin: num(l.priceToTiyinCopy),
      qty: num(l.qty),
    })),
    quotes: rows<Record<string, unknown>>(r.quotes).map((q) => ({
      kind: q.kind as never,
      amountTiyin: num(q.amountTiyin),
      approvedVia: (q.approvedVia ?? undefined) as string | undefined,
      note: (q.note ?? undefined) as string | undefined,
      at: (q.createdAt as Date).toISOString(),
    })),
    photos: rows<Record<string, unknown>>(r.photos).map((ph) => ({
      id: ph.id as string,
      stage: ph.stage as never,
      source: (ph.source ?? '') as string,
      file: (ph.s3Key ?? undefined) as string | undefined,
      geoMissing: Boolean(ph.geoMissing),
      at: (ph.createdAt as Date).toISOString(),
    })),
    materials: rows<Record<string, unknown>>(r.materials).map((m) => ({
      kind: m.kind as never,
      name: m.name as string,
      amountTiyin: num(m.amountTiyin),
      sourceChannel: m.sourceChannel as never,
      hasReceipt: Boolean(m.hasReceipt),
      priceTier: (m.priceTier ?? undefined) as never,
      at: (m.createdAt as Date).toISOString(),
    })),
    statusLog: rows<Record<string, unknown>>(r.statusLog).map((l) => ({
      from: (l.fromStatus ?? null) as OrderStatus | null,
      to: l.toStatus as OrderStatus,
      action: l.action as string,
      actorPhone: (l.actorPhone ?? undefined) as string | undefined,
      reason: (l.reason ?? undefined) as string | undefined,
      clientOpUuid: (l.clientUuid ?? undefined) as string | undefined,
      at: l.createdAt as Date,
    })),
    createdAt: (r.createdAt as Date).toISOString(),
    // Приведение через unknown: собранный объект шире записи на служебные
    // поля Prisma, и точечно перечислять их значило бы дублировать модель
  } as unknown as OrderRecord;
}
