import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

/// Именованные маршруты без таблицы маршрутов роняют приложение.
///
/// Экран «Мой дом» вёл на `/building/report`, `/building/shutdowns` и
/// `/building/pass`, которых не существовало: в `MaterialApp` нет ни `routes`,
/// ни `onGenerateRoute`, а всё остальное приложение открывает экраны через
/// `MaterialPageRoute`. Нажатие бросало исключение, и ни анализатор, ни
/// дымовой прогон этого не видели — экран строится, падает только тап.
void main() {
  test('pushNamed не используется без таблицы маршрутов', () {
    final callers = <String>[];
    for (final f in Directory('lib').listSync(recursive: true)) {
      if (f is! File || !f.path.endsWith('.dart')) continue;
      final src = f.readAsStringSync();
      if (src.contains('pushNamed') || src.contains('pushReplacementNamed')) {
        callers.add(f.path);
      }
    }
    if (callers.isEmpty) return;

    // Маршруты кто-то зовёт — значит таблица обязана существовать
    final main = File('lib/main.dart').readAsStringSync();
    final hasTable = main.contains('routes:') || main.contains('onGenerateRoute');
    expect(
      hasTable,
      isTrue,
      reason: 'именованные маршруты зовут ${callers.join(', ')}, '
          'но в MaterialApp нет ни routes, ни onGenerateRoute',
    );
  });
}
