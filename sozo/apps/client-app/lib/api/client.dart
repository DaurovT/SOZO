import 'dart:convert';
import 'package:http/http.dart' as http;

import '../i18n.dart';

/// Ошибка API в терминах клиента. Сервер всегда отдаёт {code, message}.
class ApiError implements Exception {
  ApiError(this.code, this.message, {this.statusCode});

  final String code;
  final String message;
  final int? statusCode;

  /// Сети нет — экран показывает кеш и баннер, а не пустоту
  bool get isOffline => code == 'OFFLINE';

  /// Сессия истекла — выбрасываем на вход
  bool get isUnauthorized => statusCode == 401;

  @override
  String toString() => message;
}

/// HTTP-клиент приложения «Клиент».
///
/// Базовый адрес меняется на экране входа: localhost для браузера,
/// IP компьютера в Wi-Fi для телефона, домен для прода.
class ApiClient {
  ApiClient({required this.baseUrl, this.token});

  String baseUrl;
  String? token;

  static const timeout = Duration(seconds: 12);

  /// Язык ответа сервера.
  ///
  /// Половина того, что человек читает, приходит с сервера: названия
  /// категорий и работ, статусы заявки, тексты уведомлений, сообщения об
  /// ошибках. Без этого заголовка переключение языка меняло только подписи
  /// самого приложения, а главная оставалась русской при любом выборе —
  /// и выглядело это как «кнопка языка не работает».
  Map<String, String> get _headers => {
        'Content-Type': 'application/json',
        'Accept-Language': l10n.code,
        if (token != null) 'Authorization': 'Bearer $token',
      };

  Uri _uri(String path, [Map<String, String>? query]) => Uri.parse('$baseUrl/v1$path')
      .replace(queryParameters: query?.isEmpty ?? true ? null : query);

  Future<dynamic> get(String path, {Map<String, String>? query}) async {
    try {
      final r = await http.get(_uri(path, query), headers: _headers).timeout(timeout);
      return _decode(r);
    } on ApiError {
      rethrow;
    } catch (e) {
      throw _offline(e);
    }
  }

  Future<dynamic> post(String path, Map<String, dynamic> body) async {
    try {
      final r = await http.post(_uri(path), headers: _headers, body: jsonEncode(body)).timeout(timeout);
      return _decode(r);
    } on ApiError {
      rethrow;
    } catch (e) {
      throw _offline(e);
    }
  }

  Future<dynamic> delete(String path) async {
    try {
      final r = await http.delete(_uri(path), headers: _headers).timeout(timeout);
      return _decode(r);
    } on ApiError {
      rethrow;
    } catch (e) {
      throw _offline(e);
    }
  }

  /// Причина обрыва связи, а не «нет связи с сервером».
  ///
  /// Разница принципиальна при разборе: отказ iOS в доступе к локальной сети,
  /// неверный адрес и выключенный сервер выглядят для пользователя одинаково,
  /// а чинятся по-разному. Адрес в тексте — чтобы было видно, куда стучались.
  ApiError _offline(Object e) {
    final text = e.toString();
    // iOS 14+ спрашивает разрешение на локальную сеть; отказ даёт именно это
    if (text.contains('Operation not permitted') || text.contains('errno = 1')) {
      return ApiError(
        'LOCAL_NETWORK_DENIED',
        'iOS не пускает приложение в локальную сеть.\n'
            'Настройки → SOZO → Локальная сеть — включите доступ.',
      );
    }
    // «Нет маршрута» на iOS означает и смену адреса сервера, и запрет доступа
    // к локальной сети — различить их изнутри приложения нельзя, поэтому
    // называем обе причины, а не выбираем одну наугад
    if (text.contains('No route to host') ||
        text.contains('Network is unreachable') ||
        text.contains('Failed host lookup')) {
      return ApiError(
        'OFFLINE',
        'Сервер $baseUrl недоступен.\n'
            'Либо адрес сервера изменился, либо iOS не пускает приложение '
            'в локальную сеть (Настройки → SOZO → Локальная сеть).',
      );
    }
    if (text.contains('Connection refused')) {
      return ApiError('OFFLINE', 'Сервер $baseUrl не отвечает: проверьте, что он запущен');
    }
    if (text.contains('TimeoutException')) {
      return ApiError('OFFLINE', 'Сервер $baseUrl не ответил за ${timeout.inSeconds} с');
    }
    return ApiError('OFFLINE', 'Нет связи с $baseUrl');
  }

  dynamic _decode(http.Response r) {
    final text = utf8.decode(r.bodyBytes);
    final dynamic body = text.isEmpty ? null : jsonDecode(text);
    if (r.statusCode >= 200 && r.statusCode < 300) return body;
    if (body is Map) {
      // Nest заворачивает объект исключения либо в корень, либо в message
      final inner = body['message'] is Map ? body['message'] as Map : body;
      throw ApiError(
        (inner['code'] ?? body['error'] ?? 'ERROR').toString(),
        (inner['message'] ?? _defaultMessage(r.statusCode)).toString(),
        statusCode: r.statusCode,
      );
    }
    throw ApiError('ERROR', _defaultMessage(r.statusCode), statusCode: r.statusCode);
  }

  String _defaultMessage(int status) => switch (status) {
        401 => 'Сессия истекла — войдите заново',
        403 => 'Действие недоступно',
        404 => 'Не найдено',
        409 => 'Заявка изменилась — обновите экран',
        _ => 'Ошибка сервера ($status)',
      };

  // ---------- Вход (C-02, C-03) ----------

  Future<void> requestOtp(String phone) => post('/auth/request-otp', {'phone': phone});

  Future<String> verify(String phone, String code) async {
    final r = await post('/auth/verify', {'phone': phone, 'code': code}) as Map<String, dynamic>;
    token = r['accessToken'] as String;
    return token!;
  }

  // ---------- Гостевой просмотр (C-01) ----------

  /// Цены «от» по категориям — без токена.
  ///
  /// Единственное, что приложение показывает до входа. Вызвать мастера
  /// гостем нельзя и не будет можно: у заявки обязан быть телефон, иначе
  /// мастеру некуда приехать и некому позвонить о задержке. Но узнать, во
  /// что обойдётся замена смесителя, человек вправе, не отдавая номер, — до
  /// этого экрана цену показывал только лендинг, а в приложении на месте
  /// ответа стояла нерабочая надпись.
  Future<Map<String, dynamic>> publicPrices() async =>
      (await get('/public/prices')) as Map<String, dynamic>;

  // ---------- Профиль и контексты ----------

  Future<Map<String, dynamic>> me() async => (await get('/app/me')) as Map<String, dynamic>;

  Future<Map<String, dynamic>> saveConsents(Map<String, dynamic> body) async =>
      (await post('/app/consents', body)) as Map<String, dynamic>;

  Future<Map<String, dynamic>> updateProfile(Map<String, dynamic> body) async =>
      (await post('/app/profile', body)) as Map<String, dynamic>;

  // ---------- Уведомления ----------

  Future<Map<String, dynamic>> notifications() async =>
      (await get('/app/notifications')) as Map<String, dynamic>;

  Future<void> markNotificationsRead({List<String>? ids}) =>
      post('/app/notifications/read', {'ids': ids});

  // ---------- Каталог и слоты (C-07, C-10) ----------

  Future<Map<String, dynamic>> catalog() async => (await get('/app/catalog')) as Map<String, dynamic>;

  // ---------- Контур «Дом» (C-51…C-53) ----------

  Future<Map<String, dynamic>> myBuilding() async =>
      (await get('/app/my-building')) as Map<String, dynamic>;

  /// C-52. Плитка категорий — общий справочник A-44: житель и инженер обязаны
  /// называть одно и то же одинаково, иначе очередь замечаний не свести.
  Future<List<dynamic>> buildingCategories() async {
    final r = await get('/app/my-building/observation-categories');
    return ((r as Map<String, dynamic>)['categories'] as List?) ?? const [];
  }

  Future<Map<String, dynamic>> reportBuildingProblem({
    required String categoryId,
    required List<String> photos,
    String? zoneKey,
    String? comment,
    String? joinObservationId,
  }) async =>
      (await post('/app/my-building/observations', {
        'categoryId': categoryId,
        'photos': photos,
        if (zoneKey != null && zoneKey.isNotEmpty) 'zoneKey': zoneKey,
        if (comment != null && comment.isNotEmpty) 'comment': comment,
        'joinObservationId': ?joinObservationId,
      })) as Map<String, dynamic>;

  Future<Map<String, dynamic>> myBuildingObservations() async =>
      (await get('/app/my-building/observations')) as Map<String, dynamic>;

  /// C-56. Запросы доступа в моё помещение
  Future<Map<String, dynamic>> myAccessRequests() async =>
      (await get('/app/my-building/access-requests')) as Map<String, dynamic>;

  Future<Map<String, dynamic>> decideAccessRequest(
    String id, {
    required String decision,
    String? reason,
    String? from,
    String? to,
  }) async =>
      (await post('/app/my-building/access-requests/$id/decide', {
        'decision': decision,
        'reason': ?reason,
        'from': ?from,
        'to': ?to,
      })) as Map<String, dynamic>;

  /// C-54. Пропуск гостю: житель выписывает сам, без заявки и мастера
  Future<Map<String, dynamic>> issueGuestPass({
    required String guestName,
    required String validFrom,
    required String validTo,
    String? carPlate,
    String passType = 'guest',
  }) async =>
      (await post('/app/my-building/passes', {
        'guestName': guestName,
        'validFrom': validFrom,
        'validTo': validTo,
        if (carPlate != null && carPlate.isNotEmpty) 'carPlate': carPlate,
        'passType': passType,
      })) as Map<String, dynamic>;

  Future<Map<String, dynamic>> myGuestPasses() async =>
      (await get('/app/my-building/passes')) as Map<String, dynamic>;

  Future<Map<String, dynamic>> revokeGuestPass(String id) async =>
      (await post('/app/my-building/passes/$id/revoke', {})) as Map<String, dynamic>;

  /// C-53. `scope`: upcoming (по умолчанию) или history
  Future<Map<String, dynamic>> buildingShutdowns({String scope = 'upcoming'}) async =>
      (await get('/app/my-building/shutdowns', query: {'scope': scope})) as Map<String, dynamic>;


  /// `items` — «id:кол-во» через запятую: нормо-часы считает сервер,
  /// иначе клиент показал бы окна на час там, где работы на четыре
  Future<Map<String, dynamic>> slots({String? items, int days = 3}) async =>
      (await get('/app/slots', query: {'items': items ?? '', 'days': '$days'})) as Map<String, dynamic>;

  // ---------- Адреса (C-29) ----------

  Future<Map<String, dynamic>> addresses() async => (await get('/app/addresses')) as Map<String, dynamic>;

  Future<Map<String, dynamic>> saveAddress(Map<String, dynamic> body) async =>
      (await post('/app/addresses', body)) as Map<String, dynamic>;

  Future<void> deleteAddress(String id) => delete('/app/addresses/$id');

  /// Перестать предлагать запомненного мастера первым (C-21 → C-30)
  Future<void> forgetFavoriteMaster() => delete('/app/favorite-master');

  // ---------- Заявки ----------

  Future<Map<String, dynamic>> orders({String? filter}) async =>
      (await get('/app/orders', query: {'filter': ?filter})) as Map<String, dynamic>;

  Future<Map<String, dynamic>> order(String id) async =>
      (await get('/app/orders/$id')) as Map<String, dynamic>;

  Future<Map<String, dynamic>> createOrder(Map<String, dynamic> body) async =>
      (await post('/app/orders', body)) as Map<String, dynamic>;

  /// Похожая заявка за последние сутки — предупреждение перед созданием второй
  Future<Map<String, dynamic>> duplicateCheck(String address) async =>
      (await get('/app/orders-duplicate-check', query: {'address': address})) as Map<String, dynamic>;

  Future<Map<String, dynamic>> dictionaries() async =>
      (await get('/app/dictionaries')) as Map<String, dynamic>;

  Future<Map<String, dynamic>> acceptanceCode(String id) async =>
      (await get('/app/orders/$id/acceptance-code')) as Map<String, dynamic>;

  Future<Map<String, dynamic>> cancelPreview(String id) async =>
      (await get('/app/orders/$id/cancel-preview')) as Map<String, dynamic>;

  Future<Map<String, dynamic>> saveAddressDetails(String id, Map<String, dynamic> body) async =>
      (await post('/app/orders/$id/details', body)) as Map<String, dynamic>;

  Future<Map<String, dynamic>> decide(String id, Map<String, dynamic> body) async =>
      (await post('/app/orders/$id/decision', body)) as Map<String, dynamic>;

  Future<Map<String, dynamic>> reschedule(String id, Map<String, dynamic> body) async =>
      (await post('/app/orders/$id/reschedule', body)) as Map<String, dynamic>;

  Future<Map<String, dynamic>> cancelOrder(String id, String reason) async =>
      (await post('/app/orders/$id/cancel', {'reason': reason})) as Map<String, dynamic>;

  Future<Map<String, dynamic>> confirmAcceptance(String id) async =>
      (await post('/app/orders/$id/accept', {})) as Map<String, dynamic>;

  Future<Map<String, dynamic>> pay(String id, String provider, {String? promoCode}) async =>
      (await post('/app/orders/$id/pay', {
        'provider': provider,
        if (promoCode != null && promoCode.isNotEmpty) 'promoCode': promoCode,
      })) as Map<String, dynamic>;

  Future<Map<String, dynamic>> rate(String id, Map<String, dynamic> body) async =>
      (await post('/app/orders/$id/rating', body)) as Map<String, dynamic>;

  Future<Map<String, dynamic>> quickMessage(String id, String text) async =>
      (await post('/app/orders/$id/message', {'text': text})) as Map<String, dynamic>;

  // ---------- Гарантия, споры, жалобы ----------

  Future<Map<String, dynamic>> warranty(String id, Map<String, dynamic> body) async =>
      (await post('/app/orders/$id/warranty', body)) as Map<String, dynamic>;

  Future<Map<String, dynamic>> dispute(String id, Map<String, dynamic> body) async =>
      (await post('/app/orders/$id/dispute', body)) as Map<String, dynamic>;

  Future<Map<String, dynamic>> complaints() async => (await get('/app/complaints')) as Map<String, dynamic>;

  Future<Map<String, dynamic>> fileComplaint(Map<String, dynamic> body) async =>
      (await post('/app/complaints', body)) as Map<String, dynamic>;

  // ---------- Промокод (C-13) ----------

  /// Кошелёк промокодов: сохранённые коды и приветственный, если он положен
  Future<Map<String, dynamic>> promos() async => (await get('/app/promos')) as Map<String, dynamic>;

  Future<Map<String, dynamic>> addPromo(String code) async =>
      (await post('/app/promos', {'code': code})) as Map<String, dynamic>;

  Future<void> removePromo(String code) => delete('/app/promos/$code');

  Future<Map<String, dynamic>> checkPromo(String code) async =>
      (await post('/app/promo/check', {'code': code})) as Map<String, dynamic>;

  // ---------- B2B: точка, утверждения, организация ----------

  Future<Map<String, dynamic>> site(String locationId, {String? filter}) async =>
      (await get('/app/b2b/site/$locationId', query: {'filter': ?filter})) as Map<String, dynamic>;

  Future<Map<String, dynamic>> reportIssue(String locationId, Map<String, dynamic> body) async =>
      (await post('/app/b2b/site/$locationId/report', body)) as Map<String, dynamic>;

  /// Вызвать аварийную бригаду: заявка + отсчёт срока по договору (ТЗ 18 п.2)
  Future<Map<String, dynamic>> callEmergency(String locationId, String kind) async =>
      (await post('/app/b2b/site/$locationId/emergency', {'kind': kind})) as Map<String, dynamic>;

  Future<Map<String, dynamic>> emergencyGuide(String locationId) async =>
      (await get('/app/b2b/site/$locationId/emergency')) as Map<String, dynamic>;

  Future<Map<String, dynamic>> siteDebt(String locationId) async =>
      (await get('/app/b2b/site/$locationId/debt')) as Map<String, dynamic>;

  Future<Map<String, dynamic>> siteLimits(String locationId) async =>
      (await get('/app/b2b/site/$locationId/limits')) as Map<String, dynamic>;

  Future<Map<String, dynamic>> acceptanceInfo(String orderId) async =>
      (await get('/app/b2b/orders/$orderId/acceptance')) as Map<String, dynamic>;

  Future<Map<String, dynamic>> siteAccept(String orderId, Map<String, dynamic> body) async =>
      (await post('/app/b2b/orders/$orderId/acceptance', body)) as Map<String, dynamic>;

  Future<Map<String, dynamic>> approvals() async =>
      (await get('/app/b2b/approvals')) as Map<String, dynamic>;

  Future<Map<String, dynamic>> decideApproval(String orderId, Map<String, dynamic> body) async =>
      (await post('/app/b2b/approvals/$orderId', body)) as Map<String, dynamic>;

  Future<Map<String, dynamic>> reports({String? locationId}) async =>
      (await get('/app/b2b/reports', query: {'locationId': ?locationId})) as Map<String, dynamic>;

  Future<Map<String, dynamic>> orgDashboard(String orgId) async =>
      (await get('/app/b2b/org/$orgId')) as Map<String, dynamic>;

  Future<Map<String, dynamic>> orgFinance(String orgId) async =>
      (await get('/app/b2b/org/$orgId/finance')) as Map<String, dynamic>;

  Future<Map<String, dynamic>> orgUsers(String orgId) async =>
      (await get('/app/b2b/org/$orgId/users')) as Map<String, dynamic>;

  /// Команда и приглашения: код для того, чьего номера под рукой нет
  Future<Map<String, dynamic>> team() async => (await get('/app/b2b/team')) as Map<String, dynamic>;

  Future<Map<String, dynamic>> issueInvite(Map<String, dynamic> body) async =>
      (await post('/app/b2b/team/invites', body)) as Map<String, dynamic>;

  Future<Map<String, dynamic>> revokeInvite(String id) async =>
      (await post('/app/b2b/team/invites/$id/revoke', {})) as Map<String, dynamic>;

  Future<Map<String, dynamic>> acceptInvite(String code) async =>
      (await post('/app/invites/accept', {'code': code})) as Map<String, dynamic>;

  /// F-52: руководитель заводит человека на свою точку сам, без звонка в SOZO
  Future<Map<String, dynamic>> addSiteUser(String locationId, Map<String, dynamic> body) async =>
      (await post('/app/b2b/site/$locationId/users', body)) as Map<String, dynamic>;

  Future<Map<String, dynamic>> updateSiteUser(String locationId, String repId, Map<String, dynamic> body) async =>
      (await post('/app/b2b/site/$locationId/users/$repId', body)) as Map<String, dynamic>;

  Future<void> removeSiteUser(String locationId, String repId) => delete('/app/b2b/site/$locationId/users/$repId');

  Future<Map<String, dynamic>> points() async => (await get('/app/b2b/points')) as Map<String, dynamic>;

  // ---------- Фаза 2 ----------

  /// C-28: техника клиента, заведённая мастером на объекте
  Future<Map<String, dynamic>> equipment() async => (await get('/app/equipment')) as Map<String, dynamic>;

  /// C-42: акты осмотра с пакетами дефектов
  Future<Map<String, dynamic>> acts() async => (await get('/app/b2b/acts')) as Map<String, dynamic>;

  Future<Map<String, dynamic>> decideAct(String actId, Map<String, dynamic> body) async =>
      (await post('/app/b2b/acts/$actId/decide', body)) as Map<String, dynamic>;

  /// C-43: техдолг в разрезе точек организации
  Future<Map<String, dynamic>> orgDebt(String orgId) async =>
      (await get('/app/b2b/org/$orgId/debt')) as Map<String, dynamic>;

  /// C-46: график плановых осмотров
  Future<Map<String, dynamic>> inspections(String orgId) async =>
      (await get('/app/b2b/org/$orgId/inspections')) as Map<String, dynamic>;

  // ---------- Демо-наполнение ----------

  /// Заполняет аккаунт данными для показа: без них половина экранов недостижима
  Future<Map<String, dynamic>> seedDemo() async =>
      (await post('/app/demo/seed', {})) as Map<String, dynamic>;

  /// Клиент правит карточку своей техники: шильдик мог быть нечитаемым
  Future<Map<String, dynamic>> updateEquipment(String id, Map<String, dynamic> body) async =>
      (await post('/app/equipment/$id', body)) as Map<String, dynamic>;

  /// Обслуживаем ли адрес: подсказка на шаге «где», а не отмена заявки потом
  Future<Map<String, dynamic>> addressCheck(String address) async =>
      (await get('/app/address-check', query: {'address': address})) as Map<String, dynamic>;

  // ---------- Способы оплаты и история платежей ----------

  /// Чем можно платить и чем человек платит обычно. Сохранённых карт нет:
  /// их токен выдаёт мерчант, а его пока не подключили
  Future<Map<String, dynamic>> paymentMethods() async =>
      (await get('/app/payment-methods')) as Map<String, dynamic>;

  Future<Map<String, dynamic>> setPaymentMethod(String? provider) async =>
      (await post('/app/payment-methods', {'provider': provider})) as Map<String, dynamic>;

  Future<Map<String, dynamic>> payments() async => (await get('/app/payments')) as Map<String, dynamic>;

  // ---------- Документы (F-31, F-51, F-54) ----------

  /// Ссылка на печатную форму: акт, отчёт по точке, журнал ТО, сверку, счёт.
  ///
  /// Токен идёт в адресе, а не в заголовке: ссылку открывает браузер, а он
  /// заголовков не поставит. Сервер проверяет не только подпись токена, но и
  /// то, что документ действительно ваш.
  String documentUrl(String path) => '$baseUrl/v1$path?token=${Uri.encodeQueryComponent(token ?? '')}';

  // ---------- Телеметрия (DEV-08 §5) ----------

  /// Событие воронки. Ошибки глотаются намеренно: телеметрия отправляется
  /// «в фоне» и не должна ни падать в лицо пользователю, ни ронять экран,
  /// когда сети нет. Потеря события дешевле сломанного экрана.
  Future<void> track(String event, [Map<String, dynamic>? params]) async {
    try {
      await post('/app/telemetry', {'event': event, 'params': params ?? {}});
    } catch (_) {
      // молча
    }
  }
}
