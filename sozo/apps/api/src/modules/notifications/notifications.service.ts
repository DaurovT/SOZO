import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { EventBus } from '../../common/event-bus';
import { SmsService } from '../../common/sms.service';
import { ParametersService } from '../platform/parameters.service';
import { PushDispatchService } from './push-dispatch.service';
import { clientNotices, link, sums } from './client-matrix';
import type { OrderStatusChangedEvent } from '../../common/event-bus';
import type { MasterNotifiedEvent } from '../master-api/notifications.service';

/**
 * Доставка сообщений человеку (DEV-07 §2 п.13).
 *
 * До сих пор короткие коды выписывались, складывались в журнал — и никуда не
 * уходили. Кабинет показывал, «кому ушла SMS», хотя не уходило ничего:
 * отправлял их человек руками, а на согласовании наряда-допуска держится
 * весь контур доступа. Теперь код превращается в сообщение здесь.
 *
 * Модуль подписан на шину и не импортируется никем: access публикует событие
 * и не знает, что с ним будет дальше (DEV-07 §3). Поэтому же отказ доставки
 * не роняет переход наряда — согласование не должно срываться из-за
 * недоступного поставщика, у согласующего остаётся кабинет.
 */
/**
 * Что можно схлопывать.
 *
 * Ключ схлопывания означает «показать только последнее». Правка ленты трижды
 * за минуту — это одно событие «маршрут обновлён», а не три уведомления,
 * которые мастер будет разбирать на светофоре. Всё, что относится к активной
 * заявке, не схлопывается никогда (PRD-02 §5): «доп-смета утверждена» и
 * «оплата получена» — разные факты, и потеря первого стоит мастеру денег.
 */
const COLLAPSE_BY_KIND: Partial<Record<MasterNotifiedEvent['kind'], string>> = {
  order_changed: 'feed_today',
  tomorrow_ready: 'feed_tomorrow',
};

/**
 * Чем дублируется недоставленный push (PRD-02 §5).
 *
 * Только два вида, и оба — про деньги и линию. Долг по наличным снимает
 * мастера с линии, напоминание о выезде — последний шанс успеть в окно
 * клиента. Остальное подождёт до открытия приложения: SMS платные, и
 * дублировать ими «рекомендация принята» — способ потратить бюджет впустую.
 */
const SMS_DUBLE_BY_KIND: Partial<Record<MasterNotifiedEvent['kind'], { smsFallback: string; smsFallbackArgs?: [] }>> = {
  cash_debt: { smsFallback: 'SOZO: долг по наличным достиг лимита. Внесите деньги, иначе снятие с линии' },
  departure_reminder: { smsFallback: 'SOZO: скоро окно по заявке. Откройте приложение и нажмите «Выехал»' },
};

/**
 * «22.08 в 09:00» — время отключения человеку.
 *
 * Дата обязательна: отключение планируют за сутки, и одно «с 09:00» в пуше,
 * пришедшем вечером, читается как «завтра утром» ровно до тех пор, пока не
 * окажется, что это было сегодня.
 */
function timeText(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p2 = (n: number) => String(n).padStart(2, '0');
  return `${p2(d.getDate())}.${p2(d.getMonth() + 1)} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
}

@Injectable()
export class NotificationsService implements OnModuleInit {
  private readonly log = new Logger('Notifications');

  constructor(
    private readonly bus: EventBus,
    private readonly sms: SmsService,
    private readonly params: ParametersService,
    private readonly push: PushDispatchService,
  ) {}

  /**
   * Адрес публичных страниц. Параметр 201, а не переменная окружения: он же
   * стоит в ссылке на веб-карточку заявки, и два источника разъехались бы
   * при первом переезде домена.
   */
  private base(): string {
    return this.params.text(201, 'https://sozo.uz');
  }

  onModuleInit(): void {
    /**
     * W-06: согласование наряда-допуска.
     *
     * Текст умещается в одну SMS. Кириллицей это 70 символов, поэтому в нём
     * нет ни адреса объекта, ни перечня зон: всё это согласующий увидит на
     * странице, а разбитое на три части сообщение стоит втрое и приходит
     * вразнобой.
     */
    this.bus.subscribe<{ code: string; approverPhone: string; isBackup: boolean }>('permit.link_issued', (e) =>
      this.send(e.approverPhone, `SOZO: наряд-допуск на согласование. ${this.base()}/p/${e.code}`, 'наряд-допуск'),
    );

    /**
     * C-56: доступ в чужое помещение.
     *
     * Житель отвечает по ссылке — приложения у него может не быть вовсе.
     * Спецификация называет это пушем, но FCM в системе нет, и обещать
     * доставку, которой не существует, нельзя.
     */
    this.bus.subscribe<{ accessCode: string; residentPhone: string }>('unit_access.link_issued', (e) =>
      this.send(e.residentPhone, `SOZO: нужен доступ в вашу квартиру. Решить: ${this.base()}/u/${e.accessCode}`, 'доступ в помещение'),
    );

    this.subscribeMaster();
    this.subscribeClient();
    this.subscribeReplacement();
    this.subscribeHome();
    this.subscribeTimers();
    this.subscribeCare();
  }

  /**
   * Что рождается не переходом, а временем (ТЗ §5.3, §8.9).
   *
   * Планировщик до сих пор писал такие срабатывания в аудит и на этом
   * заканчивался: запись «уведомлено» означала, что о долге знаем мы, а не
   * должник. Здесь они наконец доходят до человека.
   */
  private subscribeTimers(): void {
    this.bus.subscribe<{ orderId: string; number: string; clientPhone: string; amountTiyin: number; stage: 'T+24' | 'T+72' }>(
      'order.payment_reminder',
      (e) => {
        const late = e.stage === 'T+72';
        void this.push.deliver({
          event: `order.payment_reminder.${e.stage}`,
          phone: e.clientPhone,
          app: 'client',
          orderId: e.orderId,
          title: late ? 'Оплата просрочена' : 'Напоминание об оплате',
          body: late
            ? 'Заявка {0}: {1} сум. Новые заявки заблокированы до оплаты'
            : 'По заявке {0} ждём оплату {1} сум',
          bodyArgs: [e.number, sums(e.amountTiyin)],
          priority: 'high',
          deepLink: link.payment(e.orderId),
          // На T+72 ТЗ §8.9 прямо требует SMS: к этому сроку push уже был и
          // не сработал, а следом идёт блокировка новых заявок
          ...(late
            ? {
                smsFallback: 'SOZO: заявка {0} не оплачена, {1} сум. Новые заявки заблокированы',
                smsFallbackArgs: [e.number, sums(e.amountTiyin)],
              }
            : {}),
        });
      },
    );

    this.bus.subscribe<{ orderId: string; number: string; amountTiyin: number; waitedH: number; approvers: Array<{ phone: string; name: string }> }>(
      'order.approval_escalated',
      (e) => {
        for (const a of e.approvers) {
          void this.push.deliver({
            event: 'order.approval_escalated',
            phone: a.phone,
            app: 'client',
            orderId: e.orderId,
            title: 'Смета ждёт решения',
            body: 'Заявка {0}: {1} сум, без ответа {2} ч',
            bodyArgs: [e.number, sums(e.amountTiyin), e.waitedH],
            priority: 'heads_up',
            deepLink: link.approval(e.orderId),
            // T+24 — вторая попытка, и ТЗ §5.3 добавляет к ней SMS: первый
            // push человек уже не увидел, повторять тем же каналом бессмысленно
            smsFallback: 'SOZO: заявка {0} на {1} сум ждёт вашего утверждения {2} ч',
            smsFallbackArgs: [e.number, sums(e.amountTiyin), e.waitedH],
          });
        }
      },
    );

    this.bus.subscribe<{ number: string; organizationName: string; amountTiyin: number; stage: string; ageDays: number; recipients: Array<{ phone: string; name: string }> }>(
      'invoice.dunning',
      (e) => {
        for (const r of e.recipients) {
          void this.push.deliver({
            event: 'invoice.dunning',
            phone: r.phone,
            app: 'client',
            title: 'Счёт не оплачен',
            body: 'Счёт {0} на {1} сум просрочен на {2} дн. — {3}',
            bodyArgs: [e.number, sums(e.amountTiyin), e.ageDays, e.stage],
            priority: 'high',
            deepLink: link.invoices(),
            // С десятого дня стоит обслуживание — об этом обязаны узнать даже
            // те, у кого приложение не установлено (ТЗ §8.3)
            ...(e.ageDays >= 10
              ? {
                  smsFallback: 'SOZO: счёт {0} просрочен на {1} дн. Обслуживание приостановлено до оплаты',
                  smsFallbackArgs: [e.number, e.ageDays],
                }
              : {}),
          });
        }
      },
    );
  }

  /**
   * Жалобы и лояльность — то, что человек воспринимает как отношение к себе.
   *
   * Приоритеты здесь низкие намеренно. «Баллы начислены» ночью с гудком —
   * верный способ научить человека отключать уведомления целиком, а вместе с
   * ними и те, ради которых канал заводился.
   */
  private subscribeCare(): void {
    this.bus.subscribe<{ complainantPhone: string; orderNumber?: string }>('complaint.registered', (e) => {
      void this.push.deliver({
        event: 'complaint.registered',
        phone: e.complainantPhone,
        app: 'client',
        title: 'Жалоба принята',
        body: e.orderNumber ? 'Разбираемся по заявке {0}. Ответим в течение двух часов' : 'Разбираемся. Ответим в течение двух часов',
        bodyArgs: e.orderNumber ? [e.orderNumber] : [],
        deepLink: link.complaints(),
      });
    });

    this.bus.subscribe<{ complainantPhone: string; confirmed: boolean; resolution: string }>('complaint.resolved', (e) => {
      void this.push.deliver({
        event: 'complaint.resolved',
        phone: e.complainantPhone,
        app: 'client',
        title: e.confirmed ? 'Жалоба решена' : 'Ответ по жалобе',
        body: '{0}',
        bodyArgs: [e.resolution],
        priority: 'high',
        deepLink: link.complaints(),
      });
    });

    this.bus.subscribe<{ phone: string; amountTiyin: number; balanceTiyin: number }>('loyalty.accrued', (e) => {
      void this.push.deliver({
        event: 'loyalty.accrued',
        phone: e.phone,
        app: 'client',
        title: 'Начислены баллы',
        body: '+{0} — всего {1}',
        bodyArgs: [sums(e.amountTiyin), sums(e.balanceTiyin)],
        deepLink: link.loyalty(),
      });
    });

    this.bus.subscribe<{ phone: string; code: string; nominalTiyin: number; expiresAt: string }>('loyalty.voucher_issued', (e) => {
      void this.push.deliver({
        event: 'loyalty.voucher_issued',
        phone: e.phone,
        app: 'client',
        title: 'Ваучер ждёт вас',
        body: 'Ваучер {0} на {1} сум, действует до {2}',
        bodyArgs: [e.code, sums(e.nominalTiyin), e.expiresAt],
        priority: 'high',
        deepLink: link.loyalty(),
        // У ваучера есть срок годности: пропущенное уведомление — это
        // сгоревшие деньги человека, и SMS здесь дешевле молчания
        smsFallback: 'SOZO: ваучер {0} на {1} сум ждёт вас до {2}',
        smsFallbackArgs: [e.code, sums(e.nominalTiyin), e.expiresAt],
      });
    });
  }

  /**
   * Матрица клиента по переходам заявки (PRD-01 §5).
   *
   * Один переход может дать несколько уведомлений и нескольким адресатам:
   * назначение мастера в B2C — это и «к вам едет такой-то», и просьба
   * уточнить подъезд, а запрос утверждения в B2B уходит каждому, чей потолок
   * покрывает сумму. Разбор — в таблице client-matrix, здесь только отправка.
   */
  private subscribeClient(): void {
    this.bus.subscribe<OrderStatusChangedEvent>('order.status_changed', (e) => {
      for (const notice of clientNotices(e)) {
        void this.push.deliver({ ...notice, app: 'client' });
      }
    });
  }

  /**
   * Замена мастера — событие вне статусной машины (PRD-01 §5).
   *
   * Отдельной подпиской, потому что и публикуется оно отдельно: статус при
   * переназначении не меняется, и в поток переходов это не попадает.
   */
  private subscribeReplacement(): void {
    this.bus.subscribe<{ orderId: string; number: string; clientPhone: string; masterName: string; reason: string }>(
      'order.master_replaced',
      (e) => {
        void this.push.deliver({
          event: 'order.master_replaced',
          phone: e.clientPhone,
          app: 'client',
          orderId: e.orderId,
          title: 'Мастер заменён',
          body: 'К вам приедет {0}',
          bodyArgs: [e.masterName],
          priority: 'high',
          deepLink: link.order(e.orderId),
          // Клиент ждёт конкретного человека, которого ему назвали по имени.
          // Узнать о замене на пороге хуже, чем узнать заранее, — поэтому
          // сообщение доходит и до тех, у кого приложения нет
          smsFallback: 'SOZO: по заявке {0} к вам приедет другой мастер — {1}',
          smsFallbackArgs: [e.number, e.masterName],
        });
      },
    );
  }

  /**
   * Контур «Дом»: отключения ресурсов (PRD-01 §5.N, DEV-15).
   *
   * Адресаты приходят в событии готовым списком — движок не знает ни про
   * помещения, ни про жителей. Отключение воды касается не «квартир», а
   * людей, и рассылается поимённо.
   */
  private subscribeHome(): void {
    this.bus.subscribe<{ resourceType: string; plannedFrom: string; plannedTo: string; residentPhones?: string[]; emergency?: boolean }>(
      'shutdown.scheduled',
      (e) => {
        for (const phone of e.residentPhones ?? []) {
          void this.push.deliver({
            event: 'shutdown.scheduled',
            phone,
            app: 'client',
            title: e.emergency ? 'Аварийное отключение' : 'Плановое отключение',
            body: '{0}: с {1} до {2}',
            bodyArgs: [e.resourceType, timeText(e.plannedFrom), timeText(e.plannedTo)],
            priority: e.emergency ? 'heads_up' : 'high',
            deepLink: link.shutdowns(),
            // У жителя приложения может не быть вовсе — а воду отключат
            // всё равно. Это ровно тот случай, ради которого в ТЗ §11
            // прописано «SMS тем, у кого нет приложения»
            smsFallback: 'SOZO: {0} — отключение с {1} до {2}',
            smsFallbackArgs: [e.resourceType, timeText(e.plannedFrom), timeText(e.plannedTo)],
          });
        }
      },
    );

    this.bus.subscribe<{ resourceType: string; plannedTo: string; residentPhones?: string[] }>('shutdown.started', (e) => {
      for (const phone of e.residentPhones ?? []) {
        void this.push.deliver({
          event: 'shutdown.started',
          phone,
          app: 'client',
          title: 'Отключение началось',
          body: '{0}: ориентировочно до {1}',
          bodyArgs: [e.resourceType, timeText(e.plannedTo)],
          priority: 'high',
          deepLink: link.shutdowns(),
        });
      }
    });

    this.bus.subscribe<{ resourceType: string; residentPhones?: string[]; overranMin: number }>('shutdown.restored', (e) => {
      for (const phone of e.residentPhones ?? []) {
        void this.push.deliver({
          event: 'shutdown.restored',
          phone,
          app: 'client',
          title: 'Ресурс подан',
          body: '{0} снова работает',
          bodyArgs: [e.resourceType],
          deepLink: link.shutdowns(),
        });
      }
    });
  }

  /**
   * Матрица мастера целиком (PRD-02 §5, 27 событий).
   *
   * Подписка одна на все: лента мастера — единственное место, где эти события
   * рождаются, и она публикует каждую свою запись. Разбирать здесь двадцать
   * семь видов по отдельности незачем — текст, приоритет и deep-link уже
   * собраны там, где известен контекст.
   */
  private subscribeMaster(): void {
    this.bus.subscribe<MasterNotifiedEvent>('master.notified', (e) => {
      void this.push.deliver({
        event: `master.${e.kind}`,
        phone: e.masterPhone,
        app: 'master',
        title: e.title,
        body: e.body,
        bodyArgs: e.bodyArgs,
        priority: e.priority,
        deepLink: e.deepLink,
        orderId: e.orderId,
        ttlSeconds: e.ttlSeconds,
        collapseKey: COLLAPSE_BY_KIND[e.kind],
        ...SMS_DUBLE_BY_KIND[e.kind],
      });
    });
  }

  private async send(phone: string, text: string, what: string): Promise<void> {
    if (!phone) return;
    const res = await this.sms.send(phone, text);
    if (!res.sent) {
      // Не бросаем: доставка — следствие события, а не его условие. Провал
      // виден в журнале, а согласующему остаётся кабинет
      this.log.error(`${what}: SMS на ${phone} не ушла — ${res.error ?? 'причина неизвестна'}`);
    }
  }
}
