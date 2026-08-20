import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:sozo_client/design_tokens.dart';
import 'package:sozo_client/main.dart';
import 'package:sozo_client/screens/building_screens.dart';
import 'package:sozo_client/screens/address_details_screen.dart';
import 'package:sozo_client/screens/addresses_screen.dart';
import 'package:sozo_client/screens/b2b/acceptance_inbox.dart';
import 'package:sozo_client/screens/b2b/acceptance_screen.dart';
import 'package:sozo_client/screens/b2b/approvals_inbox.dart';
import 'package:sozo_client/screens/b2b/org_screens.dart';
import 'package:sozo_client/screens/b2b/phase2_screens.dart';
import 'package:sozo_client/screens/b2b/points_screen.dart';
import 'package:sozo_client/screens/b2b/report_screen.dart';
import 'package:sozo_client/screens/b2b/site_screens.dart';
import 'package:sozo_client/screens/b2b/staff_home.dart';
import 'package:sozo_client/screens/complaints_screen.dart';
import 'package:sozo_client/screens/consents_screen.dart';
import 'package:sozo_client/screens/context_screen.dart';
import 'package:sozo_client/screens/create/submitted_screen.dart';
import 'package:sozo_client/screens/create/wizard.dart';
import 'package:sozo_client/screens/decisions_screen.dart';
import 'package:sozo_client/screens/dispute_screen.dart';
import 'package:sozo_client/screens/equipment_screen.dart';
import 'package:sozo_client/screens/finish_screens.dart';
import 'package:sozo_client/screens/history_screen.dart';
import 'package:sozo_client/screens/home_screen.dart';
import 'package:sozo_client/screens/login_screen.dart';
import 'package:sozo_client/screens/notifications_screen.dart';
import 'package:sozo_client/screens/order_screen.dart';
import 'package:sozo_client/screens/profile_screen.dart';
import 'package:sozo_client/screens/services_screen.dart';
import 'package:sozo_client/screens/shell.dart';
import 'package:sozo_client/screens/showcase_screen.dart';
import 'package:sozo_client/screens/warranty_screen.dart';
import 'package:sozo_client/store/session.dart';

import 'fixture_data.dart';

/// Дымовой прогон всех экранов приложения «Клиент».
///
/// Смысл теста не в вёрстке, а в том, что экран строится на непустых данных.
/// Пустое состояние ловит меньше половины ошибок: в приложении мастера
/// календарь падал только на заполненном месяце. Поэтому сервер подменён
/// заглушкой, которая на любой запрос отдаёт заполненный ответ.
void main() {
  setUpAll(() {
    HttpOverrides.global = FixtureHttpOverrides();
    session.api.token = 'test';
    session.phone = '+998901112233';
    session.me = Map<String, dynamic>.from(fixture);
  });

  Future<void> check(WidgetTester tester, String name, Widget screen) async {
    // Размер настоящего телефона, а не тестовый 800×600: на широком холсте
    // не переполняется ничего, и строки, уезжающие за край на реальном
    // экране, прогон не видит
    tester.view.physicalSize = const Size(390, 844) * 3;
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);
    // Scaffold вокруг экрана — то, что в приложении даёт каркас вкладок.
    // Вкладки (главная, услуги, главная точки) без него не находят Material
    await tester.pumpWidget(
      MaterialApp(theme: sozoTheme(), home: Scaffold(body: screen)),
    );
    await tester.pump();
    // Даём отработать загрузке и таймеру поллинга карточки заявки
    await tester.pump(const Duration(milliseconds: 400));
    expect(tester.takeException(), isNull, reason: 'экран «$name» упал при построении');
  }

  final order = Map<String, dynamic>.from(fixture);
  final closed = {
    ...order,
    'status': 'closed',
    'statusLabel': 'Закрыта',
    'can': {'pay': false, 'rate': true, 'dispute': true, 'warranty': true, 'cancel': false, 'reschedule': false},
  };

  _iconsExistTest();

  group('экраны строятся на данных', () {
    testWidgets('вход', (t) => check(t, 'Вход', const LoginFlow()));
    testWidgets('выбор контекста', (t) => check(t, 'Выбор контекста', const ContextScreen()));
    testWidgets('каркас вкладок', (t) => check(t, 'Каркас вкладок', const AppShell()));
    testWidgets('главная', (t) => check(t, 'Главная', const HomeScreen()));
    testWidgets('история', (t) => check(t, 'История', const HistoryScreen()));
    testWidgets('профиль', (t) => check(t, 'Профиль', const ProfileScreen()));
    testWidgets('услуги и цены', (t) => check(t, 'Услуги', const ServicesScreen()));
    testWidgets('уведомления', (t) => check(t, 'Уведомления', const NotificationsScreen()));

    testWidgets('визард', (t) => check(t, 'Визард', const CreateOrderFlow()));
    testWidgets('визард — авария', (t) => check(t, 'Визард аварийный', const CreateOrderFlow(emergency: true)));
    testWidgets('визард — с категорией', (t) {
      return check(t, 'Визард с категорией', const CreateOrderFlow(category: 'САНТЕХНИКА'));
    });
    testWidgets('визард — повтор', (t) {
      return check(t, 'Визард повтора', const CreateOrderFlow(repeatOrderId: 'o1'));
    });

    testWidgets('активная заявка', (t) => check(t, 'Активная заявка', const OrderScreen(orderId: 'o1')));
    testWidgets('детали адреса', (t) => check(t, 'Детали адреса', AddressDetailsScreen(order: order)));

    for (final kind in DecisionKind.values) {
      testWidgets('решение $kind', (t) {
        return check(t, 'Решение $kind', DecisionScreen(order: order, kind: kind));
      });
    }

    testWidgets('итог заявки', (t) {
      return check(t, 'Итог заявки', Scaffold(body: FinishScreenBody(order: order, reload: () async {})));
    });
    testWidgets('закрытая заявка', (t) {
      return check(t, 'Закрытая заявка', Scaffold(body: FinishScreenBody(order: closed, reload: () async {})));
    });
    testWidgets('оплата', (t) => check(t, 'Оплата', PaymentScreen(order: order, totalTiyin: 125000000)));
    testWidgets('спасибо', (t) => check(t, 'Спасибо', ThanksScreen(order: order)));

    testWidgets('гарантия', (t) => check(t, 'Гарантия', WarrantyScreen(order: closed)));
    testWidgets('как дела', (t) => check(t, 'Как дела', HowAreThingsScreen(order: closed)));
    testWidgets('спор', (t) => check(t, 'Спор', DisputeScreen(order: closed)));

    testWidgets('жалобы', (t) => check(t, 'Жалобы', const ComplaintsScreen()));
    testWidgets('новая жалоба', (t) {
      return check(t, 'Новая жалоба', const ComplaintFormScreen(types: ['Сроки', 'Деньги']));
    });
    testWidgets('адреса', (t) => check(t, 'Адреса', const AddressesScreen()));
    testWidgets('адрес — форма', (t) => check(t, 'Форма адреса', const AddressFormScreen()));
    testWidgets('согласия', (t) => check(t, 'Согласия', const ConsentsScreen()));
    testWidgets('заявка принята', (t) => check(t, 'Заявка принята', OrderSubmittedScreen(order: order)));
  });

  group('навигация приложения', () {
    testWidgets('после входа экран входа сменяется приложением', (t) async {
      // Тот случай, который дымовой прогон по одному экрану поймать не мог:
      // каждый экран строился, но корень приложения не пересобирался, и вход
      // «залипал» на форме, хотя сессия уже была установлена.
      SharedPreferences.setMockInitialValues({});
      await session.signOut();
      await t.pumpWidget(const SozoClientApp());
      await t.pump();
      expect(find.byType(LoginFlow), findsOneWidget, reason: 'гость должен видеть форму входа');

      await session.signIn('+998900000000', 'test-token');
      await t.pump();
      await t.pump(const Duration(milliseconds: 400));
      expect(
        find.byType(LoginFlow),
        findsNothing,
        reason: 'после входа приложение обязано уйти с формы входа',
      );

      // Возврат в гостя тоже должен работать — иначе «Выйти» ничего не делает
      await session.signOut();
      await t.pump();
      await t.pump(const Duration(milliseconds: 400));
      expect(find.byType(LoginFlow), findsOneWidget, reason: 'после выхода — снова форма входа');
      session.api.token = 'test';
      session.me = Map<String, dynamic>.from(fixture);
    });

    testWidgets('у вкладки есть высота — каркас не съедает её таббаром', (t) async {
      // Кнопка «плюс» в таббаре была обёрнута в Center, а он в Row тянется на
      // всю доступную высоту: таббар забирал весь экран, телу вкладки
      // оставалось ноль, и после входа человек видел пустую страницу.
      // Проверки «экран построился» это не ловят — виджет есть, размер нулевой
      SharedPreferences.setMockInitialValues({});
      await session.setContext(null);
      session.me = Map<String, dynamic>.from(fixture);
      await t.pumpWidget(MaterialApp(theme: sozoTheme(), home: const AppShell()));
      await t.pump(const Duration(milliseconds: 400));

      final shell = t.getSize(find.byType(AppShell));
      final body = t.getSize(find.byType(HomeScreen).first);
      expect(body.height, greaterThan(shell.height * 0.5),
          reason: 'вкладке досталось ${body.height} из ${shell.height} — её съел таббар');
      expect(find.text('Ждут вашего ответа'), findsWidgets, reason: 'содержимое главной должно быть видно');
    });

    testWidgets('переключение личный ↔ точка меняет набор вкладок', (t) async {
      // Каркас не слушал сессию, и после смены роли оставался прежний таббар —
      // со стороны это выглядело как «переключение не работает»
      SharedPreferences.setMockInitialValues({});
      await session.setContext(null);
      session.me = Map<String, dynamic>.from(fixture);
      await t.pumpWidget(MaterialApp(theme: sozoTheme(), home: const AppShell()));
      await t.pump(const Duration(milliseconds: 400));
      expect(find.byType(HomeScreen), findsOneWidget, reason: 'личный аккаунт — своя главная');
      expect(find.byType(SiteHomeScreen), findsNothing);

      await session.setContext('loc1');
      await t.pump();
      await t.pump(const Duration(milliseconds: 400));
      expect(find.byType(SiteHomeScreen), findsOneWidget, reason: 'контекст точки — главная точки');
      expect(find.byType(HomeScreen), findsNothing, reason: 'личная главная должна уйти');

      await session.setContext(null);
      await t.pump();
      await t.pump(const Duration(milliseconds: 400));
      expect(find.byType(HomeScreen), findsOneWidget, reason: 'возврат в личный аккаунт');
      expect(t.takeException(), isNull);
    });
  });

  group('B2B-экраны строятся на данных', () {
    setUp(() {
      // Контекст точки: без него B2B-экраны показывают «точка не выбрана»
      session.contextId = 'loc1';
      session.me = Map<String, dynamic>.from(fixture);
    });
    tearDown(() => session.contextId = null);

    testWidgets('главная сотрудника', (t) => check(t, 'Главная сотрудника', const SiteHomeScreen()));
    testWidgets('лента заявок точки', (t) {
      return check(t, 'Лента заявок точки', const SiteHomeScreen(showFilters: true));
    });
    testWidgets('сообщить о поломке', (t) => check(t, 'Поломка', const ReportScreen(locationId: 'loc1')));
    testWidgets('инструкция при аварии', (t) {
      return check(t, 'Авария', const EmergencyGuideScreen(locationId: 'loc1'));
    });
    testWidgets('приёмка работ', (t) => check(t, 'Приёмка', const AcceptanceScreen(orderId: 'o1')));
    testWidgets('входящие на приёмку', (t) => check(t, 'Приёмка', const AcceptanceInboxScreen()));
    testWidgets('мои обращения сотрудника',
        (t) => check(t, 'Мои обращения', const SiteHomeScreen(fixedFilter: 'mine', titleKey: 'tab.myRequests')));
    testWidgets('центр утверждений', (t) {
      return check(t, 'Центр утверждений', const ApprovalsInboxScreen(asTab: false));
    });
    testWidgets('утверждение сметы', (t) {
      return check(t, 'Утверждение', ApprovalScreen(item: approvalItem));
    });
    testWidgets('утверждение доп-работы', (t) {
      return check(t, 'Утверждение доп-работы', ApprovalScreen(item: forcedItem));
    });
    testWidgets('техдолг точки', (t) => check(t, 'Техдолг', const DebtScreen(locationId: 'loc1')));
    testWidgets('лимиты точки', (t) => check(t, 'Лимиты', const LimitsScreen(locationId: 'loc1')));
    testWidgets('отчёты точки', (t) {
      return check(t, 'Отчёты точки', const ReportsScreen(locationId: 'loc1', asTab: false));
    });
    testWidgets('дашборд организации', (t) => check(t, 'Дашборд', const OrgDashboardScreen()));
    testWidgets('финансы организации', (t) {
      return check(t, 'Финансы', const OrgFinanceScreen(asTab: false));
    });
    testWidgets('пользователи организации', (t) => check(t, 'Пользователи', const OrgUsersScreen()));
    testWidgets('баллы и ваучеры', (t) => check(t, 'Баллы', const PointsScreen()));
    testWidgets('каркас вкладок B2B', (t) => check(t, 'Каркас B2B', const AppShell()));
  });

  group('экраны фазы 2 и витрина', () {
    setUp(() {
      session.contextId = 'loc1';
      session.me = Map<String, dynamic>.from(fixture);
    });
    tearDown(() => session.contextId = null);

    testWidgets('моя техника', (t) => check(t, 'Моя техника', const EquipmentScreen()));
    testWidgets('пакет дефектов', (t) => check(t, 'Пакет дефектов', const DefectPackageScreen()));
    testWidgets('техдолг сети', (t) => check(t, 'Техдолг сети', const OrgDebtScreen()));
    testWidgets('осмотры', (t) => check(t, 'Осмотры', const InspectionsScreen()));
    testWidgets('дашборд владельца', (t) => check(t, 'Дашборд владельца', const OwnerDashboardScreen()));
    // C-52 и C-53. Плитка категорий строится на ответе сервера: заглушка
    // отдаёт непустой список, но экран обязан пережить и пустой справочник
    testWidgets('дом: проблема в доме', (t) => check(t, 'Проблема в доме', const BuildingReportScreen()));
    testWidgets('дом: отключения', (t) => check(t, 'Отключения', const BuildingShutdownsScreen()));
    testWidgets('витрина экранов', (t) => check(t, 'Витрина', const ShowcaseScreen()));
  });
}


/// Иконка, которой нет в наборе, не роняет экран — она просто не рисуется.
///
/// Так центральная кнопка «плюс» месяц могла бы висеть пустым жёлтым кругом,
/// а карандаш правки имени — невидимым квадратом 48×48, по которому всё же
/// можно нажать. Ни один экранный тест этого не видит: виджет построен.
void _iconsExistTest() {
  test('каждая иконка из кода есть в наборе', () {
    final have = Directory('assets/icons')
        .listSync()
        .whereType<File>()
        .where((f) => f.path.endsWith('.svg'))
        .map((f) => f.uri.pathSegments.last.replaceAll('.svg', ''))
        .toSet();
    final missing = <String, String>{};
    for (final file in Directory('lib').listSync(recursive: true).whereType<File>()) {
      if (!file.path.endsWith('.dart')) continue;
      final src = file.readAsStringSync();
      for (final m in RegExp(r"""(?:FigmaIcon\(|icon:\s*)'([a-z0-9\-]+)'""").allMatches(src)) {
        if (!have.contains(m.group(1))) missing[m.group(1)!] = file.path;
      }
    }
    expect(missing, isEmpty, reason: 'нет файла иконки: ${missing.entries.map((e) => '${e.key} (${e.value})').join(', ')}');
  });
}
