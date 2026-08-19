import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { uuidv7 } from '@sozo/kernel';
import { StateStore } from '../../common/state-store';
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
export class ResourcesService {
  readonly stock: StockItemRec[] = [];
  readonly refills: StockRefillRec[] = [];
  readonly purchaseCodes: PurchaseCodeRec[] = [];
  readonly equipment: EquipmentRec[] = [
    { id: uuidv7(), inventoryNo: 'EQ-0001', name: 'Пресс-инструмент REMS', category: 'сантехника', requiredSkill: 'сантехника', status: 'in_stock' },
    { id: uuidv7(), inventoryNo: 'EQ-0002', name: 'Вакуумный насос', category: 'кондиционеры', requiredSkill: 'кондиционеры', status: 'in_stock' },
    { id: uuidv7(), inventoryNo: 'EQ-0003', name: 'Тепловизор', category: 'диагностика', status: 'in_stock' },
  ];
  readonly acts: EquipmentActRec[] = [];

  constructor(private readonly store: StateStore) {
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
