import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:sozo_client/design_tokens.dart';
import 'package:sozo_client/screens/guest_prices_screen.dart';
import 'package:sozo_client/screens/login_screen.dart';
import 'package:sozo_client/store/session.dart';

import 'fixture_data.dart';

/// Гостевой просмотр цен (C-01).
///
/// Тест написан по жалобе «кнопка „Продолжить без регистрации“ не работает».
/// Она и не работала: в вёрстке стоял `Text` без обработчика — элемент,
/// который выглядит управляющим и ничего не делает. Такую поломку не ловит
/// ни один дымовой прогон, потому что экран строится, исключений нет, и всё
/// «зелено». Ловит её только проверка нажатием.
///
/// Поэтому здесь проверяется не «экран построился», а поведение: нажатие
/// приводит к ценам, цены показаны как начальные, а заказать гостем нельзя.
List<String> _texts() => find
    .byType(Text)
    .evaluate()
    .map((e) => (e.widget as Text).data)
    .whereType<String>()
    .toList();

Future<void> _pump(WidgetTester t, Widget screen) async {
  t.view.physicalSize = const Size(390, 844) * 3;
  t.view.devicePixelRatio = 3;
  addTearDown(t.view.reset);
  await t.pumpWidget(MaterialApp(theme: sozoTheme(), home: screen));
  await t.pump();
  await t.pump(const Duration(milliseconds: 400));
}

void main() {
  setUpAll(() {
    HttpOverrides.global = FixtureHttpOverrides();
  });

  setUp(() {
    // Гость — это отсутствие токена, а не особая роль. Если экран цен
    // потребует авторизации, тест обязан упасть здесь, а не на проде
    session.api.token = null;
    responseStatus = 200;
    responseOffline = false;
    responseBody = <String, dynamic>{
      'releaseNumber': 1,
      'categories': [
        {'category': 'САНТЕХНИКА', 'priceFromTiyin': 2000000},
        {'category': 'ЭЛЕКТРИКА', 'priceFromTiyin': 1500000},
        // Категория без цены: в прайсе такое бывает между релизами
        {'category': 'ГАЗОВОЕ ОБОРУДОВАНИЕ', 'priceFromTiyin': null},
      ],
    };
  });

  tearDown(() {
    responseBody = fixture;
  });

  testWidgets('надпись «Продолжить без регистрации» ведёт к ценам', (t) async {
    await _pump(t, const LoginFlow());
    expect(find.text('Продолжить без регистрации'), findsOneWidget);

    await t.tap(find.text('Продолжить без регистрации'));
    await t.pumpAndSettle();

    expect(find.byType(GuestPricesScreen), findsOneWidget,
        reason: 'нажатие обязано куда-то приводить: элемент, который выглядит '
            'управляющим и ничего не делает, читается как поломка приложения');
  });

  testWidgets('цены показаны и названы начальными', (t) async {
    await _pump(t, const GuestPricesScreen());
    final texts = _texts();

    expect(texts.any((s) => s.contains('САНТЕХНИКА')), isTrue, reason: texts.join(' | '));
    // 2 000 000 тиынов = 20 000 сум; пробел неразрывный
    expect(texts.any((s) => s.startsWith('от ') && s.contains('20')), isTrue,
        reason: 'без слова «от» цифра читается как окончательная цена: $texts');
    expect(texts.any((s) => s.contains('после осмотра')), isTrue,
        reason: 'экран обязан объяснить, что точную цену называет мастер');
  });

  testWidgets('категория без цены не показывается', (t) async {
    await _pump(t, const GuestPricesScreen());
    expect(_texts().any((s) => s.contains('ГАЗОВОЕ')), isFalse,
        reason: 'пустая цена — незаполненный прайс, а не «бесплатно»');
  });

  testWidgets('заказать гостем нельзя — выход один, через вход', (t) async {
    await _pump(t, const GuestPricesScreen());
    final texts = _texts();

    expect(texts.any((s) => s.contains('Войти')), isTrue, reason: texts.join(' | '));
    // Заявке нужен телефон: мастеру некуда ехать и некому звонить о задержке
    expect(texts.any((s) => s.contains('Вызвать мастера') || s.contains('Оформить заявку')), isFalse,
        reason: 'гостевого заказа нет — предлагать его значит обещать несуществующее');
  });

  testWidgets('сети нет — экран объясняет, а не показывает пустоту', (t) async {
    responseOffline = true;
    await _pump(t, const GuestPricesScreen());
    expect(t.takeException(), isNull);
    expect(_texts().isNotEmpty, isTrue, reason: 'белый экран — худший из ответов');
  });
}
