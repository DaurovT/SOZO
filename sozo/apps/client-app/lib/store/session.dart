import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../api/client.dart';

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

  /// Адрес сервера. По умолчанию — боевой, поэтому обычная сборка без флагов
  /// уже ходит на него. Перекрывается при сборке: `--dart-define=SOZO_API=...`
  /// (так поднимают приложение против локального сервера). На устройстве
  /// меняется долгим нажатием по версии на первом экране.
  static const defaultBase = String.fromEnvironment('SOZO_API', defaultValue: 'https://20-52-250-154.sslip.io');

  late ApiClient api = ApiClient(baseUrl: defaultBase);

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

  Future<void> loadSimpleMode() async {
    final prefs = await SharedPreferences.getInstance();
    _simpleMode = prefs.getBool('sozo_simple_mode') ?? false;
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
    api = ApiClient(
      baseUrl: prefs.getString(_kBase) ?? defaultBase,
      token: prefs.getString(_kToken),
    );
    phone = prefs.getString(_kPhone);
    contextId = prefs.getString(_kContext);
    rememberContext = prefs.getBool(_kRemember) ?? false;
    contextChosen = rememberContext;
    notifyListeners();
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
    notifyListeners();
  }

  Future<void> signOut() async {
    api.token = null;
    me = null;
    contextId = null;
    contextChosen = false;
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_kToken);
    await prefs.remove(_kContext);
    await prefs.remove(_kRemember);
    notifyListeners();
  }

  /// Обновляет профиль. Ошибку не глотаем — экран решает, что показать.
  Future<void> refreshMe() async {
    me = await api.me();
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
    return d;
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
