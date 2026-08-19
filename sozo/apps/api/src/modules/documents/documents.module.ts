import { Controller, ForbiddenException, Get, Header, Module, Param, Query, UnauthorizedException } from '@nestjs/common';
import { DocumentsService } from './documents.service';
import { OrdersModule } from '../orders/orders.module';
import { OrdersService } from '../orders/orders.service';
import { CrmModule } from '../crm/crm.module';
import { CrmService } from '../crm/crm.service';
import { BillingModule } from '../billing/billing.module';
import { MasterApiModule } from '../master-api/master-api.module';
import { BillingService } from '../billing/billing.service';
import { verifyJwt, type JwtClaims } from '../../common/jwt';

/**
 * Документы отдаются как печатный HTML (открывается в новой вкладке → Cmd+P → PDF).
 * Токен передаётся query-параметром: браузер открывает ссылку без заголовков.
 * В проде — серверный PDF + signed URL с коротким TTL (PRD-05 §9, §13).
 */
@Controller('documents')
class DocumentsController {
  constructor(
    private readonly docs: DocumentsService,
    private readonly orders: OrdersService,
    private readonly crm: CrmService,
    private readonly billing: BillingService,
  ) {}

  private claims(token?: string): JwtClaims {
    const c = token ? verifyJwt(token) : null;
    if (!c) throw new UnauthorizedException({ code: 'TOKEN_INVALID' });
    return c;
  }

  /**
   * Сотрудники платформы видят любые документы — это их работа.
   *
   * Всем остальным подпись токена ничего не даёт: она подтверждает, что человек
   * вошёл, а не что документ его. До этой проверки, зная id, можно было открыть
   * чужой акт и сверку чужой организации.
   */
  private isStaff(c: JwtClaims): boolean {
    return (c.roles ?? []).some((r) => ['admin', 'accountant', 'dispatcher', 'owner'].includes(r));
  }

  private deny(): never {
    throw new ForbiddenException({ code: 'DOCUMENT_FORBIDDEN', message: 'Этот документ не ваш' });
  }

  /** Точки, закреплённые за телефоном: по ним разрешены отчёты и журналы */
  private mySiteIds(phone: string): { locations: Set<string>; orgs: Set<string>; orgManagerOf: Set<string> } {
    const sites = this.crm.locationsForPhone(phone);
    return {
      locations: new Set(sites.map((s) => s.loc.id)),
      orgs: new Set(sites.map((s) => s.org.id)),
      // Сверка и счета — деньги организации: их смотрит только её руководитель
      orgManagerOf: new Set(sites.filter((s) => s.rep.approvalLimitTiyin === null).map((s) => s.org.id)),
    };
  }

  @Get('orders/:id/act')
  @Header('Content-Type', 'text/html; charset=utf-8')
  async orderAct(@Param('id') id: string, @Query('token') token?: string) {
    const c = this.claims(token);
    if (!this.isStaff(c)) {
      const order = await this.orders.record('t0', id);
      const mine = order.clientPhone === c.phone;
      // Заявка точки: акт видят все, кто на этой точке работает
      const onSite = !!order.locationId && this.mySiteIds(c.phone).locations.has(order.locationId);
      if (!mine && !onSite) this.deny();
    }
    return this.docs.orderAct(id, token);
  }

  @Get('organizations/:orgId/locations/:locId/report')
  @Header('Content-Type', 'text/html; charset=utf-8')
  async locationReport(@Param('orgId') orgId: string, @Param('locId') locId: string, @Query('token') token?: string) {
    const c = this.claims(token);
    if (!this.isStaff(c) && !this.mySiteIds(c.phone).locations.has(locId)) this.deny();
    return this.docs.locationReport(orgId, locId);
  }

  @Get('organizations/:orgId/locations/:locId/maintenance-log')
  @Header('Content-Type', 'text/html; charset=utf-8')
  async maintenanceLog(@Param('orgId') orgId: string, @Param('locId') locId: string, @Query('token') token?: string) {
    const c = this.claims(token);
    if (!this.isStaff(c) && !this.mySiteIds(c.phone).locations.has(locId)) this.deny();
    return this.docs.maintenanceLog(orgId, locId);
  }

  @Get('organizations/:orgId/reconciliation')
  @Header('Content-Type', 'text/html; charset=utf-8')
  reconciliation(@Param('orgId') orgId: string, @Query('token') token?: string) {
    const c = this.claims(token);
    if (!this.isStaff(c) && !this.mySiteIds(c.phone).orgManagerOf.has(orgId)) this.deny();
    return this.docs.reconciliation(orgId);
  }

  @Get('invoices/:id')
  @Header('Content-Type', 'text/html; charset=utf-8')
  invoice(@Param('id') id: string, @Query('token') token?: string) {
    const c = this.claims(token);
    if (!this.isStaff(c)) {
      const inv = this.billing.invoicesList().find((x) => x.id === id);
      if (!inv || !this.mySiteIds(c.phone).orgManagerOf.has(inv.organizationId)) this.deny();
    }
    return this.docs.invoice(id);
  }
}

@Module({
  imports: [OrdersModule, CrmModule, BillingModule, MasterApiModule],
  controllers: [DocumentsController],
  providers: [DocumentsService],
})
export class DocumentsModule {}
