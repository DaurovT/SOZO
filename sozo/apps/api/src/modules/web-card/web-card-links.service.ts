import { Injectable } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import { StateStore } from '../../common/state-store';

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
export class WebCardLinksService {
  private readonly links = new Map<string, WebCardLinkRec>();

  constructor(private readonly store: StateStore) {
    this.store.register(
      'webCardLinks',
      () => [...this.links.values()],
      (d) => {
        this.links.clear();
        for (const l of (d ?? []) as WebCardLinkRec[]) this.links.set(l.code, l);
      },
    );
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
    this.store.persist();
  }

  revoke(code: string): void {
    const rec = this.links.get(code.toUpperCase());
    if (!rec) return;
    rec.revokedAt = new Date().toISOString();
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
