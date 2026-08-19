import { ArgumentsHost, CallHandler, Catch, ExceptionFilter, ExecutionContext, HttpException, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, map } from 'rxjs';
import { currentLocale, tr } from './locale';

/**
 * Перевод ответа на выходе, а не в четырёхстах местах кода.
 *
 * Словарь ключуется самим русским текстом (см. `locale.ts`), поэтому перевести
 * можно готовый ответ — и под перевод попадает то, что оборачивать вручную
 * невозможно: причины блокировки, шаги эскалации и уведомления, которые лежат
 * в базе по-русски и пишутся задолго до того, как их прочитает мастер.
 *
 * Обратная сторона — перевод «по совпадению строки»: если диспетчер напишет в
 * комментарии ровно ту же фразу, что стоит в словаре, она тоже переведётся.
 * Для подписей это безобидно, а значения, которые приложение отправляет
 * обратно (тип техники, навык, район), в словарь намеренно не попадают: их
 * переводит само приложение при показе, оставляя на проводе русское значение.
 */

/** Длинные строки — это base64 фотографий и подписей, в словаре их быть не может */
const MAX_LEN = 400;

function translate(value: unknown, depth = 0): unknown {
  if (depth > 12) return value;
  if (typeof value === 'string') return value.length > MAX_LEN ? value : tr(value);
  if (Array.isArray(value)) return value.map((v) => translate(v, depth + 1));
  if (value && typeof value === 'object' && (value as object).constructor === Object) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = translate(v, depth + 1);
    return out;
  }
  return value;
}

@Injectable()
export class I18nInterceptor implements NestInterceptor {
  intercept(_ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (currentLocale() === 'ru') return next.handle();
    return next.handle().pipe(map((body) => translate(body)));
  }
}

/**
 * Ошибки идут мимо интерцептора: их тело собирает фильтр исключений.
 *
 * А ошибка — половина того, что мастер вообще читает: «Без чека запчасть
 * внести нельзя» он видит чаще, чем любой заголовок.
 */
@Catch(HttpException)
export class I18nExceptionFilter implements ExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<{ status: (c: number) => { json: (b: unknown) => void } }>();
    const body = exception.getResponse();
    res.status(exception.getStatus()).json(currentLocale() === 'ru' ? body : translate(body));
  }
}
