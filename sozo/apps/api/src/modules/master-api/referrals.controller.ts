import { BadRequestException, Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import type { JwtClaims } from '../../common/jwt';
import { AuthGuard as AdminGuard, Roles } from '../identity/auth.guard';
import { ReferralsService, REFERRAL_BONUS_TIYIN, REFERRAL_TARGET_ORDERS } from './referrals.service';
import { tr } from '../../common/locale';

/**
 * A-13 «Реферальная программа мастеров» в админке.
 *
 * Раньше страница была макетом: связку «кто кого привёл» негде было взять,
 * пока не появилось приложение мастера с анкетой и полем кода. Теперь связь
 * ставится при создании карточки, а закрытые заявки считаются по журналу.
 */
@Controller('admin/referrals')
@UseGuards(AdminGuard)
@Roles('admin', 'accountant')
export class AdminReferralsController {
  constructor(private readonly referrals: ReferralsService) {}

  @Get()
  async list() {
    const rows = await this.referrals.rows();
    return {
      rows,
      target: REFERRAL_TARGET_ORDERS,
      bonusTiyin: REFERRAL_BONUS_TIYIN,
      rule: tr('Бонус начисляется после {0} закрытых заявок приведённого мастера', REFERRAL_TARGET_ORDERS),
      totals: {
        pairs: rows.length,
        earned: rows.filter((r) => r.earned && !r.paidAt).length,
        paid: rows.filter((r) => r.paidAt).length,
        payableTiyin: rows.filter((r) => r.earned && !r.paidAt).reduce((s, r) => s + r.bonusTiyin, 0),
      },
      empty: 'Рефералов пока нет: код вводится кандидатом в анкете при оформлении',
    };
  }

  /** Отметка бухгалтера о выплате бонуса пригласившему */
  @Post('paid')
  @Roles('admin', 'accountant')
  async markPaid(@Body() b: { invitedMasterId?: string }, @Req() req: { auth: JwtClaims }) {
    if (!b?.invitedMasterId) throw new BadRequestException({ code: 'MASTER_ID_REQUIRED' });
    return this.referrals.markPaid(b.invitedMasterId, req.auth.phone);
  }
}
