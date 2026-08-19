import 'dart:io';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:sozo_client/design_tokens.dart';
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
import 'package:sozo_client/screens/payments_screen.dart';
import 'package:sozo_client/screens/profile_screen.dart';
import 'package:sozo_client/screens/services_screen.dart';
import 'package:sozo_client/screens/shell.dart';
import 'package:sozo_client/screens/showcase_screen.dart';
import 'package:sozo_client/screens/warranty_screen.dart';
import 'package:sozo_client/store/session.dart';

import '../test/fixture_data.dart';

/// Выгрузка всех экранов приложения «Клиент» в PNG.
///
/// Это не тест, а инструмент: файл лежит вне `test/`, поэтому обычный
/// `flutter test` его не подхватывает. Запуск:
///
///   flutter test tool/export_screens_test.dart
///   flutter test tool/export_screens_test.dart --dart-define=OUT=/путь/к/папке
///
/// Экраны рисуются на той же заглушке сервера, что и дымовой прогон
/// (`test/fixture_data.dart`), — снимок показывает экран на заполненных
/// данных, а не пустой каркас.
const String _outPath = String.fromEnvironment(
  'OUT',
  defaultValue: '/Users/timurdaurov/Desktop/USTAPRO/screens/client-app',
);

/// iPhone 14/15 — 390×844 логических точек при плотности 3
const Size _logicalSize = Size(390, 844);
const double _pixelRatio = 3;

/// Тема приложения задаёт `fontFamily: null` — системный шрифт. В headless-
/// прогоне системного шрифта нет, и без подмены весь текст вышел бы
/// прямоугольниками-заглушками. Берём Arial: он есть на macOS, статический
/// (в отличие от вариативного SF) и покрывает кириллицу.
const String _fontFamily = 'SozoExportSans';

/// Запасное семейство под символы, которых в Arial нет (★ в рейтинге мастера)
const String _fallbackFamily = 'SozoExportSymbols';
const String _fontsDir = '/System/Library/Fonts/Supplemental';

final Directory _out = Directory(_outPath);
final List<String> _index = <String>[];
int _n = 0;

void main() {
  setUpAll(() async {
    TestWidgetsFlutterBinding.ensureInitialized();
    HttpOverrides.global = FixtureHttpOverrides();
    // Визард восстанавливает черновик из настроек — без заглушки плагина падает
    // ignore: invalid_use_of_visible_for_testing_member — файл вне test/
    SharedPreferences.setMockInitialValues(<String, Object>{});
    await _loadFonts();

    if (_out.existsSync()) {
      for (final f in _out.listSync().whereType<File>()) {
        if (f.path.endsWith('.png') || f.path.endsWith('.md')) f.deleteSync();
      }
    } else {
      _out.createSync(recursive: true);
    }

    session.api.token = 'test';
    session.phone = '+998901112233';
    session.me = Map<String, dynamic>.from(fixture);
  });

  tearDownAll(() {
    File('${_out.path}/index.md').writeAsStringSync(
      '# Экраны приложения «Клиент» (SOZO / USTAPRO)\n\n'
      'Выгружено из кода: `flutter test tool/export_screens_test.dart`.\n'
      'Размер кадра — ${_logicalSize.width.toInt()}×${_logicalSize.height.toInt()} pt '
      '(${(_logicalSize.width * _pixelRatio).toInt()}×${(_logicalSize.height * _pixelRatio).toInt()} px, @3x), '
      'данные — тестовая заглушка сервера.\n\n${_index.join('\n')}\n',
    );
    // ignore: avoid_print
    print('\nЭкранов выгружено: $_n → ${_out.path}');
  });

  final order = Map<String, dynamic>.from(fixture);
  final closed = {
    ...order,
    'status': 'closed',
    'statusLabel': 'Закрыта',
    'can': {'pay': false, 'rate': true, 'dispute': true, 'warranty': true, 'cancel': false, 'reschedule': false},
  };

  group('личный аккаунт', () {
    testWidgets('вход', (t) => shoot(t, 'Вход', const LoginFlow()));
    testWidgets('контекст', (t) => shoot(t, 'Выбор контекста', const ContextScreen()));
    testWidgets('каркас', (t) => shoot(t, 'Каркас вкладок', const AppShell()));
    testWidgets('главная', (t) => shoot(t, 'Главная', const HomeScreen()));
    testWidgets('история', (t) => shoot(t, 'История заявок', const HistoryScreen()));
    testWidgets('профиль', (t) => shoot(t, 'Профиль', const ProfileScreen()));
    testWidgets('услуги', (t) => shoot(t, 'Услуги и цены', const ServicesScreen()));
    testWidgets('уведомления', (t) => shoot(t, 'Уведомления', const NotificationsScreen()));
    testWidgets('оплаты', (t) => shoot(t, 'Оплаты и способы', const PaymentsScreen(), extra: _paymentsData));
    testWidgets('адреса', (t) => shoot(t, 'Адреса', const AddressesScreen()));
    testWidgets('форма адреса', (t) => shoot(t, 'Адрес — форма', const AddressFormScreen()));
    testWidgets('согласия', (t) => shoot(t, 'Согласия', const ConsentsScreen()));
  });

  group('создание заявки', () {
    testWidgets('визард', (t) => shoot(t, 'Новая заявка', const CreateOrderFlow()));
    testWidgets('авария', (t) => shoot(t, 'Новая заявка — авария', const CreateOrderFlow(emergency: true)));
    testWidgets('категория', (t) {
      return shoot(t, 'Новая заявка — категория выбрана', const CreateOrderFlow(category: 'САНТЕХНИКА'));
    });
    testWidgets('повтор', (t) {
      return shoot(t, 'Новая заявка — повтор прошлой', const CreateOrderFlow(repeatOrderId: 'o1'));
    });
    testWidgets('принята', (t) => shoot(t, 'Заявка принята', OrderSubmittedScreen(order: order)));
  });

  group('ход заявки', () {
    testWidgets('заявка', (t) => shoot(t, 'Активная заявка', const OrderScreen(orderId: 'o1')));
    testWidgets('адрес', (t) => shoot(t, 'Детали адреса', AddressDetailsScreen(order: order)));

    const decisionTitles = <DecisionKind, String>{
      DecisionKind.estimate: 'Решение — смета',
      DecisionKind.spareTier: 'Решение — выбор запчасти',
      DecisionKind.addwork: 'Решение — вынужденная доп-работа',
      DecisionKind.recommendation: 'Решение — рекомендация мастера',
      DecisionKind.stages: 'Решение — план этапов',
    };
    for (final e in decisionTitles.entries) {
      testWidgets(e.value, (t) => shoot(t, e.value, DecisionScreen(order: order, kind: e.key)));
    }
  });

  group('завершение', () {
    testWidgets('итог', (t) {
      return shoot(t, 'Итог заявки', Scaffold(body: FinishScreenBody(order: order, reload: () async {})));
    });
    testWidgets('закрыта', (t) {
      return shoot(t, 'Закрытая заявка', Scaffold(body: FinishScreenBody(order: closed, reload: () async {})));
    });
    testWidgets('оплата', (t) => shoot(t, 'Оплата', PaymentScreen(order: order, totalTiyin: 125000000)));
    testWidgets('спасибо', (t) => shoot(t, 'Спасибо и чаевые', ThanksScreen(order: order)));
    testWidgets('гарантия', (t) => shoot(t, 'Гарантия', WarrantyScreen(order: closed)));
    testWidgets('как дела', (t) => shoot(t, 'Как дела после работы', HowAreThingsScreen(order: closed)));
    testWidgets('спор', (t) => shoot(t, 'Спор по заявке', DisputeScreen(order: closed)));
    testWidgets('жалобы', (t) => shoot(t, 'Жалобы', const ComplaintsScreen()));
    testWidgets('новая жалоба', (t) {
      return shoot(t, 'Новая жалоба', const ComplaintFormScreen(types: ['Сроки', 'Деньги']));
    });
  });

  group('B2B — точка и организация', () {
    setUp(() {
      session.contextId = 'loc1';
      session.me = Map<String, dynamic>.from(fixture);
    });
    tearDown(() => session.contextId = null);

    testWidgets('каркас', (t) => shoot(t, 'B2B — каркас вкладок', const AppShell()));
    testWidgets('главная', (t) => shoot(t, 'B2B — главная сотрудника', const SiteHomeScreen()));
    testWidgets('лента', (t) => shoot(t, 'B2B — лента заявок точки', const SiteHomeScreen(showFilters: true)));
    testWidgets('мои обращения', (t) {
      return shoot(t, 'B2B — мои обращения',
          const SiteHomeScreen(fixedFilter: 'mine', titleKey: 'tab.myRequests'));
    });
    testWidgets('поломка', (t) => shoot(t, 'B2B — сообщить о поломке', const ReportScreen(locationId: 'loc1')));
    testWidgets('авария', (t) {
      return shoot(t, 'B2B — инструкция при аварии', const EmergencyGuideScreen(locationId: 'loc1'));
    });
    testWidgets('приёмка', (t) => shoot(t, 'B2B — приёмка работ', const AcceptanceScreen(orderId: 'o1')));
    testWidgets('входящие', (t) => shoot(t, 'B2B — входящие на приёмку', const AcceptanceInboxScreen()));
    testWidgets('утверждения', (t) {
      return shoot(t, 'B2B — центр утверждений', const ApprovalsInboxScreen(asTab: false));
    });
    testWidgets('смета', (t) => shoot(t, 'B2B — утверждение сметы', ApprovalScreen(item: approvalItem)));
    testWidgets('доп-работа', (t) {
      return shoot(t, 'B2B — утверждение доп-работы', ApprovalScreen(item: forcedItem));
    });
    testWidgets('техдолг', (t) => shoot(t, 'B2B — техдолг точки', const DebtScreen(locationId: 'loc1')));
    testWidgets('лимиты', (t) => shoot(t, 'B2B — лимиты точки', const LimitsScreen(locationId: 'loc1')));
    testWidgets('отчёты', (t) {
      return shoot(t, 'B2B — отчёты точки', const ReportsScreen(locationId: 'loc1', asTab: false));
    });
    testWidgets('дашборд', (t) => shoot(t, 'B2B — дашборд организации', const OrgDashboardScreen()));
    testWidgets('финансы', (t) => shoot(t, 'B2B — финансы организации', const OrgFinanceScreen(asTab: false)));
    testWidgets('пользователи', (t) => shoot(t, 'B2B — пользователи организации', const OrgUsersScreen()));
    testWidgets('баллы', (t) => shoot(t, 'B2B — баллы и ваучеры', const PointsScreen()));
  });

  group('фаза 2 и служебное', () {
    setUp(() {
      session.contextId = 'loc1';
      session.me = Map<String, dynamic>.from(fixture);
    });
    tearDown(() => session.contextId = null);

    testWidgets('техника', (t) => shoot(t, 'Моя техника', const EquipmentScreen(), extra: _equipmentData));
    testWidgets('дефекты', (t) => shoot(t, 'Пакет дефектов', const DefectPackageScreen()));
    testWidgets('техдолг сети', (t) => shoot(t, 'Техдолг сети', const OrgDebtScreen()));
    testWidgets('осмотры', (t) => shoot(t, 'Осмотры', const InspectionsScreen()));
    testWidgets('владелец', (t) => shoot(t, 'Дашборд владельца', const OwnerDashboardScreen()));
    testWidgets('витрина', (t) => shoot(t, 'Витрина экранов', const ShowcaseScreen()));
  });
}

/// Экран «Оплаты» читает `pending` числом, а общая заглушка отдаёт там объект
/// решений по заявке. Подменяем только конфликтующие поля.
final _paymentsData = <String, dynamic>{
  'pending': 1,
  'note': 'Сохранённых карт пока нет — их подключит платёжный провайдер',
  'methods': [
    {'code': 'cash', 'title': 'Наличные', 'note': 'Мастер подтвердит получение'},
    {'code': 'payme', 'title': 'Payme', 'note': 'Оплата по ссылке из приложения'},
    {'code': 'click', 'title': 'Click', 'note': 'Оплата по ссылке из приложения'},
  ],
  'preferred': 'payme',
  'lastUsed': 'cash',
  'totalTiyin': 125000000,
  'tipsTiyin': 5000000,
  'payments': [
    {
      'orderId': 'o1',
      'title': 'Установка смесителя',
      'number': 'Z-2026-000123',
      'provider': 'payme',
      'amountTiyin': 85000000,
      'tipTiyin': 5000000,
      'status': 'succeeded',
      'at': DateTime.now().toIso8601String(),
    },
    {
      'orderId': 'o1',
      'title': 'Замена розетки',
      'number': 'Z-2026-000100',
      'provider': 'cash',
      'amountTiyin': 40000000,
      'tipTiyin': 0,
      'status': 'pending',
      'at': DateTime.now().subtract(const Duration(days: 9)).toIso8601String(),
    },
  ],
};

/// Карточка техники читает поля из элемента списка, а в общей заглушке они
/// лежат на верхнем уровне — иначе в снимке была бы карточка без названия.
final _equipmentData = <String, dynamic>{
  'items': [
    {
      'id': 'a1',
      'type': 'Кондиционер',
      'brand': 'LG',
      'model': 'S12',
      'year': 2023,
      'lastServiceAt': DateTime.now().subtract(const Duration(days: 200)).toIso8601String(),
      'plateUnreadable': true,
      'linkedWork': ['Чистка кондиционера', 'Дозаправка фреоном'],
      'history': [
        {'number': 'Z-2026-000100', 'title': 'Чистка кондиционера', 'at': DateTime.now().subtract(const Duration(days: 200)).toIso8601String()},
      ],
    },
    {
      'id': 'a2',
      'type': 'Водонагреватель',
      'brand': 'Ariston',
      'model': 'ABS VLS',
      'year': 2021,
      'lastServiceAt': DateTime.now().subtract(const Duration(days: 90)).toIso8601String(),
      'plateUnreadable': false,
      'linkedWork': ['Замена ТЭНа'],
      'history': const [],
    },
  ],
};

/// Один снимок: экран строится на заглушке, ждёт загрузку и уходит в PNG.
Future<void> shoot(WidgetTester tester, String title, Widget screen, {Map<String, dynamic>? extra}) async {
  responseBody = extra == null ? fixture : {...fixture, ...extra};
  addTearDown(() => responseBody = fixture);

  tester.view.physicalSize = _logicalSize * _pixelRatio;
  tester.view.devicePixelRatio = _pixelRatio;
  addTearDown(tester.view.reset);

  final key = GlobalKey();
  await tester.pumpWidget(
    RepaintBoundary(
      key: key,
      child: MaterialApp(
        debugShowCheckedModeBanner: false,
        theme: _exportTheme(),
        // Вкладки (главная, услуги, главная точки) рассчитывают на Scaffold
        // каркаса: без него им негде взять Material
        home: Scaffold(backgroundColor: SozoColors.bg, body: screen),
      ),
    ),
  );

  // Загрузка данных, разбор SVG-иконок, первый кадр анимаций
  await tester.pump();
  for (var i = 0; i < 8; i++) {
    await tester.pump(const Duration(milliseconds: 120));
  }
  // Растровые фотографии декодируются настоящей асинхронностью: в поддельном
  // времени теста их Future не завершается, и на снимке оставалось белое место
  // вместо фона заставки
  await tester.runAsync(() async {
    for (final e in tester.widgetList<Image>(find.byType(Image))) {
      await precacheImage(e.image, tester.element(find.byType(MaterialApp)));
    }
  });
  await tester.pump();

  final boundary = key.currentContext!.findRenderObject()! as RenderRepaintBoundary;
  // Снимок отдаёт движок настоящей асинхронностью — в поддельном времени теста
  // такой Future не завершится и тест провисит до таймаута
  late Uint8List png;
  await tester.runAsync(() async {
    final image = await boundary.toImage(pixelRatio: _pixelRatio);
    final data = await image.toByteData(format: ui.ImageByteFormat.png);
    image.dispose();
    png = data!.buffer.asUint8List();
  });

  _n++;
  final name = '${_n.toString().padLeft(2, '0')}_${title.replaceAll(' ', '_').replaceAll('/', '-')}.png';
  File('${_out.path}/$name').writeAsBytesSync(png);
  _index.add('${_n.toString().padLeft(2, '0')}. **$title** — `$name`');

  // Ошибки вёрстки ловит дымовой прогон; выгрузка из-за них не останавливается
  final error = tester.takeException();
  if (error != null) {
    // ignore: avoid_print
    print('  ! «$title»: $error');
  }
}

ThemeData _exportTheme() {
  final base = sozoTheme();
  final app = base.appBarTheme;
  return base.copyWith(
    textTheme: base.textTheme.apply(fontFamily: _fontFamily, fontFamilyFallback: const [_fallbackFamily]),
    primaryTextTheme:
        base.primaryTextTheme.apply(fontFamily: _fontFamily, fontFamilyFallback: const [_fallbackFamily]),
    appBarTheme: app.copyWith(
      titleTextStyle: (app.titleTextStyle ?? const TextStyle())
          .copyWith(fontFamily: _fontFamily, fontFamilyFallback: const [_fallbackFamily]),
    ),
  );
}

Future<void> _loadFonts() async {
  final found = await _load(_fontFamily, const [
    'Arial.ttf',
    'Arial Bold.ttf',
    'Arial Italic.ttf',
    'Arial Bold Italic.ttf',
  ]);
  if (found == 0) {
    // ignore: avoid_print
    print('! Системные шрифты не найдены в $_fontsDir — текст выйдет прямоугольниками');
  }
  await _load(_fallbackFamily, const ['Arial Unicode.ttf']);
}

Future<int> _load(String family, List<String> files) async {
  final loader = FontLoader(family);
  var found = 0;
  for (final name in files) {
    final file = File('$_fontsDir/$name');
    if (!file.existsSync()) continue;
    found++;
    loader.addFont(Future<ByteData>.value(ByteData.sublistView(file.readAsBytesSync())));
  }
  if (found > 0) await loader.load();
  return found;
}
