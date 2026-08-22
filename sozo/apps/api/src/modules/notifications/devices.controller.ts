import { BadRequestException, Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard, Roles } from '../identity/auth.guard';
import type { JwtClaims } from '../../common/jwt';
import { localeOf, type Locale } from '../../common/locale';
import { DeviceTokensService, type DevicePlatform, type PushApp } from './device-tokens.service';
import { PushDispatchService } from './push-dispatch.service';

const APPS: PushApp[] = ['client', 'master'];
const PLATFORMS: DevicePlatform[] = ['android', 'ios', 'web'];

/**
 * Регистрация устройства для push.
 *
 * Эндпоинт живёт в модуле доставки, а не в API мастера и API клиента, хотя
 * зовут его оба приложения. Так требует правило зависимостей (DEV-07 §3):
 * доменные модули публикуют события и не знают, чем их доставляют. Развести
 * регистрацию по двум контроллерам значило бы завести в каждом из них по
 * копии одной и той же таблицы токенов.
 *
 * Аутентификация — общий JWT: обоим приложениям выдаёт его один и тот же
 * вход по OTP, и телефон в токене — тот самый адресат, по которому потом
 * ищутся устройства.
 */
@Controller('devices')
@UseGuards(AuthGuard)
export class DevicesController {
  constructor(
    private readonly devices: DeviceTokensService,
    private readonly dispatch: PushDispatchService,
  ) {}

  /**
   * Приложение зовёт это при входе и при каждой смене токена.
   *
   * Смена происходит без участия человека — FCM меняет токен при
   * переустановке, очистке данных и иногда при обновлении, — поэтому вызов
   * обязан быть идемпотентным и дешёвым: он приходит на каждый старт.
   */
  @Post()
  register(
    @Body() body: { token?: string; app?: string; platform?: string; locale?: string },
    @Req() req: { auth: JwtClaims; headers: Record<string, string> },
  ) {
    const token = body.token?.trim();
    if (!token) throw new BadRequestException({ code: 'TOKEN_REQUIRED', message: 'Не передан токен устройства' });
    const app = body.app as PushApp;
    if (!APPS.includes(app)) {
      throw new BadRequestException({ code: 'APP_UNKNOWN', message: 'Приложение: client или master', app: body.app });
    }
    const platform = body.platform as DevicePlatform;
    if (!PLATFORMS.includes(platform)) {
      throw new BadRequestException({
        code: 'PLATFORM_UNKNOWN',
        message: 'Платформа: android, ios или web',
        platform: body.platform,
      });
    }
    // Язык берём из тела, а при его отсутствии — из заголовка запроса:
    // приложение и так шлёт Accept-Language, и лишнее поле в теле — лишний
    // способ разъехаться с тем, на каком языке человек видит экран
    const locale: Locale = body.locale ? localeOf(body.locale) : localeOf(req.headers['accept-language']);
    const rec = this.devices.register({ token, app, platform, phone: req.auth.phone, locale });
    return { id: rec.id, app: rec.app, locale: rec.locale };
  }

  /**
   * Выход из приложения.
   *
   * Токен передаётся телом, а не берётся «все устройства этого телефона»:
   * человек выходит на одном аппарате, и гасить ему уведомления на втором —
   * не то, о чём он просил.
   *
   * POST, а не DELETE: тело у DELETE поддерживается неровно — часть клиентов
   * и прокси его отбрасывает, и снятие токена молча превращалось бы в
   * «уведомления приходят после выхода».
   */
  @Post('revoke')
  revoke(@Body() body: { token?: string }) {
    const token = body.token?.trim();
    if (!token) throw new BadRequestException({ code: 'TOKEN_REQUIRED', message: 'Не передан токен устройства' });
    return { revoked: this.devices.revoke(token) };
  }

  /**
   * Что уходило этому человеку.
   *
   * Нужно для разбора «мне не пришло»: по журналу видно, отправлялось ли
   * событие вообще, каким каналом и чем кончилось. Без этого ответа спор
   * упирается в слово против слова.
   */
  @Get('deliveries')
  deliveries(@Req() req: { auth: JwtClaims }) {
    return { items: this.dispatch.history(req.auth.phone) };
  }
}

/**
 * Журнал доставки для разбора жалоб.
 *
 * Отдельный контроллер с ролью, а не параметр к предыдущему: там человек
 * смотрит свои уведомления, здесь диспетчер разбирает чужую жалобу «мне
 * ничего не приходило». Разделять права внутри одного эндпоинта значило бы
 * однажды отдать чужую переписку по забытому условию.
 */
@Controller('admin/push')
@UseGuards(AuthGuard)
@Roles('admin', 'dispatcher')
export class AdminPushController {
  constructor(
    private readonly dispatch: PushDispatchService,
    private readonly devices: DeviceTokensService,
  ) {}

  /**
   * Что уходило человеку и чем кончилось.
   *
   * Здесь же видно, есть ли у него устройство вообще: половина жалоб
   * «уведомления не приходят» — это приложение, в которое не заходили после
   * обновления, и отличить такой случай от сбоя канала иначе нечем.
   */
  @Get('deliveries')
  deliveries(@Query('phone') phone?: string, @Query('limit') limit?: string) {
    if (!phone) throw new BadRequestException({ code: 'PHONE_REQUIRED', message: 'Укажите телефон человека' });
    const items = this.dispatch.history(phone, Math.min(Number(limit) || 100, 500));
    return {
      phone,
      devices: {
        client: this.devices.for(phone, 'client').length,
        master: this.devices.for(phone, 'master').length,
      },
      items,
      // Сводка по причинам: по ней видно, сломан канал или адресата нет
      byDetail: items.reduce<Record<string, number>>((acc, i) => {
        const k = i.detail ?? i.status;
        acc[k] = (acc[k] ?? 0) + 1;
        return acc;
      }, {}),
    };
  }
}
