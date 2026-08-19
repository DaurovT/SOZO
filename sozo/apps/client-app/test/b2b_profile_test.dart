import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:sozo_client/design_tokens.dart';
import 'package:sozo_client/i18n.dart';
import 'package:sozo_client/screens/profile_screen.dart';
import 'package:sozo_client/store/session.dart';

import 'fixture_data.dart';

/// Профиль обязан различать роли.
///
/// Ошибка здесь тихая: разделы спрятаны за `if (session.isB2C)`, и если экран
/// не пересобрался после смены контекста, сотрудник аптеки увидит «Мои адреса»,
/// «Моя техника» и «Оплата» — личные разделы, которых у него быть не должно.
/// Ключ по контексту в тесте не декорация: без него Flutter переиспользует тот
/// же элемент, и проверка пройдёт на экране от прошлой роли.
Future<List<String>> _rowsFor(WidgetTester t, String? context) async {
  await session.setContext(context);
  await t.pumpWidget(
    MaterialApp(
      key: ValueKey(context),
      theme: sozoTheme(),
      home: Scaffold(
        backgroundColor: SozoColors.bg,
        body: ProfileScreen(key: ValueKey('profile_$context')),
      ),
    ),
  );
  await t.pump(const Duration(milliseconds: 400));
  return find
      .byType(Text)
      .evaluate()
      .map((e) => (e.widget as Text).data)
      .whereType<String>()
      .where((s) => s.trim().isNotEmpty)
      .toList();
}

void main() {
  setUpAll(() {
    HttpOverrides.global = FixtureHttpOverrides();
    SharedPreferences.setMockInitialValues({});
    session.api.token = 'test';
    session.me = Map<String, dynamic>.from(fixture);
  });

  testWidgets('в личном профиле есть личные разделы', (t) async {
    t.view.physicalSize = const Size(390, 844) * 3;
    t.view.devicePixelRatio = 3;
    addTearDown(t.view.reset);
    final rows = await _rowsFor(t, null);
    for (final key in ['c29.title', 'c28.title', 'pay.title', 'c30.money']) {
      expect(rows, contains(t2(key)), reason: 'в личном профиле нет «${t2(key)}»');
    }
  });

  testWidgets('в профиле точки личных разделов нет', (t) async {
    t.view.physicalSize = const Size(390, 844) * 3;
    t.view.devicePixelRatio = 3;
    addTearDown(t.view.reset);
    final rows = await _rowsFor(t, 'loc1');
    expect(session.isB2C, isFalse, reason: 'контекст точки не применился');
    for (final key in ['c29.title', 'c28.title', 'pay.title', 'c30.money']) {
      expect(rows, isNot(contains(t2(key))), reason: 'в профиле точки осталось «${t2(key)}»');
    }
    // Контекст обязан показывать саму точку, а не «Личный аккаунт»
    expect(rows, contains('Аптека №12, ул. Навои 12'));
    expect(rows, isNot(contains(t2('c05.personal'))));
  });
}

String t2(String key) => t(key);
