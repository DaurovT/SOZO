import { Injectable, Logger } from '@nestjs/common';
import { createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';

/**
 * Отправка push-уведомлений (ТЗ §11, DEV-04 §1, DEV-13 п.24).
 *
 * Устроено так же, как SMS, и по той же причине: один интерфейс, журнальная
 * реализация для разработки, настоящая — для прода. Без разделения код заявки
 * знал бы про HTTP чужого сервиса, а проверить можно было бы только успешную
 * ветку — ровно ту, которая и так работает.
 *
 * Почему FCM и без firebase-admin. Канал выбран владельцем (ТЗ §17 «стек»),
 * альтернативы для Android в Узбекистане нет. SDK не подключён намеренно: из
 * всего firebase-admin здесь нужны два запроса — обмен подписанного JWT на
 * токен доступа и POST сообщения. Ради них тянуть пакет с полусотней
 * транзитивных зависимостей в монолит, который сейчас обходится девятью,
 * несоразмерно; протокол HTTP v1 стабилен и документирован.
 *
 * Ключей у проекта пока нет (DEV-13 п.24 открыт). Поэтому умолчание —
 * журнал: ненастроенный прод обязан молчать в лог, а не падать на каждом
 * назначении мастера. Но молчание объявляется при старте, а не выясняется
 * по жалобе «мне не приходят уведомления».
 */

/** Приоритет доставки. Совпадает с приоритетом ленты мастера (PRD-02 §5) */
export type PushPriority = 'heads_up' | 'high' | 'normal';

export interface PushMessage {
  title: string;
  body: string;
  /**
   * Куда ведёт тап: `sozo-master://order/{id}`, `sozo://order/{id}`.
   *
   * Уходит в data, а не в notification: разлогиненное приложение обязано
   * сначала показать вход и только потом целевой экран (PRD-02 §5), а для
   * этого ссылку нужно прочитать кодом, чего notification-полем не сделать.
   */
  deepLink?: string;
  priority?: PushPriority;
  /**
   * Срок жизни в секундах. Для офферов равен таймеру решения: просроченный
   * оффер не должен всплыть на экране через полчаса — мастер нажмёт «Принять»
   * и получит отказ (PRD-02 §5, правило TTL).
   */
  ttlSeconds?: number;
  /**
   * Ключ схлопывания. Одинаковый ключ означает «показать только последнее»:
   * три правки ленты за минуту — это одно событие «маршрут обновлён», а не
   * три. Пуши по активной заявке не схлопываются никогда (PRD-02 §5).
   */
  collapseKey?: string;
  /** Произвольные поля для приложения — id заявки, вид события */
  data?: Record<string, string>;
}

export interface PushResult {
  /** Принял ли поставщик сообщение. Показ на экране знает только устройство */
  sent: boolean;
  channel: string;
  /** Токен мёртв: приложение удалено или переустановлено — строку надо снять */
  gone?: boolean;
  providerId?: string;
  error?: string;
}

export interface PushSender {
  readonly channel: string;
  /** Отправляет по-настоящему (true) или только пишет в журнал (false) */
  readonly delivers: boolean;
  send(token: string, msg: PushMessage): Promise<PushResult>;
}

/**
 * Журнальный отправитель — умолчание вне прода.
 *
 * Пишет заголовок, текст и ссылку целиком. На разработке это единственный
 * способ увидеть, что именно получил бы человек: обрыв длинного текста и
 * пустую подстановку `{0}` видно только в полной строке.
 */
export class LogPushSender implements PushSender {
  readonly channel = 'log';
  readonly delivers = false;
  private readonly log = new Logger('Push');

  send(token: string, msg: PushMessage): Promise<PushResult> {
    const where = msg.deepLink ? ` → ${msg.deepLink}` : '';
    this.log.log(`${token.slice(0, 12)}…: ${msg.title} — ${msg.body}${where}`);
    return Promise.resolve({ sent: true, channel: this.channel });
  }
}

/** Учётные данные сервисного аккаунта — три поля из JSON, который выдаёт Firebase */
export interface ServiceAccount {
  projectId: string;
  clientEmail: string;
  privateKey: string;
}

/**
 * FCM HTTP v1.
 *
 * Токен доступа живёт час и выдаётся в обмен на JWT, подписанный приватным
 * ключом сервисного аккаунта. Обновляется по сроку, а не по отказу — в
 * отличие от Eskiz: там токен живёт месяц и таймер тикал бы вхолостую, здесь
 * же час истекает всегда, и ждать 401 на каждом сотом пуше значит терять
 * запрос и время на ровном месте. Минута запаса — на расхождение часов.
 */
export class FcmPushSender implements PushSender {
  readonly channel = 'fcm';
  readonly delivers = true;
  private readonly log = new Logger('Push');
  private token: string | null = null;
  private expiresAt = 0;
  /** Обмен идёт один на всех: сотня пушей разом не должна дать сотню логинов */
  private pending: Promise<string> | null = null;

  constructor(
    private readonly account: ServiceAccount,
    private readonly base = 'https://fcm.googleapis.com',
    private readonly oauthBase = 'https://oauth2.googleapis.com',
  ) {}

  private sign(): string {
    const now = Math.floor(Date.now() / 1000);
    const header = { alg: 'RS256', typ: 'JWT' };
    const claims = {
      iss: this.account.clientEmail,
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
      aud: `${this.oauthBase}/token`,
      iat: now,
      exp: now + 3600,
    };
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const body = `${b64(header)}.${b64(claims)}`;
    const signer = createSign('RSA-SHA256');
    signer.update(body);
    return `${body}.${signer.sign(this.account.privateKey, 'base64url')}`;
  }

  private async accessToken(): Promise<string> {
    if (this.token && Date.now() < this.expiresAt) return this.token;
    if (this.pending) return this.pending;
    this.pending = (async () => {
      const res = await fetch(`${this.oauthBase}/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
          assertion: this.sign(),
        }).toString(),
      });
      if (!res.ok) {
        const detail = (await res.text()).slice(0, 200);
        throw new Error(`Google отклонил ключ ${res.status}: ${detail}`);
      }
      const data = (await res.json()) as { access_token?: string; expires_in?: number };
      if (!data.access_token) throw new Error('Google не вернул токен доступа');
      this.token = data.access_token;
      this.expiresAt = Date.now() + ((data.expires_in ?? 3600) - 60) * 1000;
      return this.token;
    })();
    try {
      return await this.pending;
    } finally {
      this.pending = null;
    }
  }

  /**
   * Сообщение в терминах FCM.
   *
   * Android и iOS настраиваются раздельно, потому что смысл «срочно» у них
   * разный: у Android это `priority: high` (будит устройство из Doze), у iOS —
   * заголовок `apns-priority: 10`. Указать одно и понадеяться на второе
   * нельзя — оффер на 60 секунд, пролежавший в очереди до разблокировки
   * экрана, приходит уже просроченным.
   */
  private payload(token: string, msg: PushMessage): object {
    const urgent = msg.priority === 'heads_up' || msg.priority === 'high';
    const data: Record<string, string> = { ...(msg.data ?? {}) };
    if (msg.deepLink) data.deepLink = msg.deepLink;
    return {
      message: {
        token,
        notification: { title: msg.title, body: msg.body },
        data,
        android: {
          priority: urgent ? 'HIGH' : 'NORMAL',
          ...(msg.ttlSeconds ? { ttl: `${msg.ttlSeconds}s` } : {}),
          ...(msg.collapseKey ? { collapse_key: msg.collapseKey } : {}),
          notification: {
            // Канал заводится приложением при старте: без объявленного канала
            // Android 8+ не покажет уведомление вовсе
            channel_id: msg.priority === 'heads_up' ? 'sozo_urgent' : 'sozo_default',
            ...(msg.priority === 'heads_up' ? { default_sound: true } : {}),
          },
        },
        apns: {
          headers: {
            'apns-priority': urgent ? '10' : '5',
            ...(msg.ttlSeconds
              ? { 'apns-expiration': String(Math.floor(Date.now() / 1000) + msg.ttlSeconds) }
              : {}),
            ...(msg.collapseKey ? { 'apns-collapse-id': msg.collapseKey } : {}),
          },
          payload: { aps: { sound: msg.priority === 'heads_up' ? 'default' : undefined } },
        },
      },
    };
  }

  async send(token: string, msg: PushMessage): Promise<PushResult> {
    try {
      const access = await this.accessToken();
      const res = await fetch(`${this.base}/v1/projects/${this.account.projectId}/messages:send`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${access}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(this.payload(token, msg)),
      });
      if (res.ok) {
        const data = (await res.json()) as { name?: string };
        return { sent: true, channel: this.channel, providerId: data.name };
      }
      const raw = await res.text();
      /**
       * Ответ поставщика — многострочный JSON, и в журнале от него видно
       * только первую строку с открывающей скобкой. Вытаскиваем то, ради
       * чего в этот журнал и смотрят: причину словами и код ошибки.
       *
       * Разница здесь не косметическая. THIRD_PARTY_AUTH_ERROR означает, что
       * отказала Apple, а не Google, — чинится он в ключе APNs, а не в
       * ключе Firebase, и перепутать эти два места стоит вечера.
       */
      const detail = ((): string => {
        try {
          const e = (JSON.parse(raw) as { error?: { message?: string; status?: string; details?: Array<{ errorCode?: string }> } }).error;
          const code = e?.details?.find((d) => d.errorCode)?.errorCode;
          return [e?.message, e?.status, code].filter(Boolean).join(' · ') || raw.slice(0, 300);
        } catch {
          return raw.slice(0, 300);
        }
      })();
      /**
       * 404 UNREGISTERED и 400 с невалидным токеном означают одно: приложение
       * на этом устройстве больше не живёт. Такую строку нужно снять, иначе
       * она будет отправляться вечно и портить статистику доставки —
       * поставщик отказывает не потому, что канал сломан.
       *
       * Всё остальное (401, 429, 5xx) — временное: ключ протух, лимит,
       * авария у Google. Тут решает вызывающий, повторять или нет.
       */
      const gone = res.status === 404 || (res.status === 400 && /registration token|INVALID_ARGUMENT/i.test(detail));
      if (res.status === 401) this.expiresAt = 0;
      if (!gone) this.log.error(`FCM отказал ${res.status}: ${detail}`);
      // Причина едет дальше целиком: в журнале доставки «HTTP 401» не
      // отличается от протухшего ключа Firebase, а это разные починки
      return { sent: false, channel: this.channel, gone, error: `HTTP ${res.status}: ${detail}` };
    } catch (e) {
      this.log.error(`FCM недоступен: ${(e as Error).message}`);
      return { sent: false, channel: this.channel, error: (e as Error).message };
    }
  }
}

/**
 * Выбор отправителя по конфигу.
 *
 * Ключ принимается двумя способами: путём к файлу сервисного аккаунта
 * (`PUSH_FCM_CREDENTIALS`) и содержимым JSON в переменной
 * (`PUSH_FCM_CREDENTIALS_JSON`). Второе нужно для docker-compose и CI, где
 * класть файл с приватным ключом на диск неудобно; первое — обычный путь
 * прода, где файл лежит с правами 600 и не попадает в переменные окружения,
 * видимые в `docker inspect`.
 */
@Injectable()
export class PushService {
  private readonly log = new Logger('Push');
  private readonly sender: PushSender;

  constructor() {
    const provider = (process.env.PUSH_PROVIDER ?? 'log').toLowerCase();
    if (provider !== 'fcm') {
      this.sender = new LogPushSender();
      if (process.env.NODE_ENV === 'production') {
        this.log.warn('PUSH_PROVIDER не задан: уведомления пишутся в журнал и никому не уходят');
      }
      return;
    }
    const account = PushService.readAccount();
    if (!account) {
      this.log.error('PUSH_PROVIDER=fcm, но ключ сервисного аккаунта не прочитан — уведомления останутся в журнале');
      this.sender = new LogPushSender();
      return;
    }
    /**
     * Адреса поставщика — из окружения, с боевыми умолчаниями.
     *
     * Не ради гибкости: подменить их нужно ровно один раз — в прогоне e2e,
     * где вместо Google отвечает заглушка. Без этого ветка настоящего
     * отправителя не исполнялась бы в тестах ни разу и впервые заработала бы
     * в проде, на первом живом уведомлении.
     */
    this.sender = new FcmPushSender(
      account,
      process.env.PUSH_FCM_BASE || 'https://fcm.googleapis.com',
      process.env.PUSH_FCM_OAUTH_BASE || 'https://oauth2.googleapis.com',
    );
    this.log.log(`Push уходят через FCM, проект ${account.projectId}`);
  }

  private static readAccount(): ServiceAccount | null {
    const log = new Logger('Push');
    const raw = process.env.PUSH_FCM_CREDENTIALS_JSON ?? PushService.readFile(process.env.PUSH_FCM_CREDENTIALS);
    if (!raw) return null;
    try {
      const j = JSON.parse(raw) as { project_id?: string; client_email?: string; private_key?: string };
      if (!j.project_id || !j.client_email || !j.private_key) {
        log.error('в ключе FCM нет project_id / client_email / private_key');
        return null;
      }
      return {
        projectId: j.project_id,
        clientEmail: j.client_email,
        // В переменной окружения перевод строки приходит экранированным —
        // без замены подпись не соберётся, а ошибка будет невнятной
        privateKey: j.private_key.replace(/\\n/g, '\n'),
      };
    } catch (e) {
      log.error(`ключ FCM не разобран: ${(e as Error).message}`);
      return null;
    }
  }

  private static readFile(path?: string): string | null {
    if (!path) return null;
    try {
      return readFileSync(path, 'utf8');
    } catch (e) {
      new Logger('Push').error(`ключ FCM не прочитан из ${path}: ${(e as Error).message}`);
      return null;
    }
  }

  /** Доставляет ли канал по-настоящему — от этого зависит дублирование SMS */
  get delivers(): boolean {
    return this.sender.delivers;
  }

  get channel(): string {
    return this.sender.channel;
  }

  send(token: string, msg: PushMessage): Promise<PushResult> {
    return this.sender.send(token, msg);
  }
}
