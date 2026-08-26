import 'dart:async';
import 'dart:convert';
import 'dart:math';

import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../api/client.dart';
import '../push/push.dart';

/// Сессия приложения: адрес сервера, токен, профиль и выбранный контекст роли.
///
/// Один экземпляр на приложение — экраны читают его через [session], а не
/// таскают параметры через конструкторы.
class Session extends ChangeNotifier {
  static const _kToken = 'sozo_client_token';
  static const _kPhone = 'sozo_client_phone';
  static const _kBase = 'sozo_client_base';
  static const _kContext = 'sozo_client_context';
  static const _kRemember = 'sozo_client_remember_context';
  static const _kMe = 'sozo_client_me';

  /// Адрес сервера. По умолчанию — боевой, поэтому обычная сборка без флагов
  /// уже ходит на него. Перекрывается при сборке: `--dart-define=SOZO_API=...`
  /// (так поднимают приложение против локального сервера). На устройстве
  /// меняется долгим нажатием по версии на первом экране.
  static const defaultBase = String.fromEnvironment('SOZO_API', defaultValue: 'https://api.sozo.uz');

  /// HTTP-клиент. **Один на всё время жизни приложения.**
  ///
  /// Раньше `load()` заменял его новым, и всё, что успело взять ссылку на
  /// прежний, оставалось с клиентом без токена и с адресом по умолчанию.
  /// Порядок вызовов в `main()` от этого спасал случайно: `PushService`
  /// захватывает клиент в поле инициализации, то есть при первом обращении к
  /// `session.push` — стоило тронуть push до `load()`, и регистрация
  /// устройства навсегда уходила бы неавторизованной.
  ///
  /// Теперь `load()` меняет у клиента адрес и токен, а не сам клиент.
  final ApiClient api = ApiClient(baseUrl: defaultBase);

  /// Канал push. Живёт рядом с сессией, потому что привязан к ней: токен
  /// устройства регистрируется за вошедшим человеком и снимается при выходе.
  late final PushService push = PushService(api);

  String? phone;

  /// Ответ `/app/me`: профиль, контексты, долг, согласия
  Map<String, dynamic>? me;

  /// Выбранный контекст роли (C-05). null — личный аккаунт.
  String? contextId;
  bool rememberContext = false;

  /// Выбор роли уже сделан в этом запуске. Нужен, чтобы «Личный аккаунт»
  /// не выглядел как «выбор не сделан»: contextId у него пустой, и без этого
  /// признака экран выбора открывался бы снова и снова.
  bool contextChosen = false;

  bool get signedIn => api.token != null;

  /// Непрочитанные уведомления — бейдж на вкладке
  int get unreadNotifications => (me?['unreadNotifications'] as num?)?.toInt() ?? 0;

  /// Долг блокирует создание заявок, кроме аварийных (ТЗ 4.4)
  int get debtTiyin => (me?['debtTiyin'] as num?)?.toInt() ?? 0;
  bool get hasDebt => debtTiyin > 0;

  String get fullName => (me?['fullName'] as String?)?.trim().isNotEmpty == true
      ? me!['fullName'] as String
      : (phone ?? '');

  // ---- контур «Дом» (DEV-15) ----

  /// Житель подключённого объекта: раздел «Мой дом» появляется только у него.
  /// Для остальных приложение выглядит ровно как в v2.25.
  bool get isResident => me?['building'] != null;

  Map<String, dynamic>? get building =>
      me?['building'] == null ? null : Map<String, dynamic>.from(me!['building'] as Map);

  String? get buildingEmergencyPhone => building?['emergencyPhone'] as String?;

  String? get supportPhone => me?['supportPhone'] as String?;

  /// Простой режим (C-57). Хранится локально: его включает либо сам житель,
  /// либо член семьи с его аккаунта — серверу это знать незачем.
  bool _simpleMode = false;
  bool get simpleMode => _simpleMode;

  Future<void> setSimpleMode(bool on) async {
    _simpleMode = on;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool('sozo_simple_mode', on);
    notifyListeners();
  }

  /// Предложение простого режима на главной уже отклоняли.
  ///
  /// Предлагаем его тому, у кого крупный системный шрифт, — и ровно один раз:
  /// повторное предложение того же самого читается как «приложение считает
  /// меня старым», а это худшее, что можно сделать с этим экраном.
  bool _simpleModeDeclined = false;
  bool get simpleModeDeclined => _simpleModeDeclined;

  Future<void> declineSimpleMode() async {
    _simpleModeDeclined = true;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool('sozo_simple_mode_declined', true);
    notifyListeners();
  }

  Future<void> loadSimpleMode() async {
    final prefs = await SharedPreferences.getInstance();
    _simpleMode = prefs.getBool('sozo_simple_mode') ?? false;
    _simpleModeDeclined = prefs.getBool('sozo_simple_mode_declined') ?? false;
  }

  /// Заявки для простого режима: статус словами, без кодов и цветов
  List<Map<String, dynamic>> get simpleOrders =>
      ((me?['simpleOrders'] as List?) ?? const []).cast<Map<String, dynamic>>();

  List<Map<String, dynamic>> get contexts =>
      ((me?['contexts'] as List?) ?? const []).cast<Map<String, dynamic>>();

  /// Текущий контекст: запись из `contexts` либо null для личного аккаунта
  Map<String, dynamic>? get currentContext =>
      contexts.where((c) => c['id'] == contextId).firstOrNull;

  String get role => (currentContext?['role'] as String?) ?? 'client';
  bool get isB2C => currentContext == null;

  Future<void> load() async {
    final prefs = await SharedPreferences.getInstance();
    api.baseUrl = prefs.getString(_kBase) ?? defaultBase;
    api.token = prefs.getString(_kToken);
    // Протухший токен выбрасывает на вход из любого места приложения, а не
    // только с экрана выбора контекста
    api.onUnauthorized = _onUnauthorized;
    phone = prefs.getString(_kPhone);
    // Профиль из кеша — до сети. Свежий приедет следом и заменит его; если не
    // приедет, человек увидит вчерашний профиль вместо пустого приложения
    if (api.token != null) _restoreMe(prefs);
    contextId = prefs.getString(_kContext);
    rememberContext = prefs.getBool(_kRemember) ?? false;
    contextChosen = rememberContext;
    // Простой режим — тоже часть восстановления. Без этой строки он жил до
    // первого закрытия приложения: человек, которому его включил сын,
    // на следующий день открывал обычный интерфейс
    await loadSimpleMode();
    notifyListeners();
  }

  /// Профиль в кеше.
  ///
  /// Без него холодный старт без сети давал пустое приложение: `me` остаётся
  /// null, ошибка при офлайне сознательно не показывается («экраны покажут
  /// кеш»), и оболочка строится ни на чём. Житель открывает приложение в
  /// лифте — раздела «Мой дом» нет, имя пустое, долг ноль. Читается это не как
  /// «нет сети», а как «у меня всё удалили».
  ///
  /// Кеша, о котором говорил тот комментарий, не существовало нигде: загрузка
  /// сессии читала только токен, телефон, адрес сервера и контекст.
  Future<void> _cacheMe() async {
    final data = me;
    if (data == null) return;
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(_kMe, jsonEncode(data));
    } catch (_) {
      // Профиль не влез в хранилище — не повод ронять экран
    }
  }

  void _restoreMe(SharedPreferences prefs) {
    final raw = prefs.getString(_kMe);
    if (raw == null) return;
    try {
      me = (jsonDecode(raw) as Map).cast<String, dynamic>();
    } catch (_) {
      // Кеш от старого формата — ведём себя так, будто его нет
    }
  }

  /// Реакция на 401. Асинхронный выход запускаем, но не ждём: зовут нас из
  /// разбора ответа, посреди чужого запроса, и блокировать его нечем.
  ///
  /// Повторные 401 (их прилетит столько, сколько экранов успело запросить
  /// данные) гасим флагом: иначе выход зовётся десять раз подряд и десять раз
  /// дёргает `notifyListeners`.
  bool _signingOut = false;

  void _onUnauthorized() {
    if (_signingOut || api.token == null) return;
    _signingOut = true;
    unawaited(signOut().whenComplete(() => _signingOut = false));
  }

  Future<void> setBaseUrl(String url) async {
    api.baseUrl = url.trim().replaceAll(RegExp(r'/+$'), '');
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_kBase, api.baseUrl);
    notifyListeners();
  }

  Future<void> signIn(String phoneNumber, String token) async {
    phone = phoneNumber;
    api.token = token;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_kToken, token);
    await prefs.setString(_kPhone, phoneNumber);
    // Регистрируем устройство сразу: первое уведомление по заявке приходит
    // через минуты после входа, и ждать следующего запуска нельзя.
    // Без await — вход не должен зависеть от доступности Firebase
    unawaited(push.register());
    notifyListeners();
  }

  Future<void> signOut() async {
    // Сначала снимаем устройство, пока токен сессии ещё жив: после обнуления
    // запрос уйдёт без авторизации и будет отвергнут, а уведомления по чужим
    // заявкам продолжат приходить на этот аппарат
    await push.unregister();
    api.token = null;
    me = null;
    contextId = null;
    contextChosen = false;
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_kToken);
    await prefs.remove(_kContext);
    await prefs.remove(_kRemember);
    // Профиль уходит вместе с сессией: следующий человек на этом аппарате не
    // должен увидеть чужое имя и чужой долг
    await prefs.remove(_kMe);
    notifyListeners();
  }

  /// Обновляет профиль. Ошибку не глотаем — экран решает, что показать.
  Future<void> refreshMe() async {
    me = await api.me();
    unawaited(_cacheMe());
    // Контекст мог исчезнуть (403 «Доступ изменён») — тогда возвращаемся в личный
    if (contextId != null && currentContext == null) {
      contextId = null;
      final prefs = await SharedPreferences.getInstance();
      await prefs.remove(_kContext);
    }
    notifyListeners();
  }

  Future<void> setContext(String? id, {bool remember = false}) async {
    contextId = id;
    rememberContext = remember;
    contextChosen = true;
    final prefs = await SharedPreferences.getInstance();
    if (id == null) {
      await prefs.remove(_kContext);
    } else {
      await prefs.setString(_kContext, id);
    }
    await prefs.setBool(_kRemember, remember);
    notifyListeners();
  }
}

final session = Session();

/// Черновик заявки (C-07 → C-10 → C-13).
///
/// Переживает убийство процесса (PRD-01 §6): визард пишет черновик в хранилище
/// после каждого шага, а не держит его в памяти экрана.
class OrderDraft {
  static const _key = 'sozo_client_draft';

  /// Позиции прайса: id → количество
  Map<String, int> items = {};
  String? category;
  String description = '';
  bool emergency = false;

  /// Фото проблемы — data URL, как их отдаёт image_picker
  List<String> photos = [];

  String address = '';
  double? lat;
  double? lng;
  bool saveAddress = false;
  String? addressId;

  /// Этаж и лифт спрашиваются на шаге 2 только для парных работ
  /// и работ с оборудованием (DEV-08 C-10)
  String floor = '';
  bool? hasLift;

  /// Чек-лист доступа к общим зонам (C-11)
  bool? needRiser;
  bool? needCommonArea;
  bool? accessConfirmed;
  String? accessAt;

  /// Взаимоисключающий выбор времени: окно | urgent | waitlist
  String timeMode = 'slot';
  String? slotFrom;
  String? slotTo;

  String? promoCode;
  int promoDiscountPercent = 0;

  /// Ключ идемпотентности этой попытки создать заявку.
  ///
  /// Заводится вместе с черновиком и переживает его сохранение. Нужен ровно
  /// для одного случая: запрос ушёл, сервер заявку создал, ответ не доехал
  /// (12 секунд таймаута на мобильном интернете — обычное дело). Человек
  /// видит «сервер не ответил», жмёт «Отправить» ещё раз — и без этого ключа
  /// получает вторую заявку на тот же адрес. Проверка дубля за сутки ловит не
  /// всё и требует ручного решения от человека, который только что испугался.
  String idempotencyKey = newIdempotencyKey();

  /// Свой генератор вместо пакета uuid: одна зависимость ради одной строки не
  /// окупается. Времени и 64 случайных бит достаточно, чтобы два черновика на
  /// одном устройстве не совпали
  static String newIdempotencyKey() {
    final r = Random.secure();
    final rnd = List<int>.generate(8, (_) => r.nextInt(256))
        .map((b) => b.toRadixString(16).padLeft(2, '0'))
        .join();
    return '${DateTime.now().microsecondsSinceEpoch.toRadixString(16)}-$rnd';
  }

  /// Новая попытка после успешной отправки: следующая заявка — другая заявка
  void renewIdempotencyKey() => idempotencyKey = newIdempotencyKey();

  bool get isEmpty =>
      items.isEmpty && description.isEmpty && photos.isEmpty && address.isEmpty;

  Map<String, dynamic> toJson() => {
        'items': items,
        'category': category,
        'description': description,
        'emergency': emergency,
        'photos': photos,
        'address': address,
        'lat': lat,
        'lng': lng,
        'saveAddress': saveAddress,
        'addressId': addressId,
        'floor': floor,
        'hasLift': hasLift,
        'needRiser': needRiser,
        'needCommonArea': needCommonArea,
        'accessConfirmed': accessConfirmed,
        'accessAt': accessAt,
        'timeMode': timeMode,
        'slotFrom': slotFrom,
        'slotTo': slotTo,
        'promoCode': promoCode,
        'promoDiscountPercent': promoDiscountPercent,
        'idempotencyKey': idempotencyKey,
      };

  static OrderDraft fromJson(Map<String, dynamic> j) {
    final d = OrderDraft();
    d.items = ((j['items'] as Map?) ?? {}).map((k, v) => MapEntry('$k', (v as num).toInt()));
    d.category = j['category'] as String?;
    d.description = (j['description'] as String?) ?? '';
    d.emergency = j['emergency'] == true;
    d.photos = ((j['photos'] as List?) ?? const []).cast<String>();
    d.address = (j['address'] as String?) ?? '';
    d.lat = (j['lat'] as num?)?.toDouble();
    d.lng = (j['lng'] as num?)?.toDouble();
    d.saveAddress = j['saveAddress'] == true;
    d.addressId = j['addressId'] as String?;
    d.floor = (j['floor'] as String?) ?? '';
    d.hasLift = j['hasLift'] as bool?;
    d.needRiser = j['needRiser'] as bool?;
    d.needCommonArea = j['needCommonArea'] as bool?;
    d.accessConfirmed = j['accessConfirmed'] as bool?;
    d.accessAt = j['accessAt'] as String?;
    d.timeMode = (j['timeMode'] as String?) ?? 'slot';
    d.slotFrom = j['slotFrom'] as String?;
    d.slotTo = j['slotTo'] as String?;
    d.promoCode = j['promoCode'] as String?;
    d.promoDiscountPercent = (j['promoDiscountPercent'] as num?)?.toInt() ?? 0;
    // Черновик от версии без ключа — ключ уже создан конструктором
    d.idempotencyKey = (j['idempotencyKey'] as String?) ?? d.idempotencyKey;
    return d;
  }

  /// Перенести всё из восстановленного черновика в рабочий.
  ///
  /// **Список полей здесь обязан совпадать с `toJson`.** Раньше перенос жил
  /// в экране визарда и копировал 14 полей из 21: молча терялись аварийность,
  /// идентификатор выбранного адреса, «сохранить адрес» и все четыре ответа
  /// чек-листа доступа. Человек заполнял чек-лист, выбирал сохранённый адрес,
  /// выходил и возвращался — адрес превращался в свободный текст без
  /// координат, ответы обнулялись, аварийная заявка становилась обычной.
  /// И увидеть это было негде: экран итога показывает адрес строкой, а
  /// аварийность и чек-лист на нём не подписаны.
  ///
  /// Расхождение сторожит `test/draft_roundtrip_test.dart`.
  void copyFrom(OrderDraft d) {
    items = d.items;
    category = d.category;
    description = d.description;
    emergency = d.emergency;
    photos = d.photos;
    address = d.address;
    lat = d.lat;
    lng = d.lng;
    saveAddress = d.saveAddress;
    addressId = d.addressId;
    floor = d.floor;
    hasLift = d.hasLift;
    needRiser = d.needRiser;
    needCommonArea = d.needCommonArea;
    accessConfirmed = d.accessConfirmed;
    accessAt = d.accessAt;
    timeMode = d.timeMode;
    slotFrom = d.slotFrom;
    slotTo = d.slotTo;
    promoCode = d.promoCode;
    promoDiscountPercent = d.promoDiscountPercent;
    idempotencyKey = d.idempotencyKey;
  }

  Future<void> save() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_key, jsonEncode(toJson()));
  }

  static Future<OrderDraft?> restore() async {
    final prefs = await SharedPreferences.getInstance();
    final raw = prefs.getString(_key);
    if (raw == null) return null;
    try {
      final d = fromJson(jsonDecode(raw) as Map<String, dynamic>);
      return d.isEmpty ? null : d;
    } catch (_) {
      // Черновик от старой версии формата — молча выбрасываем, а не роняем вход
      await prefs.remove(_key);
      return null;
    }
  }

  static Future<void> clear() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_key);
  }
}
