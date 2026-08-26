import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

/// Виды операций офлайн-очереди должны быть известны серверу.
///
/// Половина видов, которые кладут экраны (`addwork`, `conservation`, `delay`,
/// `spare_tiers`, `permit_*`, `branch_*`…), сервер не знал вовсе: `/master/sync`
/// отвечал `KIND_UNKNOWN`, операция висела с ошибкой, и единственной кнопкой у
/// мастера было «убрать из очереди» — то есть стереть работу за день.
///
/// Поймать это раньше было нечем: обе стороны по отдельности выглядят
/// здоровыми, расходятся только списки. Проверка стоит пять строк и сверяет
/// именно их.
void main() {
  test('каждый вид очереди умеет применять сервер', () {
    final handler = File('../api/src/modules/master-api/master-api.controller.ts');
    if (!handler.existsSync()) {
      // Приложение собирают и отдельно от монорепозитория — тогда сверять не с чем
      markTestSkipped('нет исходников API рядом — сверка пропущена');
      return;
    }
    final serverKinds = RegExp(r"case '([a-zA-Z_]+)':")
        .allMatches(handler.readAsStringSync())
        .map((m) => m.group(1)!)
        .toSet();

    final appKinds = <String, String>{};
    for (final f in Directory('lib').listSync(recursive: true).whereType<File>()) {
      if (!f.path.endsWith('.dart')) continue;
      final src = f.readAsStringSync();
      for (final m in RegExp(r"kind: '([a-zA-Z_]+)'").allMatches(src)) {
        appKinds[m.group(1)!] = f.path;
      }
      // Виды, которые собираются из подстановки: экран наряда и ветки конвейера
      if (src.contains(r"kind: 'permit_$action'")) {
        appKinds['permit_open'] = f.path;
        appKinds['permit_close'] = f.path;
      }
      if (src.contains(r"kind: 'branch_${widget.kind.name}'")) {
        for (final b in ['cantGo', 'clientUnavailable', 'noAccess', 'unsafe']) {
          appKinds['branch_$b'] = f.path;
        }
      }
    }

    expect(appKinds.length, greaterThan(10), reason: 'виды не нашлись — проверьте регулярное выражение');
    final unknown = appKinds.entries.where((e) => !serverKinds.contains(e.key)).toList();
    expect(
      unknown,
      isEmpty,
      reason: 'сервер не знает эти виды операций:\n${unknown.map((e) => '  ${e.key} — ${e.value}').join('\n')}',
    );
  });
}
