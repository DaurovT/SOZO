import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:sozo_client/design_tokens.dart';
import 'package:sozo_client/format.dart';
import 'package:sozo_client/screens/history_screen.dart';
import 'package:sozo_client/screens/order_screen.dart';
import 'package:sozo_client/screens/services_screen.dart';
import 'package:sozo_client/store/session.dart';

import 'fixture_data.dart';

/// Экраны на ответах маршрутов, а не на общем теле заглушки.
///
/// Общая фикстура отвечает одним телом на любой URL: в нём собраны поля всех
/// экранов сразу, поэтому экран получает нужное поле, даже когда настоящий
/// обработчик его не отдаёт. Расхождение модели клиента с ответом сервера
/// таким тестом не поймать в принципе — он зелёный, приложение падает на
/// живом сервере.
///
/// Здесь каждый маршрут отвечает только тем, что действительно отдаёт
/// (см. [clientRoutes]). Если экран начнёт читать поле, которого в ответе
/// нет, это видно здесь, а не в проде.
void main() {
  setUpAll(() {
    HttpOverrides.global = FixtureHttpOverrides();
    SharedPreferences.setMockInitialValues({});
    session.api.token = 'test';
    session.me = Map<String, dynamic>.from(fixture);
  });

  setUp(() => responseByPath = clientRoutes);
  tearDown(() => responseByPath = {});

  Future<void> show(WidgetTester t, Widget screen) async {
    t.view.physicalSize = const Size(390, 844) * 3;
    t.view.devicePixelRatio = 3;
    addTearDown(t.view.reset);
    await t.pumpWidget(MaterialApp(
      theme: sozoTheme(),
      home: Scaffold(backgroundColor: SozoColors.bg, body: screen),
    ));
    await t.pump(const Duration(milliseconds: 600));
    expect(t.takeException(), isNull);
  }

  List<String> textsOf() => find
      .byType(Text)
      .evaluate()
      .map((e) => (e.widget as Text).data)
      .whereType<String>()
      .toList();

  testWidgets('каталог: экран услуг живёт на ответе /app/catalog', (t) async {
    await show(t, const ServicesScreen());
    final texts = textsOf();
    // Клиентская подпись категории, а не название из прайса капсом
    expect(texts.any((s) => s.contains('Не знаю, что сломалось')), isTrue,
        reason: 'экран должен брать label, а не name');
    expect(texts.any((s) => s.contains('САНТЕХНИКА')), isFalse,
        reason: 'КАПС из прайса на экран не выводится');
  });

  testWidgets('карточка заявки живёт на ответе /app/orders/:id', (t) async {
    await show(t, const OrderScreen(orderId: 'o-1'));
    final texts = textsOf();
    expect(texts.any((s) => s.contains('Z-2026-000042')), isTrue);
    expect(texts.any((s) => s.contains('Азиз Рахимов')), isTrue);
    // Окно приезда собирается форматтером из from/to, а не берётся строкой
    expect(texts.any((s) => s.contains('16:00')), isTrue);
  });

  testWidgets('список заявок живёт на ответе /app/orders', (t) async {
    await show(t, const HistoryScreen());
    expect(textsOf().any((s) => s.contains('Z-2026-000042')), isTrue);
  });

  test('ответ оплаты несёт acceptanceFixed', () {
    // Оплата больше не подтверждает приёмку — приложение обязано читать поле,
    // а не считать приёмку сделанной по факту успешного платежа
    final pay = clientRoutes['pay']!;
    expect(pay.containsKey('acceptanceFixed'), isTrue);
    expect(pay['acceptanceFixed'], isFalse);
  });

  test('каталог несёт цену выезда и процент срочности', () {
    final catalog = clientRoutes['app/catalog']!;
    expect(catalog['visitPriceTiyin'], isA<int>());
    expect(catalog['urgentSurchargePercent'], isA<int>());
    // Экран итога показывает эту цену вместо «от 0 сум» при пустом составе
    expect(soums(catalog['visitPriceTiyin']), contains('120'));
  });
}
