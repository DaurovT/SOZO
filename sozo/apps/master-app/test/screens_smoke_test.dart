import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:sozo_master/api/models.dart';
import 'package:sozo_master/design_tokens.dart';
import 'package:sozo_master/i18n.dart';
import 'package:sozo_master/main.dart';
import 'package:sozo_master/screens/addwork_screen.dart';
import 'package:sozo_master/screens/badge_screen.dart';
import 'package:sozo_master/screens/branch_screens.dart';
import 'package:sozo_master/screens/login_screen.dart';
import 'package:sozo_master/screens/notifications_screen.dart';
import 'package:sozo_master/screens/offer_sheet.dart';
import 'package:sozo_master/screens/onboarding_screen.dart';
import 'package:sozo_master/screens/order_extras.dart';
import 'package:sozo_master/screens/order_screen.dart';
import 'package:sozo_master/screens/orders_screen.dart';
import 'package:sozo_master/screens/outbox_screen.dart';
import 'package:sozo_master/screens/profile_extras.dart';
import 'package:sozo_master/screens/profile_screen.dart';
import 'package:sozo_master/screens/quote_screen.dart';
import 'package:sozo_master/screens/resources_screens.dart';
import 'package:sozo_master/screens/route_screen.dart';
import 'package:sozo_master/screens/stages_helper_payment.dart';
import 'package:sozo_master/screens/today_screen.dart';
import 'package:sozo_master/screens/wallet_screen.dart';

/// Дымовой прогон всех экранов приложения.
///
/// Смысл теста — не в проверке вёрстки, а в том, что экран вообще строится
/// на реальных данных. Пустое состояние ловит меньше половины ошибок:
/// календарь графика падал только на непустом месяце, потому что последний
/// ряд добивался пустыми клетками. Поэтому сервер здесь подменён заглушкой,
/// которая на любой запрос отдаёт заполненный ответ.
void main() {
  setUpAll(() {
    HttpOverrides.global = _FixtureHttpOverrides();
    session.api.token = 'test';
  });

  Future<void> check(WidgetTester tester, String name, Widget screen) async {
    // Размер настоящего телефона, а не тестовый 800×600.
    //
    // На широком холсте не переполняется ничего: строки, которые на реальном
    // экране уезжают за край, здесь помещаются, и прогон их не видит. Именно
    // так «Авария» и «Ждёт решения» на одной карточке годами считались целыми
    tester.view.physicalSize = const Size(390, 844) * 3;
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(MaterialApp(theme: sozoTheme(), home: screen));
    await tester.pump();
    // Даём отработать загрузке и таймерам поллинга
    await tester.pump(const Duration(milliseconds: 300));
    expect(tester.takeException(), isNull, reason: 'экран «$name» упал при построении');
  }

  final order = OrderCard.fromJson(_order);
  final profile = MasterProfile.fromJson(_profile);
  final offer = Offer.fromJson(_offer);

  /// Тот же прогон на узбекском.
  ///
  /// Словарь проверяет `i18n_test`, но он не знает о вёрстке: узбекская строка
  /// длиннее русской процентов на пятнадцать, и переполнение вылезает именно
  /// на кнопках и пилюлях. Здесь оно поймается как исключение при построении.
  group('экраны строятся на узбекском', () {
    setUpAll(() async {
      // Язык живёт в настройках телефона — в тесте их подменяем заглушкой
      SharedPreferences.setMockInitialValues({});
      await l10n.set('uz');
    });
    tearDownAll(() async => l10n.set('ru'));

    testWidgets('вход', (t) => check(t, 'Вход', const LoginScreen()));
    testWidgets('сегодня', (t) => check(t, 'Сегодня', const TodayScreen()));
    testWidgets('мои заявки', (t) => check(t, 'Мои заявки', const OrdersScreen()));
    testWidgets('профиль', (t) => check(t, 'Профиль', const ProfileScreen()));
    testWidgets('кошелёк', (t) => check(t, 'Кошелёк', const WalletScreen()));
    testWidgets('карточка заявки', (t) => check(t, 'Карточка', const OrderScreen(orderId: 'o1')));
    testWidgets('оффер', (t) async {
      await check(
        t,
        'Оффер',
        OfferSheet(
          offer: offer,
          ttlSeconds: 60,
          declineReasons: const [(code: 'far', title: 'Далеко')],
          onAccept: () async => 'o1',
          onDecline: (_) async {},
        ),
      );
    });
    testWidgets('оформление', (t) => check(t, 'Оформление', const OnboardingScreen()));

    // Навык приходит с сервера по-русски и таким же уходит обратно в анкету,
    // поэтому переводится только показ. Ошибиться тут легко и незаметно:
    // словарь значений добавили, а вызвать `tv` на экране забыли — интерфейс
    // узбекский, а «сантехника» посреди него русская.
    testWidgets('значения справочников показаны по-узбекски', (t) async {
      await t.pumpWidget(MaterialApp(theme: sozoTheme(), home: SkillsScreen(skills: profile.skillTags)));
      await t.pump(const Duration(milliseconds: 300));
      expect(find.textContaining('santexnika'), findsWidgets, reason: 'навык показан не переведённым');
      expect(find.textContaining('сантехника'), findsNothing, reason: 'русское значение осталось на экране');
    });
  });

  group('экраны строятся на данных', () {
    testWidgets('вход', (t) => check(t, 'Вход', const LoginScreen()));
    testWidgets('сегодня', (t) => check(t, 'Сегодня', const TodayScreen()));
    testWidgets('мои заявки', (t) => check(t, 'Мои заявки', const OrdersScreen()));
    testWidgets('график', (t) => check(t, 'График', const ScheduleTab()));
    testWidgets('кошелёк', (t) => check(t, 'Кошелёк', const WalletScreen()));
    testWidgets('профиль', (t) => check(t, 'Профиль', const ProfileScreen()));
    testWidgets('уведомления', (t) => check(t, 'Уведомления', const NotificationsScreen()));
    testWidgets('очередь отправки', (t) => check(t, 'Очередь отправки', const OutboxScreen()));

    testWidgets('карточка заявки', (t) => check(t, 'Карточка заявки', const OrderScreen(orderId: 'o1')));
    testWidgets('маршрут дня', (t) => check(t, 'Маршрут дня', RouteScreen(orders: [order])));
    testWidgets('карточка помощника', (t) async {
      await check(t, 'Карточка помощника', HelperOrderScreen(order: order, onDepart: () {}, onArrive: () {}));
    });
    testWidgets('смета', (t) => check(t, 'Смета', QuoteScreen(order: order)));
    testWidgets('доп-работа', (t) => check(t, 'Доп-работа', AddworkScreen(order: order)));
    testWidgets('консервация', (t) => check(t, 'Консервация', ConservationScreen(order: order)));
    testWidgets('этапы работы', (t) => check(t, 'Этапы работы', StagesScreen(order: order)));
    testWidgets('нужен помощник', (t) => check(t, 'Нужен помощник', HelperRequestScreen(order: order)));
    testWidgets('оплата', (t) => check(t, 'Оплата', PaymentScreen(order: order)));
    testWidgets('техника клиента', (t) => check(t, 'Техника клиента', AssetScreen(order: order)));
    testWidgets('список закупки', (t) => check(t, 'Список закупки', ShoppingListScreen(order: order)));
    testWidgets('рекомендовать', (t) => check(t, 'Рекомендовать', RecommendScreen(order: order)));
    testWidgets('вилка запчасти', (t) => check(t, 'Вилка запчасти', SpareTierScreen(order: order)));
    testWidgets('код закупки', (t) => check(t, 'Код закупки', PurchaseCodeScreen(order: order)));
    testWidgets('доказательство замены', (t) => check(t, 'Доказательство замены', ReplacementProofScreen(order: order)));
    testWidgets('чек-лист осмотра', (t) => check(t, 'Чек-лист осмотра', InspectionScreen(order: order)));

    for (final kind in BranchKind.values) {
      testWidgets('ветка $kind', (t) async {
        await check(t, 'Ветка $kind', BranchScreen(orderId: 'o1', orderNumber: 'Z-1', kind: kind));
      });
    }

    testWidgets('сумка', (t) => check(t, 'Сумка', const StockScreen()));
    testWidgets('оборудование', (t) => check(t, 'Оборудование', const EquipmentFullScreen()));
    testWidgets('оборудование в профиле', (t) => check(t, 'Оборудование в профиле', const EquipmentScreen()));
    testWidgets('рейтинг', (t) => check(t, 'Рейтинг', const RatingScreen()));
    testWidgets('проверка инструмента', (t) => check(t, 'Проверка инструмента', const ToolCheckScreen()));
    testWidgets('приведи мастера', (t) => check(t, 'Приведи мастера', const ReferralScreen()));

    testWidgets('удостоверение', (t) async {
      await check(t, 'Удостоверение', BadgeScreen(profile: profile, verifyBaseUrl: 'https://sozo.uz'));
    });
    testWidgets('мои документы', (t) async {
      await check(t, 'Мои документы', DocumentsListScreen(documents: profile.documents));
    });
    testWidgets('мои допуски', (t) => check(t, 'Мои допуски', SkillsScreen(skills: profile.skillTags)));

    testWidgets('оффер', (t) async {
      await check(
        t,
        'Оффер',
        OfferSheet(
          offer: offer,
          ttlSeconds: 60,
          declineReasons: const [(code: 'far', title: 'Далеко')],
          onAccept: () async => 'o1',
          onDecline: (_) async {},
        ),
      );
    });

    testWidgets('оформление', (t) => check(t, 'Оформление', const OnboardingScreen()));
    testWidgets('анкета', (t) => check(t, 'Анкета', const ApplicationScreen()));
    testWidgets('документы кандидата', (t) => check(t, 'Документы кандидата', const DocumentsScreen()));
    testWidgets('обучение', (t) => check(t, 'Обучение', const TrainingScreen()));
    testWidgets('экзамен', (t) => check(t, 'Экзамен', ExamScreen(exam: const {'available': true, 'attemptsLeft': 3})));
  });
}

// ---------- Заглушка сервера ----------

/// Один ответ на все запросы: объединение полей, которые читают экраны.
/// Экраны терпимы к лишним ключам, поэтому одного объекта достаточно.
final Map<String, dynamic> _order = {
  'id': 'o1',
  'number': 'Z-2026-000001',
  'status': 'in_progress',
  'graphType': 'b2c_standard',
  'urgency': 'urgent',
  'clientName': 'Дилшод',
  'clientPhone': '+998900000000',
  'address': 'Юнусабад 5',
  'lat': 41.35,
  'lng': 69.28,
  'description': 'Розетка искрит',
  'totalFromTiyin': 25000000,
  'myShareTiyin': 13750000,
  'role': 'lead',
  'version': 3,
  'paused': false,
  'arrivedAt': '2026-08-01T09:30:00.000Z',
  'photos': [
    {'id': 'p1', 'stage': 'before', 'geoMissing': false},
  ],
  'lines': [
    {'name': 'Замена розетки', 'qty': 2, 'priceFromTiyin': 5000000},
  ],
  'materials': [
    {'name': 'Розетка', 'amountTiyin': 3000000, 'hasReceipt': true},
  ],
  'quotes': [
    {'kind': 'approved', 'amountTiyin': 25000000},
  ],
  'acceptance': {'method': 'code'},
  'allowedActions': ['complete', 'pause'],
  'steps': [
    {'action': 'complete', 'title': 'Работа выполнена', 'enabled': false, 'reason': 'Нет фото «после»'},
    {'action': 'pause', 'title': 'Пауза', 'enabled': true},
  ],
  'blockers': ['Нет фото «после»'],
};

final Map<String, dynamic> _profile = {
  'id': 'm1',
  'fullName': 'Алишер Каримов',
  'phone': '+998 90 123-45-67',
  'status': 'active',
  'grade': 'silver',
  'rating': 91,
  'skillTags': ['сантехника', 'электрика'],
  'zones': ['Чиланзар', 'Яккасарай'],
  'qrBadgeCode': 'M7KX9QLP2RW4',
  'online': true,
  'ordersClosed': 42,
  'avgRating': 4.8,
  'acceptRatePercent': 93,
  'documents': [
    {'name': 'Паспорт', 'status': 'verified'},
    {'name': 'Справка о статусе', 'status': 'uploaded'},
    {'name': 'Фото инструмента', 'status': 'rejected'},
  ],
};

final Map<String, dynamic> _offer = {
  'id': 'of1',
  'orderNumber': 'Z-2026-000002',
  'description': 'Течёт смеситель',
  'district': 'Чиланзар',
  'urgency': 'emergency',
  'totalFromTiyin': 18000000,
  'myShareFromTiyin': 9900000,
  'ttlSeconds': 60,
  'isPaired': true,
  'waitingSince': '2026-08-01T08:15:00.000Z',
};

Map<String, dynamic> get _fixture => {
      // общие
      'message': 'Готово',
      'note': 'Пояснение',
      'empty': 'Пусто',
      'hint': 'Подсказка',
      // сегодня
      'current': _order,
      'upcoming': [_order],
      'lane': {'busyMin': 240, 'shiftMin': 480, 'loadPercent': 50},
      'cash': {'debtTiyin': 12000000, 'locked': false, 'warning': 'Приближается лимит'},
      'day': {'earnedTiyin': 45000000, 'orders': 3},
      'duty': {'title': 'Дежурство', 'note': 'До 22:00'},
      'probation': {'done': 3, 'target': 10},
      'offersPending': 0,
      'unreadNotifications': 2,
      // заявки и офферы
      'items': [_order],
      'orders': [_order],
      // уведомления
      'unread': 2,
      'groups': [
        {
          'label': 'Сегодня',
          'items': [
            {
              'kind': 'offer',
              'title': 'Новый оффер',
              'body': 'Розетка искрит, Юнусабад',
              'createdAt': '2026-08-01T19:58:00.000Z',
              'read': false,
              'orderId': 'o1',
            },
            {'kind': 'payment', 'title': 'Оплата', 'body': 'Принята', 'createdAt': '', 'read': true},
          ],
        },
      ],
      // график
      'month': '2026-08',
      'days': [
        for (var d = 1; d <= 31; d++)
          {
            'date': '2026-08-${d.toString().padLeft(2, '0')}',
            'shift': d % 3 == 0,
            'duty': d % 7 == 0,
          },
      ],
      'requests': [
        {'kind': 'vacation', 'from': '2026-08-10', 'to': '2026-08-20', 'status': 'pending'},
      ],
      // кошелёк
      'accruedTiyin': 45000000,
      'paidTiyin': 20000000,
      'dueTiyin': 13000000,
      'cashDebtTiyin': 12000000,
      'cashLimitTiyin': 200000000,
      'taxMode': 'gph',
      'periods': [
        {'code': 'week', 'title': 'Неделя'},
        {'code': 'month', 'title': 'Месяц'},
      ],
      'sections': [
        {
          'title': 'Доля за работы',
          'totalTiyin': 30000000,
          'note': 'Возмещения не облагаются налогом',
          'rows': [
            {'title': 'Z-2026-000001', 'amountTiyin': 15000000},
          ],
        },
      ],
      'blocked': [
        {'orderNumber': 'Z-2026-000003', 'note': 'Спор по качеству'},
      ],
      'totalTiyin': 5000000,
      // рейтинг
      'score': 91,
      'grade': 'silver',
      'sharePermille': 550,
      'windowDays': 56,
      'nextGrade': 'Осталось 100 закрытых заявок до «Золота»',
      'penalty': 2,
      'components': [
        {'title': 'Пунктуальность', 'value': 100, 'weight': 25, 'contribution': 25, 'formula': 'доля «Приступить»'},
        {'title': 'Качество фиксации', 'value': 60, 'weight': 15, 'contribution': 9, 'formula': 'доля пакетов'},
      ],
      'appeals': [
        {'subject': 'rating', 'text': 'Не согласен', 'status': 'open', 'at': '2026-08-01T10:00:00.000Z'},
      ],
      'upsell': {'conversionPercent': 20, 'revenueTiyin': 8000000},
      // ресурсы
      'budgetTiyin': 30000000,
      'stores': [
        {
          'name': 'Сантехмир',
          'address': 'Чиланзар, ул. Бунёдкор 12',
          'categories': ['сантехника', 'отопление'],
        },
      ],
      'catalog': [
        {'id': 'c1', 'name': 'Лента ФУМ', 'costTiyin': 800000, 'unit': 'шт', 'priceFromTiyin': 900000, 'category': 'расходники'},
      ],
      'belowMin': 2,
      'angles': ['Спереди', 'Сзади', 'Слева', 'Справа'],
      'equipment': [
        {
          'id': 'e1',
          'name': 'Перфоратор',
          'status': 'issued',
          'completeness': ['Основной блок'],
          'acts': [
            {'kind': 'issue', 'at': '2026-08-01T10:00:00.000Z', 'discrepancy': ''},
          ],
        },
      ],
      'skills': [
        {
          'skill': 'сантехника',
          'items': ['Разводной ключ', 'Труборез'],
          'confirmed': false,
        },
      ],
      // этапы, помощник, оплата
      'plan': {
        'stages': [
          {'index': 1, 'title': 'Демонтаж', 'status': 'done', 'normHours': 2, 'slotAt': '2026-08-02T09:00:00.000Z', 'pauseMinHours': 12, 'pauseMaxHours': 24},
          {'index': 2, 'title': 'Монтаж', 'status': 'planned', 'normHours': 3, 'slotAt': null},
        ],
      },
      'canStart': true,
      'blocker': 'Слот второго этапа не подтверждён',
      'helperDurations': [
        {'code': 'h1', 'title': '1 час'},
      ],
      'helperFeeTiyin': 5000000,
      'qrPayload': 'sozo://pay/o1?amount=250000',
      // код закупки
      'codes': [
        {'id': 'pc1', 'code': '558700', 'status': 'active', 'limitTiyin': 55000000, 'expiresAt': '2026-08-01T00:36:00.000Z'},
      ],
      // онбординг
      'stage': 'documents',
      'stages': [
        {'code': 'application', 'title': 'Анкета'},
        {'code': 'documents', 'title': 'Документы'},
        {'code': 'training', 'title': 'Обучение'},
      ],
      'nextStep': 'Загрузите паспорт',
      'application': {'fullName': 'Алишер', 'years': 5, 'skills': ['сантехника'], 'rejectionReason': null},
      'documents': [
        {'code': 'passport', 'title': 'Паспорт', 'status': 'verified'},
      ],
      'modules': [
        {'id': 'mod1', 'title': 'Техника безопасности', 'done': true},
      ],
      'exam': {'available': true, 'attemptsLeft': 3, 'reason': null},
      'questions': [
        {'id': 'q1', 'text': 'Вопрос?', 'options': ['А', 'Б']},
      ],
      'passed': true,
      // рефералы, оборудование в профиле
      'referrals': [
        {'name': 'Бек', 'closedOrders': 5, 'status': 'active'},
      ],
      'code': 'SOZO-123',
      'assets': [],
      'known': [
        {'type': 'кондиционер', 'brand': 'LG', 'model': 'X1'},
      ],
      'assetTypes': ['кондиционер', 'котёл'],
      'requiresAsset': true,
      'tiers': [],
      'variants': [],
      'declineReasons': [
        {'code': 'far', 'title': 'Далеко'},
      ],
      'pending': {
        'escalation': [
          {'step': 'Отправлено клиенту', 'done': true, 'at': '2026-08-01T10:00:00.000Z'},
        ],
      },
      'due': false,
      'frozen': null,
      'minVersion': '1.0.0',
    };

class _FixtureHttpOverrides extends HttpOverrides {
  @override
  HttpClient createHttpClient(SecurityContext? context) => _FixtureClient();
}

class _FixtureClient implements HttpClient {
  @override
  bool autoUncompress = true;
  @override
  Duration idleTimeout = const Duration(seconds: 15);
  @override
  String? userAgent;
  @override
  Duration? connectionTimeout;
  @override
  int? maxConnectionsPerHost;

  @override
  Future<HttpClientRequest> openUrl(String method, Uri url) async => _FixtureRequest(method, url);

  @override
  void close({bool force = false}) {}

  @override
  noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class _FixtureRequest implements HttpClientRequest {
  _FixtureRequest(this.method, this.uri);

  @override
  final String method;
  @override
  final Uri uri;
  @override
  final HttpHeaders headers = _FixtureHeaders();

  @override
  Future<HttpClientResponse> close() async => _FixtureResponse();

  @override
  void add(List<int> data) {}
  @override
  void write(Object? o) {}
  @override
  Future<void> flush() async {}
  @override
  Future addStream(Stream<List<int>> s) async {}

  @override
  noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class _FixtureResponse extends Stream<List<int>> implements HttpClientResponse {
  final List<int> _body = utf8.encode(jsonEncode(_fixture));

  @override
  int get statusCode => 200;
  @override
  String get reasonPhrase => 'OK';
  @override
  int get contentLength => _body.length;
  @override
  HttpHeaders get headers => _FixtureHeaders();
  @override
  bool get isRedirect => false;
  @override
  bool get persistentConnection => false;
  @override
  List<Cookie> get cookies => const [];
  @override
  List<RedirectInfo> get redirects => const [];
  @override
  HttpClientResponseCompressionState get compressionState =>
      HttpClientResponseCompressionState.notCompressed;

  @override
  StreamSubscription<List<int>> listen(
    void Function(List<int> event)? onData, {
    Function? onError,
    void Function()? onDone,
    bool? cancelOnError,
  }) {
    return Stream<List<int>>.value(Uint8List.fromList(_body))
        .listen(onData, onError: onError, onDone: onDone, cancelOnError: cancelOnError);
  }

  @override
  noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class _FixtureHeaders implements HttpHeaders {
  @override
  bool chunkedTransferEncoding = false;
  @override
  int contentLength = -1;
  @override
  ContentType? contentType = ContentType.json;
  @override
  DateTime? date;
  @override
  DateTime? expires;
  @override
  String? host;
  @override
  DateTime? ifModifiedSince;
  @override
  bool persistentConnection = false;
  @override
  int? port;

  @override
  void set(String name, Object value, {bool preserveHeaderCase = false}) {}
  @override
  void add(String name, Object value, {bool preserveHeaderCase = false}) {}
  @override
  String? value(String name) => name.toLowerCase() == 'content-type' ? 'application/json' : null;
  @override
  List<String>? operator [](String name) =>
      name.toLowerCase() == 'content-type' ? const ['application/json'] : null;
  @override
  void forEach(void Function(String name, List<String> values) action) {
    action('content-type', const ['application/json']);
  }

  @override
  noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}
