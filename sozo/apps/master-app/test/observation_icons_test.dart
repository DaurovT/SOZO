import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

/// Иконки плиток быстрой фиксации (M-49) обязаны существовать в ассетах.
///
/// Справочник категорий A-44 живёт в `packages/contracts`, а рисует его
/// приложение мастера. Расхождение тихое: имя из справочника не находится в
/// assets, и мастер на обходе видит пустую плитку без подписи причины —
/// ровно там, где счёт идёт на секунды.
void main() {
  test('каждая иконка справочника A-44 есть в assets/icons', () {
    final contracts = File('../../packages/contracts/src/index.ts');
    expect(contracts.existsSync(), isTrue, reason: 'не найден пакет контрактов');

    final src = contracts.readAsStringSync();
    final block = src.substring(
      src.indexOf('export const OBSERVATION_CATEGORIES'),
      src.indexOf('export const OBSERVATION_CATEGORY_IDS'),
    );
    final icons = RegExp(r"icon: '(\w+)'")
        .allMatches(block)
        .map((m) => m.group(1)!)
        .toList();

    expect(icons.length, 11, reason: 'справочник изменился — проверьте тест');

    final missing = icons
        .where((name) => !File('assets/icons/$name.svg').existsSync())
        .toList();
    expect(missing, isEmpty, reason: 'нет файлов иконок: ${missing.join(', ')}');
  });
}
