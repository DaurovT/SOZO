import { Injectable, OnModuleInit } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import { StateStore } from '../../common/state-store';
import { PrismaService } from '../../common/prisma.service';
import { PgMirror } from '../../common/pg-mirror';

/**
 * Короткие ссылки на веб-карточку заявки.
 *
 * Почему не JWT в адресе: ссылка уходит в SMS, а туда помещается 70 символов
 * кириллицей. Подписанный токен занимает вдвое больше — сообщение разобьётся
 * на три части и подорожает втрое. Поэтому в адресе короткий код, а всё
 * остальное хранится на сервере.
 *
 * Побочная выгода важнее экономии: серверную запись можно отозвать. Клиент
 * переслал ссылку в рабочий чат — код гасится одним действием, чего с
 * подписанным токеном не сделать.
 */

/** Без нуля, О, единицы и I: код диктуют по телефону и вводят руками */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export interface WebCardLinkRec {
  code: string;
  orderId: string;
  clientPhone: string;
  createdAt: string;
  expiresAt: string;
  revokedAt?: string;
  /** Сколько раз открывали — видно, дошла ли SMS до человека */
  opens: number;
  lastOpenedAt?: string;
}

@Injectable()
export class WebCardLinksService implements OnModuleInit {
  private readonly links = new Map<string, WebCardLinkRec>();

  /** Общая таблица коротких ссылок — см. DEV-19 §3.2 */
  private readonly mirror: PgMirror;

  constructor(
    private readonly store: StateStore,
    prisma: PrismaService,
  ) {
    this.store.register(
      'webCardLinks',
      () => [...this.links.values()],
      (d) => {
        this.links.clear();
        for (const l of (d ?? []) as WebCardLinkRec[]) this.links.set(l.code, l);
      },
    );
    this.mirror = new PgMirror(prisma, 'WebCardLinks', {
      load: async (tx) => {
        const rows = await tx.shortLink.findMany({ where: { kind: 'web_card' } });
        if (!rows.length) return 0;
        this.links.clear();
        for (const r of rows) {
          this.links.set(r.code, {
            code: r.code,
            orderId: r.targetId,
            clientPhone: r.phone,
            createdAt: r.createdAt.toISOString(),
            expiresAt: r.expiresAt.toISOString(),
            revokedAt: r.revokedAt?.toISOString(),
            opens: r.opens,
            lastOpenedAt: r.lastOpenedAt?.toISOString(),
          });
        }
        return rows.length;
      },
      save: async (tx, tenantId) => {
        for (const l of this.links.values()) {
          const data = {
            tenantId,
            kind: 'web_card',
            targetId: l.orderId,
            phone: l.clientPhone,
            buildingId: null,
            createdAt: new Date(l.createdAt),
            expiresAt: new Date(l.expiresAt),
            revokedAt: l.revokedAt ? new Date(l.revokedAt) : null,
            opens: l.opens,
            lastOpenedAt: l.lastOpenedAt ? new Date(l.lastOpenedAt) : null,
          };
          await tx.shortLink.upsert({ where: { code: l.code }, create: { code: l.code, ...data }, update: data });
        }
      },
    });
  }

  onModuleInit(): Promise<void> {
    return this.mirror.init();
  }

  /** Разовый перенос state.json (deploy/import-state) */
  flushToDb(): Promise<void> {
    return this.mirror.flush();
  }

  private newCode(): string {
    for (let attempt = 0; attempt < 10; attempt++) {
      let code = '';
      for (let i = 0; i < 8; i++) code += ALPHABET[randomInt(ALPHABET.length)];
      if (!this.links.has(code)) return code;
    }
    // Восемь символов из 32-буквенного алфавита — триллион вариантов;
    // десять коллизий подряд означают, что что-то не так с генератором
    throw new Error('Не удалось выдать уникальный код ссылки');
  }

  /**
   * Ссылка на заявку. Действующая переиспользуется: диспетчер отправляет SMS
   * повторно, и вторая ссылка на ту же заявку только путает.
   */
  issue(orderId: string, clientPhone: string, ttlDays = 7): WebCardLinkRec {
    const existing = [...this.links.values()].find(
      (l) => l.orderId === orderId && !l.revokedAt && new Date(l.expiresAt).getTime() > Date.now(),
    );
    if (existing) return existing;

    const rec: WebCardLinkRec = {
      code: this.newCode(),
      orderId,
      clientPhone,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + ttlDays * 86_400_000).toISOString(),
      opens: 0,
    };
    this.links.set(rec.code, rec);
    this.mirror.schedule();
    this.store.persist();
    return rec;
  }

  /**
   * Найти живую ссылку. Просроченная, отозванная и несуществующая — одно и то
   * же `null`: страница на все три случая отвечает одинаково, иначе перебор
   * кодов расскажет, какие заявки есть.
   */
  resolve(code: string): WebCardLinkRec | null {
    const rec = this.links.get((code ?? '').toUpperCase());
    if (!rec || rec.revokedAt) return null;
    if (new Date(rec.expiresAt).getTime() < Date.now()) return null;
    return rec;
  }

  /** Отметка открытия — по ней видно, дошла ли SMS */
  touchOpen(code: string): void {
    const rec = this.links.get(code.toUpperCase());
    if (!rec) return;
    rec.opens += 1;
    rec.lastOpenedAt = new Date().toISOString();
    this.mirror.schedule();
    this.store.persist();
  }

  revoke(code: string): void {
    const rec = this.links.get(code.toUpperCase());
    if (!rec) return;
    rec.revokedAt = new Date().toISOString();
    this.mirror.schedule();
    this.store.persist();
  }

  /** Все ссылки — админке, чтобы видеть, кому что выслали и открыли ли */
  all(): WebCardLinkRec[] {
    return [...this.links.values()];
  }

  forOrder(orderId: string): WebCardLinkRec[] {
    return [...this.links.values()].filter((l) => l.orderId === orderId);
  }
}
