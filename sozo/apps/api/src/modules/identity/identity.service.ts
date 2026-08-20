import { BadRequestException, Inject, Injectable, NotFoundException, OnModuleInit, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { signJwt } from '../../common/jwt';
import type { IdentityRepository, LoginEventRec, UserRecord } from './identity.repository';

export const IDENTITY_REPOSITORY = Symbol('IDENTITY_REPOSITORY');
export type { UserRecord, LoginEventRec } from './identity.repository';

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

/**
 * След входа в систему.
 *
 * Пишем и удачные, и неудачные: при разборе инцидента важнее всего вторые —
 * серия отказов по чужому номеру означает подбор. Хранение ограничено, это
 * оперативный журнал, а не архив.
 */
@Injectable()
export class IdentityService implements OnModuleInit {
  /**
   * Роли, которые выводятся из других реестров: телефон в карточке мастера даёт роль master.
   * Хук, а не прямая зависимость — identity не должен знать о модуле masters (DEV-07 §3).
   */
  private readonly roleProviders: Array<(phone: string) => string[]> = [];
  private readonly logins: LoginEventRec[] = [];


  constructor(@Inject(IDENTITY_REPOSITORY) private readonly repo: IdentityRepository) {}

  /**
   * Сид служебных учёток. Раньше стоял в конструкторе, но с базой запись в
   * конструкторе невозможна: подключение к тому моменту ещё не поднято.
   */
  async onModuleInit(): Promise<void> {
    const seed: Array<Omit<UserRecord, 'id'>> = [
      { phone: '+998900000000', fullName: 'Админ (владелец)', roles: ['admin'] },
      { phone: '+998900000001', fullName: 'Бухгалтер', roles: ['accountant'] },
      { phone: '+998900000002', fullName: 'Диспетчер (зонный)', roles: ['dispatcher'] },
    ];
    for (const u of seed) {
      if (!(await this.repo.byPhone(u.phone))) await this.repo.create(u);
    }
  }

  private async upsert(u: Omit<UserRecord, 'id'>): Promise<UserRecord> {
    return (await this.repo.byPhone(u.phone)) ?? (await this.repo.create(u));
  }

  list(): Promise<UserRecord[]> {
    return this.repo.list();
  }

  async requestOtp(phone: string): Promise<{ sent: boolean; channel: string }> {
    // Заблокированному коды не шлём.
    //
    // Раньше блокировка всплывала только при проверке кода — и приходила как
    // 401, неотличимо от «неверный код». Человек получал списанную попытку и
    // предложение ввести код заново, которого у него не было. Отказ на шаге
    // номера честнее и заодно не тратит SMS.
    const known = await this.repo.byPhone(phone);
    if (known?.blockedAt) {
      await this.trackLogin(phone, false, known.roles, `доступ закрыт: ${known.blockedReason ?? ''}`);
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
  loginLog(limit = 200): Promise<LoginEventRec[]> {
    return this.repo.loginLog(limit);
  }

  private async trackLogin(phone: string, ok: boolean, roles: string[], reason?: string): Promise<void> {
    await this.repo.trackLogin({ phone, at: new Date().toISOString(), ok, roles, reason });
  }

  /**
   * Закрыть или вернуть доступ сотруднику.
   *
   * Учётную запись не удаляем: её след остаётся в аудите, и человек, чьи
   * действия там записаны, должен оставаться опознаваемым.
   */
  async setBlocked(userId: string, blocked: boolean, reason?: string): Promise<UserRecord> {
    const user = await this.repo.byId(userId);
    if (!user) throw new NotFoundException({ code: 'USER_NOT_FOUND' });
    if (blocked && !reason?.trim()) {
      throw new BadRequestException({ code: 'REASON_REQUIRED', message: 'Причина блокировки обязательна' });
    }
    user.blockedAt = blocked ? new Date().toISOString() : undefined;
    user.blockedReason = blocked ? reason!.trim() : undefined;
    await this.repo.save(user);
    return user;
  }

  async verify(phone: string, code: string): Promise<{ accessToken: string; user: UserRecord }> {
    if (!devOtpAllowed()) {
      await this.trackLogin(phone, false, [], 'dev-код выключен, SMS-провайдер не подключён');
      throw new UnauthorizedException({
        code: 'OTP_PROVIDER_MISSING',
        message: 'Вход по коду временно недоступен: SMS-провайдер не подключён',
      });
    }
    if (code !== DEV_OTP_CODE) {
      await this.trackLogin(phone, false, [], 'неверный код');
      throw new UnauthorizedException({ code: 'OTP_INVALID' });
    }
    const known = await this.repo.byPhone(phone);
    if (known?.blockedAt) {
      await this.trackLogin(phone, false, known.roles, `доступ закрыт: ${known.blockedReason ?? ''}`);
      throw new UnauthorizedException({
        code: 'USER_BLOCKED',
        message: 'Доступ закрыт. Обратитесь к администратору',
      });
    }
    // Неизвестный телефон получает роль клиента — доступа к админке и диспетчерской нет.
    // Роли выдаёт админ (A-10); в проде — приглашения по SMS и матрица прав (ТЗ 2.3).
    const user = await this.upsert({ phone, fullName: `Клиент ${phone.slice(-4)}`, roles: ['client'] });
    // Мастер мог быть заведён после первого входа — роль подтягиваем на каждом входе
    const derived = this.roleProviders.flatMap((fn) => fn(phone));
    const merged = [...new Set([...user.roles, ...derived])];
    if (merged.length !== user.roles.length) user.roles = merged;
    user.lastLoginAt = new Date().toISOString();
    await this.repo.save(user);
    await this.trackLogin(phone, true, user.roles);
    const accessToken = signJwt({ sub: user.id, phone: user.phone, roles: user.roles }, 12 * 60 * 60);
    return { accessToken, user };
  }

  /** A-10: выдача и отзыв ролей администратором */
  async setRoles(userId: string, roles: string[]): Promise<UserRecord> {
    const allowed = ['admin', 'accountant', 'dispatcher', 'master', 'client'];
    const clean = [...new Set(roles.filter((r) => allowed.includes(r)))];
    if (clean.length === 0) throw new BadRequestException({ code: 'ROLES_REQUIRED', message: `Допустимые роли: ${allowed.join(', ')}` });
    const user = await this.repo.byId(userId);
    if (!user) throw new NotFoundException({ code: 'USER_NOT_FOUND' });
    if (user.roles.includes('admin') && !clean.includes('admin')) {
      const admins = (await this.repo.list()).filter((u) => u.roles.includes('admin'));
      if (admins.length <= 1) {
        throw new BadRequestException({ code: 'LAST_ADMIN', message: 'Нельзя снять роль у последнего администратора' });
      }
    }
    user.roles = clean;
    await this.repo.save(user);
    return user;
  }
}
