import { BadRequestException, Injectable, NotFoundException, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { uuidv7 } from '@sozo/kernel';
import { signJwt } from '../../common/jwt';
import { StateStore } from '../../common/state-store';

export const DEV_OTP_CODE = '00000'; // dev-заглушка: «пять нулей»

/**
 * Разрешён ли вход по dev-коду.
 *
 * Вне прода — да, всегда: без этого не работает ни разработка, ни тесты.
 * В проде — только по явному ALLOW_DEV_OTP=1, и это осознанное решение
 * владельца, а не умолчание: пока нет SMS-провайдера (Eskiz/Playmobile),
 * выключение флага делает вход невозможным вообще. Смысл флага в том, что
 * дыру теперь видно в конфиге, а не только в исходниках.
 */
export function devOtpAllowed(): boolean {
  if (process.env.NODE_ENV !== 'production') return true;
  return process.env.ALLOW_DEV_OTP === '1';
}

export interface UserRecord {
  id: string;
  phone: string;
  fullName: string;
  roles: string[]; // admin | accountant | dispatcher | master | ...
  /**
   * Доступ закрыт: человек уволился или его учётную запись компрометировали.
   * Клиента заблокировать было можно, своего сотрудника — нет, и увольнение
   * оставляло действующий доступ ко всей платформе.
   */
  blockedAt?: string;
  blockedReason?: string;
  /** Последний вход — по нему видно, кто ещё пользуется доступом */
  lastLoginAt?: string;
}

/**
 * След входа в систему.
 *
 * Пишем и удачные, и неудачные: при разборе инцидента важнее всего вторые —
 * серия отказов по чужому номеру означает подбор. Хранение ограничено, это
 * оперативный журнал, а не архив.
 */
export interface LoginEventRec {
  id: string;
  phone: string;
  at: string;
  ok: boolean;
  reason?: string;
  roles: string[];
}

@Injectable()
export class IdentityService {
  private readonly users = new Map<string, UserRecord>(); // key: phone
  /**
   * Роли, которые выводятся из других реестров: телефон в карточке мастера даёт роль master.
   * Хук, а не прямая зависимость — identity не должен знать о модуле masters (DEV-07 §3).
   */
  private readonly roleProviders: Array<(phone: string) => string[]> = [];
  private readonly logins: LoginEventRec[] = [];

  constructor(private readonly store: StateStore) {
    if (process.env.NODE_ENV === 'production' && devOtpAllowed()) {
      // eslint-disable-next-line no-console
      console.warn(
        '[OTP] ВНИМАНИЕ: включён вход по dev-коду 00000 в production (ALLOW_DEV_OTP=1). ' +
          'Любой, кто знает номер, войдёт под этим человеком. Снимите флаг, как только появится SMS-провайдер.',
      );
    }
    // Сид: владелец платформы, бухгалтер, диспетчер (роли PRD-04 §1)
    this.upsert({ phone: '+998900000000', fullName: 'Админ (владелец)', roles: ['admin'] });
    this.upsert({ phone: '+998900000001', fullName: 'Бухгалтер', roles: ['accountant'] });
    this.upsert({ phone: '+998900000002', fullName: 'Диспетчер (зонный)', roles: ['dispatcher'] });
    this.store.register(
      'identity',
      () => ({ users: [...this.users.values()], logins: this.logins.slice(-1000) }),
      (d) => {
        // Раньше здесь лежал просто массив пользователей — читаем оба вида,
        // иначе обновление стирает всех, кто был заведён до него
        const data = Array.isArray(d) ? { users: d as UserRecord[], logins: [] } : (d as { users: UserRecord[]; logins?: LoginEventRec[] });
        this.users.clear();
        for (const u of data.users ?? []) this.users.set(u.phone, u);
        this.logins.length = 0;
        this.logins.push(...(data.logins ?? []));
      },
    );
  }

  private upsert(u: Omit<UserRecord, 'id'>): UserRecord {
    const existing = this.users.get(u.phone);
    if (existing) return existing;
    const rec = { id: uuidv7(), ...u };
    this.users.set(u.phone, rec);
    this.store.persist();
    return rec;
  }

  list(): UserRecord[] {
    return [...this.users.values()];
  }

  requestOtp(phone: string): { sent: boolean; channel: string } {
    // Заблокированному коды не шлём.
    //
    // Раньше блокировка всплывала только при проверке кода — и приходила как
    // 401, неотличимо от «неверный код». Человек получал списанную попытку и
    // предложение ввести код заново, которого у него не было. Отказ на шаге
    // номера честнее и заодно не тратит SMS.
    const known = this.users.get(phone);
    if (known?.blockedAt) {
      this.trackLogin(phone, false, known.roles, `доступ закрыт: ${known.blockedReason ?? ''}`);
      throw new ForbiddenException({
        code: 'USER_BLOCKED',
        message: 'Доступ закрыт. Обратитесь к администратору',
        reason: known.blockedReason ?? null,
      });
    }
    // SMS_PROVIDER=log (DEV-04 §1): на dev код не отправляется, всегда «00000»
    // eslint-disable-next-line no-console
    console.log(`[OTP] ${phone} → код ${DEV_OTP_CODE} (dev-заглушка)`);
    return { sent: true, channel: 'log' };
  }

  registerRoleProvider(fn: (phone: string) => string[]): void {
    this.roleProviders.push(fn);
  }

  /** Журнал входов, свежие сверху */
  loginLog(limit = 200): LoginEventRec[] {
    return this.logins.slice(-limit).reverse();
  }

  private trackLogin(phone: string, ok: boolean, roles: string[], reason?: string): void {
    this.logins.push({ id: uuidv7(), phone, at: new Date().toISOString(), ok, roles, reason });
    if (this.logins.length > 2000) this.logins.splice(0, this.logins.length - 2000);
    this.store.persist();
  }

  /**
   * Закрыть или вернуть доступ сотруднику.
   *
   * Учётную запись не удаляем: её след остаётся в аудите, и человек, чьи
   * действия там записаны, должен оставаться опознаваемым.
   */
  setBlocked(userId: string, blocked: boolean, reason?: string): UserRecord {
    const user = [...this.users.values()].find((u) => u.id === userId);
    if (!user) throw new NotFoundException({ code: 'USER_NOT_FOUND' });
    if (blocked && !reason?.trim()) {
      throw new BadRequestException({ code: 'REASON_REQUIRED', message: 'Причина блокировки обязательна' });
    }
    user.blockedAt = blocked ? new Date().toISOString() : undefined;
    user.blockedReason = blocked ? reason!.trim() : undefined;
    this.store.persist();
    return user;
  }

  verify(phone: string, code: string): { accessToken: string; user: UserRecord } {
    if (!devOtpAllowed()) {
      this.trackLogin(phone, false, [], 'dev-код выключен, SMS-провайдер не подключён');
      throw new UnauthorizedException({
        code: 'OTP_PROVIDER_MISSING',
        message: 'Вход по коду временно недоступен: SMS-провайдер не подключён',
      });
    }
    if (code !== DEV_OTP_CODE) {
      this.trackLogin(phone, false, [], 'неверный код');
      throw new UnauthorizedException({ code: 'OTP_INVALID' });
    }
    const known = this.users.get(phone);
    if (known?.blockedAt) {
      this.trackLogin(phone, false, known.roles, `доступ закрыт: ${known.blockedReason ?? ''}`);
      throw new UnauthorizedException({
        code: 'USER_BLOCKED',
        message: 'Доступ закрыт. Обратитесь к администратору',
      });
    }
    // Неизвестный телефон получает роль клиента — доступа к админке и диспетчерской нет.
    // Роли выдаёт админ (A-10); в проде — приглашения по SMS и матрица прав (ТЗ 2.3).
    const user = this.upsert({ phone, fullName: `Клиент ${phone.slice(-4)}`, roles: ['client'] });
    // Мастер мог быть заведён после первого входа — роль подтягиваем на каждом входе
    const derived = this.roleProviders.flatMap((fn) => fn(phone));
    const merged = [...new Set([...user.roles, ...derived])];
    if (merged.length !== user.roles.length) {
      user.roles = merged;
      this.store.persist();
    }
    user.lastLoginAt = new Date().toISOString();
    this.store.persist();
    this.trackLogin(phone, true, user.roles);
    const accessToken = signJwt({ sub: user.id, phone: user.phone, roles: user.roles }, 12 * 60 * 60);
    return { accessToken, user };
  }

  /** A-10: выдача и отзыв ролей администратором */
  setRoles(userId: string, roles: string[]): UserRecord {
    const allowed = ['admin', 'accountant', 'dispatcher', 'master', 'client'];
    const clean = [...new Set(roles.filter((r) => allowed.includes(r)))];
    if (clean.length === 0) throw new BadRequestException({ code: 'ROLES_REQUIRED', message: `Допустимые роли: ${allowed.join(', ')}` });
    const user = [...this.users.values()].find((u) => u.id === userId);
    if (!user) throw new NotFoundException({ code: 'USER_NOT_FOUND' });
    if (user.roles.includes('admin') && !clean.includes('admin')) {
      const admins = [...this.users.values()].filter((u) => u.roles.includes('admin'));
      if (admins.length <= 1) {
        throw new BadRequestException({ code: 'LAST_ADMIN', message: 'Нельзя снять роль у последнего администратора' });
      }
    }
    user.roles = clean;
    this.store.persist();
    return user;
  }
}
