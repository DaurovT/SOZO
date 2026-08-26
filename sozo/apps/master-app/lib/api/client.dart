import 'dart:async';
import 'dart:convert';
import 'package:http/http.dart' as http;
import '../i18n.dart';

/// Ошибка API в терминах, понятных мастеру. Сервер всегда отдаёт {code, message}.
class ApiError implements Exception {
  ApiError(this.code, this.message, {this.statusCode, this.payload});

  final String code;
  final String message;
  final int? statusCode;

  /// Тело ответа целиком. Сервер отдаёт не только code и message: у отказа
  /// завершить ТО в теле лежит перечень незакрытых пунктов, и экран обязан
  /// показать именно его, а не общую фразу. Раньше всё сверх двух полей
  /// терялось на разборе.
  final Map<String, dynamic>? payload;

  /// Сеть недоступна — операция уходит в офлайн-очередь, а не теряется.
  /// Таймаут сюда же: для мастера это тот же случай — связь есть, но её нет
  bool get isOffline => code == 'OFFLINE' || code == 'TIMEOUT';

  /// Конфликт версий: кто-то изменил заявку параллельно — надо перечитать
  bool get isVersionConflict => code == 'VERSION_CONFLICT';

  /// Ответ не от приложения: шлюз отдал HTML (502/504 nginx), а не JSON.
  /// Раньше это неотличимо сливалось с офлайном — операция уезжала в очередь,
  /// «будто сети нет», и мастер не понимал, почему она там висит
  bool get isGateway => code == 'GATEWAY';

  /// Данные нельзя терять: связь, шлюз, серверная ошибка или протухшая сессия.
  /// Во всех четырёх случаях операция обязана лечь в очередь, а не исчезнуть
  /// вместе с тостом. Разница только в тексте, который увидит мастер
  bool get keepsData => isOffline || isGateway || statusCode == 401 || (statusCode ?? 0) >= 500;

  @override
  String toString() => message;
}

/// HTTP-клиент API мастера. Базовый адрес меняется на экране входа:
/// localhost для браузера, IP компьютера в Wi-Fi для телефона, домен для прода.
class ApiClient {
  ApiClient({required this.baseUrl, this.token});

  String baseUrl;
  String? token;

  /// Обычный запрос. Двенадцать секунд — предел терпения на объекте
  static const timeout = Duration(seconds: 12);

  /// Выгрузка очереди и снимков: тот же предел означал гарантированный
  /// таймаут на фотографии в 0,5–1 МБ через мобильный интернет в подвале
  static const uploadTimeout = Duration(seconds: 60);

  /// Сессия протухла. Сообщаем сессии, а не разбираем 401 в каждом экране:
  /// до этого единственная обработка жила в `refreshProfile`, и на действии
  /// по заявке мастер получал «Сессия истекла» без выхода и без сохранения
  void Function()? onUnauthorized;

  Map<String, String> get _headers => {
    'Content-Type': 'application/json',
    if (token != null) 'Authorization': 'Bearer $token',
    // Половина того, что мастер читает, приходит с сервера: причины отказа,
    // вопросы экзамена, тексты ошибок. Без этого заголовка интерфейс был бы
    // узбекским, а всё между кнопками — русским.
    'Accept-Language': l10n.code,
  };

  Uri _uri(String path, [Map<String, String>? query]) =>
      Uri.parse('$baseUrl/v1$path').replace(queryParameters: query?.isEmpty ?? true ? null : query);

  Future<dynamic> get(String path, {Map<String, String>? query, Duration? deadline}) async {
    try {
      final r = await http.get(_uri(path, query), headers: _headers).timeout(deadline ?? timeout);
      return _decode(r);
    } on ApiError {
      rethrow;
    } on TimeoutException {
      throw ApiError('TIMEOUT', t('net.serverNeOtvetil'));
    } catch (_) {
      throw ApiError('OFFLINE', t('net.netSvyaziSServerom'));
    }
  }

  Future<dynamic> post(String path, Map<String, dynamic> body, {Duration? deadline}) async {
    try {
      final r = await http.post(_uri(path), headers: _headers, body: jsonEncode(body)).timeout(deadline ?? timeout);
      return _decode(r);
    } on ApiError {
      rethrow;
    } on TimeoutException {
      throw ApiError('TIMEOUT', t('net.serverNeOtvetil'));
    } catch (_) {
      throw ApiError('OFFLINE', t('net.netSvyaziSServerom'));
    }
  }

  dynamic _decode(http.Response r) {
    final text = utf8.decode(r.bodyBytes);
    dynamic body;
    try {
      body = text.isEmpty ? null : jsonDecode(text);
    } on FormatException {
      // Шлюз ответил своей страницей: nginx на 502/504 отдаёт HTML.
      // Раньше разбор падал, ошибку ловил общий catch — и приложение
      // объявляло офлайн при работающей сети, пряча аварию сервера
      throw ApiError('GATEWAY', t('net.serverNeOtvetil'), statusCode: r.statusCode);
    }
    if (r.statusCode == 401 && token != null) onUnauthorized?.call();
    if (r.statusCode >= 200 && r.statusCode < 300) return body;
    if (body is Map) {
      // Nest заворачивает объект исключения либо в корень, либо в message
      final inner = body['message'] is Map ? body['message'] as Map : body;
      throw ApiError(
        (inner['code'] ?? body['error'] ?? 'ERROR').toString(),
        (inner['message'] ?? _defaultMessage(r.statusCode)).toString(),
        statusCode: r.statusCode,
        payload: Map<String, dynamic>.from(inner),
      );
    }
    throw ApiError('ERROR', _defaultMessage(r.statusCode), statusCode: r.statusCode);
  }

  String _defaultMessage(int status) => switch (status) {
    401 => t('net.sessiyaIsteklaVoyditeZanovo'),
    403 => t('net.deystvieNedostupno'),
    404 => t('net.neNaydeno'),
    409 => t('net.zayavkaIzmenilasObnoviteEkran'),
    _ => t('net.oshibkaServera', {'p1': status}),
  };

  // ---------- Аутентификация ----------

  Future<void> requestOtp(String phone) => post('/auth/request-otp', {'phone': phone});

  Future<String> verify(String phone, String code) async {
    final r = await post('/auth/verify', {'phone': phone, 'code': code}) as Map<String, dynamic>;
    token = r['accessToken'] as String;
    return token!;
  }

  // ---------- Мастер ----------

  Future<Map<String, dynamic>> me() async => (await get('/master/me')) as Map<String, dynamic>;

  /// Регистрация устройства для push (ТЗ §11, PRD-02 §5).
  ///
  /// Зовётся при каждом старте с живой сессией, а не только после входа:
  /// токен меняет сам поставщик, и молчаливая смена означает пропущенный
  /// оффер — то есть заявку, ушедшую другому мастеру.
  Future<Map<String, dynamic>> registerDevice({
    required String token,
    required String app,
    required String platform,
  }) async =>
      (await post('/devices', {'token': token, 'app': app, 'platform': platform})) as Map<String, dynamic>;

  /// Снятие устройства при выходе — чтобы офферы не приходили тому, кто вышел
  Future<Map<String, dynamic>> revokeDevice(String token) async =>
      (await post('/devices/revoke', {'token': token})) as Map<String, dynamic>;

  Future<Map<String, dynamic>> today({String? date}) async =>
      (await get('/master/today', query: {'date': ?date})) as Map<String, dynamic>;

  Future<Map<String, dynamic>> setShift(bool online, {double? lat, double? lng}) async =>
      (await post('/master/shift', {'online': online, 'lat': ?lat, 'lng': ?lng})) as Map<String, dynamic>;

  Future<Map<String, dynamic>> offers() async => (await get('/master/offers')) as Map<String, dynamic>;

  Future<Map<String, dynamic>> acceptOffer(String id, {double? lat, double? lng}) async =>
      (await post('/master/offers/$id/accept', {'lat': ?lat, 'lng': ?lng})) as Map<String, dynamic>;

  Future<void> declineOffer(String id, String reason) => post('/master/offers/$id/decline', {'reason': reason});

  Future<Map<String, dynamic>> orders({String? scope}) async =>
      (await get('/master/orders', query: {'scope': ?scope})) as Map<String, dynamic>;

  Future<Map<String, dynamic>> order(String id) async => (await get('/master/orders/$id')) as Map<String, dynamic>;

  Future<Map<String, dynamic>> act(String orderId, Map<String, dynamic> body) async =>
      (await post('/master/orders/$orderId/actions', body)) as Map<String, dynamic>;

  /// Снимок идёт с долгим дедлайном: 0,5–1 МБ base64 через мобильный
  /// интернет в подвале за двенадцать секунд не уходят никогда
  Future<Map<String, dynamic>> uploadPhoto(String orderId, Map<String, dynamic> body) async =>
      (await post('/master/orders/$orderId/photos', body, deadline: uploadTimeout)) as Map<String, dynamic>;

  Future<Map<String, dynamic>> sendQuote(String orderId, Map<String, dynamic> body) async =>
      (await post('/master/orders/$orderId/quote', body)) as Map<String, dynamic>;

  Future<Map<String, dynamic>> addMaterial(String orderId, Map<String, dynamic> body) async =>
      (await post('/master/orders/$orderId/materials', body)) as Map<String, dynamic>;

  Future<Map<String, dynamic>> fixAcceptance(String orderId, Map<String, dynamic> body) async =>
      (await post('/master/orders/$orderId/acceptance', body)) as Map<String, dynamic>;

  Future<Map<String, dynamic>> earnings() async => (await get('/master/earnings')) as Map<String, dynamic>;

  Future<Map<String, dynamic>> catalog() async => (await get('/master/catalog')) as Map<String, dynamic>;

  Future<Map<String, dynamic>> sync(List<Map<String, dynamic>> ops) async =>
      (await post('/master/sync', {'ops': ops}, deadline: uploadTimeout)) as Map<String, dynamic>;

  /// Сколько действий ещё ждёт отправки — метрика мониторинга: на сервере
  /// такое не посчитать, очередь копится ровно тогда, когда связи нет
  Future<void> reportQueue({required int depth, String? oldestAt}) async {
    await post('/master/sync/queue', {'depth': depth, 'oldestAt': oldestAt});
  }

  // ---------- Ресурсы и репутация (M-22, M-36, M-37, M-38, F-44, F-50, F-54) ----------

  Future<Map<String, dynamic>> appConfig(String version) async =>
      (await get('/master/app-config', query: {'version': version})) as Map<String, dynamic>;

  Future<Map<String, dynamic>> stock() async => (await get('/master/stock')) as Map<String, dynamic>;

  Future<Map<String, dynamic>> refillStock(Map<String, dynamic> body) async =>
      (await post('/master/stock/refill', body)) as Map<String, dynamic>;

  Future<Map<String, dynamic>> purchaseCodes(String orderId) async =>
      (await get('/master/orders/$orderId/purchase-code')) as Map<String, dynamic>;

  Future<Map<String, dynamic>> issuePurchaseCode(String orderId) async =>
      (await post('/master/orders/$orderId/purchase-code', {})) as Map<String, dynamic>;

  Future<Map<String, dynamic>> attachInvoice(String orderId, String codeId, Map<String, dynamic> body) async =>
      (await post('/master/orders/$orderId/purchase-code/$codeId/invoice', body)) as Map<String, dynamic>;

  Future<Map<String, dynamic>> equipmentFull() async => (await get('/master/equipment/full')) as Map<String, dynamic>;

  Future<Map<String, dynamic>> equipmentAct(String equipmentId, Map<String, dynamic> body) async =>
      (await post('/master/equipment/$equipmentId/act', body)) as Map<String, dynamic>;

  Future<Map<String, dynamic>> confirmAct(String actId, String code) async =>
      (await post('/master/equipment/acts/$actId/confirm', {'code': code})) as Map<String, dynamic>;

  Future<Map<String, dynamic>> replacementProof(String orderId, Map<String, dynamic> body) async =>
      (await post('/master/orders/$orderId/replacement-proof', body)) as Map<String, dynamic>;

  Future<Map<String, dynamic>> inspection(String orderId) async =>
      (await get('/master/orders/$orderId/inspection')) as Map<String, dynamic>;

  Future<Map<String, dynamic>> addDefect(String orderId, Map<String, dynamic> body) async =>
      (await post('/master/orders/$orderId/inspection/defect', body)) as Map<String, dynamic>;

  Future<Map<String, dynamic>> ratingBreakdown() async => (await get('/master/rating')) as Map<String, dynamic>;

  Future<Map<String, dynamic>> fileAppeal(Map<String, dynamic> body) async =>
      (await post('/master/appeals', body)) as Map<String, dynamic>;

  Future<Map<String, dynamic>> tips() async => (await get('/master/tips')) as Map<String, dynamic>;

  Future<Map<String, dynamic>> requestSkill(String skill) async =>
      (await post('/master/skill-request', {'skill': skill})) as Map<String, dynamic>;

  // ---------- Уведомления (PRD-02 §7) ----------

  Future<Map<String, dynamic>> notifications() async => (await get('/master/notifications')) as Map<String, dynamic>;

  Future<Map<String, dynamic>> markNotificationsRead({String? id}) async =>
      (await post('/master/notifications/read', {'id': ?id})) as Map<String, dynamic>;

  // Онбординг из приложения убран: мастера регистрирует и допускает к
  // заявкам админ, а приложение показывает только причину отказа в доступе.
  // Серверные эндпоинты /master/onboarding/* остались — ими пользуется
  // админка, и по ним же вернётся воронка, когда она понадобится.

  // ---------- Ветки конвейера (M-12…M-32) ----------

  Future<Map<String, dynamic>> dictionaries() async => (await get('/master/dictionaries')) as Map<String, dynamic>;

  Future<Map<String, dynamic>> tomorrow() async => (await get('/master/tomorrow')) as Map<String, dynamic>;

  Future<Map<String, dynamic>> delay(String orderId, int minutes) async =>
      (await post('/master/orders/$orderId/delay', {'minutes': minutes})) as Map<String, dynamic>;

  Future<Map<String, dynamic>> noAccess(String orderId, Map<String, dynamic> body) async =>
      (await post('/master/orders/$orderId/no-access', body)) as Map<String, dynamic>;

  Future<Map<String, dynamic>> clientUnavailable(String orderId, Map<String, dynamic> body) async =>
      (await post('/master/orders/$orderId/client-unavailable', body)) as Map<String, dynamic>;

  Future<Map<String, dynamic>> abortUnsafe(String orderId, Map<String, dynamic> body) async =>
      (await post('/master/orders/$orderId/abort-unsafe', body)) as Map<String, dynamic>;

  Future<Map<String, dynamic>> cantGo(String orderId, Map<String, dynamic> body) async =>
      (await post('/master/orders/$orderId/cant-go', body)) as Map<String, dynamic>;

  Future<Map<String, dynamic>> sendSpareTiers(String orderId, Map<String, dynamic> body) async =>
      (await post('/master/orders/$orderId/spare-tiers', body)) as Map<String, dynamic>;

  /// Отметить запчасть купленной. Обычно отметка ставится сама — когда мастер
  /// вносит материал в заявку; эта кнопка для случая «купил заранее»
  Future<void> markPartBought(String tierId) => post('/master/procurement/$tierId/bought', {});

  Future<Map<String, dynamic>> spareTiers(String orderId) async =>
      (await get('/master/orders/$orderId/spare-tiers')) as Map<String, dynamic>;

  Future<Map<String, dynamic>> sendAddwork(String orderId, Map<String, dynamic> body) async =>
      (await post('/master/orders/$orderId/addwork', body)) as Map<String, dynamic>;

  Future<Map<String, dynamic>> addworkStatus(String orderId) async =>
      (await get('/master/orders/$orderId/addwork')) as Map<String, dynamic>;

  Future<Map<String, dynamic>> conservation(String orderId, String photoDataUrl) async =>
      (await post('/master/orders/$orderId/conservation', {'photoDataUrl': photoDataUrl})) as Map<String, dynamic>;

  Future<Map<String, dynamic>> recommend(String orderId, Map<String, dynamic> body) async =>
      (await post('/master/orders/$orderId/recommendation', body)) as Map<String, dynamic>;

  Future<Map<String, dynamic>> recommendations() async =>
      (await get('/master/recommendations')) as Map<String, dynamic>;

  Future<Map<String, dynamic>> shoppingList(String orderId, Map<String, dynamic> body) async =>
      (await post('/master/orders/$orderId/shopping-list', body)) as Map<String, dynamic>;

  Future<Map<String, dynamic>> assets(String orderId) async =>
      (await get('/master/orders/$orderId/assets')) as Map<String, dynamic>;

  Future<Map<String, dynamic>> addAsset(String orderId, Map<String, dynamic> body) async =>
      (await post('/master/orders/$orderId/assets', body)) as Map<String, dynamic>;

  Future<Map<String, dynamic>> stages(String orderId) async =>
      (await get('/master/orders/$orderId/stages')) as Map<String, dynamic>;

  Future<Map<String, dynamic>> planStages(String orderId, Map<String, dynamic> body) async =>
      (await post('/master/orders/$orderId/stages', body)) as Map<String, dynamic>;

  Future<Map<String, dynamic>> completeStage(String orderId, int index, String photoDataUrl) async =>
      (await post('/master/orders/$orderId/stages/$index/complete', {'photoDataUrl': photoDataUrl}))
          as Map<String, dynamic>;

  Future<Map<String, dynamic>> helperRequest(String orderId, String duration) async =>
      (await post('/master/orders/$orderId/helper-request', {'duration': duration})) as Map<String, dynamic>;

  Future<Map<String, dynamic>> helperConfirm(String orderId) async =>
      (await post('/master/orders/$orderId/helper-confirm', {})) as Map<String, dynamic>;

  Future<Map<String, dynamic>> payment(String orderId, String method) async =>
      (await post('/master/orders/$orderId/payment', {'method': method})) as Map<String, dynamic>;

  // ---------- Деньги, график, профиль ----------

  Future<Map<String, dynamic>> wallet({String period = 'week'}) async =>
      (await get('/master/wallet', query: {'period': period})) as Map<String, dynamic>;

  // ---------- M-47 «Плановое ТО» ----------

  /// План ТО по объекту: оборудование, регламенты, сроки, последние работы.
  /// Кешируется целиком — ИТП и щитовая стоят там, где связи нет.
  Future<Map<String, dynamic>> maintenancePlan(String buildingId) async =>
      (await get('/master/buildings/$buildingId/maintenance')) as Map<String, dynamic>;

  Future<Map<String, dynamic>> startMaintenance(String equipmentId) async =>
      (await post('/master/equipment/$equipmentId/maintenance', {})) as Map<String, dynamic>;

  Future<Map<String, dynamic>> markMaintenanceItem(
    String maintenanceId, {
    required String itemId,
    bool done = true,
    String? note,
    List<String> photoIds = const [],
  }) async =>
      (await post('/master/maintenance/$maintenanceId/items', {
        'itemId': itemId,
        'done': done,
        if (note != null && note.isNotEmpty) 'note': note,
        'photoIds': photoIds,
      })) as Map<String, dynamic>;

  /// Завершение. При незакрытых обязательных пунктах сервер отвечает 400,
  /// и в теле лежит их перечень — экран показывает именно его.
  Future<Map<String, dynamic>> finishMaintenance(String maintenanceId) async =>
      (await post('/master/maintenance/$maintenanceId/finish', {})) as Map<String, dynamic>;

  /// M-46 «Моя выработка» — экран сотрудника оператора вместо кошелька.
  /// Денег в ответе нет по устройству эндпоинта, не по фильтрации на клиенте.
  Future<Map<String, dynamic>> output({String? from, String? to}) async =>
      (await get('/master/output', query: {'from': ?from, 'to': ?to})) as Map<String, dynamic>;

  Future<Map<String, dynamic>> cashDeposit(int amountSoums) async =>
      (await post('/master/cash-deposit', {'amountSoums': amountSoums})) as Map<String, dynamic>;

  Future<Map<String, dynamic>> equipment() async => (await get('/master/equipment')) as Map<String, dynamic>;

  Future<Map<String, dynamic>> schedule({String? month}) async =>
      (await get('/master/schedule', query: {'month': ?month})) as Map<String, dynamic>;

  Future<Map<String, dynamic>> requestTimeOff(Map<String, dynamic> body) async =>
      (await post('/master/time-off', body)) as Map<String, dynamic>;

  Future<Map<String, dynamic>> referrals() async => (await get('/master/referrals')) as Map<String, dynamic>;

  Future<Map<String, dynamic>> toolChecklist() async => (await get('/master/tool-checklist')) as Map<String, dynamic>;

  Future<Map<String, dynamic>> toolCheck(Map<String, dynamic> body) async =>
      (await post('/master/tool-check', body)) as Map<String, dynamic>;

  Future<Map<String, dynamic>> npsDue() async => (await get('/master/nps')) as Map<String, dynamic>;

  Future<Map<String, dynamic>> submitNps(int score, {String? comment}) async =>
      (await post('/master/nps', {'score': score, 'comment': ?comment})) as Map<String, dynamic>;
}
