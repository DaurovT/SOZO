import { Injectable } from '@nestjs/common';
import { uuidv7 } from '@sozo/kernel';
import type { OrderStatus } from '@sozo/contracts';
import { BillingService } from '../billing/billing.service';
import { CrmService, type LocationRec } from '../crm/crm.service';
import { FieldService } from '../field/field.service';
import { LoyaltyService } from '../loyalty/loyalty.module';
import { MasterOpsService } from '../master-api/master-ops.service';
import { MastersService } from '../masters/masters.module';
import type { OrderRecord } from '../orders/order.repository';
import { OrdersService } from '../orders/orders.service';
import { StateStore } from '../../common/state-store';
import { PricingService } from '../pricing/pricing.service';
import { QualityService } from '../quality/quality.service';
import { SchedulingService } from '../scheduling/scheduling.service';
import { ClientPhotoService } from './client-photo.service';
import { ClientProfilesService } from './client-profiles.service';

/**
 * Демо-наполнение под конкретный номер (только для показа и приёмки).
 *
 * Приложение целиком построено на данных: без заявок не видно ни карточки
 * мастера, ни сметы, ни оплаты, ни гарантии — экраны есть, а попасть на них
 * нельзя. Этот сервис создаёт полную картину: заявки во всех состояниях,
 * решения, ждущие клиента, роли на точках и деньги организации.
 *
 * Статусы проставляются напрямую, минуя граф переходов: проводить демо-заявку
 * через все гейты (фото, оплата, модерация) значило бы поднимать полсистемы
 * ради витрины. Настоящие заявки по-прежнему ходят только через машину состояний.
 */

const PHOTO = {
  before: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEUlEQVR4nGPomzwfK2IYWhIAvw1wAejpkxAAAAAASUVORK5CYII=',
  during: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEUlEQVR4nGP4t50fK2IYWhIAYxxxASyxWyIAAAAASUVORK5CYII=',
  after: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEUlEQVR4nGPQX5yNFTEMLQkA6IpPQU3dVpMAAAAASUVORK5CYII=',
};

const MASTER_NAME = 'Алишер Каримов';

/** Кто делает заявку: общий контекст для всех демо-заявок номера */
type DemoCtx = {
  phone: string;
  masterId: string | undefined;
  masterName: string;
  pick: (re: RegExp) => { id: string; name: string };
};

type DemoOrderOpts = {
  status: OrderStatus;
  item: RegExp;
  qty?: number;
  address?: string;
  description?: string;
  urgency?: 'normal' | 'urgent' | 'emergency';
  daysAgo?: number;
  withMaster?: boolean;
  photos?: Array<keyof typeof PHOTO>;
  approved?: number;
  materials?: boolean;
  rating?: number;
  /** Пауза внутри in_progress: суб-состояние, статус не меняет (DEV-10 §3) */
  pause?: string;
  /** Оплата клиентом: наполняет экран «Оплаты и способы» (C-52) */
  payment?: { provider: 'payme' | 'click' | 'uzum' | 'card' | 'cash'; status: 'pending' | 'succeeded'; amountTiyin: number };
  tipTiyin?: number;
};

/** Чек-лист планового обхода — без него акт не отправляется (ТЗ 9.3) */
const DEMO_CHECKLIST = [
  { zone: 'Торговый зал', ok: true },
  { zone: 'Подсобное помещение', ok: false, note: 'подтекает стояк' },
  { zone: 'Электрощитовая', ok: false, note: 'оплавлен автомат' },
  { zone: 'Санузел', ok: true },
];

@Injectable()
export class DemoSeedService {
  constructor(
    private readonly orders: OrdersService,
    private readonly pricing: PricingService,
    private readonly crm: CrmService,
    private readonly field: FieldService,
    private readonly billing: BillingService,
    private readonly loyalty: LoyaltyService,
    private readonly masters: MastersService,
    private readonly ops: MasterOpsService,
    private readonly profiles: ClientProfilesService,
    private readonly photos: ClientPhotoService,
    private readonly sched: SchedulingService,
    private readonly quality: QualityService,
    private readonly store: StateStore,
  ) {}

  async seed(phone: string): Promise<{ orders: number; contexts: number; message: string }> {
    // Повторное нажатие не должно плодить копии: если заявки уже есть,
    // достраиваем только недостающее (роли, деньги, акт осмотра)
    const existing = (await this.orders.list('t0')).filter((o) => o.clientPhone === phone);
    const alreadySeeded = existing.length >= 10;

    const master = this.masters.list().find((m) => m.status === 'active') ?? this.masters.list()[0];
    const items = this.pricing.active().items;
    const pick = (re: RegExp) => items.find((i) => re.test(i.name)) ?? items[1];

    this.shifts();

    if (!alreadySeeded) {
      await this.b2cOrders(phone, master?.id, master?.fullName ?? MASTER_NAME, pick);
    }
    this.b2cProfile(phone);
    const contexts = this.b2bRoles(phone);
    if (!alreadySeeded) {
      await this.b2bOrders(phone, master?.id, master?.fullName ?? MASTER_NAME, pick);
    } else {
      await this.inspectionAct(phone, master?.id, master?.fullName ?? MASTER_NAME);
      await this.equipment(phone);
    }
    this.b2bMoney(phone);
    // Состояния, которых нет в основном наборе, — на каждом запуске:
    // сид могли прогнать до того, как их сюда добавили
    await this.b2cStates({ phone, masterId: master?.id, masterName: master?.fullName ?? MASTER_NAME, pick });

    const all = await this.orders.list('t0');
    const mine = all.filter((o) => o.clientPhone === phone).length;
    return {
      orders: mine,
      contexts,
      message: 'Демо-данные созданы. Откройте «Кто вы сегодня?» в профиле, чтобы переключать роли',
    };
  }

  /**
   * Смены на две недели вперёд.
   *
   * Без них экран выбора времени пуст: окна берутся из лент мастеров, а ленты
   * — из смен, которые обычно ставит диспетчер. На чистой базе диспетчера нет,
   * и демо упирается в «свободных окон нет» на втором шаге создания заявки.
   */
  private shifts(): void {
    const active = this.masters.list().filter((m) => m.status === 'active');
    if (!active.length) return;
    const day = new Date();
    for (let i = 0; i < 14; i++) {
      this.sched.seedDay(day.toISOString().slice(0, 10), active, active[0]?.id);
      day.setDate(day.getDate() + 1);
    }
  }

  // ---------------- B2C ----------------

  private async b2cOrders(
    phone: string,
    masterId: string | undefined,
    masterName: string,
    pick: (re: RegExp) => { id: string; name: string },
  ) {
    const mk = (opts: DemoOrderOpts) => this.makeOrder({ phone, masterId, masterName, pick }, opts);

    // Свежая — ещё не оценена
    await mk({ status: 'new', item: /розетк/i, description: 'Искрит розетка на кухне', withMaster: false, daysAgo: 0 });

    // Назначена: виден мастер и окно
    await mk({ status: 'assigned', item: /смесител/i, description: 'Течёт под мойкой', daysAgo: 0 });

    // Мастер выехал — на экране появляется карта
    await mk({ status: 'master_departed', item: /чистк|кондицион/i, description: 'Кондиционер не холодит', daysAgo: 0 });

    // В работе + смета ждёт подтверждения (C-15)
    await mk({
      status: 'in_progress',
      item: /смесител/i,
      qty: 2,
      description: 'Замена смесителя и подводки',
      photos: ['before'],
      daysAgo: 0,
    });

    // В работе + выбор уровня запчасти (C-15, вилка)
    const tier = await mk({ status: 'in_progress', item: /кран|вентил|смесител/i, description: 'Нужна замена детали', photos: ['before'], approved: 24_000_000, daysAgo: 0 });
    this.ops.sendSpareTiers({
      orderId: tier.id,
      masterId: tier.masterId ?? 'demo',
      partName: 'Смеситель',
      mode: 'catalog',
      variants: [
        { tier: 'economy', title: 'Эконом', amountTiyin: 20_000_000, note: 'Китай, гарантия 1 год' },
        { tier: 'standard', title: 'Стандарт', amountTiyin: 42_000_000, note: 'Vidima, гарантия 3 года' },
        { tier: 'premium', title: 'Премиум', amountTiyin: 78_000_000, note: 'Grohe, гарантия 5 лет' },
      ],
    });

    // Вынужденная доп-работа (C-16)
    const addwork = await mk({
      status: 'addwork_approval',
      item: /труб|стояк|смесител/i,
      description: 'Замена участка трубы',
      photos: ['before', 'during'],
      approved: 32_000_000,
      daysAgo: 0,
    });
    this.ops.sendAddwork({
      orderId: addwork.id,
      masterId: addwork.masterId ?? 'demo',
      photoCount: 2,
      variants: [
        {
          kind: 'minimal',
          title: 'Минимальный — безопасная времянка',
          totalTiyin: 18_000_000,
          lines: [{ name: 'Времянка на резьбе', amountTiyin: 18_000_000, qty: 1 }],
        },
        {
          kind: 'full',
          title: 'Полный — полное устранение',
          totalTiyin: 46_000_000,
          lines: [
            { name: 'Замена участка трубы', amountTiyin: 38_000_000, qty: 1 },
            { name: 'Восстановление короба', amountTiyin: 8_000_000, qty: 1 },
          ],
        },
      ],
    });

    // Апсейл — рекомендация мастера (C-17)
    const upsell = await mk({ status: 'in_progress', item: /подводк|смесител/i, description: 'Плановая замена смесителя', approved: 28_000_000, photos: ['before'], daysAgo: 0 });
    this.ops.sendRecommendation({
      orderId: upsell.id,
      masterId: upsell.masterId ?? 'demo',
      lines: [{ name: 'Замена гибкой подводки', amountTiyin: 9_000_000, qty: 2 }],
      comment: 'Подводка на ладан дышит — лучше заменить, пока всё разобрано',
    });

    // Этапная работа — план визитов (C-18)
    const staged = await mk({ status: 'in_progress', item: /установк|монтаж|смесител/i, description: 'Работа в два визита', approved: 96_000_000, photos: ['before'], daysAgo: 1 });
    this.ops.planStages(staged.id, [
      { index: 1, title: 'Демонтаж и черновая', normHours: 3, pauseMinHours: 24, pauseMaxHours: 168, slotAt: new Date(Date.now() + 86_400_000).toISOString(), status: 'booked' },
      { index: 2, title: 'Чистовая установка', normHours: 2, pauseMinHours: 24, pauseMaxHours: 168, status: 'planned' },
    ]);

    // Выполнена — приёмка и оплата (C-19, C-20)
    const done = await mk({
      status: 'completed',
      item: /смесител/i,
      description: 'Замена смесителя',
      photos: ['before', 'after'],
      approved: 54_000_000,
      materials: true,
      daysAgo: 1,
    });
    done.acceptanceRequest = { at: new Date().toISOString(), pending: true, representative: null, absent: false };
    this.orders.touchOrder();

    // Закрыта, оценена, гарантия идёт (C-25, C-26, C-27)
    await mk({
      status: 'closed',
      item: /чистк|кондицион/i,
      description: 'Чистка кондиционера',
      photos: ['before', 'after'],
      approved: 18_000_000,
      rating: 5,
      daysAgo: 12,
    });

    // Спор (C-22)
    await mk({ status: 'dispute', item: /розетк|электр/i, description: 'Спор по стоимости работ', photos: ['after'], approved: 36_000_000, daysAgo: 5 });

    // Отменена — проверить серый перечёркнутый бейдж
    const cancelled = await mk({ status: 'cancelled', item: /двер|замок|смесител/i, description: 'Отменена клиентом', withMaster: false, daysAgo: 20 });

    await this.equipment(phone, cancelled.id);
  }

  /**
   * Техника клиента (C-28): её заводит мастер на объекте, из неё растут
   * регламентные напоминания и история обслуживания.
   */
  private async equipment(phone: string, orderId?: string) {
    if (this.ops.assetsOf(phone).length) return;
    const anchor = orderId ?? (await this.orders.list('t0')).find((o) => o.clientPhone === phone)?.id;
    if (!anchor) return;
    {
      this.ops.addAsset({
        orderId: anchor,
        clientPhone: phone,
        type: 'Кондиционер',
        brand: 'Artel',
        model: 'ART-12',
        year: 2023,
        plateUnreadable: false,
        linkedWork: ['Чистка кондиционера', 'Дозаправка фреоном'],
      });
      this.ops.addAsset({
        orderId: anchor,
        clientPhone: phone,
        type: 'Водонагреватель',
        brand: 'Ariston',
        model: 'ABS BLU',
        year: 2021,
        plateUnreadable: true,
        linkedWork: ['Замена ТЭНа', 'Чистка бака'],
      });
    }
  }

  /**
   * Одна демо-заявка в заданном состоянии.
   *
   * Статус ставится напрямую: гонять её через граф переходов значило бы
   * поднимать полсистемы (фото-гейты, оплату, модерацию) ради витрины.
   */
  private async makeOrder(ctx: DemoCtx, opts: DemoOrderOpts) {
    const item = ctx.pick(opts.item);
    const order = await this.orders.create(
      't0',
      {
        clientPhone: ctx.phone,
        clientName: 'Тимур',
        address: opts.address ?? 'ул. Навои 12',
        description: opts.description,
        urgency: opts.urgency,
        source: 'app',
        items: [{ priceItemId: item.id, qty: opts.qty ?? 1 }],
      },
      ctx.phone,
    );
    const rec = await this.orders.record('t0', order.id);
    const at = new Date(Date.now() - (opts.daysAgo ?? 0) * 86_400_000);
    rec.createdAt = at;
    rec.status = opts.status;
    rec.statusLog = this.chainTo(opts.status, at);
    if (opts.withMaster !== false && ctx.masterId) {
      rec.masterId = ctx.masterId;
      rec.masterName = ctx.masterName;
    }
    for (const stage of opts.photos ?? []) this.photos.save(rec, PHOTO[stage], undefined, stage);
    if (opts.approved) {
      rec.quotes.push({
        kind: 'approved',
        amountTiyin: opts.approved,
        approvedVia: 'app',
        note: 'Санкция клиента (демо)',
        at: at.toISOString(),
      });
    }
    if (opts.materials) {
      rec.materials = [
        {
          kind: 'spare_part',
          name: 'Смеситель Vidima',
          amountTiyin: 42_000_000,
          sourceChannel: 'partner_store',
          hasReceipt: true,
          priceTier: 'standard',
          at: at.toISOString(),
        },
        {
          kind: 'consumable',
          name: 'Лента ФУМ, герметик',
          amountTiyin: 3_500_000,
          sourceChannel: 'company_stock',
          hasReceipt: false,
          at: at.toISOString(),
        },
      ];
      rec.totalMaterialTiyin = 45_500_000;
    }
    if (opts.rating) rec.rating = opts.rating;
    if (opts.pause) {
      rec.pause = { reason: opts.pause, since: new Date(Date.now() - 3 * 3_600_000).toISOString(), until: new Date(Date.now() + 5 * 3_600_000).toISOString() };
    }
    if (opts.payment) {
      rec.payment = { ...opts.payment, at: new Date(at.getTime() + 3_600_000).toISOString() };
    }
    if (opts.tipTiyin) rec.tipTiyin = opts.tipTiyin;
    this.orders.touchOrder();
    return rec;
  }

  /**
   * Состояния, до которых обычным путём не добраться, а увидеть надо:
   * оценена, проверена, ожидает оплаты, оценена клиентом, три вида паузы,
   * решённый спор и история оплат. Идемпотентно — сверяемся по описанию,
   * иначе повторный запуск сида плодил бы копии.
   */
  private async b2cStates(ctx: DemoCtx) {
    const all = await this.orders.list('t0');
    const mine = all.filter((o) => o.clientPhone === ctx.phone);
    const has = (description: string) => mine.some((o) => o.description === description);
    const mk = (opts: DemoOrderOpts) => this.makeOrder(ctx, opts);

    // Оценена: вилка есть, мастера ещё нет
    if (!has('Не закрывается замок входной двери')) {
      await mk({
        status: 'estimated',
        item: /замок|двер|розетк/i,
        description: 'Не закрывается замок входной двери',
        withMaster: false,
        daysAgo: 0,
      });
    }

    // Проверена диспетчером — деньги посчитаны, ждём оплаты клиента
    if (!has('Замена сифона под раковиной')) {
      await mk({
        status: 'verified',
        item: /сифон|смесител/i,
        description: 'Замена сифона под раковиной',
        photos: ['before', 'after'],
        approved: 38_000_000,
        materials: true,
        daysAgo: 2,
      });
    }

    // Ожидает оплаты — единственный статус, который даёт долг на C-06
    if (!has('Установка водонагревателя')) {
      await mk({
        status: 'awaiting_payment',
        item: /водонагрев|установк|смесител/i,
        description: 'Установка водонагревателя',
        photos: ['before', 'after'],
        approved: 62_000_000,
        daysAgo: 3,
      });
    }

    // Оценена клиентом — терминальное состояние с оплатой и чаевыми
    if (!has('Профилактика кондиционера в спальне')) {
      await mk({
        status: 'rated',
        item: /чистк|кондицион/i,
        description: 'Профилактика кондиционера в спальне',
        photos: ['before', 'after'],
        approved: 22_000_000,
        rating: 5,
        payment: { provider: 'payme', status: 'succeeded', amountTiyin: 22_000_000 },
        tipTiyin: 2_000_000,
        daysAgo: 8,
      });
    }

    // Три вида паузы: снаружи это один статус «в работе», а причины разные
    const pauses: Array<[string, string]> = [
      ['Ожидание материалов', 'Замена стояка в санузле'],
      ['Технологический перерыв', 'Штробление и укладка кабеля'],
      ['Заблокировано третьей стороной', 'Замена вводного автомата'],
    ];
    for (const [reason, description] of pauses) {
      if (has(description)) continue;
      await mk({
        status: 'in_progress',
        item: /труб|кабел|автомат|смесител/i,
        description,
        photos: ['before'],
        approved: 34_000_000,
        pause: reason,
        daysAgo: 1,
      });
    }

    // Наличные, которые мастер ещё не подтвердил: на C-52 это отдельная строка
    if (!has('Мелкий ремонт на кухне')) {
      await mk({
        status: 'closed',
        item: /розетк|смесител/i,
        description: 'Мелкий ремонт на кухне',
        photos: ['after'],
        approved: 14_000_000,
        payment: { provider: 'cash', status: 'pending', amountTiyin: 14_000_000 },
        daysAgo: 6,
      });
    }

    // Оплата картой по старой закрытой заявке — история на C-52
    const closed = mine.filter((o) => o.status === 'closed' && !o.payment);
    for (const o of closed.slice(0, 2)) {
      const rec = await this.orders.record('t0', o.id);
      rec.payment = {
        provider: 'click',
        status: 'succeeded',
        amountTiyin: rec.totalFromTiyin,
        at: new Date(new Date(rec.createdAt).getTime() + 4 * 3_600_000).toISOString(),
      };
      this.orders.touchOrder();
    }

    await this.disputes(ctx.phone, mine);
    this.complaintStates(ctx.phone);
  }

  /**
   * Спор виден клиенту только через реестр качества: у заявки со статусом
   * `dispute` без записи в реестре экран C-22 пустой — ни причины, ни решения.
   */
  private async disputes(phone: string, mine: OrderRecord[]) {
    const open = mine.find((o) => o.status === 'dispute');
    if (open && !this.quality.disputes.some((d) => d.orderId === open.id)) {
      this.quality.openDispute({
        orderId: open.id,
        orderNumber: open.number,
        openedByPhone: phone,
        openedByRole: 'client',
        reason: 'Не согласен с суммой за материалы: смеситель дороже, чем в магазине',
        amountTiyin: open.totalFromTiyin,
      });
    }

    // Второй спор — уже решённый: клиенту важнее увидеть исход, чем ожидание
    const settled = mine.find((o) => o.status === 'closed' && !this.quality.disputes.some((d) => d.orderId === o.id));
    if (settled) {
      const d = this.quality.openDispute({
        orderId: settled.id,
        orderNumber: settled.number,
        openedByPhone: phone,
        openedByRole: 'client',
        reason: 'Работа сделана не полностью',
        amountTiyin: settled.totalFromTiyin,
      });
      this.quality.resolveDispute(d.id, {
        resolution: 'for_client',
        // Возврат не может быть больше суммы заявки — реестр это проверяет
        refundTiyin: Math.round(settled.totalFromTiyin / 2),
        comment: 'Пересчитали материалы по чекам, разницу вернули на карту',
        handledByPhone: '+998712000000',
      });
    }
  }

  /** Жалоба в разборе и жалоба решённая: у ленты уведомлений это разные форматы */
  private complaintStates(phone: string) {
    const p = this.profiles.get(phone);
    const fresh = p.complaints.find((c) => c.status === 'new');
    if (fresh) {
      fresh.status = 'in_progress';
      this.profiles.touch();
    }
  }

  /** Журнал статусов до нужного состояния: без него трекер на C-14 пустой */
  private chainTo(status: OrderStatus, at: Date): OrderRecord['statusLog'] {
    const chain: OrderStatus[] = ['new', 'estimated', 'assigned', 'master_departed', 'in_progress', 'completed', 'verified', 'closed'];
    const idx = chain.indexOf(status);
    const path: OrderStatus[] = idx >= 0 ? chain.slice(0, idx + 1) : ['new', status];
    return path.map((s, i) => ({
      from: i === 0 ? null : path[i - 1],
      to: s,
      action: 'demo',
      at: new Date(at.getTime() + i * 20 * 60_000),
    }));
  }

  private b2cProfile(phone: string) {
    const p = this.profiles.get(phone);
    if (!p.addresses.length) {
      this.profiles.saveAddress(phone, {
        label: 'Дом',
        street: 'ул. Навои 12',
        apartment: '45',
        entrance: '3',
        floor: '5',
        intercom: '45В',
        hasLift: true,
        comment: 'Код от калитки 1234, злая собака во дворе',
        primary: true,
      });
      this.profiles.saveAddress(phone, { label: 'Дача', street: 'Чарвак, ул. Горная 7', floor: '1', hasLift: false });
    }
    if (!p.complaints.length) {
      this.profiles.fileComplaint(phone, {
        type: 'Сроки',
        text: 'Мастер опоздал на два часа и не предупредил заранее',
      });
      const resolved = this.profiles.fileComplaint(phone, {
        type: 'Качество работы',
        text: 'После ремонта осталась течь в месте соединения, пришлось вызывать повторно',
      });
      resolved.status = 'resolved';
      resolved.resolution = 'Мастер выехал повторно, течь устранена бесплатно. Приносим извинения';
    }
  }

  // ---------------- B2B ----------------

  /** Три роли на трёх точках: иначе переключатель контекста нечем показать */
  private b2bRoles(phone: string): number {
    const org = this.crm.list()[0];
    if (!org) return 0;
    const full = this.crm.get(org.id);

    // Третья точка — под роль руководителя организации: две роли на одной
    // точке одновременно невозможны, телефон в карточке точки один
    if (full.locations.length < 3) {
      full.locations.push({
        id: uuidv7(),
        name: 'Аптека Мирабад',
        address: 'Ташкент, Мирабадский р-н, ул. Шота Руставели 18',
        lat: 41.2894,
        lng: 69.2611,
        orderLimitTiyin: 200_000_000,
        monthlyLimitTiyin: 800_000_000,
        photoForbidden: false,
        passport: { areaM2: 120, bathrooms: 2, acUnits: 4, electricPanels: 2, objectType: 'Аптека / магазин' },
        access: {
          schedule: 'пн–вс 09:00–21:00',
          accessNotes: 'вход с торца, ключи у охраны',
          hoaContact: 'УК «Мирабад» +998712003344',
          waterShutoff: 'кран в санузле за дверцей',
          electricalPanel: 'щиток в коридоре у входа',
          gasValve: null,
        },
        preferredMasterId: null,
        blacklistMasterIds: [],
        representatives: [],
      } as LocationRec);
    }
    const [first, second, third] = full.locations;
    const put = (loc: LocationRec, role: string, limit: number | null, primary: boolean) => {
      // Главный на точке ровно один. Раньше флаг просто ставился, и после
      // прогонов сида с разных демо-номеров на одной точке оказывалось пять
      // «основных» — а от этого признака зависит, кто может приглашать людей
      if (primary) loc.representatives.forEach((r) => (r.primary = false));
      const existing = loc.representatives.find((r) => r.phone === phone);
      if (existing) {
        existing.role = role;
        existing.approvalLimitTiyin = limit;
        existing.primary = primary;
        return;
      }
      loc.representatives.push({ id: uuidv7(), fullName: 'Тимур Дауров', phone, role, approvalLimitTiyin: limit, primary });
    };
    // Сотрудник: без права утверждать и без сумм на экране
    put(first, 'Провизор', 0, false);
    // Руководитель точки: утверждает в пределах лимита
    put(second, 'Руководитель точки', 100_000_000, true);
    // Руководитель организации: без потолка
    put(third, 'Руководитель организации', null, false);

    // Программа баллов — опция договора; без неё экран C-49 пустой
    full.terms.loyaltyEnabled = true;
    full.terms.showMoneyToEmployees = false;
    this.store.persist();
    return 3;
  }

  private async b2bOrders(
    phone: string,
    masterId: string | undefined,
    masterName: string,
    pick: (re: RegExp) => { id: string; name: string },
  ) {
    const org = this.crm.list()[0];
    if (!org) return;
    const full = this.crm.get(org.id);
    const mine = full.locations.filter((l) => l.representatives.some((r) => r.phone === phone));

    for (const [i, loc] of mine.entries()) {
      const item = pick(/смесител|розетк/i);
      const base = async (status: OrderStatus, description: string, daysAgo: number) => {
        const o = await this.orders.create(
          't0',
          {
            clientPhone: phone,
            clientName: 'Тимур Дауров',
            address: loc.address,
            description,
            source: 'app',
            organizationId: full.id,
            locationId: loc.id,
            items: [{ priceItemId: item.id, qty: 1 + i }],
          },
          phone,
        );
        const rec = await this.orders.record('t0', o.id);
        const at = new Date(Date.now() - daysAgo * 86_400_000);
        rec.createdAt = at;
        rec.status = status;
        rec.statusLog = this.chainTo(status, at);
        if (masterId) {
          rec.masterId = masterId;
          rec.masterName = masterName;
        }
        this.orders.touchOrder();
        return rec;
      };

      // Ждёт утверждения — наполняет центр утверждений (C-36, C-41)
      await base('pending_approval', `Не работает освещение в торговом зале (${loc.name})`, 0);
      await base('in_progress', `Течёт кран в подсобке (${loc.name})`, 1);
      const accept = await base('completed', `Замена ламп и стартеров (${loc.name})`, 2);
      accept.acceptanceRequest = { at: new Date().toISOString(), pending: true, representative: null, absent: false };
      this.photos.save(accept, PHOTO.after, undefined, 'after');
      await base('closed', `Профилактика кондиционеров (${loc.name})`, 25);
      this.orders.touchOrder();
    }

    await this.inspectionAct(phone, masterId, masterName);
  }

  /**
   * Акт осмотра с дефектами: из него собирается техдолг точки (C-37, C-43)
   * и пакетное утверждение (C-42). Без акта эти экраны пустые.
   */
  private async inspectionAct(phone: string, masterId: string | undefined, masterName: string) {
    const org = this.crm.list()[0];
    if (!org) return;
    const full = this.crm.get(org.id);
    const mine = full.locations.filter((l) => l.representatives.some((r) => r.phone === phone));
    // Акт осмотра с дефектами — из него собирается техдолг точки (C-37, C-43)
    const site = mine[1] ?? mine[0];
    if (!site) return;
    const draft = this.field.list({ locationId: site.id }).find((a) => a.status === 'draft');
    if (draft) {
      // Черновик остался от прерванного прогона — дозаполняем и отправляем,
      // иначе техдолг есть, а пакета дефектов на экране нет
      if (!draft.checklist.length) this.field.setChecklist(draft.id, DEMO_CHECKLIST);
      this.field.submit(draft.id);
      return;
    }
    if (true) {
      const order = await this.orders.create(
        't0',
        {
          clientPhone: phone,
          clientName: 'Тимур Дауров',
          address: site.address,
          description: `Плановый осмотр (${site.name})`,
          source: 'app',
          organizationId: full.id,
          locationId: site.id,
          inspection: true,
        },
        phone,
      );
      const act = this.field.draftFor({
        orderId: order.id,
        organizationId: full.id,
        locationId: site.id,
        locationName: site.name,
        masterId: masterId ?? 'demo',
        masterName,
      });
      const defects: Array<[string, string, 'low' | 'medium' | 'high', number | null]> = [
        ['Электрика', 'Оплавлен автомат в щитке — риск возгорания', 'high', 46_000_000],
        ['Сантехника', 'Подтекает стояк в подсобке', 'medium', 28_000_000],
        ['Кондиционеры', 'Дренаж забит, конденсат на стене', 'medium', 15_000_000],
        ['Двери', 'Провис доводчик на входной двери', 'low', 9_000_000],
        ['Освещение', 'Мигают лампы в зале — нужна замена ПРА', 'low', null],
      ];
      // Без заполненного чек-листа акт не отправляется — это гейт ТЗ 9.3
      this.field.setChecklist(act.id, DEMO_CHECKLIST);
      for (const [category, description, severity, estimateTiyin] of defects) {
        this.field.addItem(act.id, { category, description, severity, photoIds: [], estimateTiyin });
      }
      this.field.submit(act.id);
    }
  }

  private b2bMoney(phone: string) {
    const org = this.crm.list()[0];
    if (!org) return;
    const full = this.crm.get(org.id);

    // Счета: один оплачен, один висит — чтобы дунинг было на чём показать
    const existing = this.billing.invoicesList().filter((i) => i.organizationId === full.id);
    if (existing.length < 2) {
      const paid = this.billing.issueSubscriptionInvoice(full.id, full.name, full.subscriptionTiyin ?? 300_000_000);
      this.billing.markInvoicePaid(paid.id);
      const unpaid = this.billing.issueSubscriptionInvoice(full.id, full.name, full.subscriptionTiyin ?? 300_000_000);
      // Выставлен пять дней назад — дунинг T+3 уже сработал
      unpaid.issuedAt = new Date(Date.now() - 5 * 86_400_000).toISOString();
      this.store.persist();
    } else {
      // Счета уже были: состариваем самый старый неоплаченный, иначе
      // предупреждение о просрочке нечем показать
      const unpaid = existing.filter((i) => i.status === 'issued');
      if (unpaid.length && Date.now() - new Date(unpaid[0].issuedAt).getTime() < 3 * 86_400_000) {
        unpaid[0].issuedAt = new Date(Date.now() - 5 * 86_400_000).toISOString();
        this.store.persist();
      }
    }

    // Баллы сотрудника и выданный ваучер (C-49)
    const account = this.loyalty.accounts.get(phone);
    if (!account || account.balanceTiyin === 0) {
      this.loyalty.accrue(phone, 4_800_000, '1% от работ по заявке точки');
      this.loyalty.accrue(phone, 6_200_000, '1% от работ по заявке точки');
      this.loyalty.accrue(phone, 3_400_000, '1% от работ по заявке точки');
    }
  }
}
