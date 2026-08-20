import { Injectable } from '@nestjs/common';
import { randomInt } from 'node:crypto';

/**
 * Коды подтверждения входа.
 *
 * Держатся в памяти процесса и не переживают перезапуск — намеренно. Код
 * живёт три минуты; после перезапуска человек просто запрашивает новый, и это
 * дешевле, чем строка в базе, которую придётся чистить и которая расходится
 * между процессами ровно в тот момент, когда их станет два (тогда сюда
 * встанет Redis, а не таблица).
 *
 * Хранится сам код, а не его хеш: он живёт минуты, годен один раз и не даёт
 * доступа никуда, кроме этого же номера. Хеширование здесь создало бы
 * видимость защиты — от того, у кого уже есть память процесса.
 */
export interface OtpEntry {
  code: string;
  expiresAt: number;
  /** Неверные попытки: после лимита код умирает, а не ждёт перебора */
  attempts: number;
  /** Когда отправлен последний код — от него считается пауза до следующего */
  sentAt: number;
}

/** Три минуты: дольше — окно для перехвата, короче — не успевает прийти SMS */
export const OTP_TTL_MS = 3 * 60 * 1000;
/** Пауза между отправками на один номер */
export const OTP_RESEND_MS = 60 * 1000;
/** Сколько кодов можно запросить на номер за час */
export const OTP_HOURLY_LIMIT = 5;
/** Неверных попыток на один код */
export const OTP_MAX_ATTEMPTS = 5;

export interface OtpIssue {
  code: string;
  /** Через сколько секунд можно будет запросить следующий */
  retryAfterSec: number;
}

@Injectable()
export class OtpStore {
  private readonly entries = new Map<string, OtpEntry>();
  /** Времена отправок за последний час — по ним считается часовой лимит */
  private readonly sends = new Map<string, number[]>();

  /**
   * Пятизначный код. Не шестизначный: столько же цифр, сколько у всех
   * знакомых человеку сервисов в стране, и код диктуют по телефону.
   * Ведущие нули сохраняются — код это строка, а не число.
   */
  private newCode(): string {
    return String(randomInt(0, 100_000)).padStart(5, '0');
  }

  /**
   * Сколько секунд осталось до следующей возможной отправки.
   * Ноль — можно отправлять.
   */
  cooldownLeft(phone: string, now = Date.now()): number {
    const e = this.entries.get(phone);
    if (!e) return 0;
    const left = e.sentAt + OTP_RESEND_MS - now;
    return left > 0 ? Math.ceil(left / 1000) : 0;
  }

  /** Исчерпан ли часовой лимит отправок на номер */
  hourlyExhausted(phone: string, now = Date.now()): boolean {
    return this.recentSends(phone, now).length >= OTP_HOURLY_LIMIT;
  }

  private recentSends(phone: string, now: number): number[] {
    const hourAgo = now - 3600_000;
    const fresh = (this.sends.get(phone) ?? []).filter((t) => t > hourAgo);
    this.sends.set(phone, fresh);
    return fresh;
  }

  /**
   * Выдать код. Вызывается только после проверки лимитов: отдельная проверка
   * и отдельная выдача нужны, чтобы отказ по лимиту не считался отправкой.
   */
  issue(phone: string, fixedCode?: string, now = Date.now()): OtpIssue {
    // Уборка протухших: записи удаляются при проверке, но брошенный код никто
    // не проверяет — без этого карта росла бы на каждый неудачный вход
    for (const [k, v] of this.entries) if (v.expiresAt <= now) this.entries.delete(k);
    const code = fixedCode ?? this.newCode();
    this.entries.set(phone, { code, expiresAt: now + OTP_TTL_MS, attempts: 0, sentAt: now });
    this.sends.set(phone, [...this.recentSends(phone, now), now]);
    return { code, retryAfterSec: Math.ceil(OTP_RESEND_MS / 1000) };
  }

  /**
   * Проверить код.
   *
   * Возвращает причину отказа, а не просто false: «код истёк» и «код неверен»
   * — разные события для человека и разные строки в журнале входов.
   */
  verify(phone: string, code: string, now = Date.now()): 'ok' | 'none' | 'expired' | 'attempts' | 'wrong' {
    const e = this.entries.get(phone);
    if (!e) return 'none';
    if (e.expiresAt <= now) {
      this.entries.delete(phone);
      return 'expired';
    }
    if (e.attempts >= OTP_MAX_ATTEMPTS) return 'attempts';
    if (e.code !== code) {
      e.attempts += 1;
      // Исчерпанная попытка сжигает код, но запись остаётся до конца срока.
      //
      // Удалять её сразу нельзя: следующая проверка вернула бы «код не
      // запрашивался», и человек, исчерпавший попытки, читал бы «неверный
      // код» и вводил бы дальше — вместо «запросите новый». Запись живёт
      // ровно до истечения кода и ничего не пропускает: сравнение до неё
      // не доходит.
      return e.attempts >= OTP_MAX_ATTEMPTS ? 'attempts' : 'wrong';
    }
    // Код одноразовый: повторный вход требует нового
    this.entries.delete(phone);
    return 'ok';
  }

  /** Сколько номеров сейчас ждут ввода кода — видно в /health процесса */
  pending(): number {
    return this.entries.size;
  }
}
