import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { localeOf, runWithLocale } from './common/locale';
import { I18nExceptionFilter, I18nInterceptor } from './common/i18n.interceptor';
import { DEFAULT_TENANT, runWithDbContext, type DbContext } from './common/db-context';

/**
 * Роль запроса в терминах политик базы.
 *
 * Соответствие намеренно грубое: политики различают платформу, оператора,
 * жителя и мастера, а ролей в системе больше. Бухгалтер и диспетчер для базы
 * одно и то же — оба видят весь тенант и не видят чужие объекты. Дробить
 * политики под каждую роль приложения значит держать два разных набора
 * правил доступа, которые обязательно разойдутся.
 */
function dbRoleOf(roles: string[]): DbContext['role'] {
  if (roles.includes('admin')) return 'platform_admin';
  if (roles.includes('dispatcher') || roles.includes('accountant')) return 'platform_dispatcher';
  if (roles.includes('master')) return 'master';
  return 'resident';
}

/** Состав токена без проверки подписи: её делает AuthGuard */
function readClaims(header: string | undefined): { sub?: string; roles?: string[] } | null {
  const raw = header?.startsWith('Bearer ') ? header.slice(7) : null;
  const payload = raw?.split('.')[1];
  if (!payload) return null;
  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString()) as { sub?: string; roles?: string[] };
  } catch {
    return null;
  }
}

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
    // Контекст RLS ставится здесь же, одним проходом с языком: политики базы
    // читают его из переменных сессии, а собрать их можно только из токена.
    // Разбираем без проверки подписи — подпись проверяет AuthGuard, а здесь
    // нужен лишь состав контекста; неподписанный токен всё равно не пройдёт
    // дальше guard'а, а до базы запрос без guard'а не доходит
    const claims = readClaims(req.headers['authorization']);
    runWithDbContext(
      {
        tenantId: DEFAULT_TENANT,
        role: dbRoleOf(claims?.roles ?? []),
        operatorOrgId: null,
        userId: claims?.sub ?? null,
      },
      () => runWithLocale(localeOf(req.headers['accept-language']), next),
    );
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
