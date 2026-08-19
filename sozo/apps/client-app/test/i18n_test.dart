import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:sozo_client/i18n.dart';

/// Словарь легко разъезжается: строку добавили на экран, русский вариант
/// написали, узбекский забыли — и узбекоязычный клиент видит вперемешку два
/// языка. Заметить это глазами невозможно, поэтому проверяем машиной.
///
/// Читаем исходник словаря, а не карты в памяти: они приватные, и делать их
/// публичными ради теста — менять устройство продукта под тест.
void main() {
  final source = File('lib/i18n.dart').readAsStringSync();

  Map<String, String> entries(String mapName) {
    final body = source.split('const $mapName = <String, String>{')[1].split('\n};')[0];
    // Значение бывает многострочным, поэтому берём его до закрывающей кавычки
    final re = RegExp(r"'([^']+)':\s*\n?\s*'((?:[^'\\]|\\.)*)'", multiLine: true);
    return {for (final m in re.allMatches(body)) m.group(1)!: m.group(2)!};
  }

  final ru = entries('_ru');
  final uz = entries('_uz');

  test('словарь непустой — иначе проверки ниже ничего не значат', () {
    expect(ru.length, greaterThan(500));
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
      // Разошедшиеся подстановки страшнее опечатки: «{sum}» останется в тексте
      // как есть, и человек увидит фигурные скобки вместо суммы
      if (inRu.length != inUz.length || !inRu.containsAll(inUz)) broken.add(key);
    }
    expect(broken, isEmpty, reason: 'подстановки разошлись: ${broken.join(', ')}');
  });

  test('каждый ключ из экранов есть в словаре', () {
    // Пропущенный ключ не падает, а печатается как есть: на дашборде
    // организации в меню месяцами висело «c47.title» вместо «Отчёты
    // организации». Глазами это ловится только на снимке экрана
    final unresolved = <String, String>{};
    for (final file in Directory('lib').listSync(recursive: true).whereType<File>()) {
      if (!file.path.endsWith('.dart') || file.path.endsWith('i18n.dart')) continue;
      final calls = RegExp(r"""(?<![A-Za-z0-9_'"])t\('([^']+)'""").allMatches(file.readAsStringSync());
      for (final m in calls) {
        final key = m.group(1)!;
        // Ключ, собранный из переменной, проверить статически нельзя
        if (key.contains(r'$') || ru.containsKey(key)) continue;
        unresolved[key] = file.path;
      }
    }
    expect(
      unresolved,
      isEmpty,
      reason: 'нет перевода: ${unresolved.entries.map((e) => '${e.key} (${e.value})').join(', ')}',
    );
  });

  test('переключение языка меняет строку', () async {
    // Язык сохраняется в настройках телефона — в тесте их подменяем
    TestWidgetsFlutterBinding.ensureInitialized();
    SharedPreferences.setMockInitialValues({});
    await l10n.set('uz');
    expect(t('common.save'), isNot('Сохранить'));
    await l10n.set('ru');
    expect(t('common.save'), 'Сохранить');
  });
}
