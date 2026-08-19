import { BadRequestException, Body, Controller, Get, Injectable, Module, OnModuleInit, Post, Req, UseGuards } from '@nestjs/common';
import { uuidv7 } from '@sozo/kernel';
import { AuthGuard, Roles } from '../identity/auth.guard';
import { AuditService } from '../platform/audit.service';
import { EventBus, type OrderClosedEvent } from '../../common/event-bus';
import { CrmService } from '../crm/crm.service';
import { CrmModule } from '../crm/crm.module';
import { StateStore } from '../../common/state-store';
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
  history: Array<{ id: string; kind: 'accrual' | 'voucher' | 'storno'; amountTiyin: number; note: string; at: string }>;
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

  constructor(
    private readonly bus: EventBus,
    private readonly crm: CrmService,
    private readonly store: StateStore,
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
  }

  touch(): void {
    this.store.persist();
  }

  onModuleInit(): void {
    this.bus.subscribe<OrderClosedEvent>('order.closed', (e) => {
      if (e.graphType !== 'b2b' || !e.organizationId || !e.clientPhone) return;
      try {
        const org = this.crm.get(e.organizationId);
        if (!org.terms.loyaltyEnabled) return; // только как опция договора (ТЗ 17.14)
        const accrual = Math.floor((e.baseWorkTiyin || 0) / 100); // 1% от базы работ, без материалов
        if (accrual <= 0) return;
        this.accrue(e.clientPhone, accrual, `1% от работ по ${e.number}`);
      } catch {
        /* организация могла быть удалена — начисление пропускается */
      }
    });
  }

  private account(phone: string): LoyaltyAccount {
    let acc = this.accounts.get(phone);
    if (!acc) {
      acc = { phone, balanceTiyin: 0, history: [] };
      this.accounts.set(phone, acc);
    }
    return acc;
  }

  accrue(phone: string, amountTiyin: number, note: string): void {
    const acc = this.account(phone);
    acc.balanceTiyin += amountTiyin;
    acc.history.push({ id: uuidv7(), kind: 'accrual', amountTiyin, note, at: new Date().toISOString() });
    this.tryIssueVoucher(acc);
    this.store.persist();
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
