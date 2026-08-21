import { BadRequestException, Body, Controller, Get, Injectable, Module, NotFoundException, Param, Post, Req, UseGuards, OnModuleInit } from '@nestjs/common';
import { uuidv7 } from '@sozo/kernel';
import { AuthGuard, Roles } from '../identity/auth.guard';
import { AuditService } from '../platform/audit.service';
import { EventBus } from '../../common/event-bus';
import { StateStore } from '../../common/state-store';
import { PrismaService } from '../../common/prisma.service';
import { PgMirror } from '../../common/pg-mirror';
import type { JwtClaims } from '../../common/jwt';

/**
 * A-38: внутренний склад — лёгкий контур MVP (ТЗ 17.16).
 * StockMovement — append-only журнал; продажа мастеру публикует событие,
 * billing удерживает сумму из ведомости (≤30% выплаты контролирует выплата).
 */
export interface StockItemRec {
  id: string;
  category: 'special_equipment' | 'tool' | 'consumable' | 'uniform_merch' | 'other';
  name: string;
  unit: string;
  qtyOnHand: number;
  minQty: number;
  costTiyin: number;
}

export interface StockMovementRec {
  id: string;
  stockItemId: string;
  itemName: string;
  type: 'receipt' | 'temp_use' | 'sale_to_master' | 'write_off' | 'return';
  qty: number;
  masterId?: string;
  masterName?: string;
  priceTiyin?: number;
  comment?: string;
  createdAt: string;
}

@Injectable()
export class StockService implements OnModuleInit {
  readonly items: StockItemRec[] = [
    { id: uuidv7(), category: 'uniform_merch', name: 'Футболка SOZO с логотипом', unit: 'шт', qtyOnHand: 40, minQty: 10, costTiyin: 8_000_000 },
    { id: uuidv7(), category: 'consumable', name: 'Перчатки рабочие', unit: 'пара', qtyOnHand: 100, minQty: 20, costTiyin: 1_200_000 },
  ];
  readonly movements: StockMovementRec[] = [];

  private readonly mirror: PgMirror;

  constructor(
    private readonly store: StateStore,
    prisma: PrismaService,
  ) {
    this.store.register(
      'stock',
      () => ({ items: this.items, movements: this.movements }),
      (d) => {
        const data = d as { items: StockItemRec[]; movements: StockMovementRec[] };
        this.items.length = 0;
        this.items.push(...data.items);
        this.movements.length = 0;
        this.movements.push(...data.movements);
      },
    );
    this.mirror = new PgMirror(prisma, 'Stock', {
      load: async (tx) => {
        const [items, movements] = await Promise.all([
          tx.stockItem.findMany(),
          tx.stockMovement.findMany({ orderBy: { createdAt: 'asc' } }),
        ]);
        if (items.length) {
          this.items.length = 0;
          this.items.push(
            ...items.map((x) => ({
              id: x.id,
              category: x.category as StockItemRec['category'],
              name: x.name,
              unit: x.unit,
              qtyOnHand: x.qtyOnHand,
              minQty: x.minQty,
              costTiyin: Number(x.costTiyin),
            })),
          );
        }
        if (movements.length) {
          this.movements.length = 0;
          this.movements.push(
            ...movements.map((m) => ({
              id: m.id,
              stockItemId: m.stockItemId,
              itemName: m.itemName,
              type: m.type as StockMovementRec['type'],
              qty: m.qty,
              masterId: m.masterId ?? undefined,
              masterName: m.masterName ?? undefined,
              priceTiyin: m.priceTiyin === null ? undefined : Number(m.priceTiyin),
              comment: m.comment ?? undefined,
              createdAt: m.createdAt.toISOString(),
            })),
          );
        }
        return items.length + movements.length;
      },
      save: async (tx, tenantId) => {
        for (const x of this.items) {
          const data = {
            category: x.category, name: x.name, unit: x.unit,
            qtyOnHand: x.qtyOnHand, minQty: x.minQty, costTiyin: BigInt(x.costTiyin),
          };
          await tx.stockItem.upsert({ where: { id: x.id }, create: { id: x.id, tenantId, ...data }, update: data });
        }
        // Движения append-only: остаток считается из них, и правка задним
        // числом означала бы, что склад сходится только на бумаге
        for (const m of this.movements) {
          await tx.stockMovement.upsert({
            where: { id: m.id },
            create: {
              id: m.id, tenantId, stockItemId: m.stockItemId, itemName: m.itemName,
              type: m.type, qty: m.qty, masterId: m.masterId ?? null, masterName: m.masterName ?? null,
              priceTiyin: m.priceTiyin === undefined ? null : BigInt(m.priceTiyin),
              comment: m.comment ?? null, createdAt: new Date(m.createdAt),
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

  touch(): void {
    this.store.persist();
  }

  item(id: string): StockItemRec {
    const i = this.items.find((x) => x.id === id);
    if (!i) throw new NotFoundException({ code: 'STOCK_ITEM_NOT_FOUND' });
    return i;
  }
}

@Controller('admin/stock')
@UseGuards(AuthGuard)
export class StockController {
  constructor(
    private readonly stock: StockService,
    private readonly audit: AuditService,
    private readonly bus: EventBus,
  ) {}

  @Get('items')
  @Roles('admin', 'accountant')
  items() {
    return this.stock.items.map((i) => ({ ...i, belowMin: i.qtyOnHand < i.minQty }));
  }

  @Post('items')
  @Roles('admin')
  addItem(@Body() b: any) {
    const rec: StockItemRec = {
      id: uuidv7(),
      category: b.category ?? 'other',
      name: b.name,
      unit: b.unit ?? 'шт',
      qtyOnHand: b.qtyOnHand ?? 0,
      minQty: b.minQty ?? 0,
      costTiyin: b.costTiyin ?? 0,
    };
    this.stock.items.push(rec);
    this.stock.touch();
    return rec;
  }

  @Get('movements')
  @Roles('admin', 'accountant')
  movements() {
    return [...this.stock.movements].reverse();
  }

  /** Движение: приход / продажа мастеру (удержание из ведомости) / списание / возврат */
  @Post('movements')
  @Roles('admin')
  move(@Body() b: { stockItemId: string; type: StockMovementRec['type']; qty: number; masterId?: string; masterName?: string; priceTiyin?: number; comment?: string }, @Req() req: { auth: JwtClaims }) {
    const item = this.stock.item(b.stockItemId);
    if (!b.qty || b.qty <= 0) throw new BadRequestException({ code: 'QTY_NOT_POSITIVE' });
    const outgoing = b.type === 'sale_to_master' || b.type === 'write_off' || b.type === 'temp_use';
    if (outgoing && item.qtyOnHand < b.qty) throw new BadRequestException({ code: 'NOT_ENOUGH_STOCK', message: `На складе ${item.qtyOnHand} ${item.unit}` });
    if (b.type === 'sale_to_master' && (!b.masterId || !b.priceTiyin)) {
      throw new BadRequestException({ code: 'MASTER_AND_PRICE_REQUIRED', message: 'Продажа мастеру: нужны мастер и цена' });
    }
    item.qtyOnHand += outgoing ? -b.qty : b.qty;
    const rec: StockMovementRec = {
      id: uuidv7(),
      stockItemId: item.id,
      itemName: item.name,
      type: b.type,
      qty: b.qty,
      masterId: b.masterId,
      masterName: b.masterName,
      priceTiyin: b.priceTiyin,
      comment: b.comment,
      createdAt: new Date().toISOString(),
    };
    this.stock.movements.push(rec);
    this.stock.touch();
    if (b.type === 'sale_to_master') {
      this.bus.publish('stock.sold_to_master', {
        masterId: b.masterId,
        masterName: b.masterName ?? '',
        amountTiyin: b.priceTiyin! * b.qty,
        itemName: `${item.name} × ${b.qty}`,
      });
    }
    this.audit.write({ actorPhone: req.auth.phone, action: `stock.${b.type}`, entity: 'StockItem', entityId: item.id, payload: { qty: b.qty } });
    return rec;
  }
}

@Module({
  controllers: [StockController],
  providers: [StockService],
})
export class StockModule {}
