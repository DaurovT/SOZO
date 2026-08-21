import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:sozo_client/i18n.dart';

/// Языки, собранные внутрь приложения, — не нарисованные вкладки.
///
/// Словарь читается из исходника, а не через публичный геттер: открывать карты
/// наружу ради теста значит держать в продукте дверь, которой пользуется
/// только тест. Ломается тут ровно одно — ключ, добавленный в русский и
/// забытый в остальных: человек видит русскую строку посреди чужого экрана.
///
/// Догружаемые языки сюда не входят: их файлов в сборке нет, они приезжают с
/// сервера. Их полноту сверяет `tools/check-dicts.mjs`.
Map<String, String> _dict(String file, String name) {
  final source = File(file).readAsStringSync();
  final start = source.indexOf('const $name = <String, String>{');
  if (start < 0) throw StateError('карта $name не найдена в $file');
  final end = source.indexOf('\n};', start);
  final body = source.substring(start, end);
  final out = <String, String>{};
  // Значение бывает и в одинарных кавычках, и в двойных: переводы писали
  // разные руки, и апостроф в тексте одинарными не обойти
  // Тройные кавычки не случайно: raw-строка не может содержать свой
  // разделитель, а выражению нужны оба вида кавычек сразу
  final re = RegExp(
    r'''^\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)")\s*:\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)")\s*,''',
    multiLine: true,
  );
  for (final m in re.allMatches(body)) {
    out[(m.group(1) ?? m.group(2))!] = (m.group(3) ?? m.group(4))!;
  }
  return out;
}

void main() {
  final ru = _dict('lib/i18n/dict_ru.dart', 'ruDict');
  final uz = _dict('lib/i18n/dict_uz.dart', 'uzDict');
  final en = _dict('lib/i18n/dict_en.dart', 'enDict');

  test('в русском словаре есть ключи', () {
    expect(ru.length, greaterThan(700));
  });

  test('английский покрывает все ключи русского', () {
    final missing = ru.keys.where((k) => !en.containsKey(k)).toList();
    expect(missing, isEmpty, reason: 'нет перевода на английский: ${missing.take(10)}');
  });

  test('узбекский покрывает все ключи русского', () {
    final missing = ru.keys.where((k) => !uz.containsKey(k)).toList();
    expect(missing, isEmpty, reason: 'нет перевода на узбекский: ${missing.take(10)}');
  });

  test('английский не повторяет русский дословно', () {
    // Совпадать могут только цифры, коды и латиница: RU, UZ, EN, «Payme»
    final copied = ru.entries
        .where((e) => en[e.key] == e.value && RegExp(r'[А-Яа-яЁё]').hasMatch(e.value))
        .map((e) => e.key)
        .toList();
    expect(copied, isEmpty, reason: 'ключи скопированы без перевода: ${copied.take(10)}');
  });

  test('внутрь приложения собраны ровно три языка', () {
    // Остальные семь качаются с сервера. Если язык переедет в сборку, вырастет
    // вес установки — это решение, а не побочный эффект правки словаря
    expect(L10n.builtIn, {'ru', 'uz', 'en'});
    expect(L10n.codes.length, 10);
    expect(L10n.codes.take(3), ['ru', 'uz', 'en']);
  });

  test('у каждого языка есть подпись на нём самом', () {
    final missing = L10n.codes.where((c) => (L10n.names[c] ?? '').isEmpty).toList();
    expect(missing, isEmpty, reason: 'язык без названия в списке выбора: $missing');
    final noShort = L10n.codes.where((c) => (L10n.shortNames[c] ?? '').isEmpty).toList();
    expect(noShort, isEmpty, reason: 'язык без кода для переключателя: $noShort');
  });

  // `l10n.set` пишет выбор в SharedPreferences. Без мока плагин ждёт ответа
  // от платформы, которой в тесте нет, и проверка висит до таймаута — а не
  // падает. Мок ставим до первого обращения к языку
  testWidgets('переключение отдаёт три разные строки', (tester) async {
    SharedPreferences.setMockInitialValues({});
    final seen = <String, String>{};
    // Только встроенные: догружаемый язык полез бы в сеть, которой в тесте нет
    for (final code in L10n.codes.where(L10n.builtIn.contains)) {
      await l10n.set(code);
      expect(l10n.code, code, reason: 'язык не переключился на $code');
      seen[code] = t('tab.profile');
    }
    await l10n.set('ru');
    expect(
      seen.values.toSet().length,
      3,
      reason: 'три языка дали меньше трёх разных строк: ${seen.values.join(' / ')}',
    );
  });

  testWidgets('догружаемый язык без сети не подменяет текущий', (tester) async {
    // Сети в тесте нет, значит загрузка обязана провалиться. Проверяем не саму
    // загрузку, а обещание `set`: неудача возвращает false и оставляет человека
    // на языке, который у него работает, а не на пустом экране
    SharedPreferences.setMockInitialValues({});
    await l10n.set('ru');
    final ok = await l10n.set('ko');
    expect(ok, isFalse, reason: 'без сети словарь взяться неоткуда');
    expect(l10n.code, 'ru', reason: 'язык сменился, хотя словарь не приехал');
    expect(l10n.status, LocaleStatus.failed, reason: 'экрану нечего показать о неудаче');
    l10n.clearError();
  });
}
