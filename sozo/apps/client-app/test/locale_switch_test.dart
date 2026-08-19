import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:sozo_client/i18n.dart';
import 'package:sozo_client/main.dart';
import 'package:sozo_client/store/session.dart';

import 'fixture_data.dart';

/// Язык обязан применяться мгновенно (C-30).
///
/// Проверяем через настоящий корень приложения, а не через отдельный экран:
/// ломается тут именно цепочка. Корень слушает `l10n` и перестраивает
/// `MaterialApp`, но ниже стоят `const`-виджеты — Flutter видит тот же самый
/// объект и пропускает обновление поддерева. Экран, взятый отдельно, такой
/// ошибки не покажет: у него нет этой цепочки.
void main() {
  testWidgets('смена языка перерисовывает главную сразу', (tester) async {
    HttpOverrides.global = FixtureHttpOverrides();
    SharedPreferences.setMockInitialValues({});
    tester.view.physicalSize = const Size(390, 844) * 3;
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);

    session.api.token = 'test';
    session.phone = '+998901112233';
    session.me = Map<String, dynamic>.from(fixture);
    await session.setContext(null); // личный кабинет, выбор роли уже сделан
    await l10n.set('ru');

    await tester.pumpWidget(const SozoClientApp());
    for (var i = 0; i < 8; i++) {
      await tester.pump(const Duration(milliseconds: 200));
    }
    expect(find.text('Ждут вашего ответа'), findsWidgets, reason: 'сначала русский');

    await l10n.set('uz');
    await tester.pump();
    for (var i = 0; i < 8; i++) {
      await tester.pump(const Duration(milliseconds: 200));
    }
    expect(
      find.text('Ждут вашего ответа'),
      findsNothing,
      reason: 'после переключения русский заголовок остался на экране',
    );
    expect(find.text(l10n.t('c06.awaiting')), findsWidgets, reason: 'узбекский заголовок не появился');

    await l10n.set('ru');
  });
}
