import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { AuthGuard, Roles } from '../identity/auth.guard';
import { CrmService } from '../crm/crm.service';
import { OrdersService } from '../orders/orders.service';
import { ClientProfilesService } from './client-profiles.service';
import { ClientViewService } from './client-view.service';

/**
 * Что админ знает о человеке, пользующемся приложением.
 *
 * Реестр `/admin/clients` выводится из заявок и знает только деньги: сколько
 * потратил, сколько должен. Всё, что клиент сообщил о себе сам — согласия,
 * язык, адреса, запомненный мастер, жалобы — живёт в профиле приложения, и
 * до этого эндпоинта не было способа это увидеть.
 *
 * Отдельным контроллером внутри клиентского модуля, а не полем в реестре
 * заявок: реестр живёт в модуле заявок, а тот про приложение ничего не знает
 * и знать не должен.
 */
@Controller('admin/app-clients')
@UseGuards(AuthGuard)
@Roles('admin', 'accountant')
export class AdminAppClientsController {
  constructor(
    private readonly profiles: ClientProfilesService,
    private readonly orders: OrdersService,
    private readonly crm: CrmService,
    private readonly view: ClientViewService,
  ) {}

  @Get()
  list() {
    return this.profiles.all().map((p) => ({
      phone: p.phone,
      fullName: p.fullName,
      locale: p.locale,
      consentPersonalData: p.consents.personalData,
      consentMarketing: p.consents.marketing,
      consentAt: p.consents.at ?? null,
      addresses: p.addresses.length,
      complaints: p.complaints.length,
      favoriteMasterName: p.favoriteMasterName ?? null,
      // Роли на точках: по ним видно, что человек ещё и представитель B2B
      sites: this.crm.locationsForPhone(p.phone).map((s) => ({
        organization: s.org.name,
        location: s.loc.name,
        role: s.rep.role,
        approvalLimitTiyin: s.rep.approvalLimitTiyin,
      })),
    }));
  }

  @Get(':phone')
  async one(@Param('phone') phone: string) {
    const p = this.profiles.get(phone);
    const all = await this.orders.list('t0');
    const mine = all.filter((o) => o.clientPhone === phone);
    return {
      profile: {
        phone: p.phone,
        fullName: p.fullName,
        locale: p.locale,
        consents: p.consents,
        favoriteMasterName: p.favoriteMasterName ?? null,
      },
      addresses: p.addresses,
      complaints: p.complaints,
      sites: this.crm.locationsForPhone(phone).map((s) => ({
        organization: s.org.name,
        location: s.loc.name,
        role: s.rep.role,
        approvalLimitTiyin: s.rep.approvalLimitTiyin,
        primary: s.rep.primary,
      })),
      orders: {
        // Личные и по точкам считаем врозь: это разные контуры и разные деньги
        personal: mine.filter((o) => !o.locationId).length,
        business: mine.filter((o) => !!o.locationId).length,
      },
      /**
       * Платежи и гарантия — то, ради чего чаще всего звонят в поддержку.
       *
       * До этого они лежали на разных экранах: заявки в одном месте, оплаты
       * внутри карточек, гарантия нигде. Оператор собирал картину руками,
       * пока человек ждал на линии.
       */
      payments: mine
        .filter((o) => o.payment)
        .map((o) => ({
          orderId: o.id,
          number: o.number,
          provider: o.payment!.provider,
          status: o.payment!.status,
          amountTiyin: o.payment!.amountTiyin,
          tipTiyin: o.tipTiyin ?? 0,
          at: o.payment!.at,
        }))
        .sort((a, b) => b.at.localeCompare(a.at)),
      warranty: mine
        .map((o) => ({ o, until: this.view.warrantyUntil(o) }))
        .filter((x) => !!x.until && new Date(x.until!).getTime() > Date.now())
        .map((x) => ({
          orderId: x.o.id,
          number: x.o.number,
          title: x.o.lines[0]?.name ?? x.o.description,
          until: x.until,
        }))
        .sort((a, b) => (a.until ?? '').localeCompare(b.until ?? '')),
    };
  }
}
