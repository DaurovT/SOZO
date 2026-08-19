import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:sozo_master/i18n.dart';

/// Словарь легко разъезжается: строку добавили на экран, русский вариант
/// написали, узбекский забыли — и мастер на объекте видит вперемешку два
/// языка. Заметить это глазами невозможно, поэтому проверяем машиной.
///
/// Читаем исходник словаря, а не карты в памяти: они приватные, и делать их
/// публичными ради теста — менять устройство продукта под тест.
void main() {
  final source = File('lib/i18n.dart').readAsStringSync();

  Map<String, String> entries(String mapName) {
    final body = source.split('const $mapName = <String, String>{')[1].split('\n};')[0];
    final re = RegExp(r"'([^']+)':\s*\n?\s*'((?:[^'\\]|\\.)*)'", multiLine: true);
    return {for (final m in re.allMatches(body)) m.group(1)!: m.group(2)!};
  }

  final ru = entries('_ru');
  final uz = entries('_uz');
  final values = entries('_values');

  test('словарь непустой — иначе проверки ниже ничего не значат', () {
    expect(ru.length, greaterThan(700));
  });

  test('каждая русская строка переведена на узбекский', () {
    final missing = ru.keys.where((k) => !uz.containsKey(k)).toList()..sort();
    expect(missing, isEmpty, reason: 'без узбекского перевода: ${missing.join(', ')}');
  });

  test('в узбекской колонке нет ключей, которых нет в русской', () {
    final extra = uz.keys.where((k) => !ru.containsKey(k)).toList()..sort();
    expect(extra, isEmpty, reason: 'лишние ключи: ${extra.join(', ')}');
  });

  test('подстановки совпадают в обоих языках', () {
    final re = RegExp(r'\{(\w+)\}');
    final broken = <String>[];
    for (final key in ru.keys) {
      final inRu = re.allMatches(ru[key]!).map((m) => m.group(1)).toSet();
      final inUz = re.allMatches(uz[key] ?? '').map((m) => m.group(1)).toSet();
      // Разошедшиеся подстановки страшнее опечатки: «{p1}» останется в тексте
      // как есть, и мастер увидит фигурные скобки вместо суммы
      if (inRu.length != inUz.length || !inRu.containsAll(inUz)) broken.add(key);
    }
    expect(broken, isEmpty, reason: 'подстановки разошлись: ${broken.join(', ')}');
  });

  test('в узбекской колонке не осталось кириллицы', () {
    final cyr = RegExp('[А-Яа-яЁё]');
    final left = uz.entries.where((e) => cyr.hasMatch(e.value)).map((e) => e.key).toList();
    expect(left, isEmpty, reason: 'не переведено: ${left.join(', ')}');
  });

  test('экраны не пишут по-русски мимо словаря', () {
    // Главная причина, по которой перевод протухает: новую строку пишут прямо
    // в виджет. Ловим это здесь, а не на объекте у мастера.
    final cyr = RegExp('[А-Яа-яЁё]');
    final offenders = <String>[];
    for (final f in Directory('lib').listSync(recursive: true).whereType<File>()) {
      if (!f.path.endsWith('.dart') || f.path.endsWith('i18n.dart')) continue;
      var line = 0;
      for (final raw in f.readAsLinesSync()) {
        line++;
        final code = raw.split('//')[0];
        final trimmed = raw.trimLeft();
        if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue;
        for (final m in RegExp("'[^']*'").allMatches(code)) {
          if (!cyr.hasMatch(m.group(0)!)) continue;
          // Значения словарей сервера остаются русскими намеренно: они уходят
          // в payload, и перевод сломал бы сверку на бэкенде
          if (values.containsKey(m.group(0)!.replaceAll("'", ''))) continue;
          offenders.add('${f.path}:$line');
        }
      }
    }
    expect(offenders, isEmpty, reason: 'русский текст мимо словаря: ${offenders.join(', ')}');
  });

  test('переключение языка меняет строку', () async {
    TestWidgetsFlutterBinding.ensureInitialized();
    SharedPreferences.setMockInitialValues({});
    await l10n.set('uz');
    expect(t('order.sohranit'), 'Saqlash');
    expect(t('common.otmena'), isNot('Отмена'));
    await l10n.set('ru');
    expect(t('order.sohranit'), 'Сохранить');
  });

  test('значения словарей сервера переводятся, а незнакомые проходят как есть', () async {
    SharedPreferences.setMockInitialValues({});
    await l10n.set('uz');
    expect(tv('кондиционер'), 'konditsioner');
    expect(tv('неизвестная категория'), 'неизвестная категория');
    await l10n.set('ru');
    expect(tv('кондиционер'), 'кондиционер');
  });
}
