import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { uuidv7 } from '@sozo/kernel';
import { StateStore } from '../../common/state-store';
import { PrismaService } from '../../common/prisma.service';
import { PgMirror } from '../../common/pg-mirror';
import type { Locale } from '../../common/locale';

/**
 * Реестр устройств, которым можно доставить push (ТЗ §11).
 *
 * Приложение присылает токен FCM при каждом входе и при каждой его смене —
 * поставщик меняет токен сам, без спроса, при переустановке и иногда при
 * обновлении. Поэтому регистрация идемпотентна по токену: повторный вызов не
 * плодит строки, а обновляет владельца и метку живости.
 */

export type PushApp = 'client' | 'master';
export type DevicePlatform = 'android' | 'ios' | 'web';

export interface DeviceTokenRec {
  id: string;
  token: string;
  app: PushApp;
  platform: DevicePlatform;
  phone: string;
  locale: Locale;
  lastSeenAt: string;
  revokedAt?: string;
}

/**
 * Сколько устройство считается живым без единого подтверждения токена.
 *
 * Полгода — это не про экономию строк, а про доставку: FCM отзывает токен
 * молча, и мёртвые адресаты растворяют статистику отправки. Полугодовой
 * порог выбран потому, что сезонные заявки (кондиционер, отопление) приходят
 * раз в полгода, и человек, вернувшийся к приложению через пять месяцев,
 * обязан получить уведомление сразу, а не после повторного входа.
 */
const STALE_DAYS = 180;

/**
 * Сколько держим снятую строку, прежде чем удалить совсем.
 *
 * Снятый токен не удаляется сразу намеренно: он возвращается при первом же
 * фоновом обновлении, которое приложение делает и после выхода. Но вечно
 * он не нужен — через квартал это уже не «человек вышел вчера», а мусор,
 * который проходит через каждую выборку адресатов.
 */
const KEEP_REVOKED_DAYS = 90;

/** Как часто подметаем. Чаще раза в сутки незачем: строки живут месяцами */
const SWEEP_EVERY_MS = 24 * 3600 * 1000;

@Injectable()
export class DeviceTokensService implements OnModuleInit {
  private readonly items: DeviceTokenRec[] = [];
  private readonly mirror: PgMirror;

  private readonly log = new Logger('Push');

  constructor(
    private readonly store: StateStore,
    private readonly prisma: PrismaService,
  ) {
    this.store.register(
      'deviceTokens',
      () => this.items,
      (d) => {
        this.items.length = 0;
        this.items.push(...((d ?? []) as DeviceTokenRec[]));
      },
    );
    this.mirror = new PgMirror(prisma, 'DeviceTokens', {
      load: async (tx) => {
        const rows = await tx.deviceToken.findMany({ orderBy: { createdAt: 'asc' } });
        if (!rows.length) return 0;
        this.items.length = 0;
        this.items.push(
          ...rows.map((r) => ({
            id: r.id,
            token: r.token,
            app: r.app as PushApp,
            platform: r.platform as DevicePlatform,
            phone: r.phone,
            locale: r.locale as Locale,
            lastSeenAt: r.lastSeenAt.toISOString(),
            revokedAt: r.revokedAt?.toISOString(),
          })),
        );
        return rows.length;
      },
      save: async (tx, tenantId) => {
        for (const d of [...this.items]) {
          const data = {
            app: d.app,
            platform: d.platform,
            phone: d.phone,
            locale: d.locale,
            lastSeenAt: new Date(d.lastSeenAt),
            revokedAt: d.revokedAt ? new Date(d.revokedAt) : null,
          };
          await tx.deviceToken.upsert({
            where: { token: d.token },
            create: { id: d.id, tenantId, token: d.token, ...data },
            update: data,
          });
        }
      },
    });
    this.store.registerMirror(this.mirror);
  }

  private lastSweep = 0;

  onModuleInit(): Promise<void> {
    return this.mirror.init();
  }

  /**
   * Уборка мёртвых строк — лениво, при регистрации устройства.
   *
   * Без отдельного таймера: регистрация происходит на каждом запуске
   * приложения, то есть достаточно часто, а таймер в монолите пришлось бы
   * заводить, останавливать при выключении и объяснять в двух местах.
   *
   * Удаляем только заведомо мёртвое: снятое больше квартала назад и не
   * подтверждавшееся дольше двух сроков живости. Устройство человека,
   * который вернулся через полгода, при этом не теряется — оно
   * зарегистрируется заново при первом же запуске приложения.
   */
  private sweep(): void {
    const now = Date.now();
    if (now - this.lastSweep < SWEEP_EVERY_MS) return;
    this.lastSweep = now;
    const revokedBefore = now - KEEP_REVOKED_DAYS * 86_400_000;
    const seenBefore = now - 2 * STALE_DAYS * 86_400_000;
    const dead = this.items.filter(
      (d) =>
        (d.revokedAt && Date.parse(d.revokedAt) < revokedBefore) || Date.parse(d.lastSeenAt) < seenBefore,
    );
    if (!dead.length) return;
    for (const d of dead) {
      const i = this.items.indexOf(d);
      if (i >= 0) this.items.splice(i, 1);
    }
    this.store.persist();
    // Из базы строки уходят отдельным запросом: зеркало умеет только
    // записывать набор, а удаление в нём не выражено
    if (this.prisma.enabled) {
      void this.prisma
        .withContext((tx) => tx.deviceToken.deleteMany({ where: { token: { in: dead.map((d) => d.token) } } }))
        .catch((e: unknown) => this.log.error(`чистка устройств не удалась: ${(e as Error).message}`));
    }
    this.log.log(`снято мёртвых устройств: ${dead.length}`);
  }

  /**
   * Зарегистрировать устройство.
   *
   * Владелец у строки перезаписывается намеренно. Тот же токен с другим
   * телефоном означает ровно одно: этим телефоном вошёл другой человек —
   * приложение переустановили, аппарат продали, в семье сменился владелец
   * учётной записи. Оставить прежнего адресата значило бы слать ему чужие
   * заявки с адресом и именем клиента.
   */
  register(input: {
    token: string;
    app: PushApp;
    platform: DevicePlatform;
    phone: string;
    locale?: Locale;
  }): DeviceTokenRec {
    this.sweep();
    const now = new Date().toISOString();
    const found = this.items.find((d) => d.token === input.token);
    if (found) {
      found.app = input.app;
      found.platform = input.platform;
      found.phone = input.phone;
      if (input.locale) found.locale = input.locale;
      found.lastSeenAt = now;
      delete found.revokedAt;
      this.persist();
      return found;
    }
    const rec: DeviceTokenRec = {
      id: uuidv7(),
      token: input.token,
      app: input.app,
      platform: input.platform,
      phone: input.phone,
      locale: input.locale ?? 'ru',
      lastSeenAt: now,
    };
    this.items.push(rec);
    this.persist();
    return rec;
  }

  /**
   * Снять устройство — выход из приложения.
   *
   * Строка не удаляется, а помечается: удалённая вернулась бы при первом же
   * фоновом обновлении токена, которое приложение делает и после выхода,
   * потому что FCM живёт в процессе, а не в сессии.
   */
  revoke(token: string): boolean {
    const found = this.items.find((d) => d.token === token && !d.revokedAt);
    if (!found) return false;
    found.revokedAt = new Date().toISOString();
    this.persist();
    return true;
  }

  /** Токен отвергнут поставщиком: приложения на устройстве больше нет */
  markGone(token: string): void {
    this.revoke(token);
  }

  /**
   * Живые устройства адресата.
   *
   * Приложение обязательно: слесарь заказывает ремонт себе домой тем же
   * номером, и оффер на выезд в его клиентское приложение уходить не должен.
   */
  for(phone: string, app: PushApp): DeviceTokenRec[] {
    const stale = Date.now() - STALE_DAYS * 24 * 3600 * 1000;
    return this.items.filter(
      (d) => d.phone === phone && d.app === app && !d.revokedAt && Date.parse(d.lastSeenAt) >= stale,
    );
  }

  /** Есть ли куда слать. По этому ответу решается дублирование SMS (ТЗ §11) */
  has(phone: string, app: PushApp): boolean {
    return this.for(phone, app).length > 0;
  }

  /** Разовый перенос state.json (deploy/import-state) */
  flushToDb(): Promise<void> {
    return this.mirror.flush();
  }

  private persist(): void {
    this.store.persist();
  }
}
