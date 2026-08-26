import { BadRequestException, Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard, Roles } from '../identity/auth.guard';
import type { JwtClaims } from '../../common/jwt';
import { localeOf, type Locale } from '../../common/locale';
import { DeviceTokensService, type DevicePlatform, type PushApp } from './device-tokens.service';
import { PushDispatchService } from './push-dispatch.service';

const APPS: PushApp[] = ['client', 'master'];

/**
 * Подсказка по итогу проверки.
 *
 * Отдельной функцией, потому что половина отказов чинится не там, где их
 * читают. THIRD_PARTY_AUTH_ERROR от FCM означает, что учётные данные
 * отвергла Apple, а не Google: искать причину надо в ключе APNs — Team ID,
 * Key ID и в том, к какому приложению ключ привязан, — а вовсе не в ключе
 * сервисного аккаунта, который в этот момент работает исправно.
 */
function hintFor(devices: number, status: string, detail?: string): string {
  if (devices === 0) return 'Устройств нет: человек не открывал приложение после установки либо вышел из него';
  if (status === 'sent') return 'Отправлено поставщику. Если на телефоне пусто — проверьте разрешение на уведомления в настройках телефона';
  if (detail?.includes('THIRD_PARTY_AUTH_ERROR') || detail?.includes('APNs')) {
    return (
      'FCM принял запрос, но Apple отвергла учётные данные APNs. Проверьте в Firebase → Cloud Messaging: ' +
      'Team ID (ровно 10 символов), Key ID и что ключ .p8 загружен именно для этого iOS-приложения'
    );
  }
  if (detail?.includes('token_gone')) {
    return 'Токен устройства снят: приложение переустановлено или удалено. Пусть человек откроет приложение и войдёт — токен зарегистрируется заново';
  }
  if (detail?.includes('404') || detail?.includes('UNREGISTERED')) {
    return 'Токен устройства мёртв — приложение удалили или переустановили. Строка снята, вернётся при следующем входе';
  }
  return `Поставщик не принял: ${detail ?? 'причина в журнале сервера'}`;
}
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
  revoke(@Body() body: { token?: string }, @Req() req: { auth: JwtClaims }) {
    const token = body.token?.trim();
    if (!token) throw new BadRequestException({ code: 'TOKEN_REQUIRED', message: 'Не передан токен устройства' });
    /**
     * Снять можно только свой токен.
     *
     * Токен принимался телом и не сверялся с телефоном из авторизации — в
     * отличие от соседних регистрации и списка доставок, где сверка есть.
     * Зная чужой FCM-токен, можно было отключить человеку уведомления;
     * эксплуатация ограничена тем, что токен ещё нужно откуда-то взять, но
     * проверка здесь стоит одну строку.
     */
    return { revoked: this.devices.revokeOwn(token, req.auth.phone) };
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
  /**
   * Проверочное уведомление себе или указанному человеку.
   *
   * Нужно после каждого касания к каналу: включили FCM, сменили ключ,
   * пересобрали приложение. Без такой кнопки проверка выглядит как «создайте
   * заявку и назначьте мастера» — то есть боевое действие с боевыми данными
   * ради того, чтобы посмотреть, дошло ли уведомление.
   *
   * Приоритет высокий намеренно: проверяют обычно именно то, разбудит ли
   * телефон, а тихое уведомление в шторке этого не показывает.
   */
  @Post('test')
  async test(
    @Body() body: { phone?: string; app?: string },
    @Req() req: { auth: JwtClaims },
  ) {
    const phone = body.phone?.trim() || req.auth.phone;
    const app = (body.app as PushApp) ?? 'client';
    if (!APPS.includes(app)) {
      throw new BadRequestException({ code: 'APP_UNKNOWN', message: 'Приложение: client или master', app: body.app });
    }
    const devices = this.devices.for(phone, app);
    const rec = await this.dispatch.deliver({
      event: 'push.test',
      phone,
      app,
      title: 'Проверка связи',
      body: 'Уведомления SOZO работают. Это сообщение отправил администратор',
      priority: 'high',
    });
    return {
      phone,
      app,
      devicesFound: devices.length,
      result: rec.status,
      channel: rec.channel,
      detail: rec.detail,
      // Прямая подсказка вместо чтения журнала: у отказа здесь всего
      // несколько причин, и каждая чинится по-своему
      hint: hintFor(devices.length, rec.status, rec.detail),
    };
  }

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
