import { Body, Controller, Get, Injectable, Module, NotFoundException, Param, Post, Put, UseGuards, OnModuleInit } from '@nestjs/common';
import { uuidv7 } from '@sozo/kernel';
import { AuthGuard, Roles } from '../identity/auth.guard';
import { StateStore } from '../../common/state-store';
import { PrismaService } from '../../common/prisma.service';
import { PgMirror } from '../../common/pg-mirror';

/** registry: активы и справочники — A-13 оборудование, A-14 магазины, A-23 расходники, A-30 причины */

export interface EquipmentRec {
  id: string;
  inventoryNumber: string;
  name: string;
  costTiyin: number;
  status: 'in_stock' | 'issued' | 'maintenance' | 'written_off';
  issuedToMasterId?: string;
  issuedToMasterName?: string;
  nextMaintenanceAt?: string;
}

export interface PartnerStoreRec {
  id: string;
  name: string;
  categories: string[];
  creditLimitTiyin: number;
  payableTiyin: number;
  status: 'active' | 'paused';
}

export interface ConsumableRec {
  id: string;
  name: string;
  unit: string;
  fixPriceTiyin: number; // фикс-прайс «сумки»: без чека, вся сумма мастеру (ТЗ 8.4)
  normPerOrder?: string;
}

@Injectable()
export class RegistryService implements OnModuleInit {
  readonly equipment: EquipmentRec[] = [
    { id: uuidv7(), inventoryNumber: 'EQ-0001', name: 'Перфоратор Bosch GBH 2-26', costTiyin: 250_000_000, status: 'in_stock' },
    { id: uuidv7(), inventoryNumber: 'EQ-0002', name: 'Течеискатель', costTiyin: 180_000_000, status: 'in_stock' },
  ];
  readonly stores: PartnerStoreRec[] = [
    { id: uuidv7(), name: 'Стройбаза «Куйлюк» (демо)', categories: ['сантехника', 'электрика'], creditLimitTiyin: 500_000_000, payableTiyin: 0, status: 'active' },
  ];
  readonly consumables: ConsumableRec[] = [
    { id: uuidv7(), name: 'Лён сантехнический', unit: 'упак', fixPriceTiyin: 1_500_000 },
    { id: uuidv7(), name: 'Фум-лента', unit: 'шт', fixPriceTiyin: 800_000 },
    { id: uuidv7(), name: 'Изолента', unit: 'шт', fixPriceTiyin: 1_000_000 },
    { id: uuidv7(), name: 'Клеммы Wago (компл.)', unit: 'компл', fixPriceTiyin: 2_500_000 },
  ];
  /** A-24: запчасти с вилками эконом/стандарт/премиум (порог 200 000, ТЗ 8.4.3) */
  readonly spareParts: Array<{ id: string; name: string; unit: string; economTiyin: number; standardTiyin: number; premiumTiyin: number }> = [
    { id: uuidv7(), name: 'Смеситель кухонный', unit: 'шт', economTiyin: 25_000_000, standardTiyin: 45_000_000, premiumTiyin: 90_000_000 },
    { id: uuidv7(), name: 'Автомат 16А', unit: 'шт', economTiyin: 3_500_000, standardTiyin: 6_000_000, premiumTiyin: 12_000_000 },
    { id: uuidv7(), name: 'Шаровой кран 1/2"', unit: 'шт', economTiyin: 4_000_000, standardTiyin: 7_500_000, premiumTiyin: 15_000_000 },
  ];
  /** A-29: зоны и города (city_id с первого дня, ТЗ 17.4) */
  readonly zones: Array<{ id: string; city: string; name: string; active: boolean }> = [
    { id: uuidv7(), city: 'Ташкент', name: 'Чиланзар', active: true },
    { id: uuidv7(), city: 'Ташкент', name: 'Юнусабад', active: true },
    { id: uuidv7(), city: 'Ташкент', name: 'Мирзо-Улугбек', active: true },
    { id: uuidv7(), city: 'Ташкент', name: 'Яккасарай', active: true },
    { id: uuidv7(), city: 'Ташкент', name: 'Сергели', active: false },
  ];
  /** A-30: типы жалоб + SLA (ТЗ 17.10) */
  readonly complaintTypes: Array<{ type: string; slaFirstResponseH: number; slaResolutionH: number }> = [
    { type: 'Качество работ', slaFirstResponseH: 2, slaResolutionH: 24 },
    { type: 'Поведение мастера', slaFirstResponseH: 2, slaResolutionH: 24 },
    { type: 'Сроки', slaFirstResponseH: 2, slaResolutionH: 24 },
    { type: 'Деньги (→ спор)', slaFirstResponseH: 2, slaResolutionH: 72 },
    { type: 'Сервис и диспетчер', slaFirstResponseH: 2, slaResolutionH: 24 },
    { type: 'Приложение', slaFirstResponseH: 2, slaResolutionH: 72 },
  ];
  /** A-29a: ставки сум/м² по типам объектов — источник калькулятора абонентки (ТЗ 17.2) */
  readonly objectTypeRates: Array<{ id: string; objectType: string; ratePerM2Tiyin: number; typicalAreaM2: number }> = [
    { id: uuidv7(), objectType: 'Офис', ratePerM2Tiyin: 1_500_000, typicalAreaM2: 100 },
    { id: uuidv7(), objectType: 'Аптека / магазин', ratePerM2Tiyin: 2_000_000, typicalAreaM2: 80 },
    { id: uuidv7(), objectType: 'Кафе / салон', ratePerM2Tiyin: 2_500_000, typicalAreaM2: 120 },
    { id: uuidv7(), objectType: 'Ресторан / гостиница', ratePerM2Tiyin: 3_000_000, typicalAreaM2: 250 },
  ];
  /** A-28: производственный календарь РУз (ТЗ 14) — деловые таймеры «замерзают» в праздники */
  readonly holidays: Array<{ date: string; name: string }> = [
    { date: '2026-01-01', name: 'Новый год' },
    { date: '2026-03-08', name: 'Международный женский день' },
    { date: '2026-03-21', name: 'Навруз' },
    { date: '2026-05-27', name: 'Курбан-байрам (уточняется)' },
    { date: '2026-09-01', name: 'День независимости' },
    { date: '2026-10-01', name: 'День учителя' },
    { date: '2026-12-08', name: 'День Конституции' },
  ];
  /** A-27: ToolChecklist — неполный набор = временное снятие skill-тега (ТЗ 8.4.1) */
  readonly toolChecklists: Array<{ skill: string; tools: string[] }> = [
    { skill: 'сантехника', tools: ['Разводной ключ', 'Труборез', 'Паяльник ПП', 'Течеискатель (компания)', 'Фонарь'] },
    { skill: 'электрика', tools: ['Мультиметр', 'Индикаторная отвёртка', 'Стриппер', 'Набор отвёрток диэлектр.', 'Клеммы'] },
    { skill: 'кондиционеры', tools: ['Манометрический коллектор', 'Вакуумный насос (компания)', 'Течеискатель фреона', 'Динамометрический ключ'] },
  ];
  /** A-26: чек-листы плановых осмотров по типам объектов (ТЗ 9.3) */
  readonly inspectionChecklists: Array<{ objectType: string; items: string[] }> = [
    {
      objectType: 'универсальный',
      items: [
        'Сантехника: краны, соединения, бачки — на течи',
        'Щиток: протяжка контактов, следы нагрева',
        'Лампы: перегоревшие заменить (лампы клиента)',
        'Кондиционеры: чистка фильтров (в сезон)',
        'Вентиляция: осмотр решёток и тяги',
        'Двери/окна/замки: петли, доводчики, уплотнители',
        'Мелкий крепёж: полки, поручни, плинтусы',
        'Фотоотчёт о состоянии объекта',
      ],
    },
  ];

  private readonly mirror: PgMirror;

  constructor(
    private readonly store: StateStore,
    prisma: PrismaService,
  ) {
    this.store.register(
      'registry',
      () => ({ equipment: this.equipment, stores: this.stores, consumables: this.consumables, spareParts: this.spareParts, zones: this.zones }),
      (d) => {
        const data = d as Record<string, unknown[]>;
        const apply = (target: unknown[], src?: unknown[]) => {
          if (!src) return;
          target.length = 0;
          target.push(...src);
        };
        apply(this.equipment, data.equipment);
        apply(this.stores, data.stores);
        apply(this.consumables, data.consumables);
        apply(this.spareParts, data.spareParts);
        apply(this.zones, data.zones);
      },
    );
    this.mirror = new PgMirror(prisma, 'Registry', {
      load: async (tx) => {
        const [equipment, stores, consumables, spares, zones] = await Promise.all([
          tx.equipmentUnit.findMany(),
          tx.partnerStore.findMany(),
          tx.consumableCatalog.findMany(),
          tx.sparePartCatalog.findMany(),
          tx.serviceZone.findMany(),
        ]);
        const apply = <T>(target: T[], src: T[]) => {
          if (!src.length) return;
          target.length = 0;
          target.push(...src);
        };
        apply(this.equipment, equipment.map((e) => ({
          id: e.id,
          inventoryNumber: e.inventoryNo,
          name: e.name,
          costTiyin: Number(e.costTiyin),
          status: e.status as EquipmentRec['status'],
          issuedToMasterId: e.holderMasterId ?? undefined,
          issuedToMasterName: e.holderMasterName ?? undefined,
          nextMaintenanceAt: e.nextMaintenanceAt?.toISOString(),
        })));
        apply(this.stores, stores.map((x) => ({
          id: x.id,
          name: x.name,
          categories: x.categories,
          creditLimitTiyin: Number(x.creditLimitTiyin),
          payableTiyin: Number(x.payableTiyin),
          status: x.status as PartnerStoreRec['status'],
        })));
        apply(this.consumables, consumables.map((x) => ({
          id: x.id,
          name: x.name,
          unit: x.unit,
          fixPriceTiyin: Number(x.fixPriceTiyin),
          normPerOrder: x.normPerOrder ?? undefined,
        })));
        apply(this.spareParts, spares.map((x) => ({
          id: x.id,
          name: x.name,
          unit: x.unit,
          economTiyin: Number(x.economTiyin),
          standardTiyin: Number(x.standardTiyin),
          premiumTiyin: Number(x.premiumTiyin),
        })));
        apply(this.zones, zones.map((x) => ({ id: x.id, city: x.city, name: x.name, active: x.active })));
        return equipment.length + stores.length + consumables.length + spares.length + zones.length;
      },
      save: async (tx, tenantId) => {
        for (const e of this.equipment) {
          const data = {
            inventoryNo: e.inventoryNumber,
            name: e.name,
            costTiyin: BigInt(e.costTiyin),
            // Состояния сведены при проектировании: repair и maintenance —
            // одно и то же (DEV-19 §3.1)
            status: e.status === 'written_off' ? 'written_off' : e.status,
            holderMasterId: e.issuedToMasterId ?? null,
            holderMasterName: e.issuedToMasterName ?? null,
            issuedAt: e.issuedToMasterId ? new Date() : null,
            nextMaintenanceAt: e.nextMaintenanceAt ? new Date(e.nextMaintenanceAt) : null,
          };
          await tx.equipmentUnit.upsert({ where: { id: e.id }, create: { id: e.id, tenantId, ...data }, update: data });
        }
        for (const x of this.stores) {
          const data = {
            name: x.name,
            categories: x.categories,
            creditLimitTiyin: BigInt(x.creditLimitTiyin),
            payableTiyin: BigInt(x.payableTiyin),
            status: x.status,
          };
          await tx.partnerStore.upsert({ where: { id: x.id }, create: { id: x.id, tenantId, ...data }, update: data });
        }
        for (const x of this.consumables) {
          const data = { name: x.name, unit: x.unit, fixPriceTiyin: BigInt(x.fixPriceTiyin), normPerOrder: x.normPerOrder ?? null };
          await tx.consumableCatalog.upsert({ where: { id: x.id }, create: { id: x.id, tenantId, ...data }, update: data });
        }
        for (const x of this.spareParts) {
          const data = {
            name: x.name, unit: x.unit,
            economTiyin: BigInt(x.economTiyin),
            standardTiyin: BigInt(x.standardTiyin),
            premiumTiyin: BigInt(x.premiumTiyin),
          };
          await tx.sparePartCatalog.upsert({ where: { id: x.id }, create: { id: x.id, tenantId, ...data }, update: data });
        }
        for (const x of this.zones) {
          const data = { city: x.city, name: x.name, active: x.active };
          await tx.serviceZone.upsert({ where: { id: x.id }, create: { id: x.id, tenantId, ...data }, update: data });
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

  touch(): void {
    this.store.persist();
  }

  readonly cancelReasons: string[] = [
    'Клиент отменил (>2 ч до окна)',
    'Клиент отменил (<2 ч — ложный вызов)',
    'Клиент недоступен на месте',
    'Нет доступа: третья сторона',
    'Дубль заявки',
    'Вне зоны покрытия',
    'Не согласована смета',
    'Молчание утверждающего (T+72)',
  ];
}

@Controller('admin/registry')
@UseGuards(AuthGuard)
export class RegistryController {
  constructor(private readonly reg: RegistryService) {}

  @Get('equipment')
  @Roles('admin', 'accountant')
  equipment() {
    return this.reg.equipment;
  }

  @Post('equipment')
  @Roles('admin')
  addEquipment(@Body() b: { inventoryNumber: string; name: string; costTiyin: number }) {
    const rec: EquipmentRec = { id: uuidv7(), inventoryNumber: b.inventoryNumber, name: b.name, costTiyin: b.costTiyin, status: 'in_stock' };
    this.reg.equipment.push(rec);
    this.reg.touch();
    return rec;
  }

  @Put('equipment/:id')
  @Roles('admin')
  updateEquipment(@Param('id') id: string, @Body() patch: Partial<EquipmentRec>) {
    const rec = this.reg.equipment.find((e) => e.id === id);
    if (!rec) throw new NotFoundException({ code: 'EQUIPMENT_NOT_FOUND' });
    Object.assign(rec, patch);
    this.reg.touch();
    return rec;
  }

  @Get('stores')
  @Roles('admin', 'accountant')
  stores() {
    return this.reg.stores;
  }

  @Post('stores')
  @Roles('admin')
  addStore(@Body() b: { name: string; categories?: string[]; creditLimitTiyin?: number }) {
    const rec: PartnerStoreRec = { id: uuidv7(), name: b.name, categories: b.categories ?? [], creditLimitTiyin: b.creditLimitTiyin ?? 0, payableTiyin: 0, status: 'active' };
    this.reg.stores.push(rec);
    this.reg.touch();
    return rec;
  }

  @Get('consumables')
  @Roles('admin', 'accountant')
  consumables() {
    return this.reg.consumables;
  }

  @Post('consumables')
  @Roles('admin')
  addConsumable(@Body() b: { name: string; unit: string; fixPriceTiyin: number }) {
    const rec: ConsumableRec = { id: uuidv7(), name: b.name, unit: b.unit, fixPriceTiyin: b.fixPriceTiyin };
    this.reg.consumables.push(rec);
    this.reg.touch();
    return rec;
  }

  @Get('cancel-reasons')
  @Roles('admin', 'accountant')
  cancelReasons() {
    return this.reg.cancelReasons;
  }

  @Get('spare-parts')
  @Roles('admin', 'accountant')
  spareParts() {
    return this.reg.spareParts;
  }

  @Post('spare-parts')
  @Roles('admin')
  addSparePart(@Body() b: any) {
    const rec = { id: uuidv7(), name: b.name, unit: b.unit ?? 'шт', economTiyin: b.economTiyin ?? 0, standardTiyin: b.standardTiyin ?? 0, premiumTiyin: b.premiumTiyin ?? 0 };
    this.reg.spareParts.push(rec);
    this.reg.touch();
    return rec;
  }

  @Get('zones')
  @Roles('admin', 'accountant')
  zones() {
    return this.reg.zones;
  }

  @Post('zones')
  @Roles('admin')
  addZone(@Body() b: any) {
    const rec = { id: uuidv7(), city: b.city ?? 'Ташкент', name: b.name, active: b.active ?? false };
    this.reg.zones.push(rec);
    this.reg.touch();
    return rec;
  }

  @Get('complaint-types')
  @Roles('admin', 'accountant')
  complaintTypes() {
    return this.reg.complaintTypes;
  }

  @Get('object-type-rates')
  @Roles('admin', 'accountant')
  objectTypeRates() {
    return this.reg.objectTypeRates;
  }

  @Get('holidays')
  @Roles('admin', 'accountant')
  holidays() {
    return this.reg.holidays;
  }

  @Get('tool-checklists')
  @Roles('admin', 'accountant')
  toolChecklists() {
    return this.reg.toolChecklists;
  }

  @Get('inspection-checklists')
  @Roles('admin', 'accountant')
  inspectionChecklists() {
    return this.reg.inspectionChecklists;
  }
}

@Module({
  controllers: [RegistryController],
  providers: [RegistryService],
  exports: [RegistryService],
})
export class RegistryModule {}
