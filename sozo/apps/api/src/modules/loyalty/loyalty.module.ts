import { BadRequestException, Body, Controller, Get, Injectable, Module, OnModuleInit, Post, Req, UseGuards } from '@nestjs/common';
import { uuidv7 } from '@sozo/kernel';
import { AuthGuard, Roles } from '../identity/auth.guard';
import { AuditService } from '../platform/audit.service';
import { EventBus, type OrderClosedEvent } from '../../common/event-bus';
import { CrmService } from '../crm/crm.service';
import { CrmModule } from '../crm/crm.module';
import { StateStore } from '../../common/state-store';
import { PrismaService } from '../../common/prisma.service';
import { PgMirror } from '../../common/pg-mirror';
import type { JwtClaims } from '../../common/jwt';

/**
 * A-36: программа баллов персонала точек (ТЗ 17.14).
 * Начисление 1% от БАЗЫ работ закрытой B2B-заявки — только если опция включена
 * в договоре организации (иначе коммерческий подкуп). 1 балл = 1 сум.
 * Ваучеры супермаркетов из пула, авто-выдача по FEFO при достижении номинала.
 * Dev-упрощение: заявитель = clientPhone заявки (в проде — applicant_user_id, D-08).
 */
export interface LoyaltyAccount {
  phone: string;
  balanceTiyin: number;
  history: Array<{
    id: string;
    kind: 'accrual' | 'voucher' | 'storno';
    amountTiyin: number;
    note: string;
    /**
     * Заявка, породившая движение.
     *
     * Раньше история писалась без ссылки: начисление нельзя было ни найти по
     * заявке, ни отменить при возврате — вид «сторно» был объявлен в типе и
     * не создавался нигде.
     */
    orderId?: string;
    at: string;
  }>;
}

export interface VoucherRec {
  id: string;
  code: string;
  nominalTiyin: number;
  expiresAt: string; // FEFO — первым выдаётся ближайший к сгоранию
  status: 'free' | 'issued';
  issuedToPhone?: string;
  issuedAt?: string;
}

@Injectable()
export class LoyaltyService implements OnModuleInit {
  readonly accounts = new Map<string, LoyaltyAccount>();
  readonly vouchers: VoucherRec[] = [
    { id: uuidv7(), code: 'KRZ-0001', nominalTiyin: 10_000_000, expiresAt: '2026-10-01', status: 'free' },
    { id: uuidv7(), code: 'KRZ-0002', nominalTiyin: 10_000_000, expiresAt: '2026-12-01', status: 'free' },
    { id: uuidv7(), code: 'KRZ-0003', nominalTiyin: 20_000_000, expiresAt: '2026-11-01', status: 'free' },
  ];

  private readonly mirror: PgMirror;

  constructor(
    private readonly bus: EventBus,
    private readonly crm: CrmService,
    private readonly store: StateStore,
    prisma: PrismaService,
  ) {
    this.store.register(
      'loyalty',
      () => ({ accounts: [...this.accounts.values()], vouchers: this.vouchers }),
      (d) => {
        const data = d as { accounts: LoyaltyAccount[]; vouchers: VoucherRec[] };
        this.accounts.clear();
        for (const a of data.accounts) this.accounts.set(a.phone, a);
        this.vouchers.length = 0;
        this.vouchers.push(...data.vouchers);
      },
    );
    this.mirror = new PgMirror(prisma, 'Loyalty', {
      load: async (tx) => {
        const [accounts, entries, vouchers] = await Promise.all([
          tx.loyaltyAccount.findMany(),
          tx.loyaltyEntry.findMany({ orderBy: { at: 'asc' } }),
          tx.voucher.findMany(),
        ]);
        if (accounts.length) {
          this.accounts.clear();
          for (const a of accounts) {
            this.accounts.set(a.phone, {
              phone: a.phone,
              balanceTiyin: Number(a.balanceTiyin),
              history: entries
                .filter((e) => e.phone === a.phone)
                .map((e) => ({
                  id: e.id,
                  kind: e.kind as LoyaltyAccount['history'][number]['kind'],
                  amountTiyin: Number(e.amountTiyin),
                  note: e.note,
                  at: e.at.toISOString(),
                })),
            });
          }
        }
        if (vouchers.length) {
          this.vouchers.length = 0;
          this.vouchers.push(
            ...vouchers.map((v) => ({
              id: v.id,
              code: v.code,
              nominalTiyin: Number(v.nominalTiyin),
              expiresAt: v.expiresAt.toISOString().slice(0, 10),
              status: v.status as VoucherRec['status'],
              issuedToPhone: v.issuedToPhone ?? undefined,
              issuedAt: v.issuedAt?.toISOString(),
            })),
          );
        }
        return accounts.length + vouchers.length;
      },
      save: async (tx, tenantId) => {
        for (const a of this.accounts.values()) {
          await tx.loyaltyAccount.upsert({
            where: { tenantId_phone: { tenantId, phone: a.phone } },
            create: { tenantId, phone: a.phone, balanceTiyin: BigInt(a.balanceTiyin) },
            update: { balanceTiyin: BigInt(a.balanceTiyin) },
          });
          // Движения append-only: начисление или сторно переписывать нельзя,
          // из них считается баланс
          for (const h of a.history) {
            await tx.loyaltyEntry.upsert({
              where: { id: h.id },
              create: {
                id: h.id, tenantId, phone: a.phone, kind: h.kind,
                amountTiyin: BigInt(h.amountTiyin), note: h.note, at: new Date(h.at),
              },
              update: {},
            });
          }
        }
        for (const v of this.vouchers) {
          const data = {
            code: v.code,
            nominalTiyin: BigInt(v.nominalTiyin),
            expiresAt: new Date(`${v.expiresAt.slice(0, 10)}T00:00:00Z`),
            status: v.status,
            issuedToPhone: v.issuedToPhone ?? null,
            issuedAt: v.issuedAt ? new Date(v.issuedAt) : null,
          };
          await tx.voucher.upsert({ where: { id: v.id }, create: { id: v.id, tenantId, ...data }, update: data });
        }
      },
    });
    this.store.registerMirror(this.mirror);
  }

  /** Разовый перенос state.json (deploy/import-state) */
  flushToDb(): Promise<void> {
    return this.mirror.flush();
  }

  touch(): void {
    this.store.persist();
  }

  onModuleInit(): void {
    void this.mirror.init();
    /**
     * Начисление за закрытую B2B-заявку.
     *
     * Пустой `catch` убран: он гасил всё подряд, и потерянное начисление не
     * оставляло следа вообще. Теперь молча пропускается ровно один случай —
     * удалённая организация, — а всё остальное поднимается наверх, и шина
     * повторит доставку (см. common/event-bus).
     */
    this.bus.subscribe<OrderClosedEvent>(
      'order.closed',
      (e) => {
        if (e.graphType !== 'b2b' || !e.organizationId || !e.clientPhone) return;
        let org;
        try {
          org = this.crm.get(e.organizationId);
        } catch {
          return; // организации больше нет — начислять некому
        }
        if (!org.terms.loyaltyEnabled) return; // только как опция договора (ТЗ 17.14)
        const accrual = Math.floor((e.baseWorkTiyin || 0) / 100); // 1% от базы работ, без материалов
        if (accrual <= 0) return;
        // Ключ идемпотентности — сама заявка: повтор доставки события не
        // начислит баллы второй раз
        this.accrue(e.clientPhone, accrual, `1% от работ по ${e.number}`, e.orderId);
      },
      'loyalty.order_closed',
      { retry: true },
    );

    /**
     * Отмена заявки и возврат по спору снимают начисленное.
     *
     * Подписки на эти события не было ни здесь, ни в биллинге: заявку
     * сторнировали, а баллы оставались, и выданный на них ваучер отозвать
     * было нечем. Снимаем ровно то, что начислили по этой заявке.
     */
    this.bus.subscribe<{ orderId: string; number: string; clientPhone?: string }>(
      'order.cancelled',
      (e) => this.reverseFor(e.orderId, `Отмена заявки ${e.number}`),
      'loyalty.order_cancelled',
      { retry: true },
    );
    this.bus.subscribe<{ orderId: string; orderNumber: string }>(
      'dispute.refunded',
      (e) => this.reverseFor(e.orderId, `Возврат по спору ${e.orderNumber}`),
      'loyalty.dispute_refunded',
      { retry: true },
    );
  }

  /**
   * Снять начисление по заявке.
   *
   * Баланс может уйти в минус — и это правильно: человек уже получил ваучер
   * на баллы, которых больше нет, и долг должен быть виден, а не списан
   * молча. Отзывать выданный ваучер платформа не может физически.
   */
  reverseFor(orderId: string, note: string): void {
    if (!orderId) return;
    for (const acc of this.accounts.values()) {
      const accrued = acc.history.filter((h) => h.kind === 'accrual' && h.orderId === orderId);
      if (!accrued.length) continue;
      if (acc.history.some((h) => h.kind === 'storno' && h.orderId === orderId)) continue; // уже сторнировано
      const total = accrued.reduce((sum, h) => sum + h.amountTiyin, 0);
      if (total <= 0) continue;
      acc.balanceTiyin -= total;
      acc.history.push({ id: uuidv7(), kind: 'storno', amountTiyin: -total, note, orderId, at: new Date().toISOString() });
      this.store.persist();
      this.bus.publish('loyalty.reversed', { phone: acc.phone, amountTiyin: total, balanceTiyin: acc.balanceTiyin, note });
    }
  }

  private account(phone: string): LoyaltyAccount {
    let acc = this.accounts.get(phone);
    if (!acc) {
      acc = { phone, balanceTiyin: 0, history: [] };
      this.accounts.set(phone, acc);
    }
    return acc;
  }

  accrue(phone: string, amountTiyin: number, note: string, orderId?: string): void {
    const acc = this.account(phone);
    // По одной заявке начисляем один раз: повтор доставки события, повтор
    // запроса или переигровка не должны удваивать баллы
    if (orderId && acc.history.some((h) => h.kind === 'accrual' && h.orderId === orderId)) return;
    acc.balanceTiyin += amountTiyin;
    acc.history.push({ id: uuidv7(), kind: 'accrual', amountTiyin, note, orderId, at: new Date().toISOString() });
    this.tryIssueVoucher(acc);
    this.store.persist();
    // Начисление — уведомление низкого приоритета (PRD-01 §5): человеку
    // приятно, но будить его этим нельзя
    this.bus.publish('loyalty.accrued', { phone, amountTiyin, balanceTiyin: acc.balanceTiyin, note });
  }

  /** FEFO: свободный ваучер с ближайшим сроком годности, номинал ≤ баланса */
  private tryIssueVoucher(acc: LoyaltyAccount): void {
    const candidate = this.vouchers
      .filter((v) => v.status === 'free' && v.nominalTiyin <= acc.balanceTiyin)
      .sort((a, b) => a.expiresAt.localeCompare(b.expiresAt))[0];
    if (!candidate) return;
    candidate.status = 'issued';
    candidate.issuedToPhone = acc.phone;
    candidate.issuedAt = new Date().toISOString();
    acc.balanceTiyin -= candidate.nominalTiyin;
    acc.history.push({
      id: uuidv7(),
      kind: 'voucher',
      amountTiyin: -candidate.nominalTiyin,
      note: `Ваучер ${candidate.code} (${candidate.nominalTiyin / 100} сум)`,
      at: new Date().toISOString(),
    });
    /**
     * Ваучер — единственное в лояльности, что стоит SMS (PRD-01 §5).
     *
     * У него есть срок годности, и пропущенное уведомление означает
     * сгоревшие деньги человека. Остальное в программе можно посмотреть
     * когда угодно, а это — нет.
     */
    this.bus.publish('loyalty.voucher_issued', {
      phone: acc.phone,
      code: candidate.code,
      nominalTiyin: candidate.nominalTiyin,
      expiresAt: candidate.expiresAt,
    });
  }
}

@Controller('admin/loyalty')
@UseGuards(AuthGuard)
export class LoyaltyController {
  constructor(
    private readonly loyalty: LoyaltyService,
    private readonly audit: AuditService,
  ) {}

  @Get('accounts')
  @Roles('admin', 'accountant')
  accounts() {
    return [...this.loyalty.accounts.values()];
  }

  @Get('vouchers')
  @Roles('admin', 'accountant')
  vouchers() {
    return this.loyalty.vouchers;
  }

  /** Пополнение пула ваучеров (закупка у Корзинки — DEV-05 п.16) */
  @Post('vouchers')
  @Roles('admin')
  addVoucher(@Body() b: { code: string; nominalTiyin: number; expiresAt: string }, @Req() req: { auth: JwtClaims }) {
    if (!b.code || !b.nominalTiyin || !b.expiresAt) throw new BadRequestException({ code: 'FIELDS_REQUIRED' });
    const rec: VoucherRec = { id: uuidv7(), code: b.code, nominalTiyin: b.nominalTiyin, expiresAt: b.expiresAt, status: 'free' };
    this.loyalty.vouchers.push(rec);
    this.loyalty.touch();
    this.audit.write({ actorPhone: req.auth.phone, action: 'voucher.added', entity: 'Voucher', entityId: rec.id, payload: { code: b.code } });
    return rec;
  }
}

@Module({
  imports: [CrmModule],
  controllers: [LoyaltyController],
  providers: [LoyaltyService],
  // Экран баллов сотрудника точки (C-49) читает те же счета, что и админка
  exports: [LoyaltyService],
})
export class LoyaltyModule {}
