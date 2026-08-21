import { BadRequestException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { uuidv7 } from '@sozo/kernel';
import { StateStore } from '../../common/state-store';
import { PrismaService } from '../../common/prisma.service';
import { PgMirror } from '../../common/pg-mirror';
import { tr } from '../../common/locale';

/**
 * Ресурсы мастера: сумка расходников (M-36, F-51), код закупки в долг компании
 * (M-22, F-32) и оборудование компании с актами (M-37/M-38, F-52).
 *
 * Все три про одно: чем мастер физически располагает на выезде и кто за это отвечает
 * деньгами. Поэтому и живут вместе.
 */

/** Норматив остатка расходника по навыку: ниже — предупреждение (ТЗ 8.4.2) */
export const CONSUMABLE_CATALOG = [
  { id: 'c1', name: 'Лента ФУМ', unit: 'шт', costTiyin: 800_000, priceTiyin: 1_200_000, skill: 'сантехника', minStock: 5 },
  { id: 'c2', name: 'Прокладка резиновая', unit: 'шт', costTiyin: 200_000, priceTiyin: 400_000, skill: 'сантехника', minStock: 20 },
  { id: 'c3', name: 'Силиконовый герметик', unit: 'туба', costTiyin: 2_500_000, priceTiyin: 3_500_000, skill: 'сантехника', minStock: 2 },
  { id: 'c4', name: 'Клеммник Wago', unit: 'шт', costTiyin: 300_000, priceTiyin: 500_000, skill: 'электрика', minStock: 20 },
  { id: 'c5', name: 'Изолента', unit: 'шт', costTiyin: 500_000, priceTiyin: 800_000, skill: 'электрика', minStock: 5 },
  { id: 'c6', name: 'Гофра 16 мм', unit: 'м', costTiyin: 150_000, priceTiyin: 250_000, skill: 'электрика', minStock: 10 },
  { id: 'c7', name: 'Фреон R32 (дозаправка)', unit: 'кг', costTiyin: 9_000_000, priceTiyin: 13_000_000, skill: 'кондиционеры', minStock: 1 },
] as const;

/** Каталог запчастей: поиск вместо свободного текста (ТЗ 17.17 п.5) */
export const SPARE_PART_CATALOG = [
  { id: 's1', name: 'Картридж смесителя 35 мм', category: 'сантехника', economyTiyin: 4_000_000, standardTiyin: 8_500_000, premiumTiyin: 16_000_000 },
  { id: 's2', name: 'Гибкая подводка 1/2', category: 'сантехника', economyTiyin: 1_500_000, standardTiyin: 3_000_000, premiumTiyin: 6_000_000 },
  { id: 's3', name: 'Насос циркуляционный', category: 'отопление', economyTiyin: 32_000_000, standardTiyin: 45_000_000, premiumTiyin: 78_000_000 },
  { id: 's4', name: 'Автомат 16А', category: 'электрика', economyTiyin: 2_000_000, standardTiyin: 4_500_000, premiumTiyin: 9_000_000 },
  { id: 's5', name: 'ТЭН для бойлера', category: 'бойлеры', economyTiyin: 12_000_000, standardTiyin: 22_000_000, premiumTiyin: 38_000_000 },
  { id: 's6', name: 'Плата управления котла', category: 'отопление', economyTiyin: 60_000_000, standardTiyin: 110_000_000, premiumTiyin: 190_000_000 },
] as const;

export const PARTNER_STORES = [
  { id: 'p1', name: 'Сантехмир', address: 'Чиланзар, ул. Бунёдкор 12', categories: ['сантехника', 'отопление'] },
  { id: 'p2', name: 'ЭлектроДом', address: 'Юнусабад, ул. Амира Темура 88', categories: ['электрика'] },
  { id: 'p3', name: 'КлиматСервис', address: 'Мирзо-Улугбек, ул. Мустакиллик 4', categories: ['кондиционеры'] },
] as const;

/** Код закупки живёт 4 часа и покрывает бюджет +10% (ТЗ 8.4) */
export const PURCHASE_CODE_TTL_HOURS = 4;
export const PURCHASE_CODE_HEADROOM_PERCENT = 10;

export interface StockItemRec {
  masterId: string;
  catalogId: string;
  qty: number;
  updatedAt: string;
}

export interface StockRefillRec {
  id: string;
  masterId: string;
  items: Array<{ catalogId: string; qty: number; costTiyin: number }>;
  receiptFile?: string;
  totalTiyin: number;
  at: string;
}

export interface PurchaseCodeRec {
  id: string;
  code: string;
  orderId: string;
  masterId: string;
  limitTiyin: number;
  status: 'active' | 'used' | 'expired';
  invoice?: { file: string; items: Array<{ name: string; amountTiyin: number }>; totalTiyin: number; at: string };
  createdAt: string;
  expiresAt: string;
}

export interface EquipmentRec {
  id: string;
  inventoryNo: string;
  name: string;
  category: string;
  requiredSkill?: string;
  status: 'in_stock' | 'issued' | 'repair' | 'lost';
  holderMasterId?: string;
  issuedAt?: string;
  photoFile?: string;
}

export interface EquipmentActRec {
  id: string;
  equipmentId: string;
  masterId: string;
  kind: 'issue' | 'return';
  photos: string[];
  completeness: Array<{ item: string; ok: boolean }>;
  discrepancy?: string;
  confirmCode: string;
  confirmed: boolean;
  at: string;
}

@Injectable()
export class ResourcesService implements OnModuleInit {
  readonly stock: StockItemRec[] = [];
  readonly refills: StockRefillRec[] = [];
  readonly purchaseCodes: PurchaseCodeRec[] = [];
  readonly equipment: EquipmentRec[] = [
    { id: uuidv7(), inventoryNo: 'EQ-0001', name: 'Пресс-инструмент REMS', category: 'сантехника', requiredSkill: 'сантехника', status: 'in_stock' },
    { id: uuidv7(), inventoryNo: 'EQ-0002', name: 'Вакуумный насос', category: 'кондиционеры', requiredSkill: 'кондиционеры', status: 'in_stock' },
    { id: uuidv7(), inventoryNo: 'EQ-0003', name: 'Тепловизор', category: 'диагностика', status: 'in_stock' },
  ];
  readonly acts: EquipmentActRec[] = [];

  private readonly mirror: PgMirror;

  constructor(
    private readonly store: StateStore,
    prisma: PrismaService,
  ) {
    this.store.register(
      'masterResources',
      () => ({
        stock: this.stock,
        refills: this.refills.slice(-500),
        purchaseCodes: this.purchaseCodes.slice(-500),
        equipment: this.equipment,
        acts: this.acts.slice(-500),
      }),
      (d) => {
        const data = d as Record<string, unknown[]>;
        const fill = <T>(t: T[], s: unknown[] | undefined) => {
          if (!s) return;
          t.length = 0;
          t.push(...(s as T[]));
        };
        fill(this.stock, data.stock);
        fill(this.refills, data.refills);
        fill(this.purchaseCodes, data.purchaseCodes);
        fill(this.equipment, data.equipment);
        fill(this.acts, data.acts);
      },
    );
    this.mirror = new PgMirror(prisma, 'MasterResources', {
      load: async (tx) => {
        const [stock, refills, codes, equipment, acts] = await Promise.all([
          tx.masterStock.findMany(),
          tx.masterStockRefill.findMany({ include: { items: true }, orderBy: { at: 'asc' } }),
          tx.purchaseCode.findMany({ include: { invoiceItems: true }, orderBy: { createdAt: 'asc' } }),
          tx.equipmentUnit.findMany(),
          tx.equipmentAct.findMany({ include: { completeness: true }, orderBy: { at: 'asc' } }),
        ]);
        const fill = <T>(t: T[], src: T[]) => {
          if (!src.length) return;
          t.length = 0;
          t.push(...src);
        };
        fill(this.stock, stock.map((x) => ({
          masterId: x.masterId, catalogId: x.catalogId, qty: x.qty, updatedAt: x.updatedAt.toISOString(),
        })));
        fill(this.refills, refills.map((r) => ({
          id: r.id, masterId: r.masterId,
          items: r.items.map((i) => ({ catalogId: i.catalogId, qty: i.qty, costTiyin: Number(i.costTiyin) })),
          receiptFile: r.receiptFile ?? undefined,
          totalTiyin: Number(r.totalTiyin), at: r.at.toISOString(),
        })));
        fill(this.purchaseCodes, codes.map((c) => ({
          id: c.id, code: c.code, orderId: c.orderId, masterId: c.masterId,
          limitTiyin: Number(c.limitTiyin), status: c.status as PurchaseCodeRec['status'],
          invoice: c.invoiceFile
            ? {
                file: c.invoiceFile,
                items: c.invoiceItems.map((i) => ({ name: i.name, amountTiyin: Number(i.amountTiyin) })),
                totalTiyin: Number(c.invoiceTotalTiyin ?? 0),
                at: (c.invoiceAt ?? c.createdAt).toISOString(),
              }
            : undefined,
          createdAt: c.createdAt.toISOString(), expiresAt: c.expiresAt.toISOString(),
        })));
        // Оборудование — общая таблица с реестром платформы (DEV-19 §3.1)
        fill(this.equipment, equipment.map((e) => ({
          id: e.id, inventoryNo: e.inventoryNo, name: e.name, category: e.category,
          requiredSkill: e.requiredSkill ?? undefined,
          status: (e.status === 'maintenance' ? 'repair' : e.status) as EquipmentRec['status'],
          holderMasterId: e.holderMasterId ?? undefined,
          issuedAt: e.issuedAt?.toISOString(),
          photoFile: e.photoFile ?? undefined,
        })));
        fill(this.acts, acts.map((a) => ({
          id: a.id, equipmentId: a.equipmentId, masterId: a.masterId,
          kind: a.kind as EquipmentActRec['kind'], photos: a.photos,
          completeness: a.completeness.map((c) => ({ item: c.item, ok: c.ok })),
          discrepancy: a.discrepancy ?? undefined,
          confirmCode: a.confirmCode, confirmed: a.confirmed, at: a.at.toISOString(),
        })));
        return stock.length + refills.length + codes.length + equipment.length + acts.length;
      },
      save: async (tx, tenantId) => {
        for (const x of [...this.stock]) {
          await tx.masterStock.upsert({
            where: { tenantId_masterId_catalogId: { tenantId, masterId: x.masterId, catalogId: x.catalogId } },
            create: { tenantId, masterId: x.masterId, catalogId: x.catalogId, qty: Math.max(0, x.qty) },
            update: { qty: Math.max(0, x.qty) },
          });
        }
        for (const r of [...this.refills]) {
          await tx.masterStockRefill.upsert({
            where: { id: r.id },
            create: {
              id: r.id, tenantId, masterId: r.masterId, receiptFile: r.receiptFile ?? null,
              totalTiyin: BigInt(Math.max(0, r.totalTiyin)), at: new Date(r.at),
            },
            update: {},
          });
          await tx.masterStockRefillItem.deleteMany({ where: { refillId: r.id } });
          for (const i of r.items) {
            await tx.masterStockRefillItem.create({
              data: {
                id: uuidv7(), refillId: r.id, catalogId: i.catalogId,
                qty: Math.max(1, i.qty), costTiyin: BigInt(Math.max(0, i.costTiyin)),
              },
            });
          }
        }
        for (const c of [...this.purchaseCodes]) {
          const data = {
            code: c.code, orderId: c.orderId, masterId: c.masterId,
            limitTiyin: BigInt(Math.max(1, c.limitTiyin)), status: c.status,
            // CHECK в m26: накладная либо есть целиком, либо её нет
            invoiceFile: c.invoice?.file ?? null,
            invoiceTotalTiyin: c.invoice ? BigInt(Math.max(0, c.invoice.totalTiyin)) : null,
            invoiceAt: c.invoice ? new Date(c.invoice.at) : null,
            expiresAt: new Date(c.expiresAt),
          };
          await tx.purchaseCode.upsert({
            where: { id: c.id },
            create: { id: c.id, tenantId, createdAt: new Date(c.createdAt), ...data },
            update: data,
          });
          await tx.purchaseInvoiceItem.deleteMany({ where: { purchaseCodeId: c.id } });
          for (const i of c.invoice?.items ?? []) {
            await tx.purchaseInvoiceItem.create({
              data: { id: uuidv7(), purchaseCodeId: c.id, name: i.name, amountTiyin: BigInt(Math.max(0, i.amountTiyin)) },
            });
          }
        }
        for (const e of [...this.equipment]) {
          const data = {
            inventoryNo: e.inventoryNo, name: e.name, category: e.category,
            requiredSkill: e.requiredSkill ?? null,
            // Состояния сведены при проектировании: repair и maintenance —
            // одно и то же (DEV-19 §3.1)
            status: e.status === 'repair' ? 'maintenance' : e.status,
            holderMasterId: e.holderMasterId ?? null,
            // CHECK в m29: выданное оборудование знает, у кого и с какого дня
            issuedAt: e.holderMasterId ? new Date(e.issuedAt ?? new Date().toISOString()) : null,
            photoFile: e.photoFile ?? null,
          };
          // Ключ — инвентарный номер, а не идентификатор строки.
          //
          // Таблица одна на два модуля (DEV-19 §3.1), и у каждого свой набор
          // в памяти со своими uuid. Upsert по id заводил бы вторую строку на
          // тот же перфоратор и падал на уникальности инвентарного номера —
          // что и происходило: 62 неудачные записи за прогон. Номер и есть
          // то, чем эта вещь опознаётся в жизни.
          await tx.equipmentUnit.upsert({
            where: { tenantId_inventoryNo: { tenantId, inventoryNo: data.inventoryNo } },
            create: { id: e.id, tenantId, ...data },
            update: data,
          });
        }
        for (const a of [...this.acts]) {
          const data = {
            equipmentId: a.equipmentId, masterId: a.masterId, kind: a.kind, photos: a.photos,
            discrepancy: a.discrepancy ?? null, confirmCode: a.confirmCode,
            confirmed: a.confirmed, at: new Date(a.at),
          };
          await tx.equipmentAct.upsert({ where: { id: a.id }, create: { id: a.id, tenantId, ...data }, update: data });
          await tx.equipmentActItem.deleteMany({ where: { actId: a.id } });
          for (const c of a.completeness) {
            await tx.equipmentActItem.create({ data: { id: uuidv7(), actId: a.id, item: c.item, ok: c.ok } });
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

  // ---------- M-36 Сумка ----------

  /** Остатки с отметкой «ниже норматива»: показываем только по навыкам мастера */
  stockOf(masterId: string, skills: string[]) {
    return CONSUMABLE_CATALOG.filter((c) => skills.includes(c.skill)).map((c) => {
      const rec = this.stock.find((s) => s.masterId === masterId && s.catalogId === c.id);
      const qty = rec?.qty ?? 0;
      return {
        catalogId: c.id,
        name: c.name,
        unit: c.unit,
        skill: c.skill,
        qty,
        minStock: c.minStock,
        belowMin: qty < c.minStock,
        costTiyin: c.costTiyin,
        priceTiyin: c.priceTiyin,
      };
    });
  }

  refillStock(masterId: string, items: Array<{ catalogId: string; qty: number }>, receiptFile?: string): StockRefillRec {
    if (!items.length) throw new BadRequestException({ code: 'ITEMS_REQUIRED' });
    if (!receiptFile) throw new BadRequestException({ code: 'RECEIPT_REQUIRED', message: 'Пополнение зачисляется только по чеку' });
    const lines = items.map((i) => {
      const c = CONSUMABLE_CATALOG.find((x) => x.id === i.catalogId);
      if (!c) throw new BadRequestException({ code: 'CATALOG_UNKNOWN', message: 'Позиция не из каталога расходников' });
      const qty = Math.max(1, Math.round(i.qty));
      const cur = this.stock.find((s) => s.masterId === masterId && s.catalogId === c.id);
      if (cur) {
        cur.qty += qty;
        cur.updatedAt = new Date().toISOString();
      } else {
        this.stock.push({ masterId, catalogId: c.id, qty, updatedAt: new Date().toISOString() });
      }
      return { catalogId: c.id, qty, costTiyin: c.costTiyin * qty };
    });
    const rec: StockRefillRec = {
      id: uuidv7(),
      masterId,
      items: lines,
      receiptFile,
      totalTiyin: lines.reduce((s, l) => s + l.costTiyin, 0),
      at: new Date().toISOString(),
    };
    this.refills.push(rec);
    this.store.persist();
    return rec;
  }

  /** Списание расходника в заявку уменьшает остаток автоматически */
  consume(masterId: string, catalogId: string, qty: number): void {
    const rec = this.stock.find((s) => s.masterId === masterId && s.catalogId === catalogId);
    if (!rec) return;
    rec.qty = Math.max(0, rec.qty - qty);
    rec.updatedAt = new Date().toISOString();
    this.store.persist();
  }

  // ---------- M-22 Код закупки ----------

  issuePurchaseCode(orderId: string, masterId: string, budgetTiyin: number): PurchaseCodeRec {
    // Действующий код на заявку не дублируем — иначе лимит удваивается
    const active = this.purchaseCodes.find((c) => c.orderId === orderId && c.status === 'active' && new Date(c.expiresAt) > new Date());
    if (active) return active;
    const now = Date.now();
    const rec: PurchaseCodeRec = {
      id: uuidv7(),
      code: String(Math.floor(100000 + Math.random() * 900000)),
      orderId,
      masterId,
      limitTiyin: Math.round(budgetTiyin * (1 + PURCHASE_CODE_HEADROOM_PERCENT / 100)),
      status: 'active',
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + PURCHASE_CODE_TTL_HOURS * 3_600_000).toISOString(),
    };
    this.purchaseCodes.push(rec);
    this.store.persist();
    return rec;
  }

  purchaseCodesFor(orderId: string): PurchaseCodeRec[] {
    const now = Date.now();
    for (const c of this.purchaseCodes) {
      if (c.status === 'active' && new Date(c.expiresAt).getTime() < now) c.status = 'expired';
    }
    return this.purchaseCodes.filter((c) => c.orderId === orderId);
  }

  attachInvoice(codeId: string, file: string, items: Array<{ name: string; amountTiyin: number }>): PurchaseCodeRec {
    const c = this.purchaseCodes.find((x) => x.id === codeId);
    if (!c) throw new NotFoundException({ code: 'CODE_NOT_FOUND' });
    if (!items.length) throw new BadRequestException({ code: 'ITEMS_REQUIRED', message: 'Перечислите позиции накладной — диспетчер сверит со сметой' });
    const totalTiyin = items.reduce((s, i) => s + i.amountTiyin, 0);
    if (totalTiyin > c.limitTiyin) {
      throw new BadRequestException({
        code: 'LIMIT_EXCEEDED',
        message: tr('Накладная на {0} сум превышает лимит кода {1} сум', Math.round(totalTiyin / 100), Math.round(c.limitTiyin / 100)),
      });
    }
    c.invoice = { file, items, totalTiyin, at: new Date().toISOString() };
    c.status = 'used';
    this.store.persist();
    return c;
  }

  // ---------- M-37/M-38 Оборудование ----------

  equipmentOf(masterId: string): EquipmentRec[] {
    return this.equipment.filter((e) => e.holderMasterId === masterId);
  }

  availableEquipment(skills: string[]): EquipmentRec[] {
    return this.equipment.filter((e) => e.status === 'in_stock' && (!e.requiredSkill || skills.includes(e.requiredSkill)));
  }

  /**
   * Акт выдачи/возврата. Фото со всех сторон и чек-лист комплектности —
   * это то, чем мастер докажет, что вернул целым, а компания — что выдала целым.
   */
  createAct(data: { equipmentId: string; masterId: string; kind: 'issue' | 'return'; photos: string[]; completeness: Array<{ item: string; ok: boolean }>; discrepancy?: string }): EquipmentActRec {
    const eq = this.equipment.find((e) => e.id === data.equipmentId);
    if (!eq) throw new NotFoundException({ code: 'EQUIPMENT_NOT_FOUND' });
    if (data.photos.length < 4) {
      throw new BadRequestException({ code: 'PHOTOS_REQUIRED', message: tr('Нужно 4 ракурса, снято {0}', data.photos.length) });
    }
    if (data.kind === 'issue' && eq.status !== 'in_stock') {
      throw new BadRequestException({ code: 'NOT_AVAILABLE', message: 'Единица уже выдана или в ремонте' });
    }
    if (data.kind === 'return' && eq.holderMasterId !== data.masterId) {
      throw new BadRequestException({ code: 'NOT_YOURS', message: 'Эта единица за вами не числится' });
    }
    const missing = data.completeness.filter((c) => !c.ok);
    if (missing.length && !data.discrepancy?.trim()) {
      throw new BadRequestException({
        code: 'DISCREPANCY_REQUIRED',
        message: tr('Комплектность неполная ({0}) — опишите расхождение, будет разбор с кладовщиком', missing.map((m) => m.item).join(', ')),
      });
    }
    const rec: EquipmentActRec = {
      id: uuidv7(),
      confirmCode: String(Math.floor(1000 + Math.random() * 9000)),
      confirmed: false,
      at: new Date().toISOString(),
      ...data,
    };
    this.acts.push(rec);
    this.store.persist();
    return rec;
  }

  /** Код одноразовый и серверный — офлайн акт подтвердить нельзя */
  confirmAct(actId: string, code: string): EquipmentActRec {
    const a = this.acts.find((x) => x.id === actId);
    if (!a) throw new NotFoundException({ code: 'ACT_NOT_FOUND' });
    if (a.confirmed) throw new BadRequestException({ code: 'ALREADY_CONFIRMED' });
    if (a.confirmCode !== code) throw new BadRequestException({ code: 'CODE_INVALID', message: 'Неверный код подтверждения' });
    a.confirmed = true;
    const eq = this.equipment.find((e) => e.id === a.equipmentId)!;
    if (a.kind === 'issue') {
      eq.status = 'issued';
      eq.holderMasterId = a.masterId;
      eq.issuedAt = a.at;
      eq.photoFile = a.photos[0];
    } else {
      eq.status = a.discrepancy ? 'repair' : 'in_stock';
      eq.holderMasterId = undefined;
      eq.issuedAt = undefined;
    }
    this.store.persist();
    return a;
  }

  actsFor(masterId: string): EquipmentActRec[] {
    return this.acts.filter((a) => a.masterId === masterId).sort((a, b) => b.at.localeCompare(a.at));
  }
}
