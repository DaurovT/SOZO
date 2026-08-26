import 'dart:convert';
import 'package:http/http.dart' as http;

import '../i18n.dart';

/// Ошибка API в терминах клиента. Сервер всегда отдаёт {code, message}.
class ApiError implements Exception {
  ApiError(this.code, this.message, {this.statusCode, this.debug});

  final String code;

  /// Строка для человека. На экран попадает только она
  final String message;
  final int? statusCode;

  /// Техническая причина: адрес стенда, текст исключения, номер кода ответа.
  /// В интерфейс не выводится никогда — только в лог и в отчёт об ошибке
  final String? debug;

  /// Сети нет — экран показывает кеш и баннер, а не пустоту
  bool get isOffline => code == 'OFFLINE';

  /// Сессия истекла — выбрасываем на вход
  bool get isUnauthorized => statusCode == 401;

  @override
  String toString() => debug == null ? message : '$message [$debug]';

  /// Локальная сеть закрыта настройками телефона — единственный случай,
  /// когда экрану есть смысл предложить правку адреса стенда
  bool get isLocalNetworkDenied => code == 'LOCAL_NETWORK_DENIED';
}

/// Текст любого сбоя для экрана.
///
/// `'$e'` в интерфейсе — это как раз то, из-за чего человек видел
/// «SocketException: Connection refused (OS Error…), address = 192.168.0.10».
/// Через эту функцию наружу выходит либо строка сервера, либо одна общая
/// фраза, а техническая часть остаётся в логе.
String humanError(Object e) => e is ApiError ? e.message : t('error.unknown');

/// HTTP-клиент приложения «Клиент».
///
/// Базовый адрес меняется на экране входа: localhost для браузера,
/// IP компьютера в Wi-Fi для телефона, домен для прода.
class ApiClient {
  ApiClient({required this.baseUrl, this.token});

  String baseUrl;
  String? token;

  /// Сессия протухла: сервер ответил 401 на запрос с токеном.
  ///
  /// Раньше это обрабатывалось на одном экране — выборе контекста. На всех
  /// остальных 401 попадал в общий обработчик `AsyncView` и рисовал кнопку
  /// «Повторить», которая обречена падать всегда. Выйти можно было только из
  /// профиля, а профиль сам не грузился по той же причине: приложение
  /// запиралось насмерть, и лечилось переустановкой.
  ///
  /// Ставит `Session`, дёргает `_decode` — из любого запроса приложения.
  void Function()? onUnauthorized;

  static const timeout = Duration(seconds: 12);

  /// Язык ответа сервера.
  ///
  /// Половина того, что человек читает, приходит с сервера: названия
  /// категорий и работ, статусы заявки, тексты уведомлений, сообщения об
  /// ошибках. Без этого заголовка переключение языка меняло только подписи
  /// самого приложения, а главная оставалась русской при любом выборе —
  /// и выглядело это как «кнопка языка не работает».
  Map<String, String> get _headers => _headersWith(null);

  /// `authToken` перекрывает токен сессии для одного запроса.
  ///
  /// Нужен ровно на входе: между проверкой кода и записью согласий приложение
  /// обязано ходить авторизованным, но сессии ещё нет — человек не нажал
  /// «Войти». Раньше `verify` присваивал токен живому клиенту, и в этом
  /// промежутке `session.signedIn` уже отвечал «да», хотя ни сохранения, ни
  /// уведомления подписчиков не было. Комментарий в экране входа обещал
  /// обратное — теперь обещание выполняется.
  Map<String, String> _headersWith(String? authToken) {
    final bearer = authToken ?? token;
    return {
      'Content-Type': 'application/json',
      'Accept-Language': l10n.code,
      if (bearer != null) 'Authorization': 'Bearer $bearer',
    };
  }

  Uri _uri(String path, [Map<String, String>? query]) => Uri.parse('$baseUrl/v1$path')
      .replace(queryParameters: query?.isEmpty ?? true ? null : query);

  Future<dynamic> get(String path, {Map<String, String>? query, String? authToken}) async {
    try {
      final r = await http.get(_uri(path, query), headers: _headersWith(authToken)).timeout(timeout);
      return _decode(r);
    } on ApiError {
      rethrow;
    } catch (e) {
      throw _offline(e);
    }
  }

  /// `idempotencyKey` уходит заголовком `Idempotency-Key`: повтор того же
  /// запроса после таймаута обязан вернуть уже созданную запись, а не завести
  /// вторую. `timeout` перекрывается там, где тело заведомо тяжёлое — заявка
  /// с пятью фотографиями в base64 не укладывается в двенадцать секунд на
  /// мобильном интернете, и общий таймаут превращал её в бесконечный повтор.
  Future<dynamic> post(
    String path,
    Map<String, dynamic> body, {
    String? idempotencyKey,
    Duration? timeout,
    String? authToken,
  }) async {
    try {
      final r = await http
          .post(
            _uri(path),
            headers: {
              ..._headersWith(authToken),
              'Idempotency-Key': ?idempotencyKey,
            },
            body: jsonEncode(body),
          )
          .timeout(timeout ?? ApiClient.timeout);
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

  /// Обрыв связи. Человеку — одна строка, разработчику — причина в `debug`.
  ///
  /// Раньше причина стояла в тексте на экране: «iOS не пускает приложение в
  /// локальную сеть. Настройки → SOZO → Локальная сеть», «Сервер
  /// http://192.168.0.10:3000 не ответил за 12 с». В отладке это экономит час,
  /// в проде — читается как поломка приложения и адрес чужого компьютера
  /// посреди экрана. Для человека все эти случаи означают ровно одно: связи
  /// нет, попробуйте Wi-Fi или мобильные данные, а если срочно — позвоните.
  ///
  /// Код различаем по-прежнему: `LOCAL_NETWORK_DENIED` показывает экрану, что
  /// дело в доступе к локальной сети, и там за долгим нажатием откроется
  /// правка адреса стенда.
  ApiError _offline(Object e) {
    final text = e.toString();
    final human = t('error.offline');
    // iOS 14+ спрашивает разрешение на локальную сеть; отказ даёт именно это
    if (text.contains('Operation not permitted') || text.contains('errno = 1')) {
      return ApiError('LOCAL_NETWORK_DENIED', human, debug: 'local network denied: $text');
    }
    // «Нет маршрута» на iOS означает и смену адреса сервера, и запрет доступа
    // к локальной сети — различить их изнутри приложения нельзя
    if (text.contains('No route to host') ||
        text.contains('Network is unreachable') ||
        text.contains('Failed host lookup')) {
      return ApiError('OFFLINE', human, debug: 'no route to $baseUrl: $text');
    }
    if (text.contains('Connection refused')) {
      return ApiError('OFFLINE', human, debug: 'connection refused: $baseUrl');
    }
    if (text.contains('TimeoutException')) {
      return ApiError('OFFLINE', human, debug: '$baseUrl timed out after ${timeout.inSeconds}s');
    }
    return ApiError('OFFLINE', human, debug: '$baseUrl: $text');
  }

  dynamic _decode(http.Response r) {
    final text = utf8.decode(r.bodyBytes);
    final dynamic body = text.isEmpty ? null : jsonDecode(text);
    if (r.statusCode >= 200 && r.statusCode < 300) return body;
    // Только если токен был: 401 на проверке кода — это «код неверный»,
    // а не «сессия истекла», и выбрасывать оттуда некуда, человек и так на входе
    if (r.statusCode == 401 && token != null) onUnauthorized?.call();
    if (body is Map) {
      // Nest заворачивает объект исключения либо в корень, либо в message
      final inner = body['message'] is Map ? body['message'] as Map : body;
      throw ApiError(
        (inner['code'] ?? body['error'] ?? 'ERROR').toString(),
        (inner['message'] ?? _defaultMessage(r.statusCode)).toString(),
        statusCode: r.statusCode,
        debug: 'HTTP ${r.statusCode} $baseUrl',
      );
    }
    throw ApiError('ERROR', _defaultMessage(r.statusCode),
        statusCode: r.statusCode, debug: 'HTTP ${r.statusCode} $baseUrl');
  }

  /// Ответ без своего текста. Номер кода в строку не выносим: «Ошибка сервера
  /// (500)» человеку ничего не сообщает и ничего ему не предлагает — он
  /// остаётся в `debug` и в логе
  String _defaultMessage(int status) => switch (status) {
        401 => t('error.signedOut'),
        403 => t('error.forbidden'),
        404 => t('error.notFound'),
        409 => t('error.conflict'),
        _ => t('error.server'),
      };

  // ---------- Вход (C-02, C-03) ----------

  Future<void> requestOtp(String phone) => post('/auth/request-otp', {'phone': phone});

  /// Проверка кода. Токен **возвращается, но не присваивается**: сессию
  /// фиксирует экран входа после согласий, через `Session.signIn`.
  /// До этого момента приложение не считается вошедшим — и не притворяется им.
  Future<String> verify(String phone, String code) async {
    final r = await post('/auth/verify', {'phone': phone, 'code': code}) as Map<String, dynamic>;
    return r['accessToken'] as String;
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

  Future<Map<String, dynamic>> me({String? authToken}) async =>
      (await get('/app/me', authToken: authToken)) as Map<String, dynamic>;

  /// Регистрация устройства для push (ТЗ §11).
  ///
  /// Зовётся при каждом старте с живой сессией, а не только после входа:
  /// токен меняет сам поставщик, и молчаливая смена означает, что
  /// уведомления просто перестанут приходить.
  Future<Map<String, dynamic>> registerDevice({
    required String token,
    required String app,
    required String platform,
  }) async =>
      (await post('/devices', {'token': token, 'app': app, 'platform': platform})) as Map<String, dynamic>;

  /// Снятие устройства при выходе — чтобы чужие заявки не приходили на аппарат
  Future<Map<String, dynamic>> revokeDevice(String token) async =>
      (await post('/devices/revoke', {'token': token})) as Map<String, dynamic>;

  Future<Map<String, dynamic>> saveConsents(Map<String, dynamic> body, {String? authToken}) async =>
      (await post('/app/consents', body, authToken: authToken)) as Map<String, dynamic>;

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

  /// Создание заявки. Тело тяжёлое (фотографии в base64), поэтому свой
  /// таймаут; ключ идемпотентности живёт в черновике и переживает повтор
  static const createTimeout = Duration(seconds: 45);

  Future<Map<String, dynamic>> createOrder(Map<String, dynamic> body, {String? idempotencyKey}) async =>
      (await post('/app/orders', body, idempotencyKey: idempotencyKey, timeout: createTimeout))
          as Map<String, dynamic>;

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
