import { Injectable, Logger } from '@nestjs/common';
import { uuidv7 } from '@sozo/kernel';
import { PushService, type PushPriority } from '../../common/push.service';
import { SmsService } from '../../common/sms.service';
import { PrismaService } from '../../common/prisma.service';
import { currentDbContext, systemContext } from '../../common/db-context';
import { runWithLocale, tr, trValue, type Locale } from '../../common/locale';
import { ParametersService } from '../platform/parameters.service';
import { DeviceTokensService, type PushApp } from './device-tokens.service';

/**
 * Доставка уведомления человеку на устройство (ТЗ §11, DEV-07 §2 п.12).
 *
 * Здесь собрано всё, что отличает «отправили» от «дошло»: выбор устройств,
 * язык получателя, повтор при временном отказе, дублирование SMS для
 * критичного и частотный потолок для того, что критичным не является.
 *
 * Ничего из этого не может уронить бизнес-операцию. Уведомление — следствие
 * события, а не его условие: заявка назначается мастеру независимо от того,
 * доступен ли сейчас Google. Поэтому все отказы гасятся и попадают в журнал
 * доставки, а не в ответ на запрос.
 */

export interface DeliverInput {
  /** Имя события матрицы: order.assigned, master.offer — им же меряют доставку */
  event: string;
  phone: string;
  app: PushApp;
  /** Русский шаблон. Перевод — при отправке, в язык устройства (ТЗ §14) */
  title: string;
  body: string;
  bodyArgs?: (string | number)[];
  priority?: PushPriority;
  deepLink?: string;
  orderId?: string;
  ttlSeconds?: number;
  collapseKey?: string;
  /**
   * Текст SMS, которым дублируется недоставленный push.
   *
   * Задаётся только для критичного (ТЗ §11: «для Android-устройств без
   * Google-сервисов критичные уведомления дублируются SMS»). Не для всего
   * подряд: SMS платные, и дублировать ими «начислены баллы» — способ
   * потратить бюджет на то, что человек и так увидит, открыв приложение.
   */
  smsFallback?: string;
  smsFallbackArgs?: (string | number)[];
  /**
   * Сервисное касание — под частотным потолком (ТЗ §17.12: не чаще одного
   * в две недели). Операционные уведомления по заявке идут всегда.
   */
  serviceTouch?: boolean;
}

export interface DeliveryRec {
  id: string;
  event: string;
  phone: string;
  app: PushApp;
  channel: 'push' | 'sms_fallback' | 'none';
  status: 'sent' | 'failed' | 'skipped';
  detail?: string;
  orderId?: string;
  attempts: number;
  createdAt: string;
  /** Считается ли отправка сервисным касанием — по ней меряется потолок */
  serviceTouch?: boolean;
}

/** Параметр 203 — частотный потолок сервисных касаний, дней */
const PARAM_SERVICE_TOUCH_DAYS = 203;
/** Параметр 204 — дублировать ли критичное SMS (ТЗ §11: «набор SMS-событий — параметр») */
const PARAM_SMS_DOUBLE = 204;

/**
 * Повторы при временном отказе.
 *
 * Три попытки с нарастающей паузой: отказ FCM почти всегда короткий — лимит
 * запросов или пятисотка у Google, — и переживается за минуту. Дальше
 * повторять бессмысленно: у офферных пушей к этому моменту истёк TTL, а
 * событие по заявке уже видно в ленте.
 *
 * Это in-process расписание, а не очередь: шина здесь тоже in-process
 * (EventBus), и заводить BullMQ ради ретраев одного канала раньше, чем на
 * него переедет весь outbox, значит получить две разные модели доставки.
 */
const RETRY_DELAYS_MS = [5_000, 30_000];

@Injectable()
export class PushDispatchService {
  private readonly log = new Logger('Push');
  /**
   * Последние отправки в памяти.
   *
   * Нужны для частотного потолка и для ответа «что вообще уходило этому
   * человеку» без похода в базу. Полный журнал живёт в push_delivery.
   */
  private readonly recent: DeliveryRec[] = [];

  constructor(
    private readonly push: PushService,
    private readonly sms: SmsService,
    private readonly devices: DeviceTokensService,
    private readonly params: ParametersService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Доставить. Не бросает и не ждёт результата дольше первой попытки:
   * повторы уходят в фон, вызывающий продолжает свою операцию.
   */
  async deliver(input: DeliverInput): Promise<DeliveryRec> {
    if (!input.phone) return this.record(input, 'none', 'skipped', 'no_phone');

    if (input.serviceTouch && this.capped(input.phone)) {
      // Потолок — не ошибка доставки, а решение не отправлять. В журнале
      // видно именно это: иначе «пользователь жалуется, что не приходит»
      // разбирали бы как сбой канала
      return this.record(input, 'none', 'skipped', 'rate_capped');
    }

    const devices = this.devices.for(input.phone, input.app);
    if (!devices.length) return this.fallback(input, 'no_token');

    let sent = false;
    let attempts = 0;
    let lastError: string | undefined;
    for (const device of devices) {
      const msg = this.compose(input, device.locale);
      const res = await this.push.send(device.token, msg);
      attempts++;
      if (res.sent) {
        sent = true;
        continue;
      }
      if (res.gone) {
        // Приложения на устройстве больше нет. Снимаем сразу, иначе строка
        // будет отниматься запрос при каждой рассылке до скончания века
        this.devices.markGone(device.token);
        continue;
      }
      lastError = res.error;
      this.retry(input, device.token, device.locale, 0);
    }

    if (sent) return this.record(input, 'push', 'sent', undefined, attempts);
    // Ни одно устройство не приняло сообщение прямо сейчас. Повторы уже
    // назначены, но критичное ждать их не может — дублируем SMS
    return this.fallback(input, lastError ?? 'not_delivered', attempts);
  }

  /**
   * Отправить обоим каналам сразу.
   *
   * Отдельный вход для того, что ТЗ помечает «push + SMS сразу» —
   * вынужденная доп-смета B2B с красным флагом (§5.3). Там SMS не запасной
   * канал, а второй основной: мастер стоит на объекте, и два часа молчания
   * стоят дороже одной SMS.
   */
  async deliverBoth(input: DeliverInput & { smsFallback: string }): Promise<DeliveryRec> {
    const rec = await this.deliver({ ...input, smsFallback: undefined });
    if (this.smsAllowed) await this.sendSms(input);
    return rec;
  }

  /** Что уходило этому человеку — для админки и разбора жалоб */
  history(phone: string, limit = 50): DeliveryRec[] {
    return this.recent
      .filter((r) => r.phone === phone)
      .slice(-limit)
      .reverse();
  }

  private compose(input: DeliverInput, locale: Locale) {
    return runWithLocale(locale, () => ({
      title: tr(input.title),
      body: tr(input.body, ...(input.bodyArgs ?? []).map((a) => (typeof a === 'string' ? trValue(a) : a))),
      deepLink: input.deepLink,
      priority: input.priority,
      ttlSeconds: input.ttlSeconds,
      collapseKey: input.collapseKey,
      data: {
        event: input.event,
        ...(input.orderId ? { orderId: input.orderId } : {}),
      },
    }));
  }

  /**
   * Повтор одной отправки.
   *
   * Через таймер, а не через ожидание в запросе: назначение мастера не
   * должно висеть тридцать секунд из-за пятисотки у поставщика. Промах
   * последней попытки уже отражён в журнале первой записью — второй строки
   * на то же событие не пишем, чтобы статистика доставки не двоилась.
   */
  private retry(input: DeliverInput, token: string, locale: Locale, attempt: number): void {
    const delay = RETRY_DELAYS_MS[attempt];
    if (delay === undefined) return;
    const timer = setTimeout(() => {
      void (async () => {
        const res = await this.push.send(token, this.compose(input, locale));
        if (res.sent) {
          this.record(input, 'push', 'sent', `retry ${attempt + 1}`, attempt + 2);
          return;
        }
        if (res.gone) {
          this.devices.markGone(token);
          return;
        }
        this.retry(input, token, locale, attempt + 1);
      })();
    }, delay);
    // Иначе процесс не завершится, пока висит повтор: прогон e2e и разовые
    // скрипты повисали бы на полминуты после последнего уведомления
    timer.unref?.();
  }

  /**
   * Запасной канал.
   *
   * Отсутствие токена — обычное дело, а не сбой: у клиента может не быть
   * приложения вовсе (телефонный канал, ТЗ §12), у Android-аппарата без
   * Google-сервисов не будет токена никогда. Поэтому критичное уходит SMS,
   * а некритичное просто отмечается в журнале — событие останется в ленте.
   */
  private async fallback(input: DeliverInput, reason: string, attempts = 1): Promise<DeliveryRec> {
    if (!input.smsFallback) return this.record(input, 'none', 'skipped', reason, attempts);
    if (!this.smsAllowed) {
      // Видно в журнале как отдельная причина: «не настроен push» и «человеку
      // нечем доставить» — разные проблемы, и чинят их разные люди
      return this.record(input, 'none', 'skipped', this.push.delivers ? 'sms_double_off' : 'push_not_configured', attempts);
    }
    const ok = await this.sendSms(input);
    return this.record(input, 'sms_fallback', ok ? 'sent' : 'failed', reason, attempts);
  }

  /**
   * Можно ли дублировать SMS.
   *
   * Два условия, и оба обязательны.
   *
   * Первое — push-канал должен по-настоящему работать. SMS здесь дубль
   * недоставленного уведомления, а не запасной канал вместо него: пока FCM
   * не настроен, токенов нет ни у кого, и «дубль» превратился бы в SMS на
   * каждое назначение мастера — то есть в платную рассылку, которую никто не
   * заказывал. Именно так ненастроенный прод и тратит бюджет молча.
   *
   * Второе — выключатель. ТЗ §11 прямо называет набор SMS-событий
   * параметром, потому что сообщения платные.
   */
  private get smsAllowed(): boolean {
    if (!this.push.delivers) return false;
    return this.params.text(PARAM_SMS_DOUBLE, '1').trim() !== '0';
  }

  private async sendSms(input: DeliverInput): Promise<boolean> {
    if (!input.smsFallback) return false;
    // Язык SMS — из последнего известного устройства человека; если
    // устройств нет вовсе (телефонный клиент), остаётся русский. Гадать по
    // номеру нельзя: узбекский номер не значит узбекский язык
    const locale = this.devices.for(input.phone, input.app)[0]?.locale ?? 'ru';
    const text = runWithLocale(locale, () =>
      tr(input.smsFallback as string, ...(input.smsFallbackArgs ?? []).map((a) => (typeof a === 'string' ? trValue(a) : a))),
    );
    const res = await this.sms.send(input.phone, text);
    if (!res.sent) this.log.error(`${input.event}: SMS-дубль на ${input.phone} не ушёл — ${res.error ?? 'причина неизвестна'}`);
    return res.sent;
  }

  /** Было ли сервисное касание этому человеку внутри окна потолка (ТЗ §17.12) */
  private capped(phone: string): boolean {
    const days = Number(this.params.text(PARAM_SERVICE_TOUCH_DAYS, '14'));
    if (!Number.isFinite(days) || days <= 0) return false;
    const since = Date.now() - days * 24 * 3600 * 1000;
    return this.recent.some(
      (r) => r.phone === phone && r.serviceTouch && r.status === 'sent' && Date.parse(r.createdAt) >= since,
    );
  }

  private record(
    input: DeliverInput,
    channel: DeliveryRec['channel'],
    status: DeliveryRec['status'],
    detail?: string,
    attempts = 1,
  ): DeliveryRec {
    const rec: DeliveryRec = {
      id: uuidv7(),
      event: input.event,
      phone: input.phone,
      app: input.app,
      channel,
      status,
      detail,
      orderId: input.orderId,
      attempts,
      createdAt: new Date().toISOString(),
      serviceTouch: input.serviceTouch,
    };
    this.recent.push(rec);
    // Окно потолка — две недели, и держать в памяти больше нескольких тысяч
    // строк ради него незачем: полный журнал в базе
    if (this.recent.length > 5000) this.recent.splice(0, this.recent.length - 5000);
    this.persist(rec);
    return rec;
  }

  private persist(rec: DeliveryRec): void {
    if (!this.prisma.enabled) return;
    const tenantId = (currentDbContext() ?? systemContext()).tenantId;
    void this.prisma
      .withContext(async (tx) => {
        await tx.pushDelivery.create({
          data: {
            id: rec.id,
            tenantId,
            event: rec.event,
            phone: rec.phone,
            app: rec.app,
            channel: rec.channel,
            status: rec.status,
            detail: rec.detail ?? null,
            // Идентификатор заявки в схеме uuid; часть вызовов знает только
            // номер вида Z-1042 — журнал доставки важнее строгости поля
            orderId: /^[0-9a-f-]{36}$/i.test(rec.orderId ?? '') ? (rec.orderId as string) : null,
            attempts: rec.attempts,
            createdAt: new Date(rec.createdAt),
          },
        });
      })
      .catch((e: unknown) => {
        // Журнал доставки не может ронять доставку. Но молчать нельзя:
        // прогон e2e падает, если в логе была неудачная запись
        this.log.error(`запись в журнал доставки не удалась: ${(e as Error).message}`);
      });
  }
}
