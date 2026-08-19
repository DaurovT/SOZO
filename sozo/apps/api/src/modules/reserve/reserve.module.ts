import { BadRequestException, Body, Controller, Get, Injectable, Module, NotFoundException, Param, Post, Req, UseGuards } from '@nestjs/common';
import { uuidv7 } from '@sozo/kernel';
import { AuthGuard, Roles } from '../identity/auth.guard';
import { AuditService } from '../platform/audit.service';
import { EventBus } from '../../common/event-bus';
import { StateStore } from '../../common/state-store';
import type { JwtClaims } from '../../common/jwt';

/**
 * A-20: резервный фонд ущербов (ТЗ 17.7). Страховых продуктов ГО в УЗ нет —
 * фонд копится проводкой 1.5% от выручки (billing), дела разбираются здесь.
 * Выплата → событие damage.payout → проводки в billing (регресс к мастеру ≤30%).
 */
export interface DamageCase {
  id: string;
  orderId?: string;
  description: string;
  claimantName: string;
  amountTiyin: number;
  regressTiyin: number; // ≤ 30% суммы (ТЗ 17.7)
  masterId?: string;
  masterName?: string;
  status: 'filed' | 'review' | 'approved' | 'rejected' | 'paid';
  resolution?: string;
  createdAt: string;
}

@Injectable()
export class ReserveService {
  readonly cases: DamageCase[] = [];

  constructor(private readonly store: StateStore) {
    this.store.register(
      'reserve',
      () => this.cases,
      (d) => {
        this.cases.length = 0;
        this.cases.push(...(d as DamageCase[]));
      },
    );
  }

  touch(): void {
    this.store.persist();
  }

  file(data: Pick<DamageCase, 'orderId' | 'description' | 'claimantName' | 'amountTiyin' | 'masterId' | 'masterName'>): DamageCase {
    const c: DamageCase = { id: uuidv7(), ...data, regressTiyin: 0, status: 'filed', createdAt: new Date().toISOString() };
    this.cases.push(c);
    this.store.persist();
    return c;
  }

  get(id: string): DamageCase {
    const c = this.cases.find((x) => x.id === id);
    if (!c) throw new NotFoundException({ code: 'CASE_NOT_FOUND' });
    return c;
  }
}

@Controller('admin/reserve-fund')
@UseGuards(AuthGuard)
export class ReserveController {
  constructor(
    private readonly reserve: ReserveService,
    private readonly audit: AuditService,
    private readonly bus: EventBus,
  ) {}

  @Get('cases')
  @Roles('admin', 'accountant')
  list() {
    return [...this.reserve.cases].reverse();
  }

  @Post('cases')
  @Roles('admin')
  file(@Body() body: any, @Req() req: { auth: JwtClaims }) {
    const c = this.reserve.file({
      orderId: body.orderId,
      description: body.description,
      claimantName: body.claimantName ?? '',
      amountTiyin: body.amountTiyin,
      masterId: body.masterId,
      masterName: body.masterName,
    });
    this.audit.write({ actorPhone: req.auth.phone, action: 'damage.filed', entity: 'DamageCase', entityId: c.id });
    return c;
  }

  /** Резолюция админа: утвердить (с регрессом ≤30%) или отклонить */
  @Post('cases/:id/resolve')
  @Roles('admin')
  resolve(@Param('id') id: string, @Body() body: { approve: boolean; regressTiyin?: number; resolution?: string }, @Req() req: { auth: JwtClaims }) {
    const c = this.reserve.get(id);
    if (c.status !== 'filed' && c.status !== 'review') throw new BadRequestException({ code: 'CASE_ALREADY_RESOLVED' });
    if (body.approve) {
      const maxRegress = Math.floor(c.amountTiyin * 0.3);
      const regress = Math.min(body.regressTiyin ?? 0, maxRegress); // регресс не более 30% (ТЗ 17.7)
      c.status = 'approved';
      c.regressTiyin = regress;
    } else {
      c.status = 'rejected';
    }
    c.resolution = body.resolution ?? '';
    this.reserve.touch();
    this.audit.write({ actorPhone: req.auth.phone, action: `damage.${c.status}`, entity: 'DamageCase', entityId: id, payload: { regressTiyin: c.regressTiyin } });
    return c;
  }

  /** Выплата из фонда — двойное подтверждение (PRD-04 §1.3) */
  @Post('cases/:id/pay')
  @Roles('admin')
  pay(@Param('id') id: string, @Body() body: { secondAdminConfirmed?: boolean }, @Req() req: { auth: JwtClaims }) {
    if (!body?.secondAdminConfirmed) {
      throw new BadRequestException({ code: 'SECOND_ADMIN_REQUIRED', message: 'Выплата из фонда ущербов требует двойного подтверждения' });
    }
    const c = this.reserve.get(id);
    if (c.status !== 'approved') throw new BadRequestException({ code: 'CASE_NOT_APPROVED' });
    c.status = 'paid';
    this.reserve.touch();
    this.bus.publish('damage.payout', {
      caseId: c.id,
      amountTiyin: c.amountTiyin,
      regressTiyin: c.regressTiyin,
      masterId: c.masterId,
      description: c.description,
    });
    this.audit.write({ actorPhone: req.auth.phone, action: 'damage.paid', entity: 'DamageCase', entityId: id });
    return c;
  }
}

@Module({
  controllers: [ReserveController],
  providers: [ReserveService],
})
export class ReserveModule {}
