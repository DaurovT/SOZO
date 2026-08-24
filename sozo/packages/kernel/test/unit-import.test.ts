import { describe, expect, it } from 'vitest';
import { buildImport, normalizePhone, parseDelimited, unitKey, UNIT_IMPORT_TEMPLATE } from '../src/unit-import.js';

/**
 * Импорт реестра помещений.
 *
 * Проверяется не «файл прочитался», а поведение на настоящем реестре: он
 * приходит из Excel, вёлся годами и содержит дубли, пустые строки и
 * телефоны в пяти форматах. Импорт, который на такой таблице падает
 * целиком, оператор не запустит второй раз.
 */
describe('разбор файла', () => {
  it('точка с запятой — русский Excel', () => {
    const rows = parseDelimited('Номер;Этаж\n12;4\n13;4\n');
    expect(rows).toEqual([['Номер', 'Этаж'], ['12', '4'], ['13', '4']]);
  });

  it('запятая — английский Excel', () => {
    expect(parseDelimited('number,floor\n12,4\n')).toEqual([['number', 'floor'], ['12', '4']]);
  });

  it('табуляция — выгрузка из 1С', () => {
    expect(parseDelimited('Номер\tЭтаж\n12\t4\n')).toEqual([['Номер', 'Этаж'], ['12', '4']]);
  });

  it('BOM не съедает первую колонку', () => {
    const rows = parseDelimited('﻿Номер;Этаж\n12;4\n');
    expect(rows[0][0]).toBe('Номер');
  });

  it('кавычки и точка с запятой внутри ячейки', () => {
    const rows = parseDelimited('Номер;ФИО\n12;"Иванов; Иван"\n');
    expect(rows[1][1]).toBe('Иванов; Иван');
  });

  it('удвоенная кавычка внутри значения', () => {
    expect(parseDelimited('a;b\n1;"ООО ""Ромашка"""\n')[1][1]).toBe('ООО "Ромашка"');
  });

  it('пустые строки в конце файла не считаются данными', () => {
    expect(parseDelimited('Номер\n12\n\n\n').length).toBe(2);
  });
});

describe('телефон', () => {
  it('девять цифр — местный номер', () => expect(normalizePhone('901234567')).toBe('+998901234567'));
  it('с кодом страны', () => expect(normalizePhone('998 90 123-45-67')).toBe('+998901234567'));
  it('с плюсом и скобками', () => expect(normalizePhone('+998 (90) 123 45 67')).toBe('+998901234567'));
  it('с восьмёркой, как набирают внутри страны', () => expect(normalizePhone('8901234567')).toBe('+998901234567'));
  // Молчаливая правка означает, что оповещение об отключении уйдёт не туда
  it('неузнанный формат — ошибка, а не догадка', () => {
    expect(normalizePhone('12345')).toBeNull();
    expect(normalizePhone('+7 916 1234567')).toBeNull();
  });
});

describe('номер помещения', () => {
  it('регистр и пробелы не создают второе помещение', () => {
    expect(unitKey(' 12 А ')).toBe(unitKey('12а'));
  });
  it('разные номера остаются разными', () => {
    expect(unitKey('12а')).not.toBe(unitKey('12б'));
  });
});

describe('сборка импорта', () => {
  const parse = (s: string, existing: string[] = []) => buildImport(parseDelimited(s), existing);

  it('шапка узнаётся по именам колонок', () => {
    const r = parse('Номер;Этаж;Телефон\n12;4;901234567\n');
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ number: '12', floor: 4, residentPhone: '+998901234567', line: 2 });
  });

  it('файл без шапки читается по порядку колонок шаблона', () => {
    const r = parse('12;1;4;Квартира;R1;901234567;Иванов;Собственник\n');
    expect(r.rows[0]).toMatchObject({ number: '12', entrance: '1', floor: 4, unitType: 'apartment' });
    expect(r.rows[0].line).toBe(1);
  });

  it('узбекская и английская шапка', () => {
    expect(parse('Xona;Qavat\n12;4\n').rows[0].number).toBe('12');
    expect(parse('unit,floor\n12,4\n').rows[0].number).toBe('12');
  });

  // Реестр в тысячу строк с одной кривой строкой не должен отвергаться целиком
  it('плохая строка не отменяет остальные', () => {
    const r = parse('Номер;Телефон\n12;901234567\n13;12345\n14;907654321\n');
    expect(r.rows.map((x) => x.number)).toEqual(['12', '14']);
    expect(r.problems).toEqual([{ line: 3, code: 'PHONE_INVALID', value: '12345' }]);
  });

  it('строка без номера — ошибка с номером строки', () => {
    const r = parse('Номер;ФИО\n;Иванов\n12;Петров\n');
    expect(r.problems[0]).toMatchObject({ line: 2, code: 'NUMBER_REQUIRED' });
    expect(r.willCreateUnits).toBe(1);
  });

  // «12» и «12А» — разные квартиры; одинаковы «12а» и «12А»
  it('дубль внутри файла называет обе строки', () => {
    const r = parse('Номер\n12а\n12А\n');
    expect(r.problems[0]).toMatchObject({ line: 3, code: 'DUPLICATE_IN_FILE' });
    expect(r.problems[0].value).toContain('строке 2');
  });

  // Повторный импорт того же файла — обычное дело: оператор дослал строки
  it('совпадение с заведённым помещением отделено от дубля в файле', () => {
    const r = parse('Номер\n12\n13\n', ['12']);
    expect(r.problems).toEqual([{ line: 2, code: 'ALREADY_EXISTS', value: '12' }]);
    expect(r.alreadyExists).toBe(1);
    expect(r.willCreateUnits).toBe(1);
  });

  it('неизвестный тип и роль названы, а не заменены молча', () => {
    expect(parse('Номер;Тип\n12;Ангар\n').problems[0]).toMatchObject({ code: 'TYPE_UNKNOWN', value: 'Ангар' });
    expect(parse('Номер;Роль\n12;Сосед\n').problems[0]).toMatchObject({ code: 'ROLE_UNKNOWN', value: 'Сосед' });
  });

  it('дробный этаж — ошибка', () => {
    expect(parse('Номер;Этаж\n12;4,5\n').problems[0]).toMatchObject({ code: 'FLOOR_INVALID' });
  });

  it('стояки разделяются запятой, точкой с запятой или слешем', () => {
    expect(parse('Номер;Стояки\n12;"R1, R2/R3"\n').rows[0].riserIds).toEqual(['R1', 'R2', 'R3']);
  });

  it('без телефона помещение заводится, житель — нет', () => {
    const r = parse('Номер;Телефон\n12;\n13;901234567\n');
    expect(r.willCreateUnits).toBe(2);
    expect(r.willCreateResidents).toBe(1);
  });

  it('роли переводятся на все три языка', () => {
    expect(parse('Номер;Роль\n12;Арендатор\n').rows[0].residentRole).toBe('tenant');
    expect(parse('Номер;Роль\n12;Ijarachi\n').rows[0].residentRole).toBe('tenant');
    expect(parse('Номер;Роль\n12;family\n').rows[0].residentRole).toBe('family');
  });

  it('шаблон, который мы отдаём оператору, сам проходит импорт', () => {
    const r = parse(UNIT_IMPORT_TEMPLATE);
    expect(r.problems).toEqual([]);
    expect(r.willCreateUnits).toBe(3);
    expect(r.willCreateResidents).toBe(2);
  });

  it('пустой файл не падает', () => {
    expect(parse('').willCreateUnits).toBe(0);
  });
});
