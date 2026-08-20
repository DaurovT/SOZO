import { BadRequestException, Inject, Injectable, NotFoundException, OnModuleInit, UnauthorizedException, ForbiddenException, HttpException, HttpStatus } from '@nestjs/common';
import { signJwt } from '../../common/jwt';
import { SmsService } from '../../common/sms.service';
import { seedingAllowed } from '../../common/seeding';
import { OtpStore, OTP_TTL_MS } from './otp.store';
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


  constructor(
    @Inject(IDENTITY_REPOSITORY) private readonly repo: IdentityRepository,
    private readonly sms: SmsService,
    private readonly otp: OtpStore,
  ) {}

  /**
   * Сид служебных учёток. Раньше стоял в конструкторе, но с базой запись в
   * конструкторе невозможна: подключение к тому моменту ещё не поднято.
   *
   * При переносе state.json посев пропускается: служебные учётки приедут из
   * снимка со своими идентификаторами и ролями, а заведённые заново получили
   * бы другие — и роли разошлись бы с тем, что видел администратор.
   */
  async onModuleInit(): Promise<void> {
    if (!seedingAllowed()) return;
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
    // Лимиты отправки применяются только к настоящей доставке.
    //
    // Пауза и часовой предел защищают деньги и абонента: каждая SMS платная,
    // а поток кодов на чужой номер — способ травли. Когда сообщения только
    // пишутся в журнал, защищать нечего, и лимиты мешали бы разработке и
    // тестам, не давая ничего взамен. Предел неверных попыток, в отличие от
    // этих двух, действует всегда: он про подбор, а не про стоимость.
    if (this.sms.delivers) {
      const left = this.otp.cooldownLeft(phone);
      if (left > 0) {
        throw new HttpException(
          { code: 'OTP_TOO_SOON', message: `Новый код можно запросить через ${left} с`, retryAfterSec: left },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      if (this.otp.hourlyExhausted(phone)) {
        throw new HttpException(
          { code: 'OTP_RATE_LIMITED', message: 'Слишком много запросов кода. Попробуйте через час' },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    }

    // На журнальном отправителе код предсказуем: те же «пять нулей», что и
    // раньше. Иначе разработка и тесты читали бы код из вывода сервера, а
    // ветка проверки кода осталась бы той же самой — предсказуемость здесь
    // ничего не ослабляет, потому что ослаблять нечего: SMS никуда не идёт.
    const { code } = this.otp.issue(phone, this.sms.delivers ? undefined : DEV_OTP_CODE);
    const minutes = Math.round(OTP_TTL_MS / 60_000);
    const res = await this.sms.send(phone, `Код входа SOZO: ${code}. Действует ${minutes} мин. Никому его не сообщайте.`);
    if (!res.sent) {
      // Поставщик не принял сообщение — код бесполезен, и держать его значит
      // заставить человека ждать паузу до следующей попытки ни за что
      this.otp.issue(phone, undefined, 0);
      await this.trackLogin(phone, false, known?.roles ?? [], `SMS не отправлена: ${res.error ?? 'причина неизвестна'}`);
      throw new HttpException(
        { code: 'SMS_SEND_FAILED', message: 'Не удалось отправить код. Попробуйте ещё раз' },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    return { sent: true, channel: res.channel };
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
    // Проверка кода.
    //
    // На журнальном отправителе принимается и «пять нулей» без запроса: так
    // работали разработка и тесты до появления SMS, и ломать это нечем —
    // отправки всё равно нет. С настоящим поставщиком проходит только код,
    // который действительно уходил на этот номер, с его сроком и лимитом
    // попыток.
    const verdict = this.otp.verify(phone, code);
    const devFallback = !this.sms.delivers && code === DEV_OTP_CODE;
    if (verdict !== 'ok' && !devFallback) {
      const reason = {
        none: 'код не запрашивался или уже использован',
        expired: 'код истёк',
        attempts: 'исчерпаны попытки ввода',
        wrong: 'неверный код',
        ok: '',
      }[verdict];
      await this.trackLogin(phone, false, [], reason);
      throw new UnauthorizedException({
        code: verdict === 'expired' ? 'OTP_EXPIRED' : verdict === 'attempts' ? 'OTP_ATTEMPTS_EXCEEDED' : 'OTP_INVALID',
        message:
          verdict === 'expired'
            ? 'Код истёк. Запросите новый'
            : verdict === 'attempts'
              ? 'Слишком много попыток. Запросите новый код'
              : 'Неверный код',
      });
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
