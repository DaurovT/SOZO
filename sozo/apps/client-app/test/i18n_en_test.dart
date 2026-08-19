import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:sozo_client/i18n.dart';

/// Английский словарь — третий язык, а не нарисованная вкладка.
///
/// Словарь читается из исходника, а не через публичный геттер: открывать карты
/// наружу ради теста значит держать в продукте дверь, которой пользуется
/// только тест. Ломается тут ровно одно — ключ, добавленный в русский и
/// забытый в остальных: человек видит русскую строку посреди чужого экрана.
Map<String, String> _dict(String source, String name) {
  final start = source.indexOf('const $name = <String, String>{');
  if (start < 0) throw StateError('карта $name не найдена');
  final end = source.indexOf('\n};', start);
  final body = source.substring(start, end);
  final out = <String, String>{};
  for (final m in RegExp(r"^\s*'((?:[^'\\]|\\.)*)':\s*'((?:[^'\\]|\\.)*)',\s*$", multiLine: true)
      .allMatches(body)) {
    out[m.group(1)!] = m.group(2)!;
  }
  return out;
}

void main() {
  final source = File('lib/i18n.dart').readAsStringSync();
  final ru = _dict(source, '_ru');
  final uz = _dict(source, '_uz');
  final en = _dict(source, '_en');

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

  test('в списке языков ровно три кода', () {
    expect(L10n.codes, ['ru', 'uz', 'en']);
  });

  // `l10n.set` пишет выбор в SharedPreferences. Без мока плагин ждёт ответа
  // от платформы, которой в тесте нет, и проверка висит до таймаута — а не
  // падает. Мок ставим до первого обращения к языку
  testWidgets('переключение отдаёт три разные строки', (tester) async {
    SharedPreferences.setMockInitialValues({});
    final seen = <String, String>{};
    for (final code in L10n.codes) {
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
}
