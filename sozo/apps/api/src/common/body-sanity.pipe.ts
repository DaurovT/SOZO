import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';

/**
 * Общая проверка тела запроса.
 *
 * Глобального `ValidationPipe` в проекте нет, и это заметно по следствиям:
 * `NaN` доезжал до журнала проводок и отравлял баланс необратимо,
 * отрицательный остаток ломал запись всего склада, отрицательные суммы
 * возвратов проходили обе проверки насквозь. Каждое из этих мест теперь
 * проверяет себя само — но полагаться только на это значит однажды завести
 * двадцать первый эндпоинт и забыть.
 *
 * Классический `ValidationPipe` здесь бесполезен: он проверяет DTO-классы с
 * декораторами `class-validator`, а тела в этом коде — обычные интерфейсы, и
 * часть контрактов проверяется zod'ом. Поэтому проверяется то, что можно
 * проверить без описания каждого поля и что действительно ломается:
 *
 *   · `NaN` и `Infinity` — числа, которых в JSON не бывает, но которые
 *     рождаются из `Number('две')` и доезжают до BigInt();
 *   · целые за пределом безопасного диапазона — после них арифметика врёт;
 *   · слишком глубокая вложенность — защита от разбора бомбы из массивов.
 *
 * Строки, которые вызывающий потом сам превратит в число, здесь не поймать —
 * их проверяют на месте. Это второй слой, а не единственный.
 */
const MAX_DEPTH = 12;

@Injectable()
export class BodySanityPipe implements PipeTransform {
  transform(value: unknown): unknown {
    this.walk(value, 0, '');
    return value;
  }

  private walk(v: unknown, depth: number, path: string): void {
    if (depth > MAX_DEPTH) {
      throw new BadRequestException({ code: 'BODY_TOO_DEEP', message: 'Слишком глубокая структура тела запроса', path });
    }
    if (typeof v === 'number') {
      if (!Number.isFinite(v)) {
        throw new BadRequestException({
          code: 'NUMBER_NOT_FINITE',
          message: `Поле «${path || 'значение'}» — не число (NaN или бесконечность)`,
          path,
        });
      }
      if (Number.isInteger(v) && !Number.isSafeInteger(v)) {
        throw new BadRequestException({
          code: 'NUMBER_TOO_LARGE',
          message: `Поле «${path}» выходит за безопасный диапазон целых — арифметика по нему будет врать`,
          path,
        });
      }
      return;
    }
    if (Array.isArray(v)) {
      for (let i = 0; i < v.length; i++) this.walk(v[i], depth + 1, `${path}[${i}]`);
      return;
    }
    if (v && typeof v === 'object') {
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
        this.walk(x, depth + 1, path ? `${path}.${k}` : k);
      }
    }
  }
}
