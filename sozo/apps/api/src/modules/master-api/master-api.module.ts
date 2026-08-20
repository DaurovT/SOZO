import { AccessModule } from '../access/access.module';
import { BadRequestException, Body, Controller, Get, Module, Post, Req, UseGuards } from '@nestjs/common';
import { AdminReferralsController } from './referrals.controller';
import { ReferralsService } from './referrals.service';
import { masterShare } from '@sozo/kernel';
import { AuthGuard, Roles } from '../identity/auth.guard';
import type { JwtClaims } from '../../common/jwt';
import { AdminMasterOpsController } from './admin-master-ops.controller';
import { MasterApiController } from './master-api.controller';
import { MasterOpsController } from './master-ops.controller';
import { MasterOpsService } from './master-ops.service';
import { MasterPhotoService } from './photo.service';
import { MasterResourcesController } from './master-resources.controller';
import { ResourcesService } from './resources.service';
import { RatingService } from './rating.service';
import { NotificationsService } from './notifications.service';
import { MasterGuard } from './master.guard';
import { MasterOffersService, OFFER_TTL_SECONDS, EXPRESS_TTL_SECONDS } from './offers.service';
import { AdminOnboardingController, OnboardingController, OnboardingGuard } from './onboarding.controller';
import { OnboardingService } from './onboarding.service';
import { OrdersModule } from '../orders/orders.module';
import { OrdersService } from '../orders/orders.service';
import { PricingModule } from '../pricing/pricing.module';
import { BillingModule } from '../billing/billing.module';
import { SchedulingModule } from '../scheduling/scheduling.module';
import { MastersModule, MastersService } from '../masters/masters.module';
import { QualityModule } from '../quality/quality.module';
import { FieldModule } from '../field/field.module';
import { CrmModule } from '../crm/crm.module';

/** Район из адреса — dev-заглушка геокодера: до принятия мастер видит район, не точку */
function districtOf(address: string): string {
  const known = ['Чиланзар', 'Юнусабад', 'Мирзо-Улугбек', 'Яккасарай', 'Шайхантахур', 'Сергели', 'Учтепа', 'Алмазар', 'Бектемир', 'Мирабад', 'Яшнабад'];
  return known.find((d) => address.toLowerCase().includes(d.toLowerCase())) ?? 'Ташкент';
}

/**
 * Отправка офферов из диспетчерской (D-04 → M-04).
 * Диспетчер жмёт «Предложить мастеру» — мастеру прилетает оффер с таймером 60 секунд.
 */
@Controller('dispatch/offers')
@UseGuards(AuthGuard)
@Roles('dispatcher', 'admin')
class DispatchOffersController {
  constructor(
    private readonly offers: MasterOffersService,
    private readonly orders: OrdersService,
    private readonly masters: MastersService,
  ) {}

  @Get()
  list() {
    return {
      ttlSeconds: OFFER_TTL_SECONDS,
      items: this.offers.offers.slice(-100).reverse(),
      online: this.offers.onlineMasters().map((s) => ({
        ...s,
        masterName: this.masters.list().find((m) => m.id === s.masterId)?.fullName,
      })),
    };
  }

  /**
   * M-10: экспресс-замена. Мастер сорвался, клиент уже ждёт — предложение уходит
   * всем свободным сразу, заявку получает первый принявший. Отказ без причины и без штрафа.
   */
  @Post('express')
  async express(@Body() b: { orderId?: string; waitingSince?: string }) {
    if (!b?.orderId) throw new BadRequestException({ code: 'ORDER_REQUIRED' });
    const order = await this.orders.get('t0', b.orderId);
    const online = this.offers.onlineMasters();
    const created = online
      .map((s) => this.masters.list().find((x) => x.id === s.masterId))
      .filter((x): x is NonNullable<typeof x> => !!x && x.status === 'active' && x.id !== order.masterId)
      .map((mm) =>
        this.offers.create({
          orderId: order.id,
          orderNumber: order.number,
          masterId: mm.id,
          masterName: mm.fullName,
          category: order.lines[0]?.name ?? order.description.slice(0, 60),
          district: districtOf(order.address),
          urgency: order.urgency,
          estimateFromTiyin: order.totalFromTiyin,
          estimateToTiyin: order.totalToTiyin,
          masterShareFromTiyin: Number(masterShare(BigInt(order.baseFromTiyin || 0), 1000n, 550n)),
          isPaired: !!order.helperId,
          kind: 'express',
          ttlSeconds: EXPRESS_TTL_SECONDS,
          waitingSince: b.waitingSince ?? new Date().toISOString(),
        }),
      );
    return {
      sent: created.length,
      ttlSeconds: EXPRESS_TTL_SECONDS,
      note: created.length ? 'Заявку получит первый принявший' : 'Свободных мастеров на линии нет',
    };
  }

  @Post()
  async send(@Body() b: { orderId?: string; masterIds?: string[] }, @Req() req: { auth: JwtClaims }) {
    if (!b?.orderId) throw new BadRequestException({ code: 'ORDER_REQUIRED' });
    const ids = b?.masterIds ?? [];
    if (!ids.length) throw new BadRequestException({ code: 'MASTERS_REQUIRED', message: 'Выберите хотя бы одного мастера' });
    const order = await this.orders.get('t0', b.orderId);
    const created = ids.map((masterId) => {
      const m = this.masters.get(masterId);
      return this.offers.create({
        orderId: order.id,
        orderNumber: order.number,
        masterId: m.id,
        masterName: m.fullName,
        category: order.lines[0]?.name ?? order.description.slice(0, 60) ?? 'Заявка',
        district: districtOf(order.address),
        urgency: order.urgency,
        estimateFromTiyin: order.totalFromTiyin,
        estimateToTiyin: order.totalToTiyin,
        masterShareFromTiyin: Number(masterShare(BigInt(order.baseFromTiyin || 0), 1000n, 550n)),
        isPaired: !!order.helperId,
        kind: 'personal',
        ttlSeconds: OFFER_TTL_SECONDS,
      });
    });
    return { sent: created.length, ttlSeconds: OFFER_TTL_SECONDS, offers: created };
  }
}

/**
 * master-api (PRD-02, DEV-09): контур приложения мастера.
 * Отдельный модуль, а не ветка в orders — у мастера своя авторизация (карточка мастера,
 * а не роль в JWT), свой узкий набор действий и своя офлайн-семантика.
 */
@Module({
  imports: [AccessModule, OrdersModule, PricingModule, BillingModule, SchedulingModule, MastersModule, QualityModule, FieldModule, CrmModule],
  controllers: [AdminMasterOpsController, MasterApiController, MasterOpsController, OnboardingController, AdminOnboardingController, AdminReferralsController, MasterResourcesController, DispatchOffersController],
  providers: [MasterOffersService, MasterOpsService, MasterPhotoService, OnboardingService, ResourcesService, RatingService, NotificationsService, ReferralsService, MasterGuard, OnboardingGuard],
  exports: [MasterOffersService, MasterOpsService, OnboardingService, ResourcesService, RatingService, NotificationsService, ReferralsService],
})
export class MasterApiModule {}
