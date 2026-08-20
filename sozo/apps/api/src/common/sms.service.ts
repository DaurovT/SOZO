import { Injectable, Logger } from '@nestjs/common';

/**
 * Отправка SMS (DEV-04 §1).
 *
 * Один интерфейс и две реализации: журнал для разработки и Eskiz для прода.
 * Разделение не ради абстракции как таковой — без него код входа знал бы про
 * HTTP чужого поставщика, а тесты не могли бы проверить ни одну ветку
 * доставки, кроме успешной.
 *
 * Почему Eskiz. В Узбекистане два обиходных поставщика — Eskiz и Playmobile.
 * Реализован один: у второго другой протокол, и писать его вслепую, без
 * учётной записи и без единого ответа настоящего сервера, значило бы выдать
 * непроверенный код за готовый. Интерфейс для него готов, работа — полдня,
 * когда появятся ключи.
 */
export interface SmsResult {
  /** Ушло ли сообщение поставщику. Доставку абоненту знает только отчёт */
  sent: boolean;
  /** Как отправлено: log | eskiz — попадает в ответ и в журнал */
  channel: string;
  /** Идентификатор у поставщика: по нему сверяют отчёт о доставке */
  providerId?: string;
  error?: string;
}

export interface SmsSender {
  readonly channel: string;
  /** Отправляет по-настоящему (true) или только пишет в журнал (false) */
  readonly delivers: boolean;
  send(phone: string, text: string): Promise<SmsResult>;
}

/**
 * Журнальный отправитель — умолчание вне прода.
 *
 * Ничего не отправляет и ничего не стоит. Текст пишется в журнал целиком:
 * на разработке это единственный способ увидеть, что именно получил бы
 * человек, а укороченный текст скрывал бы ровно те ошибки, ради которых
 * сообщение и читают — обрыв на 70-м символе и подстановку пустых полей.
 */
export class LogSmsSender implements SmsSender {
  readonly channel = 'log';
  readonly delivers = false;
  private readonly log = new Logger('SMS');

  send(phone: string, text: string): Promise<SmsResult> {
    this.log.log(`${phone}: ${text}`);
    return Promise.resolve({ sent: true, channel: this.channel });
  }
}

/**
 * Eskiz (notify.eskiz.uz).
 *
 * Токен живёт около месяца и выдаётся по логину-паролю. Обновляется не по
 * расписанию, а по отказу: расписание в монолите означало бы таймер, который
 * тикает и тогда, когда SMS не отправляют месяцами, а протухший токен всё
 * равно возможен — после перезапуска поставщика или смены пароля. Поэтому
 * один повтор после 401, и не больше: второй подряд отказ — это уже не
 * протухший токен, а неверные учётные данные, и повторять их бессмысленно.
 */
export class EskizSmsSender implements SmsSender {
  readonly channel = 'eskiz';
  readonly delivers = true;
  private readonly log = new Logger('SMS');
  private token: string | null = null;

  constructor(
    private readonly email: string,
    private readonly password: string,
    private readonly from: string,
    private readonly base: string,
  ) {}

  private async login(): Promise<string> {
    const body = new FormData();
    body.append('email', this.email);
    body.append('password', this.password);
    const res = await fetch(`${this.base}/api/auth/login`, { method: 'POST', body });
    if (!res.ok) throw new Error(`вход в Eskiz отклонён: ${res.status}`);
    const data = (await res.json()) as { data?: { token?: string } };
    const token = data.data?.token;
    if (!token) throw new Error('Eskiz не вернул токен');
    this.token = token;
    return token;
  }

  private async post(token: string, phone: string, text: string): Promise<Response> {
    const body = new FormData();
    // Поставщик ждёт номер без плюса: 998901234567
    body.append('mobile_phone', phone.replace(/\D/g, ''));
    body.append('message', text);
    body.append('from', this.from);
    return fetch(`${this.base}/api/message/sms/send`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body,
    });
  }

  async send(phone: string, text: string): Promise<SmsResult> {
    try {
      let token = this.token ?? (await this.login());
      let res = await this.post(token, phone, text);
      if (res.status === 401) {
        this.token = null;
        token = await this.login();
        res = await this.post(token, phone, text);
      }
      if (!res.ok) {
        const detail = (await res.text()).slice(0, 200);
        this.log.error(`Eskiz отказал ${res.status}: ${detail}`);
        return { sent: false, channel: this.channel, error: `HTTP ${res.status}` };
      }
      const data = (await res.json()) as { id?: string | number; message?: string };
      return { sent: true, channel: this.channel, providerId: data.id === undefined ? undefined : String(data.id) };
    } catch (e) {
      this.log.error(`Eskiz недоступен: ${(e as Error).message}`);
      return { sent: false, channel: this.channel, error: (e as Error).message };
    }
  }
}

/**
 * Выбор отправителя по конфигу.
 *
 * Умолчание — журнал, и это осознанно: настроенный не до конца прод должен
 * молчать в журнал, а не падать при каждом входе. Но молчание видно —
 * отсутствие ключей объявляется при старте, а не выясняется по жалобе.
 */
@Injectable()
export class SmsService {
  private readonly log = new Logger('SMS');
  private readonly sender: SmsSender;

  constructor() {
    const provider = (process.env.SMS_PROVIDER ?? 'log').toLowerCase();
    if (provider === 'eskiz') {
      const email = process.env.SMS_ESKIZ_EMAIL ?? '';
      const password = process.env.SMS_ESKIZ_PASSWORD ?? '';
      if (!email || !password) {
        this.log.error('SMS_PROVIDER=eskiz, но SMS_ESKIZ_EMAIL/PASSWORD не заданы — сообщения останутся в журнале');
        this.sender = new LogSmsSender();
      } else {
        this.sender = new EskizSmsSender(
          email,
          password,
          // Отправитель по умолчанию — тестовый альфа-номер Eskiz: с ним
          // сообщения уходят, но только на номера, добавленные в кабинете
          process.env.SMS_ESKIZ_FROM ?? '4546',
          process.env.SMS_ESKIZ_BASE ?? 'https://notify.eskiz.uz',
        );
        this.log.log(`SMS отправляются через Eskiz от имени ${process.env.SMS_ESKIZ_FROM ?? '4546'}`);
      }
    } else {
      this.sender = new LogSmsSender();
      if (process.env.NODE_ENV === 'production') {
        this.log.warn('SMS_PROVIDER не задан: сообщения пишутся в журнал и никому не уходят');
      }
    }
  }

  /** Отправляет ли поставщик по-настоящему — от этого зависят лимиты отправки */
  get delivers(): boolean {
    return this.sender.delivers;
  }

  get channel(): string {
    return this.sender.channel;
  }

  send(phone: string, text: string): Promise<SmsResult> {
    return this.sender.send(phone, text);
  }
}
