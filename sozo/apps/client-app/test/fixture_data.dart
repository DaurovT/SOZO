import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

/// Общая заглушка сервера для тестов и выгрузки экранов.
///
/// Вынесено из screens_smoke_test.dart, чтобы дымовой прогон и экспорт PNG
/// работали на одних и тех же данных: разойдись они — снимки перестали бы
/// показывать то, что проверяет тест.

/// Тело ответа заглушки. По умолчанию — общий [fixture]; экспорт экранов
/// подменяет его на время одного снимка, когда экрану нужны свои поля.
Map<String, dynamic> responseBody = fixture;

/// Код ответа заглушки: 500 нужен, чтобы снять экран ошибки
int responseStatus = 200;

/// Заглушка рвёт соединение — снимок офлайн-состояния
bool responseOffline = false;

final approvalItem = <String, dynamic>{
  'orderId': 'o1',
  'number': 'Z-2026-000123',
  'locationName': 'Аптека №12',
  'kind': 'estimate',
  'title': 'Смета по заявке',
  'amountTiyin': 85000000,
  'description': 'Замена смесителя в подсобке',
  'variants': null,
  'waitingHours': 3,
  'aboveMyLimit': false,
  'myLimitTiyin': 100000000,
};

final forcedItem = <String, dynamic>{
  ...approvalItem,
  'kind': 'forced',
  'title': 'Вынужденная доп-работа',
  'aboveMyLimit': true,
  'variants': [
    {
      'kind': 'minimal',
      'title': 'Минимальный',
      'totalTiyin': 18000000,
      'lines': [
        {'name': 'Времянка', 'amountTiyin': 18000000, 'qty': 1},
      ],
    },
    {
      'kind': 'full',
      'title': 'Полный',
      'totalTiyin': 46000000,
      'lines': [
        {'name': 'Замена трубы', 'amountTiyin': 46000000, 'qty': 1},
      ],
    },
  ],
};

/// Один ответ на все запросы: объединение полей всех эндпоинтов.
/// Так экран получает заполненные данные, какой бы путь он ни дёрнул.
final _today = DateTime.now().toIso8601String().substring(0, 10);
final _now = DateTime.now().toIso8601String();

final fixture = <String, dynamic>{
  // ---- /app/me
  'phone': '+998901112233',
  'fullName': 'Тимур',
  'locale': 'ru',
  'consents': {'personalData': true, 'marketing': false},
  'debtTiyin': 12000000,
  'hasClosedOrders': true,
  'addressesCount': 2,
  'warrantyDays': 30,
  'supportPhone': '+998712000000',
  'contexts': [
    {
      'id': 'loc1',
      'title': 'Аптека №12, ул. Навои 12',
      // Без organizationId экраны организации считают контекст невыбранным
      'organizationId': 'org1',
      'organizationName': 'Сеть «Доривор»',
      'role': 'site_manager',
      'approvalLimitTiyin': 50000000,
      'pending': 2,
    },
  ],

  // ---- /app/catalog
  'releaseNumber': 1,
  'categories': [
    {
      'name': 'САНТЕХНИКА',
      'label': 'Сантехника',
      'hint': 'Трубы, краны, унитазы и др.',
      'icon': 'droplet',
      'popular': true,
      'order': 1,
      'priceFromTiyin': 8000000,
      'items': [
        {
          'id': 'p1',
          'name': 'Установка смесителя',
          'unit': 'шт',
          'category': 'САНТЕХНИКА',
          'priceFromTiyin': 16000000,
          'priceToTiyin': 25000000,
          'normHours': 1.5,
          'isPaired': true,
          'isStaged': true,
          'requiresEquipment': true,
          'note': null,
        },
      ],
    },
    {
      'name': 'ЭЛЕКТРИКА',
      'label': 'Электрика',
      'hint': 'Проводка, розетки, щитки',
      'icon': 'zap',
      'popular': true,
      'order': 2,
      'priceFromTiyin': 5000000,
      'items': [
        {
          'id': 'p2',
          'name': 'Замена розетки',
          'unit': 'шт',
          'category': 'ЭЛЕКТРИКА',
          'priceFromTiyin': 5000000,
          'priceToTiyin': 9000000,
          'normHours': null,
          'isPaired': false,
          'isStaged': false,
          'requiresEquipment': false,
          'note': null,
        },
      ],
    },
  ],

  // ---- /app/slots
  'normHours': 1.5,
  'urgentAvailable': true,
  'waitlistAvailable': true,
  'days': [
    {
      'date': _today,
      'windows': [
        {'startMin': 600, 'label': '10:00–12:00', 'mastersAvailable': 2, 'slots': 4},
        {'startMin': 660, 'label': '11:00–13:00', 'mastersAvailable': 1, 'slots': 4},
      ],
    },
  ],

  // ---- /app/addresses
  'addresses': [
    {
      'id': 'a1',
      'label': 'Дом',
      'street': 'ул. Навои 12',
      'apartment': '45',
      'entrance': '3',
      'floor': '5',
      'intercom': '45В',
      'hasLift': true,
      'comment': 'Код от калитки 1234',
      'primary': true,
    },
  ],

  // ---- /app/orders + карточка заявки
  'id': 'o1',
  'number': 'Z-2026-000123',
  'status': 'in_progress',
  'statusLabel': 'В работе',
  'graphType': 'b2c',
  'urgency': 'emergency',
  'address': 'ул. Навои 12',
  'description': 'Течёт под мойкой',
  'category': 'Установка смесителя',
  'totalFromTiyin': 23000000,
  'totalToTiyin': 31000000,
  'totalMaterialTiyin': 4200000,
  'approvedTiyin': 24000000,
  'promoDiscountPercent': 10,
  'masterName': 'Алишер Каримов',
  'rating': 5,
  'needsDecision': true,
  'createdAt': _now,
  'warrantyUntil': DateTime.now().add(const Duration(days: 12)).toIso8601String(),
  'lat': 41.311,
  'lng': 69.279,
  'window': {'from': '${_today}T10:00:00', 'to': '${_today}T12:00:00', 'label': '10:00–12:00'},
  'master': {'name': 'Алишер Каримов', 'rating': 4.9, 'jobsDone': 312},
  'lines': [
    {'name': 'Установка смесителя', 'unit': 'шт', 'qty': 2, 'fromTiyin': 32000000, 'toTiyin': 50000000},
  ],
  'materials': [
    {'kind': 'spare_part', 'name': 'Смеситель Vidima', 'amountTiyin': 42000000, 'priceTier': 'standard', 'hasReceipt': true},
  ],
  'quotes': [
    {'kind': 'initial', 'amountTiyin': 20000000, 'at': _now},
  ],
  'photos': [
    {'stage': 'before', 'url': '/v1/photos/x.jpg?token=t', 'at': _now},
    {'stage': 'after', 'url': '/v1/photos/y.jpg?token=t', 'at': _now},
  ],
  'pause': {'reason': 'Ожидание материалов', 'since': _now, 'until': _now},
  'acceptance': null,
  'acceptanceCode': '4831',
  'code': '4831',
  'addressDetails': {'apartment': '45', 'entrance': '3', 'floor': '5', 'intercom': '45В', 'hasLift': true, 'at': _now},
  'payment': null,
  'timeline': [
    {'status': 'new', 'label': 'Новая', 'at': _now, 'done': true, 'current': false},
    {'status': 'in_progress', 'label': 'В работе', 'at': _now, 'done': true, 'current': true},
    {'status': 'closed', 'label': 'Закрыта', 'at': null, 'done': false, 'current': false},
  ],
  'pending': {
    'estimate': true,
    'addressDetails': true,
    'spareTier': {
      'id': 's1',
      'partName': 'Смеситель',
      'variants': [
        {'tier': 'economy', 'title': 'Эконом', 'amountTiyin': 20000000, 'note': 'Китай, 1 год'},
        {'tier': 'standard', 'title': 'Стандарт', 'amountTiyin': 42000000, 'note': 'Vidima, 3 года'},
      ],
    },
    'addwork': {
      'id': 'aw1',
      'photoCount': 2,
      'variants': [
        {
          'kind': 'minimal',
          'title': 'Минимальный — безопасная времянка',
          'totalTiyin': 18000000,
          'lines': [
            {'name': 'Времянка', 'amountTiyin': 18000000, 'qty': 1},
          ],
        },
        {
          'kind': 'full',
          'title': 'Полный — полное устранение',
          'totalTiyin': 46000000,
          'lines': [
            {'name': 'Замена участка трубы', 'amountTiyin': 46000000, 'qty': 1},
          ],
        },
      ],
    },
    'recommendation': {
      'id': 'r1',
      'comment': 'Подводка на ладан дышит — лучше заменить, пока разобрано',
      'lines': [
        {'name': 'Замена подводки', 'amountTiyin': 9000000, 'qty': 2},
      ],
    },
    'stagePlan': {
      'orderId': 'o1',
      'allSlotsConfirmed': false,
      'stages': [
        {'index': 1, 'title': 'Демонтаж и черновая', 'normHours': 3, 'pauseMinHours': 24, 'pauseMaxHours': 168, 'slotAt': _now, 'status': 'booked'},
        {'index': 2, 'title': 'Чистовая установка', 'normHours': 2, 'pauseMinHours': 24, 'pauseMaxHours': 168, 'status': 'planned'},
      ],
    },
  },
  'can': {'cancel': true, 'reschedule': true, 'pay': true, 'rate': false, 'dispute': true, 'warranty': true},
  'statusLog': [
    {'to': 'new', 'label': 'Новая', 'at': _now},
  ],
  'orders': [
    {
      'id': 'o1',
      'number': 'Z-2026-000123',
      'status': 'in_progress',
      'statusLabel': 'В работе',
      'urgency': 'emergency',
      'address': 'ул. Навои 12',
      'description': 'Течёт под мойкой',
      'category': 'Установка смесителя',
      'totalFromTiyin': 23000000,
      'totalToTiyin': 31000000,
      'masterName': 'Алишер Каримов',
      'window': {'from': '${_today}T10:00:00', 'to': '${_today}T12:00:00', 'label': '10:00–12:00'},
      'rating': null,
      'warrantyUntil': null,
      'createdAt': _now,
      'needsDecision': true,
    },
  ],
  'activeOrder': {
    'id': 'o1',
    'number': 'Z-2026-000123',
    'status': 'in_progress',
    'statusLabel': 'В работе',
    'urgency': 'normal',
    'address': 'ул. Навои 12',
    'category': 'Установка смесителя',
    'totalFromTiyin': 23000000,
    'totalToTiyin': 31000000,
    'masterName': 'Алишер Каримов',
    'window': null,
    'createdAt': _now,
    'needsDecision': false,
  },
  'repeatable': {
    'id': 'o0',
    'number': 'Z-2026-000100',
    'status': 'closed',
    'statusLabel': 'Закрыта',
    'urgency': 'normal',
    'address': 'ул. Навои 12',
    'category': 'Чистка кондиционера',
    'totalFromTiyin': 18000000,
    'totalToTiyin': 18000000,
    'masterName': 'Алишер Каримов',
    'window': null,
    'createdAt': _now,
    'needsDecision': false,
  },
  'awaiting': [
    {
      'id': 'o1',
      'number': 'Z-2026-000123',
      'status': 'in_progress',
      'statusLabel': 'В работе',
      'urgency': 'normal',
      'address': 'ул. Навои 12',
      'category': 'Установка смесителя',
      'totalFromTiyin': 23000000,
      'totalToTiyin': 31000000,
      'masterName': 'Алишер Каримов',
      'window': null,
      'createdAt': _now,
      'needsDecision': true,
      'decision': {'kind': 'estimate', 'title': 'Подтвердите стоимость — мастер ждёт', 'urgent': true},
    },
  ],
  'label': 'Сантехника',
  'popular': true,
  'order': 1,
  // Гарантия и техника на главной: без них новые карточки С-06 не проверяются
  'warranty': {'count': 3, 'nextUntil': _now, 'nextTitle': 'Замена смесителя'},
  'equipmentDue': [
    {'id': 'a1', 'title': 'Кондиционер LG S12', 'type': 'Кондиционер', 'daysSinceService': 200, 'periodDays': 180, 'due': true},
  ],
  'postponedRecommendations': [
    {
      'id': 'r9',
      'orderId': 'o1',
      'orderNumber': 'Z-2026-000123',
      'totalTiyin': 9000000,
      'comment': null,
      'lines': [
        {'name': 'Замена подводки', 'amountTiyin': 9000000, 'qty': 1},
      ],
      'createdAt': _now,
    },
  ],

  // ---- /app/complaints
  'complaints': [
    {
      'id': 'c1',
      'type': 'Сроки',
      'text': 'Мастер опоздал на два часа без предупреждения',
      'orderNumber': 'Z-2026-000123',
      'status': 'in_progress',
      'resolution': null,
      'createdAt': _now,
    },
  ],
  'types': ['Качество работы', 'Поведение мастера', 'Сроки', 'Деньги', 'Другое'],

  // ---- /app/dictionaries
  'cancelReasons': ['Передумал', 'Нашёл другого мастера', 'Другое'],
  'disputeReasons': ['Качество работы', 'Не согласен с суммой', 'Другое'],
  'quickMessages': ['Я задерживаюсь', 'Позвоните мне'],
  'tipPresets': [1000000, 2000000, 5000000],

  // ---- B2B: точка, утверждения, организация, баллы
  'location': {'id': 'loc1', 'name': 'Аптека №12', 'address': 'ул. Навои 12'},
  'organization': {'id': 'org1', 'name': 'Сеть «Доривор»', 'status': 'active'},
  'role': 'site_manager',
  'showMoney': true,
  'suspended': false,
  'awaitingAcceptance': [
    {'id': 'o1', 'number': 'Z-2026-000123', 'address': 'ул. Навои 12'},
  ],
  'pendingApproval': 2,
  'limits': {
    'orderLimitTiyin': 50000000,
    'monthlyLimitTiyin': 150000000,
    'monthSpentTiyin': 64000000,
    'myApprovalLimitTiyin': 100000000,
  },
  'orderLimitTiyin': 50000000,
  'monthlyLimitTiyin': 150000000,
  'monthSpentTiyin': 64000000,
  'myApprovalLimitTiyin': 100000000,
  'editable': false,
  'note': 'Лимиты задаются договором',
  'access': {'schedule': 'пн–вс 08:00–22:00', 'accessNotes': 'вход со двора', 'hoaContact': 'УК +998712001122'},
  'passport': {'areaM2': 85, 'objectType': 'Аптека', 'acUnits': 3, 'electricPanels': 1},
  'loyalty': {'enabled': true, 'balanceTiyin': 12800000},
  'dispatcherPhone': '+998712000000',
  'kinds': [
    {
      'kind': 'water',
      'title': 'Вода',
      'steps': [
        {'text': 'Перекройте кран холодной воды', 'hint': 'в подсобке за стеллажом'},
        {'text': 'Уберите технику из воды', 'hint': null},
      ],
    },
  ],
  'requested': true,
  'accepted': false,
  'rejections': [
    {'at': _now, 'reason': 'Не убрали мусор', 'by': 'Азиза Каримова'},
  ],
  'items': [
    {
      'orderId': 'o1',
      'number': 'Z-2026-000123',
      'locationId': 'loc1',
      'locationName': 'Аптека №12',
      'kind': 'forced',
      'title': 'Вынужденная доп-работа',
      'amountTiyin': 46000000,
      'description': 'Труба за плиткой оказалась чугунной',
      'variants': [
        {
          'kind': 'minimal',
          'title': 'Минимальный',
          'totalTiyin': 18000000,
          'lines': [
            {'name': 'Времянка', 'amountTiyin': 18000000, 'qty': 1},
          ],
        },
      ],
      'waitingHours': 5,
      'aboveMyLimit': false,
      'myLimitTiyin': 100000000,
      // Поля дефекта техдолга: ответ один на все запросы
      'id': 'd1',
      'actId': 'act1',
      'actNumber': 'A-2026-0001',
      'category': 'Электрика',
      'severity': 'high',
      'estimateTiyin': 46000000,
      'declined': true,
      'declineReason': 'Отложено до ремонта',
      'ageDays': 72,
      'createdAt': _now,
      // Та же запись читается лентой уведомлений: заглушка одна на все пути.
      // kind/title/orderId уже заданы выше — здесь только поля ленты
      'body': 'Z-2026-000123',
      'at': _now,
      'actionable': true,
      'read': false,
    },
  ],
  'totalTiyin': 46000000,
  'bySeverity': {'high': 46000000, 'medium': 0, 'low': 0},
  'staleDays': 30,
  'scope': 'Аптека №12',
  'locations': [
    {'id': 'loc1', 'name': 'Аптека №12'},
    {'id': 'loc2', 'name': 'Аптека №7'},
  ],
  'months': [
    {'month': _today.substring(0, 7), 'ordersTotal': 14, 'emergencies': 2, 'worksTiyin': 340000000, 'materialsTiyin': 120000000, 'closed': 11},
  ],
  'techDebtTiyin': 46000000,
  'pdfAvailable': false,
  'tiles': [
    {'id': 'loc1', 'name': 'Аптека №12', 'address': 'ул. Навои 12', 'state': 'error', 'label': 'Ждёт утверждения', 'activeOrders': 2, 'pendingApproval': 1},
    {'id': 'loc2', 'name': 'Аптека №7', 'address': 'ул. Амира Темура 3', 'state': 'success', 'label': 'Всё в порядке', 'activeOrders': 0, 'pendingApproval': 0},
  ],
  'summary': {
    'pendingApproval': 1,
    'subscriptionTiyin': 300000000,
    'unpaidInvoices': 1,
    'unpaidTiyin': 300000000,
    'techDebtTiyin': 46000000,
  },
  'contract': {
    'type': 'subscription',
    'kind': 'annual',
    'subscriptionTiyin': 300000000,
    'pricesFrozen': true,
    'penaltyEnabled': true,
    'carryoverPercent': 0,
  },
  'invoices': [
    {'id': 'i1', 'number': 'СФ-0001', 'kind': 'subscription', 'amountTiyin': 300000000, 'status': 'issued', 'issuedAt': _now, 'paidAt': null},
  ],
  'dunning': 'warn',
  'oldestUnpaidDays': 4,
  'showMoneyToEmployees': false,
  'thresholds': [
    {'role': 'Руководитель точки', 'limitTiyin': 100000000},
  ],
  'total': 1,
  'enabled': true,
  'balanceTiyin': 12800000,
  'nextThresholdTiyin': 20000000,
  'toNextTiyin': 7200000,
  'vouchers': [
    {'id': 'v1', 'code': 'KRZ-0001', 'nominalTiyin': 10000000, 'expiresAt': '2026-10-01', 'expired': false},
  ],
  // Одна запись на два экрана: баллы читают note/amountTiyin, осмотры —
  // locationName/number/defects. Ответ-заглушка один на все запросы.
  'history': [
    {
      'id': 'act1',
      'kind': 'accrual',
      'amountTiyin': 1240000,
      'note': '1% от работ по Z-2026-000123',
      'at': _now,
      'locationName': 'Аптека №12',
      'number': 'A-1001',
      'defects': 5,
      'status': 'sent',
    },
  ],
  'rules': 'Баллы начисляются за заявки через приложение',

  // ---- фаза 2: техника, акты, осмотры
  'lastServiceAt': _now,
  'plateUnreadable': true,
  'linkedWork': ['Чистка кондиционера'],
  'brand': 'Artel',
  'model': 'ART-12',
  'year': 2023,
  'acts': [
    {
      'id': 'act1',
      'number': 'A-1001',
      'locationId': 'loc1',
      'locationName': 'Аптека №12',
      'masterName': 'Алишер Каримов',
      'status': 'sent',
      'createdAt': _now,
      'expiresAt': null,
      'checklist': [
        {'zone': 'Торговый зал', 'ok': true},
        {'zone': 'Электрощитовая', 'ok': false, 'note': 'оплавлен автомат'},
      ],
      'items': [
        {'id': 'd1', 'category': 'Электрика', 'description': 'Оплавлен автомат', 'severity': 'high', 'estimateTiyin': 46000000, 'decision': 'pending', 'orderId': null},
        {'id': 'd2', 'category': 'Сантехника', 'description': 'Подтекает стояк', 'severity': 'medium', 'estimateTiyin': 28000000, 'decision': 'pending', 'orderId': null},
      ],
      'totalTiyin': 74000000,
      'pending': 2,
    },
  ],
  'upcoming': [
    {'locationId': 'loc1', 'locationName': 'Аптека №12', 'lastAt': _now, 'lastDefects': 5, 'nextAt': _now, 'periodicity': 'раз в квартал', 'overdue': false},
  ],
  'olderThan60': 2,
  'olderThan60Tiyin': 46000000,
  'count': 5,

  // ---- уведомления
  'unread': 1,
  'unreadNotifications': 3,

  // ---- прочее
  'duplicate': null,
  'empty': 'Пока пусто',
  'ok': true,
  'message': 'Готово',
  'accessToken': 'test',
};

class FixtureHttpOverrides extends HttpOverrides {
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
  Future<HttpClientRequest> openUrl(String method, Uri url) async {
    if (responseOffline) throw const SocketException('Connection refused');
    return _FixtureRequest(method, url);
  }

  // flutter_map закрывает свой клиент при удалении слоя тайлов
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

  // Поля, которые выставляет package:http перед отправкой. Их нельзя отдать
  // noSuchMethod: сеттер там всегда бросает, и запрос падал «нет связи» —
  // экран показывал ошибку вместо данных, а тест этого не замечал
  @override
  bool followRedirects = true;
  @override
  int maxRedirects = 5;
  @override
  int contentLength = -1;
  @override
  bool persistentConnection = true;
  @override
  bool bufferOutput = true;
  @override
  Encoding encoding = utf8;

  @override
  Future<HttpClientResponse> close() async => _FixtureResponse();

  @override
  Future<HttpClientResponse> get done async => _FixtureResponse();

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
  final List<int> _body = utf8.encode(jsonEncode(responseBody));

  @override
  int get statusCode => responseStatus;
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
