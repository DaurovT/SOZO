import { BadRequestException, Injectable } from '@nestjs/common';
import { AuditService } from '../platform/audit.service';
import { MasterRec, MastersService } from '../masters/masters.module';
import { OrdersService } from '../orders/orders.service';
import { tr } from '../../common/locale';

/**
 * M-41 «Приведи мастера» (ТЗ 18 п.11).
 *
 * Связь хранится на карточке приглашённого: `referrerCode` ставится один раз
 * при создании карточки из анкеты. Считать по имени пригласившего нельзя —
 * тёзки и переименования рвут связь молча.
 */

/** Бонус начисляется после 20 закрытых заявок приглашённого */
export const REFERRAL_TARGET_ORDERS = 20;

/** 500 000 сум за приведённого мастера */
export const REFERRAL_BONUS_TIYIN = 500_000_00;

export type ReferralRow = {
  referrerCode: string;
  referrerName: string;
  invitedMasterId: string;
  invitedName: string;
  invitedPhone: string;
  invitedStatus: MasterRec['status'];
  closedOrders: number;
  target: number;
  bonusTiyin: number;
  /** Порог пройден — бонус заработан, но выплату делает бухгалтер отдельно */
  earned: boolean;
  paidAt: string | null;
};

@Injectable()
export class ReferralsService {
  constructor(
    private readonly masters: MastersService,
    private readonly orders: OrdersService,
    private readonly audit: AuditService,
  ) {}

  /** Все пары «кто привёл → кого привёл». Пустой список — норма, а не ошибка. */
  async rows(): Promise<ReferralRow[]> {
    const all = this.masters.list();
    const invited = all.filter((m) => m.referrerCode);
    if (!invited.length) return [];

    const orders = await this.orders.list('t0');
    const closedBy = new Map<string, number>();
    for (const o of orders) {
      if (!o.masterId || !['closed', 'rated'].includes(o.status)) continue;
      closedBy.set(o.masterId, (closedBy.get(o.masterId) ?? 0) + 1);
    }

    return invited.map((m) => {
      const referrer = all.find((x) => x.qrBadgeCode === m.referrerCode);
      const closed = closedBy.get(m.id) ?? 0;
      return {
        referrerCode: m.referrerCode!,
        referrerName: referrer?.fullName ?? m.referrerName ?? '—',
        invitedMasterId: m.id,
        invitedName: m.fullName,
        invitedPhone: m.phone,
        invitedStatus: m.status,
        closedOrders: closed,
        target: REFERRAL_TARGET_ORDERS,
        bonusTiyin: REFERRAL_BONUS_TIYIN,
        earned: closed >= REFERRAL_TARGET_ORDERS,
        paidAt: m.referralBonusPaidAt ?? null,
      };
    });
  }

  /** Строки одного пригласившего — для экрана мастера */
  async byReferrer(code: string): Promise<ReferralRow[]> {
    const all = await this.rows();
    return all.filter((r) => r.referrerCode === code);
  }

  /**
   * Отметка о выплате. Раньше порога отметить нельзя: иначе в отчёте
   * появится выплата за мастера, который ещё не отработал условие.
   */
  async markPaid(invitedMasterId: string, actorPhone: string): Promise<ReferralRow> {
    const rows = await this.rows();
    const row = rows.find((r) => r.invitedMasterId === invitedMasterId);
    if (!row) throw new BadRequestException({ code: 'REFERRAL_NOT_FOUND' });
    if (!row.earned) {
      throw new BadRequestException({
        code: 'REFERRAL_NOT_EARNED',
        message: tr('Бонус после {0} закрытых заявок, сейчас {1}', REFERRAL_TARGET_ORDERS, row.closedOrders),
      });
    }
    if (row.paidAt) throw new BadRequestException({ code: 'REFERRAL_ALREADY_PAID' });

    const at = new Date().toISOString();
    this.masters.update(invitedMasterId, { referralBonusPaidAt: at });
    this.audit.write({
      actorPhone,
      action: 'referral.bonus_paid',
      entity: 'MasterProfile',
      entityId: invitedMasterId,
      payload: { referrerCode: row.referrerCode, bonusTiyin: row.bonusTiyin },
    });
    return { ...row, paidAt: at };
  }
}
