import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:sozo_client/design_tokens.dart';
import 'package:sozo_client/store/session.dart';
import 'fixture_data.dart';

import 'package:sozo_client/screens/shell.dart';
import 'package:sozo_client/screens/home_screen.dart';
import 'package:sozo_client/screens/history_screen.dart';
import 'package:sozo_client/screens/profile_screen.dart';
import 'package:sozo_client/screens/services_screen.dart';
import 'package:sozo_client/screens/notifications_screen.dart';
import 'package:sozo_client/screens/payments_screen.dart';
import 'package:sozo_client/screens/addresses_screen.dart';
import 'package:sozo_client/screens/consents_screen.dart';
import 'package:sozo_client/screens/complaints_screen.dart';
import 'package:sozo_client/screens/equipment_screen.dart';
import 'package:sozo_client/screens/context_screen.dart';
import 'package:sozo_client/screens/create/wizard.dart';
import 'package:sozo_client/screens/b2b/staff_home.dart';
import 'package:sozo_client/screens/b2b/org_screens.dart';
import 'package:sozo_client/screens/b2b/approvals_inbox.dart';
import 'package:sozo_client/screens/b2b/acceptance_inbox.dart';
import 'package:sozo_client/screens/b2b/points_screen.dart';

/// Аудит экранов: не «построился без исключения», а «видно и помещается».
///
/// Прежние проверки этого не ловили. Экран с нулевой высотой строится без
/// ошибок — так после переноса кнопки в таббар главная страница месяц могла
/// бы быть пустой. Переполнение по ширине приходит отдельным исключением
/// вёрстки, и `takeException` его глотал молча: на узком телефоне вторая
/// метка на карточке заявки просто уезжала за край.
void main() {
  final report = <String>[];

  setUpAll(() {
    HttpOverrides.global = FixtureHttpOverrides();
    SharedPreferences.setMockInitialValues({});
    session.api.token = 'test';
    session.me = Map<String, dynamic>.from(fixture);
  });

  Future<void> audit(WidgetTester t, String name, Widget screen) async {
    t.view.physicalSize = const Size(390, 844) * 3;
    t.view.devicePixelRatio = 3;
    addTearDown(t.view.reset);
    final prev = FlutterError.onError;
    FlutterError.onError = (d) {
      // ignore: avoid_print
      print('=== $name ===\n${d.toString()}');
    };
    addTearDown(() => FlutterError.onError = prev);
    await t.pumpWidget(MaterialApp(theme: sozoTheme(), home: Scaffold(backgroundColor: SozoColors.bg, body: screen)));
    await t.pump(const Duration(milliseconds: 500));
    final err = t.takeException();
    final texts = find.byType(Text).evaluate().length;
    double h = -1;
    try {
      h = t.getSize(find.byType(Scaffold).first).height;
    } catch (_) {}
    final problems = <String>[];
    if (err != null) {
      problems.add('ИСКЛЮЧЕНИЕ: $err');
      if (err is FlutterError) {
        // ignore: avoid_print
        print('--- $name ---\n${err.toStringDeep().split('\n').take(28).join('\n')}');
      }
    }
    if (texts < 3) problems.add('почти пусто: текстов $texts');
    if (h == 0) problems.add('нулевая высота');
    report.add(problems.isEmpty ? 'ok    $name  (текстов $texts)' : 'СЛОМАН $name → ${problems.join('; ')}');
    expect(problems, isEmpty, reason: '$name: ${problems.join('; ')}');
  }

  tearDownAll(() {
    // ignore: avoid_print
    print('\n===== АУДИТ ЭКРАНОВ =====\n${report.join('\n')}\n');
  });

  testWidgets('каркас', (t) => audit(t, 'Каркас вкладок', const AppShell()));
  testWidgets('главная', (t) => audit(t, 'Главная', const HomeScreen()));
  testWidgets('история', (t) => audit(t, 'История заявок', const HistoryScreen()));
  testWidgets('профиль', (t) => audit(t, 'Профиль', const ProfileScreen()));
  testWidgets('услуги', (t) => audit(t, 'Услуги и цены', const ServicesScreen()));
  testWidgets('уведомления', (t) => audit(t, 'Уведомления', const NotificationsScreen()));
  testWidgets('оплаты', (t) => audit(t, 'Оплаты', const PaymentsScreen()));
  testWidgets('адреса', (t) => audit(t, 'Адреса', const AddressesScreen()));
  testWidgets('согласия', (t) => audit(t, 'Согласия', const ConsentsScreen()));
  testWidgets('жалобы', (t) => audit(t, 'Жалобы', const ComplaintsScreen()));
  testWidgets('техника', (t) => audit(t, 'Моя техника', const EquipmentScreen()));
  testWidgets('контекст', (t) => audit(t, 'Выбор контекста', const ContextScreen()));
  testWidgets('визард', (t) => audit(t, 'Новая заявка', const CreateOrderFlow()));
  testWidgets('точка', (t) => audit(t, 'B2B главная точки', const SiteHomeScreen()));
  testWidgets('утверждения', (t) => audit(t, 'B2B утверждения', const ApprovalsInboxScreen()));
  testWidgets('приёмка', (t) => audit(t, 'B2B приёмка', const AcceptanceInboxScreen()));
  testWidgets('точки', (t) => audit(t, 'B2B точки', const PointsScreen()));
  testWidgets('дашборд', (t) => audit(t, 'B2B дашборд', const OrgDashboardScreen()));
  testWidgets('финансы', (t) => audit(t, 'B2B финансы', const OrgFinanceScreen()));
  testWidgets('пользователи', (t) async {
    await session.setContext('loc1');
    await audit(t, 'B2B пользователи', const OrgUsersScreen());
    await session.setContext(null);
  });
}
