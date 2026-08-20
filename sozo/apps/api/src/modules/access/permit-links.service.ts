import { Injectable } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import { StateStore } from '../../common/state-store';

/**
 * Короткие ссылки на согласование наряда-допуска (W-06).
 *
 * Тот же принцип, что у веб-карточки заявки: в SMS уходит короткий код, а не
 * подписанный токен — сообщение кириллицей вмещает 70 символов, и JWT разбил бы
 * его на три части. Серверную запись вдобавок можно отозвать, а токен нет.
 *
 * Ссылка живёт ровно до срока SLA согласования: после него решение принимает
 * либо авто-согласие, либо диспетчер, и открытая ссылка только путает.
 */

/** Без нуля, О, единицы и I: код диктуют по телефону */
export const LINK_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/**
 * Код короткой ссылки. Вынесен из класса, потому что тем же алфавитом и той же
 * длиной пользуется запрос доступа в помещение (C-56): два разных алфавита
 * означали бы, что человек по телефону диктует то так, то этак.
 */
export function newLinkCode(taken: (code: string) => boolean): string {
  for (let i = 0; i < 10; i++) {
    let code = '';
    for (let j = 0; j < 8; j++) code += LINK_ALPHABET[randomInt(LINK_ALPHABET.length)];
    if (!taken(code)) return code;
  }
  throw new Error('Не удалось выдать уникальный код ссылки');
}

const ALPHABET = LINK_ALPHABET;

export interface PermitLinkRec {
  code: string;
  permitId: string;
  buildingId: string;
  /** Номер, на который ушла SMS — он же попадает в аудит решения */
  approverPhone: string;
  createdAt: string;
  expiresAt: string;
  usedAt?: string;
  revokedAt?: string;
  opens: number;
  lastOpenedAt?: string;
}

@Injectable()
export class PermitLinksService {
  private readonly links = new Map<string, PermitLinkRec>();

  constructor(private readonly store: StateStore) {
    this.store.register(
      'permitLinks',
      () => [...this.links.values()],
      (d) => {
        this.links.clear();
        for (const l of (d ?? []) as PermitLinkRec[]) this.links.set(l.code, l);
      },
    );
  }

  private newCode(): string {
    for (let i = 0; i < 10; i++) {
      let code = '';
      for (let j = 0; j < 8; j++) code += ALPHABET[randomInt(ALPHABET.length)];
      if (!this.links.has(code)) return code;
    }
    throw new Error('Не удалось выдать уникальный код ссылки');
  }

  /** Ссылка согласующему. Действующая переиспользуется — повторная SMS ведёт туда же. */
  issue(permitId: string, buildingId: string, approverPhone: string, expiresAt: string): PermitLinkRec {
    const live = [...this.links.values()].find(
      (l) =>
        l.permitId === permitId &&
        l.approverPhone === approverPhone &&
        !l.revokedAt &&
        !l.usedAt &&
        Date.parse(l.expiresAt) > Date.now(),
    );
    if (live) return live;

    const rec: PermitLinkRec = {
      code: this.newCode(),
      permitId,
      buildingId,
      approverPhone,
      createdAt: new Date().toISOString(),
      expiresAt,
      opens: 0,
    };
    this.links.set(rec.code, rec);
    return rec;
  }

  /**
   * Разбор кода. `null` на любую причину отказа — истёк, использован, отозван,
   * не существует: иначе перебор кодов расскажет, какие наряды есть.
   */
  resolve(code: string): PermitLinkRec | null {
    const l = this.links.get(code.toUpperCase());
    if (!l) return null;
    if (l.revokedAt || l.usedAt) return null;
    if (Date.parse(l.expiresAt) <= Date.now()) return null;
    l.opens += 1;
    l.lastOpenedAt = new Date().toISOString();
    return l;
  }

  /** Состояние ссылки без побочных эффектов — для страницы «ссылка недействительна» */
  peek(code: string): PermitLinkRec | undefined {
    return this.links.get(code.toUpperCase());
  }

  markUsed(code: string): void {
    const l = this.links.get(code.toUpperCase());
    if (l) l.usedAt = new Date().toISOString();
  }

  revokeForPermit(permitId: string): number {
    let n = 0;
    for (const l of this.links.values()) {
      if (l.permitId === permitId && !l.revokedAt && !l.usedAt) {
        l.revokedAt = new Date().toISOString();
        n += 1;
      }
    }
    return n;
  }

  listForPermit(permitId: string): PermitLinkRec[] {
    return [...this.links.values()].filter((l) => l.permitId === permitId);
  }
}
