import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { localeOf, runWithLocale } from './common/locale';
import { I18nExceptionFilter, I18nInterceptor } from './common/i18n.interceptor';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  // https://api.sozo.uz/v1 (DEV-03). Веб-карточка заявки живёт вне префикса:
  // её адрес уходит в SMS, где каждый символ платный, и `/w/ABCD2345`
  // помещается в одно сообщение, а `/v1/w/...` — уже впритык
  // Публичные страницы, которые открывает человек по ссылке из SMS, живут вне /v1:
// это адреса для браузера, а не эндпоинты API. 'w' — веб-карточка заявки (W-01…W-05),
// 'p' — согласование наряда-допуска (W-06).
  app.setGlobalPrefix('v1', {
    exclude: ['w/:code', 'w/:code/(.*)', 'p/:code', 'p/:code/(.*)', 'u/:code', 'u/:code/(.*)'],
  });
  // Список источников задаётся окружением: CORS_ORIGINS через запятую.
  // `origin: true` отражает любой источник и остаётся только в dev, где
  // адреса меняются каждый день. В проде пустой список = запрет всего чужого.
  const corsOrigins = (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  if (corsOrigins.length > 0) {
    app.enableCors({ origin: corsOrigins, credentials: true });
    // eslint-disable-next-line no-console
    console.log(`[CORS] разрешены источники: ${corsOrigins.join(', ')}`);
  } else if (process.env.NODE_ENV === 'production') {
    app.enableCors({ origin: false });
    // eslint-disable-next-line no-console
    console.warn('[CORS] production без CORS_ORIGINS — кросс-доменные запросы запрещены');
  } else {
    app.enableCors({ origin: true }); // dev: админка на vite (5173)
  }
  app.useBodyParser('json', { limit: '10mb' }); // загрузка фото dataURL (PRD-05 §9)
  // Веб-карточка заявки работает на обычных формах, без JS: браузер шлёт
  // urlencoded, и без этого разбора «Согласен» на слабом телефоне не нажмётся
  app.useBodyParser('urlencoded', { extended: false });

  // Язык ответа: приложение мастера присылает Accept-Language, и с ним из
  // сервера уходят узбекские причины отказа, вопросы экзамена и ошибки.
  // Админка и диспетчерская заголовок не шлют и получают русский.
  app.use((req: { headers: Record<string, string | undefined> }, _res: unknown, next: () => void) => {
    runWithLocale(localeOf(req.headers['accept-language']), next);
  });

  // Журнал обращений: без него отладка мобильных приложений превращается
  // в гадание — с телефона не видно, дошёл ли запрос и что ответил сервер.
  // Тела не пишем: там коды подтверждения, токены и фото.
  if (process.env.HTTP_LOG !== 'off') {
    app.use((req: { method: string; originalUrl: string }, res: { statusCode: number; on: (e: string, cb: () => void) => void }, next: () => void) => {
      const started = Date.now();
      res.on('finish', () => {
        // eslint-disable-next-line no-console
        console.log(`[HTTP] ${req.method} ${req.originalUrl} → ${res.statusCode} (${Date.now() - started} мс)`);
      });
      next();
    });
  }

  // Перевод ответа и текста ошибок. Оба нужны: тело успешного ответа собирает
  // интерцептор, тело ошибки — фильтр, и мимо одного из них ушла бы половина
  app.useGlobalInterceptors(new I18nInterceptor());
  app.useGlobalFilters(new I18nExceptionFilter());

  const port = Number(process.env.PORT ?? 3000);
  // Адрес привязки: за nginx слушаем только петлю, чтобы порт 3000 не торчал
  // в сеть даже при открытом NSG. Без HOST поведение прежнее (0.0.0.0) —
  // это нужно разработке, где на API ходят с телефона в той же Wi-Fi.
  const host = process.env.HOST ?? '0.0.0.0';
  await app.listen(port, host);
  // eslint-disable-next-line no-console
  console.log(`SOZO API: http://${host}:${port}/v1/health`);
}

void bootstrap();
