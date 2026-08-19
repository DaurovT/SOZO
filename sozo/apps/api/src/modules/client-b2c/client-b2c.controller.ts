import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuditService } from '../platform/audit.service';
import { CrmService } from '../crm/crm.service';
import { MasterOpsService } from '../master-api/master-ops.service';
import { OrdersService } from '../orders/orders.service';
import type { OrderRecord } from '../orders/order.repository';
import { trValue } from '../../common/locale';
import { PricingService } from '../pricing/pricing.service';
import { PromoService, WELCOME_CODE } from '../promo/promo.module';
import { QualityService, type ComplaintType } from '../quality/quality.service';
import { ParametersService } from '../platform/parameters.service';
import { RegistryService } from '../registry/registry.module';
import { SchedulingService } from '../scheduling/scheduling.service';
import { AppGuard, type AppRequest } from './app.guard';
import { ClientPhotoService } from './client-photo.service';
import { ClientProfilesService } from './client-profiles.service';
import { ClientNotificationsService } from './client-notifications.service';
import { ClientViewService } from './client-view.service';
import { DemoSeedService } from './demo-seed.service';

/** Категории под лицензией — до договора с лицензиатом их не показываем (ТЗ 17.8) */
const CLOSED_CATEGORY = /газ|лифт/i;

/**
 * Перевод категорий прайса на язык клиента.
 *
 * В прайсе владельца они записаны капсом и по видам работ: «ДЕМОНТАЖ, БУРЕНИЕ,
 * ШТРОБЛЕНИЕ». Человек так не думает — он думает «течёт кран». `popular`
 * отбирает шесть плиток на главную: тринадцать вариантов на первом экране —
 * это не выбор, а паралич; остальные открываются по «Все работы».
 */
function clientLabel(category: string): { label: string; hint: string; icon: string; popular: boolean; order: number } {
  const c = category.toLowerCase();
  // Подпись, описание и значок — из макета услуг (200:4). Держим их здесь,
  // а не в приложении: список категорий приходит из прайса, и разъезжаться
  // ему с описаниями нельзя — их правят вместе
  const m = (label: string, hint: string, icon: string, popular: boolean, order: number) => ({ label, hint, icon, popular, order });
  // «Не знаю, что сломалось» — первой строкой (200:4): человек, который не
  // может назвать поломку, не должен искать выход в конце списка из тринадцати
  // категорий, где каждая уже требует от него ответа
  if (c.includes('выезд') || c.includes('диагност')) return m('Не знаю, что сломалось', 'Мастер приедет и разберётся', 'help-circle', true, 0);
  if (c.includes('сантех')) return m('Сантехника', 'Трубы, краны, унитазы и др.', 'droplet', true, 1);
  if (c.includes('электр')) return m('Электрика', 'Проводка, розетки, щитки', 'zap', true, 2);
  if (c.includes('кондицион') || c.includes('вентиляц')) return m('Кондиционер', 'Установка, чистка, ремонт', 'snowflake', true, 3);
  if (c.includes('окн') || c.includes('двер') || c.includes('балкон')) return m('Двери и окна', 'Монтаж, замена, регулировка', 'door-open', true, 4);
  if (c.includes('бытов')) return m('Бытовая техника', 'Ремонт стиралок, холодильников', 'washing-machine', true, 5);
  if (c.includes('универсал') || c.includes('час')) return m('Мелкий ремонт', 'Полки, розетки и тд', 'wrench', true, 6);
  if (c.includes('маляр') || c.includes('отделоч')) return m('Отделка и покраска', 'Поклейка обоев, покраска стен', 'paint-roller', false, 8);
  if (c.includes('пол') || c.includes('потол')) return m('Полы и потолки', 'Ламинат, натяжные потолки и др.', 'layers', false, 9);
  if (c.includes('демонтаж') || c.includes('бурен') || c.includes('штроб')) return m('Демонтаж и штробление', 'Снос перегородок, штробы', 'hammer', false, 10);
  if (c.includes('свароч')) return m('Сварочные работы', 'Металлоконструкции, заборы', 'flame', false, 11);
  if (c.includes('слаботоч') || c.includes('интернет') || c.includes('безопасн')) return m('Интернет и камеры', 'Установка, настройка, ремонт', 'wifi', false, 12);
  if (c.includes('сервис')) return m('Сервисные услуги', 'Сборка мебели, чистка и др.', 'settings', false, 13);
  // Незнакомая категория из нового релиза прайса: показываем как есть,
  // но без капса — КАПС в интерфейсе запрещён (DEV-06 §7)
  const lower = category.toLowerCase();
  return m(lower.charAt(0).toUpperCase() + lower.slice(1), '', 'wrench', false, 20);
}

/**
 * Тип жалобы: с экрана приходит человеческая строка, реестру качества нужен код.
 *
 * Переводим здесь, а не на клиенте: коды — внутреннее устройство платформы,
 * приложению о них знать незачем, а формулировки в интерфейсе ещё поменяются.
 */
function complaintCode(label: string): ComplaintType {
  const c = label.toLowerCase();
  if (c.includes('качеств')) return 'quality';
  if (c.includes('поведен')) return 'behavior';
  if (c.includes('срок')) return 'deadline';
  if (c.includes('деньг') || c.includes('сумм') || c.includes('оплат')) return 'money';
  if (c.includes('сервис') || c.includes('диспетчер')) return 'service';
  if (c.includes('приложен')) return 'app';
  return 'other';
}

const today = (): string => new Date().toISOString().slice(0, 10);

const HHMM = (min: number): string =>
  `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

/**
 * Приложение «Клиент», B2C-контур (DEV-08, план DEV-12).
 *
 * Живёт на `/v1/app/*`, а не на `/v1/client/*`: там уже есть приложение
 * ответственного на точке, и смешивать два разных продукта в одном префиксе —
 * верный способ однажды отдать клиенту чужие данные.
 */
@Controller('app')
@UseGuards(AppGuard)
export class ClientB2CController {
  constructor(
    private readonly orders: OrdersService,
    private readonly pricing: PricingService,
    private readonly sched: SchedulingService,
    private readonly promo: PromoService,
    private readonly crm: CrmService,
    private readonly ops: MasterOpsService,
    private readonly profiles: ClientProfilesService,
    private readonly view: ClientViewService,
    private readonly photos: ClientPhotoService,
    private readonly audit: AuditService,
    private readonly demo: DemoSeedService,
    private readonly notifications: ClientNotificationsService,
    private readonly quality: QualityService,
    private readonly registry: RegistryService,
    private readonly params: ParametersService,
  ) {}

  private phone(req: AppRequest): string {
    return req.clientPhone!;
  }

  /**
   * Заявки личного аккаунта.
   *
   * Один и тот же человек бывает и частным клиентом, и ответственным на точке —
   * телефон у него один. Отличает контуры привязка к точке: заявка с
   * `locationId` принадлежит организации и в личном списке появляться не должна,
   * иначе клиент видит в своей истории ремонт чужой аптеки.
   */
  private personal(all: OrderRecord[], phone: string): OrderRecord[] {
    return all.filter((o) => o.clientPhone === phone && !o.locationId);
  }

  /** Заявка клиента. Чужая — 403, а не 404: врать о существовании тоже не надо. */
  private async mine(req: AppRequest, id: string): Promise<OrderRecord> {
    const order = await this.orders.record('t0', id);
    if (order.clientPhone !== this.phone(req)) {
      throw new ForbiddenException({ code: 'FOREIGN_ORDER', message: 'Это не ваша заявка' });
    }
    return order;
  }

  // ---------- Профиль ----------

  /** C-01/C-05/C-30: кто вошёл, какие у него роли и есть ли долг */
  @Get('me')
  async me(@Req() req: AppRequest) {
    const phone = this.phone(req);
    const profile = this.profiles.get(phone);
    const all = await this.orders.list('t0');
    const mine = this.personal(all, phone);
    // Долг блокирует создание заявок, кроме аварийных (ТЗ 4.4)
    const debtTiyin = mine
      .filter((o) => o.status === 'awaiting_payment')
      .reduce((s, o) => s + o.totalFromTiyin, 0);

    // B2B-контексты: телефон вписан ответственным в карточку точки (A-09)
    const sites = this.crm.locationsForPhone(phone);
    const contexts = sites.map((s) => {
      // Роль — из права утверждать, а не из флага «основной» (см. roleOf в b2b-контроллере)
      const role =
        s.rep.approvalLimitTiyin === null ? 'org_manager' : s.rep.approvalLimitTiyin > 0 ? 'site_manager' : 'staff';
      return {
      id: s.loc.id,
      title: `${s.loc.name}, ${s.loc.address}`,
      organizationId: s.org.id,
      organizationName: s.org.name,
      role,
      approvalLimitTiyin: s.rep.approvalLimitTiyin,
      /**
       * Должность из карточки на точке: «Завхоз», «Старшая смены».
       *
       * На права не влияет и потому долго считалась необязательной, а человеку
       * в профиле показать было нечего — кто он в этой организации, приложение
       * знало и молчало.
       */
      position: s.rep.position ?? null,
      organizationStatus: s.org.status,
      /**
       * Программа баллов включена договором.
       *
       * Приложение собирает по этому флагу нижнюю панель: держать постоянную
       * вкладку «Баллы», которая у большинства открывает «программа не
       * подключена», — впустую потраченное место в панели из пяти.
       */
      loyaltyEnabled: s.org.terms.loyaltyEnabled,
      /**
       * Суммы скрываются только от сотрудника и только если организация
       * так решила (ТЗ 5.2). Руководители видят деньги всегда — считать
       * это по «есть ли потолок» неверно: у руководителя организации
       * потолка нет вовсе, и проверка на него давала обратный ответ.
       */
      showMoney: role !== 'staff' || s.org.terms.showMoneyToEmployees,
      pending: 0,
      };
    });

    return {
      phone,
      fullName: profile.fullName || mine.find((o) => o.clientName)?.clientName || '',
      locale: profile.locale,
      consents: profile.consents,
      debtTiyin,
      /**
       * Блокировка новых заявок и её причина.
       *
       * Отдаём заранее, а не в момент отправки: собрать заявку из пяти шагов
       * и получить отказ на последнем — худший способ узнать, что тебя
       * заблокировали. Аварийный вызов при этом работает всегда (ТЗ 4.4),
       * и сказать об этом важнее всего остального.
       */
      blocked: (() => {
        const b = this.orders.blockOf(phone);
        return b
          ? { reason: b.reason, at: b.at, emergencyStillAvailable: true }
          : null;
      })(),
      hasClosedOrders: mine.some((o) => ['closed', 'rated'].includes(o.status)),
      addressesCount: profile.addresses.length,
      favoriteMasterName: profile.favoriteMasterName ?? null,
      contexts,
      warrantyDays: this.view.warrantyDays,
      supportPhone: this.params.text(200, '+998712000000'),
      // Бейдж на вкладке: профиль тянется на каждом обновлении главной,
      // отдельный запрос ради одной цифры не нужен
      unreadNotifications: this.notifications.unread(
        phone,
        all.filter((o) => o.clientPhone === phone || (o.locationId && sites.some((s) => s.loc.id === o.locationId))),
      ),
    };
  }

  /**
   * Лента уведомлений. Одна на оба контура: человеку неважно, случилось
   * событие по личной заявке или по его точке — важно, что оно случилось.
   */
  @Get('notifications')
  async notificationsList(@Req() req: AppRequest) {
    const phone = this.phone(req);
    const all = await this.orders.list('t0');
    const locIds = new Set(this.crm.locationsForPhone(phone).map((s) => s.loc.id));
    const mine = all.filter((o) => o.clientPhone === phone || (o.locationId && locIds.has(o.locationId)));
    const items = this.notifications.build(phone, mine);
    return { items, unread: items.filter((n) => !n.read).length };
  }

  @Post('notifications/read')
  async markNotificationsRead(@Body() b: { ids?: string[] }, @Req() req: AppRequest) {
    const phone = this.phone(req);
    if (b?.ids?.length) {
      this.notifications.markRead(phone, b.ids);
    } else {
      // Без списка — прочитать всё: кнопка «отметить все» в шапке ленты
      const all = await this.orders.list('t0');
      const locIds = new Set(this.crm.locationsForPhone(phone).map((s) => s.loc.id));
      const mine = all.filter((o) => o.clientPhone === phone || (o.locationId && locIds.has(o.locationId)));
      this.notifications.markRead(phone, this.notifications.build(phone, mine).map((n) => n.id));
    }
    return { ok: true };
  }

  /**
   * Имя клиента: спрашивается при знакомстве и правится потом.
   *
   * Отдельно от согласий, хотя `consents` его тоже принимает: сменить имя —
   * не то же самое, что дать согласие на обработку данных, и смешивать их в
   * одной ручке значит однажды переписать согласие вместе с опечаткой в имени.
   */
  @Post('profile')
  updateProfile(@Body() b: { fullName?: string }, @Req() req: AppRequest) {
    const name = b?.fullName?.trim() ?? '';
    if (!name) throw new BadRequestException({ code: 'NAME_REQUIRED', message: 'Укажите, как к вам обращаться' });
    if (name.length > 80) throw new BadRequestException({ code: 'NAME_TOO_LONG', message: 'Слишком длинное имя' });
    const p = this.profiles.setConsents(this.phone(req), { fullName: name });
    this.audit.write({
      actorPhone: this.phone(req),
      action: 'client.profile_updated',
      entity: 'ClientProfile',
      entityId: p.phone,
      payload: { fullName: p.fullName },
    });
    return { fullName: p.fullName };
  }

  /**
   * Принять приглашение в организацию.
   *
   * Живёт в общем контуре приложения, а не в B2B: его вводит человек, у
   * которого никаких точек ещё нет — на B2B-ручки ему пока нечем ответить.
   */
  @Post('invites/accept')
  acceptInvite(@Body() b: { code?: string; fullName?: string }, @Req() req: AppRequest) {
    const code = b?.code?.trim();
    if (!code) throw new BadRequestException({ code: 'CODE_REQUIRED', message: 'Введите код приглашения' });
    const phone = this.phone(req);
    const joined = this.crm.acceptInvite(phone, code, b?.fullName ?? this.profiles.get(phone).fullName);
    this.audit.write({
      actorPhone: phone,
      action: 'b2b.invite_accepted',
      entity: 'ClientProfile',
      entityId: phone,
      payload: joined,
    });
    return joined;
  }

  /** C-03/C-04: согласия и язык */
  @Post('consents')
  consents(
    @Body() b: { personalData?: boolean; marketing?: boolean; locale?: string; fullName?: string },
    @Req() req: AppRequest,
  ) {
    const p = this.profiles.setConsents(this.phone(req), b ?? {});
    this.audit.write({
      actorPhone: this.phone(req),
      action: 'client.consents_set',
      entity: 'ClientProfile',
      entityId: p.phone,
      payload: { personalData: p.consents.personalData, marketing: p.consents.marketing, locale: p.locale },
    });
    return { consents: p.consents, locale: p.locale };
  }

  // ---------- Каталог работ (C-07) ----------

  @Get('catalog')
  catalog() {
    const release = this.pricing.active();
    const byCategory = new Map<string, ReturnType<typeof this.item>[]>();
    for (const it of release.items) {
      if (CLOSED_CATEGORY.test(it.category) || CLOSED_CATEGORY.test(it.name)) continue;
      const list = byCategory.get(it.category) ?? [];
      list.push(this.item(it));
      byCategory.set(it.category, list);
    }
    return {
      releaseNumber: release.number,
      categories: [...byCategory.entries()]
        .map(([name, items]) => ({
          // Само название категории остаётся русским: приложение отправляет
          // его обратно (жалоба с точки), и перевод сломал бы следующий запрос
          name,
          // Название прайса — язык владельца: «ДЕМОНТАЖ, БУРЕНИЕ, ШТРОБЛЕНИЕ».
          // Клиент думает «течёт кран», поэтому на плитке своё слово
          ...(() => {
            const l = clientLabel(name);
            return { ...l, label: trValue(l.label) };
          })(),
          // Цена «от» категории — минимальная в ней: именно её показывает плитка
          priceFromTiyin: Math.min(...items.map((i) => i.priceFromTiyin)),
          items,
        }))
        .sort((a, b) => a.order - b.order),
      note: 'Цена «от» — типовой случай, не оферта. Точную стоимость мастер называет до начала работ.',
    };
  }

  private item(it: ReturnType<PricingService['active']>['items'][number]) {
    return {
      id: it.id,
      name: it.name,
      unit: trValue(it.unit),
      category: it.category,
      priceFromTiyin: it.priceFromTiyin,
      priceToTiyin: it.priceToTiyin,
      normHours: it.normHours,
      /** Цена уже включает второго мастера (ТЗ 4.5) — на карточке это чип */
      isPaired: it.isPaired,
      /** Работа в несколько визитов: план сессий подтверждается на C-18 */
      isStaged: it.isStaged,
      /** Нужен этаж и лифт ещё на шаге 2 — под транспорт и подбор пары (ТЗ 17.3) */
      requiresEquipment: it.requiresEquipment,
      note: it.note,
    };
  }

  // ---------- Окна приезда (C-10) ----------

  /**
   * Доступные окна на несколько дней вперёд. Нормо-часы считаем по выбранным
   * позициям: показывать окна «на час», когда работы на четыре, — обман.
   */
  /**
   * Обслуживаем ли этот адрес.
   *
   * Зоны заведены в справочнике и до этой проверки ни на что не влияли: человек
   * оформлял визит туда, куда никто не поедет, и узнавал об этом отменой заявки.
   * Не запрещаем: границы зон в справочнике грубые, и отказать по совпадению
   * строки — хуже, чем предупредить. Диспетчер увидит пометку и решит.
   */
  /**
   * Обслуживаем ли адрес.
   *
   * Три исхода, а не два. Раньше их было два, и «Ташкент, ул. Навои 12» —
   * обычный городской адрес — получал «этого района нет в списке
   * обслуживаемых»: совпадение искалось только по названию района, а район в
   * адресе пишут редко. Человека пугали на ровном месте ещё до отправки заявки.
   */
  @Get('address-check')
  addressCheck(@Query('address') address?: string) {
    const a = (address ?? '').toLowerCase();
    const active = this.registry.zones.filter((z) => z.active);
    const zone = active.find((z) => a.includes(z.name.toLowerCase()))?.name ?? null;
    const cities = [...new Set(active.map((z) => z.city))];
    const city = cities.find((c) => a.includes(c.toLowerCase())) ?? null;
    return {
      // Город назван — значит доедем; какой именно район, уточнит диспетчер
      inZone: !!zone || !!city,
      zone,
      city,
      cities,
      message: zone
        ? `Обслуживаем: ${zone}`
        : city
          ? `Обслуживаем ${city} — район уточнит диспетчер`
          : 'Район не распознали. Заявку примем, диспетчер перезвонит и уточнит, сможем ли доехать',
    };
  }

  @Get('slots')
  slots(@Query('items') items?: string, @Query('days') days?: string) {
    const release = this.pricing.active();
    const ids = (items ?? '').split(',').filter(Boolean);
    let normHours = 0;
    for (const raw of ids) {
      const [id, qty] = raw.split(':');
      const item = release.items.find((i) => i.id === id);
      if (item?.normHours) normHours += item.normHours * (Number(qty) || 1);
    }
    if (normHours === 0) normHours = 1; // нормо-часы не заполнены (DEV-05 п.17)

    const daysAhead = Math.min(Math.max(Number(days) || 3, 1), 7);
    const out: Array<{ date: string; holiday?: string; windows: ReturnType<SchedulingService['availableWindows']> }> = [];
    const start = new Date();
    for (let i = 0; i < daysAhead; i++) {
      const d = new Date(start);
      d.setDate(d.getDate() + i);
      const date = d.toISOString().slice(0, 10);
      const windows = this.sched.availableWindows(date, normHours);
      // Пустой день не показываем вовсе: серые «занятые» слоты клиенту не нужны
      if (!windows.length) continue;
      // Праздник не запрещает вызов — в Навруз тоже течёт кран. Но человек
      // должен знать, что выбирает праздничный день: смен меньше, ждать дольше
      const holiday = this.registry.holidays.find((h) => h.date === date)?.name;
      out.push({ date, holiday, windows });
    }
    return {
      normHours,
      days: out,
      // Ночью «Срочно» не предлагаем: действует ночной тариф, наценки не стакаются
      urgentAvailable: new Date().getHours() >= 7 && new Date().getHours() < 22,
      waitlistAvailable: true,
    };
  }

  // ---------- Адреса (C-29) ----------

  @Get('addresses')
  addresses(@Req() req: AppRequest) {
    return { addresses: this.profiles.addresses(this.phone(req)) };
  }

  @Post('addresses')
  saveAddress(@Body() b: Record<string, unknown>, @Req() req: AppRequest) {
    return this.profiles.saveAddress(this.phone(req), b as never);
  }

  @Delete('addresses/:id')
  deleteAddress(@Param('id') id: string, @Req() req: AppRequest) {
    this.profiles.deleteAddress(this.phone(req), id);
    return { deleted: true };
  }

  // ---------- Заявки ----------

  /** C-06/C-24: список заявок клиента, свежие сверху */
  @Get('orders')
  async list(@Query('filter') filter: string | undefined, @Req() req: AppRequest) {
    const phone = this.phone(req);
    const all = await this.orders.list('t0');
    let mine = this.personal(all, phone);
    const active = ['new', 'estimated', 'assigned', 'master_departed', 'in_progress', 'addwork_approval', 'completed', 'verified', 'awaiting_payment'];
    if (filter === 'active') mine = mine.filter((o) => active.includes(o.status));
    if (filter === 'closed') mine = mine.filter((o) => ['closed', 'rated'].includes(o.status));
    if (filter === 'dispute') mine = mine.filter((o) => o.status === 'dispute');
    if (filter === 'warranty') mine = mine.filter((o) => o.graphType === 'warranty');

    const cards = mine
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .map((o) => this.view.card(o));
    // Отложенные рекомендации мастера — карточка внизу главной (C-06)
    const postponed = this.ops.postponedFor(this.personal(all, phone).map((o) => o.id));

    return {
      orders: cards,
      // Что ждёт ответа прямо сейчас — отдельным слоем, а не спрятано
      // внутрь карточки: пока клиент не откроет заявку, мастер стоит
      awaiting: cards.filter((c) => c.decision !== null),
      activeOrder: cards.find((c) => active.includes(c.status)) ?? null,
      // Карточка «Повторить» на C-06 — из последней закрытой заявки (ТЗ 17.17 п.2)
      repeatable: cards.find((c) => ['closed', 'rated'].includes(c.status)) ?? null,
      postponedRecommendations: postponed.map((r) => ({
        id: r.id,
        orderId: r.orderId,
        orderNumber: all.find((o) => o.id === r.orderId)?.number ?? '',
        lines: r.lines,
        comment: r.comment ?? null,
        totalTiyin: r.lines.reduce((s, l) => s + l.amountTiyin * l.qty, 0),
        createdAt: r.createdAt,
      })),
      /**
       * Что сейчас на гарантии.
       *
       * Самое сильное обещание сервиса до сих пор молчало: гарантия была
       * видна только внутри карточки закрытой заявки, и человек не знал,
       * что у него три работы под защитой. А знание об этом — ровно то,
       * что заставляет позвонить нам, а не соседу с дрелью.
       */
      warranty: (() => {
        const now = Date.now();
        const covered = this.personal(all, phone)
          .map((o) => ({ order: o, until: this.view.warrantyUntil(o) }))
          .filter((x): x is { order: OrderRecord; until: string } => !!x.until && new Date(x.until).getTime() > now)
          .sort((a, b) => a.until.localeCompare(b.until));
        return {
          count: covered.length,
          // Ближайшая к истечению: о ней имеет смысл говорить, а не о самой свежей
          nextUntil: covered[0]?.until ?? null,
          nextTitle: covered[0] ? (covered[0].order.lines[0]?.name ?? covered[0].order.description) : null,
        };
      })(),
      /**
       * Техника, которой пора заняться.
       *
       * Регламентное напоминание жило внутри экрана «Моя техника», куда
       * заходят раз в полгода — то есть ровно тогда, когда напоминание уже
       * не нужно. Здесь оно попадается на глаза само.
       */
      equipmentDue: this.equipmentDue(phone, all),
      /**
       * Первый вход: заявок нет и не было.
       *
       * Раньше человек видел кнопку «Вызвать мастера» и плашку аварии — и ни
       * слова о том, как это устроено и сколько стоит приезд. Самый частый
       * вопрос перед первым вызовом именно про деньги, и молчание о них
       * читается как «сориентируем на месте».
       */
      firstRun: mine.length === 0 ? this.firstRunHints() : null,
      empty: 'Пока нет заявок',
    };
  }

  /**
   * Что рассказать тому, кто вызывает мастера впервые.
   *
   * Цену выезда берём из прайса, а не пишем текстом: она меняется релизами,
   * и зашитая строка однажды разойдётся с настоящим счётом.
   */
  private firstRunHints() {
    const diagnostics = this.pricing
      .active()
      .items.find((i) => /выезд|диагност|осмотр/i.test(i.name));
    return {
      steps: [
        { title: 'Опишите, что случилось', text: 'Можно словами и фотографией — подбирать работы по каталогу не обязательно' },
        { title: 'Мастер приедет в выбранное окно', text: 'Назначим за час, окно подтвердим отдельно' },
        { title: 'Цену назовёт до начала работ', text: 'Работы начнутся только после вашего подтверждения' },
      ],
      visitPriceTiyin: diagnostics?.priceFromTiyin ?? null,
      visitNote: diagnostics
        ? 'Столько стоит приезд и диагностика, если от работ откажетесь. Согласитесь — сумма зачтётся'
        : null,
      warrantyDays: this.view.warrantyDays,
    };
  }

  /**
   * Техника, у которой вышел срок обслуживания.
   *
   * Периодичность зависит от типа: кондиционер чистят раз в полгода, котёл
   * и водонагреватель — раз в год. Считаем от последней работы по этой
   * технике, а не от даты установки: если её обслуживали месяц назад,
   * напоминать нечего.
   */
  private equipmentDue(phone: string, all: OrderRecord[]) {
    const periodDays = (type: string): number => {
      const t = type.toLowerCase();
      if (t.includes('кондицион')) return 180;
      return 365;
    };
    const closed = all
      .filter((o) => o.clientPhone === phone && !o.locationId && ['closed', 'rated'].includes(o.status))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    return this.ops
      .assetsOf(phone)
      .map((a) => {
        const last = closed.find(
          (o) => o.id === a.orderId || o.description.toLowerCase().includes(a.type.toLowerCase()),
        );
        const since = new Date(last?.createdAt ?? a.createdAt).getTime();
        const days = Math.floor((Date.now() - since) / 86_400_000);
        return {
          id: a.id,
          title: [a.type, a.brand, a.model].filter(Boolean).join(' '),
          type: a.type,
          daysSinceService: days,
          periodDays: periodDays(a.type),
          due: days >= periodDays(a.type),
        };
      })
      .filter((x) => x.due)
      .sort((a, b) => b.daysSinceService - a.daysSinceService);
  }

  @Get('orders/:id')
  async one(@Param('id') id: string, @Req() req: AppRequest) {
    const order = await this.mine(req, id);
    const all = await this.orders.list('t0');
    const jobsDone = order.masterId
      ? all.filter((o) => o.masterId === order.masterId && ['closed', 'rated'].includes(o.status)).length
      : undefined;
    return this.view.full(order, this.phone(req), jobsDone);
  }

  /**
   * C-13: отправка заявки.
   *
   * Долг блокирует создание — кроме аварийной (ТЗ 4.4). Проверку делает
   * OrdersService, здесь только понятная клиенту причина.
   */
  @Post('orders')
  async create(
    @Body()
    b: {
      items?: Array<{ priceItemId: string; qty?: number }>;
      description?: string;
      photos?: string[];
      address?: string;
      lat?: number;
      lng?: number;
      addressId?: string;
      saveAddress?: boolean;
      urgency?: 'normal' | 'urgent' | 'emergency';
      timeMode?: 'slot' | 'urgent' | 'waitlist';
      slotDate?: string;
      slotStartMin?: number;
      promoCode?: string;
      floor?: string;
      hasLift?: boolean;
      needRiser?: boolean;
      needCommonArea?: boolean;
      accessConfirmed?: boolean;
      accessAt?: string;
      source?: 'category' | 'search' | 'repeat' | 'emergency';
    },
    @Req() req: AppRequest,
  ) {
    const phone = this.phone(req);
    const profile = this.profiles.get(phone);
    const address = b.address?.trim();
    if (!address) throw new BadRequestException({ code: 'ADDRESS_REQUIRED', message: 'Укажите улицу и дом' });

    const items = (b.items ?? []).filter((i) => i.priceItemId);
    const urgency = b.urgency ?? (b.timeMode === 'urgent' ? 'urgent' : 'normal');
    if (!items.length && !b.description?.trim()) {
      throw new BadRequestException({
        code: 'WORK_OR_DESCRIPTION_REQUIRED',
        message: 'Выберите работу или опишите проблему словами',
      });
    }

    const saved = b.addressId ? profile.addresses.find((a) => a.id === b.addressId) : undefined;
    const order = await this.orders.create(
      't0',
      {
        clientPhone: phone,
        clientName: profile.fullName || undefined,
        address,
        lat: b.lat,
        lng: b.lng,
        description: b.description?.trim(),
        urgency,
        source: 'app',
        promoCode: b.promoCode,
        items,
        // «Запомнить мастера» с прошлой заявки: распределение поднимет его выше,
        // если он свободен и подходит по навыкам
        preferredMasterId: profile.favoriteMasterId,
        requestedWindow: {
          mode: b.timeMode ?? 'slot',
          date: b.slotDate,
          startMin: b.slotStartMin,
          endMin: b.slotStartMin == null ? undefined : b.slotStartMin + 120,
        },
        commonAreaAccess:
          b.needRiser || b.needCommonArea
            ? {
                needRiser: !!b.needRiser,
                needCommonArea: !!b.needCommonArea,
                confirmed: b.accessConfirmed,
                confirmedAt: b.accessAt,
              }
            : undefined,
        // Этаж и лифт спрашивают на шаге 2 только для парных работ и работ
        // с оборудованием; остальные детали клиент уточнит на C-50
        addressDetails:
          saved || b.floor || b.hasLift != null
            ? {
                apartment: saved?.apartment,
                entrance: saved?.entrance,
                floor: b.floor || saved?.floor,
                intercom: saved?.intercom,
                hasLift: b.hasLift ?? saved?.hasLift,
                comment: saved?.comment,
                at: new Date().toISOString(),
              }
            : undefined,
      },
      phone,
    );

    const saveCount = this.photos.saveMany(order, b.photos);
    if (b.saveAddress) {
      this.profiles.saveAddress(phone, { street: address, floor: b.floor, hasLift: b.hasLift, lat: b.lat, lng: b.lng });
    }
    this.audit.write({
      actorPhone: phone,
      action: 'client.order_created',
      entity: 'Order',
      entityId: order.id,
      payload: {
        number: order.number,
        items: items.length,
        photos: saveCount,
        urgency,
        source: b.source ?? 'category',
        // Адрес вне зон покрытия — в аудите, чтобы диспетчер и разбор потом
        // видели, что заявка приехала из района, который мы не обслуживаем
        outOfZone: !this.addressCheck(address).inZone,
      },
    });
    return { ...this.view.full(order, phone), coverage: this.addressCheck(address) };
  }

  /** C-13: детект дубля — похожая заявка того же клиента за последние сутки */
  @Get('orders-duplicate-check')
  async duplicateCheck(@Query('address') address: string | undefined, @Req() req: AppRequest) {
    const phone = this.phone(req);
    const all = await this.orders.list('t0');
    const dayAgo = Date.now() - 24 * 3_600_000;
    const dup = all.find(
      (o) =>
        o.clientPhone === phone &&
        !o.locationId &&
        new Date(o.createdAt).getTime() > dayAgo &&
        !['closed', 'rated', 'cancelled'].includes(o.status) &&
        (!address || o.address.trim().toLowerCase() === address.trim().toLowerCase()),
    );
    return { duplicate: dup ? this.view.card(dup) : null };
  }

  // ---------- Промокод (C-13) ----------

  @Post('promo/check')
  async check(@Body() b: { code?: string }, @Req() req: AppRequest) {
    const code = b?.code?.trim();
    if (!code) throw new BadRequestException({ code: 'CODE_REQUIRED', message: 'Введите код' });
    // evaluate, а не redeem: промокод списывается при использовании,
    // иначе проверка на экране «Итог» сожгла бы его без заявки
    const phone = this.phone(req);
    const v = this.promo.evaluate(code, { phone, isFirstOrder: await this.isFirstOrder(phone) });
    return {
      valid: v.valid,
      discountPercent: v.discountPercent,
      firstOrderOnly: v.firstOrderOnly,
      message: v.valid ? `Промокод применён: −${v.discountPercent}%` : v.message,
    };
  }

  /**
   * Первая ли это заявка.
   *
   * Считаем по факту вызова мастера, а не по дате регистрации: человек мог
   * завести аккаунт год назад и ни разу ничего не заказать — для него
   * приветственная скидка ровно так же уместна, как для вчерашнего.
   * Отменённые не считаем: заявка, которой не было, первой быть не мешает.
   */
  private async isFirstOrder(phone: string): Promise<boolean> {
    const all = await this.orders.list('t0');
    return !this.personal(all, phone).some((o) => o.status !== 'cancelled');
  }

  // ---------- Кошелёк промокодов (C-30) ----------

  /**
   * Мои промокоды.
   *
   * Кошелёк, а не список кампаний: человек видит только то, что ввёл сам,
   * плюс приветственный код, если он ему ещё положен. Скидка пересчитывается
   * на каждом показе — процент мог измениться, а код закончиться, и хранить
   * его копию значило бы обещать скидку, которой уже нет.
   */
  @Get('promos')
  async promos(@Req() req: AppRequest) {
    const phone = this.phone(req);
    const first = await this.isFirstOrder(phone);
    const wallet = this.profiles.get(phone).promoWallet ?? [];
    const items = wallet.map((w) => {
      const v = this.promo.evaluate(w.code, { phone, isFirstOrder: first });
      return {
        code: w.code,
        addedAt: w.addedAt,
        usedAt: w.usedAt ?? null,
        orderNumber: w.orderNumber ?? null,
        discountPercent: w.usedAt ? 0 : v.discountPercent,
        usable: !w.usedAt && v.valid,
        firstOrderOnly: v.firstOrderOnly,
        note: w.usedAt ? `Использован в заявке ${w.orderNumber ?? ''}`.trim() : v.message,
      };
    });
    // Приветственный код не выдаём вторично: если он уже в кошельке или
    // потрачен, предлагать его снова — обещать скидку, которой нет
    const welcome = this.promo.evaluate(WELCOME_CODE, { phone, isFirstOrder: first });
    const alreadyHas = wallet.some((w) => w.code === WELCOME_CODE);
    return {
      items,
      welcome:
        welcome.valid && !alreadyHas
          ? { code: WELCOME_CODE, discountPercent: welcome.discountPercent }
          : null,
      note: 'Скидка считается от стоимости работ и применяется при оплате',
    };
  }

  @Post('promos')
  async addPromo(@Body() b: { code?: string }, @Req() req: AppRequest) {
    const code = b?.code?.trim();
    if (!code) throw new BadRequestException({ code: 'CODE_REQUIRED', message: 'Введите промокод' });
    const phone = this.phone(req);
    const v = this.promo.evaluate(code, { phone, isFirstOrder: await this.isFirstOrder(phone) });
    // Негодный код в кошелёк не кладём: список «сохранённых, но не работающих»
    // скидок хуже отказа — человек рассчитывает на них при оплате
    if (!v.valid) throw new BadRequestException({ code: 'PROMO_INVALID', message: v.message });
    this.profiles.addPromo(phone, code);
    this.audit.write({
      actorPhone: phone,
      action: 'client.promo_saved',
      entity: 'ClientProfile',
      entityId: phone,
      payload: { code: code.toUpperCase() },
    });
    return { ok: true, code: code.toUpperCase(), discountPercent: v.discountPercent, message: v.message };
  }

  @Delete('promos/:code')
  removePromo(@Param('code') code: string, @Req() req: AppRequest) {
    this.profiles.removePromo(this.phone(req), code);
    return { ok: true };
  }

  /**
   * Забыть мастера, которого клиент когда-то попросил запоминать.
   *
   * Обещание «будем звать его» должно быть отзываемым в том же приложении,
   * где его дали, — иначе единственный способ передумать это звонок в поддержку.
   */
  @Delete('favorite-master')
  forgetFavoriteMaster(@Req() req: AppRequest) {
    this.profiles.setFavoriteMaster(this.phone(req), undefined, undefined);
    this.audit.write({
      actorPhone: this.phone(req),
      action: 'client.favorite_master_cleared',
      entity: 'ClientProfile',
      entityId: this.phone(req),
      payload: {},
    });
    return { ok: true, message: 'Больше не будем предлагать этого мастера первым' };
  }

  // ---------- Способы оплаты и история платежей ----------

  /**
   * Чем можно платить и чем человек платит обычно.
   *
   * Сохранённых карт здесь нет и не будет до договора с мерчантом: номер карты
   * хранить у себя нельзя, а её токен выдаёт Payme или Click после 3-D Secure.
   * Пока помним только выбор — чтобы не спрашивать одно и то же каждый раз.
   */
  @Get('payment-methods')
  async paymentMethods(@Req() req: AppRequest) {
    const phone = this.phone(req);
    const profile = this.profiles.get(phone);
    const all = await this.orders.list('t0');
    const mine = this.personal(all, phone);

    // Чем платил в прошлый раз — сильная подсказка, даже если предпочтение
    // не выставлено: люди редко меняют способ от заявки к заявке
    const last = mine
      .filter((o) => o.payment?.status === 'succeeded')
      .sort((a, b) => (b.payment!.at ?? '').localeCompare(a.payment!.at ?? ''))[0]?.payment?.provider;

    return {
      preferred: profile.preferredPaymentProvider ?? null,
      lastUsed: last ?? null,
      methods: [
        { code: 'payme', title: 'Payme', note: 'Оплата в приложении Payme' },
        { code: 'click', title: 'Click', note: 'Оплата через Click' },
        { code: 'uzum', title: 'Uzum', note: 'Оплата через Uzum' },
        { code: 'card', title: 'Банковская карта', note: 'Ввод реквизитов на защищённой странице банка' },
        { code: 'cash', title: 'Наличные мастеру', note: 'Мастер зафиксирует оплату в своём приложении' },
      ],
      note: 'Карту привяжем, когда подключим платёжного провайдера. Пока запоминаем только способ',
    };
  }

  @Post('payment-methods')
  setPaymentMethod(@Body() b: { provider?: string }, @Req() req: AppRequest) {
    const p = this.profiles.setPreferredPayment(this.phone(req), b?.provider);
    this.audit.write({
      actorPhone: this.phone(req),
      action: 'client.payment_method_set',
      entity: 'ClientProfile',
      entityId: this.phone(req),
      payload: { provider: p.preferredPaymentProvider ?? null },
    });
    return {
      ok: true,
      preferred: p.preferredPaymentProvider ?? null,
      message: p.preferredPaymentProvider ? 'Запомнили — будем предлагать этот способ первым' : 'Будем спрашивать каждый раз',
    };
  }

  /**
   * История платежей.
   *
   * Открывают её не из любопытства, а когда сверяют выписку по карте: там
   * списание без пояснений, и надо понять, за что. Поэтому в строке — дата,
   * сумма, способ и ссылка на акт, а не только номер заявки.
   */
  @Get('payments')
  async payments(@Req() req: AppRequest) {
    const phone = this.phone(req);
    const all = await this.orders.list('t0');
    const mine = this.personal(all, phone).filter((o) => o.payment);

    const rows = mine
      .map((o) => ({
        orderId: o.id,
        number: o.number,
        title: o.lines[0]?.name ?? o.description,
        address: o.address,
        provider: o.payment!.provider,
        status: o.payment!.status,
        amountTiyin: o.payment!.amountTiyin,
        tipTiyin: o.tipTiyin ?? 0,
        at: o.payment!.at,
      }))
      .sort((a, b) => b.at.localeCompare(a.at));

    const succeeded = rows.filter((r) => r.status === 'succeeded');
    return {
      payments: rows,
      totalTiyin: succeeded.reduce((s, r) => s + r.amountTiyin, 0),
      tipsTiyin: succeeded.reduce((s, r) => s + r.tipTiyin, 0),
      // Наличные, которые мастер ещё не подтвердил, — не долг, но и не оплата
      pending: rows.filter((r) => r.status === 'pending').length,
      empty: 'Оплат пока не было',
    };
  }

  // ---------- Жалобы (C-23) ----------

  /**
   * Статус жалобы клиент видит тот, что стоит в реестре качества, а не свою
   * копию: разбор идёт там, и расхождение означало бы «у вас решено, у нас нет».
   */
  private withQualityStatus(rec: ReturnType<ClientProfilesService['complaints']>[number]) {
    if (!rec.qualityId) return rec;
    const q = this.quality.complaints.find((c) => c.id === rec.qualityId);
    if (!q) return rec;
    return {
      ...rec,
      status: q.status === 'rejected' ? ('closed' as const) : q.status,
      resolution: q.resolution ?? rec.resolution,
      answerDueAt: q.slaFirstResponseAt,
      answeredAt: q.firstResponseAt ?? null,
    };
  }

  @Get('complaints')
  complaints(@Req() req: AppRequest) {
    return {
      complaints: this.profiles.complaints(this.phone(req)).map((c) => this.withQualityStatus(c)),
      types: ['Качество работы', 'Поведение мастера', 'Сроки', 'Деньги', 'Сервис и диспетчер', 'Приложение', 'Другое'],
      empty: 'Жалоб нет — и хорошо',
    };
  }

  @Post('complaints')
  async fileComplaint(
    @Body() b: { type?: string; text?: string; orderId?: string; orderNumber?: string; photos?: string[] },
    @Req() req: AppRequest,
  ) {
    const rec = this.profiles.fileComplaint(this.phone(req), b ?? {});

    // Та же жалоба заводится в реестре качества: там SLA первого ответа,
    // ответственный и плейбук резолюции. Без этого шага жалоба видна только
    // самому клиенту и разбирать её некому.
    const order = rec.orderId ? await this.orders.record('t0', rec.orderId).catch(() => null) : null;
    const profile = this.profiles.get(this.phone(req));
    const sites = this.crm.locationsForPhone(this.phone(req));
    const q = this.quality.fileComplaint({
      orderId: rec.orderId,
      orderNumber: rec.orderNumber ?? order?.number,
      complainantPhone: this.phone(req),
      complainantName: profile.fullName || undefined,
      // Жалоба руководителя организации идёт сразу старшему смены (ТЗ 17.10)
      isOrgManager: sites.some((s) => s.rep.approvalLimitTiyin === null),
      type: complaintCode(rec.type),
      text: rec.text,
      masterId: order?.masterId,
      masterName: order?.masterName,
    });
    rec.qualityId = q.id;
    this.profiles.touch();

    this.audit.write({
      actorPhone: this.phone(req),
      action: 'client.complaint_filed',
      entity: 'Complaint',
      entityId: q.id,
      payload: { type: q.type, orderId: rec.orderId ?? null, source: 'client_app' },
    });
    return {
      complaint: this.withQualityStatus(rec),
      message: 'Жалоба зарегистрирована. Ответим в течение 2 часов (8:00–22:00)',
    };
  }

  // ---------- Телеметрия (DEV-08 §5) ----------

  /**
   * Воронка создания заявки и оплат. Складываем в аудит: отдельного
   * хранилища событий у платформы пока нет, а терять воронку до его
   * появления — значит не узнать, на каком шаге отваливаются клиенты.
   */
  @Post('telemetry')
  track(@Body() b: { event?: string; params?: Record<string, unknown> }, @Req() req: AppRequest) {
    if (!b?.event) throw new BadRequestException({ code: 'EVENT_REQUIRED', message: 'Не указано событие' });
    this.audit.write({
      actorPhone: this.phone(req),
      action: `client_app.${b.event}`,
      entity: 'Telemetry',
      payload: b.params ?? {},
    });
    return { ok: true };
  }

  /**
   * Демо-наполнение под свой номер: заявки во всех состояниях, решения,
   * роли на точках, деньги. Нужно для показа и приёмки — приложение целиком
   * на данных, и без них половина экранов недостижима.
   */
  @Post('demo/seed')
  async seedDemo(@Req() req: AppRequest) {
    const r = await this.demo.seed(this.phone(req));
    this.audit.write({
      actorPhone: this.phone(req),
      action: 'client.demo_seeded',
      entity: 'ClientProfile',
      entityId: this.phone(req),
      payload: { orders: r.orders, contexts: r.contexts },
    });
    return r;
  }

  /**
   * C-28 «Моя техника» (фаза 2). Единицы техники заводит мастер на объекте —
   * из них растут регламентные напоминания и история обслуживания.
   */
  @Get('equipment')
  async equipment(@Req() req: AppRequest) {
    const phone = this.phone(req);
    const assets = this.ops.assetsOf(phone);
    const all = await this.orders.list('t0');
    return {
      items: assets.map((a) => {
        const history = all
          .filter((o) => o.clientPhone === phone && !o.locationId && ['closed', 'rated'].includes(o.status))
          .filter((o) => o.id === a.orderId || o.description.toLowerCase().includes(a.type.toLowerCase()))
          .map((o) => ({
            id: o.id,
            number: o.number,
            title: o.lines[0]?.name ?? o.description,
            at: new Date(o.createdAt).toISOString(),
            totalTiyin: o.totalFromTiyin,
          }));
        return {
          id: a.id,
          type: a.type,
          brand: a.brand ?? null,
          model: a.model ?? null,
          year: a.year ?? null,
          // Шильдик не читался — мастер отметил это на месте (M-24)
          plateUnreadable: a.plateUnreadable,
          linkedWork: a.linkedWork,
          installedAt: a.createdAt,
          history,
          lastServiceAt: history[0]?.at ?? null,
        };
      }),
      empty: 'Здесь появится техника после первого визита мастера',
    };
  }

  /**
   * Клиент правит карточку своей техники.
   *
   * Запись заводит мастер по шильдику, а шильдик бывает выцветшим или
   * заклеенным. Владелец знает марку и год точнее — и до этого поправить
   * их было негде.
   */
  @Post('equipment/:id')
  updateEquipment(
    @Param('id') id: string,
    @Body() b: { type?: string; brand?: string; model?: string; year?: number },
    @Req() req: AppRequest,
  ) {
    const rec = this.ops.updateAsset(id, this.phone(req), {
      type: b?.type,
      brand: b?.brand,
      model: b?.model,
      year: b?.year,
    });
    this.audit.write({
      actorPhone: this.phone(req),
      action: 'client.equipment_updated',
      entity: 'Asset',
      entityId: id,
      payload: { type: rec.type, brand: rec.brand ?? null, model: rec.model ?? null },
    });
    return { ok: true, item: rec };
  }

  @Delete('equipment/:id')
  removeEquipment(@Param('id') id: string, @Req() req: AppRequest) {
    this.ops.removeAsset(id, this.phone(req));
    this.audit.write({
      actorPhone: this.phone(req),
      action: 'client.equipment_removed',
      entity: 'Asset',
      entityId: id,
      payload: {},
    });
    return { ok: true, message: 'Убрали из списка техники' };
  }

  /**
   * Справочные строки, которые не должны жить в коде экрана.
   *
   * Причины отмены берём из справочника админки: раньше пять строк были зашиты
   * прямо здесь, и правка справочника ни на что не влияла. Оставляем только те,
   * что клиент может назвать сам — «молчание утверждающего» и «вне зоны» ставит
   * система, предлагать их человеку незачем.
   */
  @Get('dictionaries')
  dictionaries() {
    const clientReasons = this.registry.cancelReasons.filter((r) => /клиент|дубл|смет/i.test(r));
    return {
      cancelReasons: [...clientReasons, 'Другое'],
      disputeReasons: ['Качество работы', 'Не согласен с суммой', 'Приехал не тот мастер', 'Другое'],
      quickMessages: ['Я задерживаюсь', 'Позвоните мне', 'Домофон не работает'],
      tipPresets: [1_000_000, 2_000_000, 5_000_000],
      emergencyHint: 'Затопление, короткое замыкание, запах газа. При запахе газа сначала звоните 104.',
      slotsNote: `Окна показываем двухчасовые: ${HHMM(600)}–${HHMM(720)} и так далее`,
      todayDate: today(),
    };
  }
}
