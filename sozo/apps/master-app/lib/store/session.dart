import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../api/client.dart';
import '../api/models.dart';
import 'outbox.dart';

/// Сессия мастера: адрес сервера, токен, профиль, кеш каталога для офлайн-сметы.
///
/// Адрес сервера хранится и меняется на экране входа — одно приложение
/// работает и с ноутбуком в локальной сети, и с боевым доменом.
class Session extends ChangeNotifier {
  Session() {
    api = ApiClient(baseUrl: defaultBaseUrl);
    outbox = Outbox(api);
  }

  /// Версия сборки — сверяется с минимальной серверной (F-60)
  static const appVersion = String.fromEnvironment('SOZO_VERSION', defaultValue: '1.0.0');

  static const defaultBaseUrl = String.fromEnvironment('SOZO_API', defaultValue: 'https://api.sozo.uz');
  static const _kToken = 'sozo_token';
  static const _kBase = 'sozo_base_url';
  static const _kPhone = 'sozo_phone';
  static const _kCatalog = 'sozo_catalog_v1';

  late final ApiClient api;
  late final Outbox outbox;

  MasterProfile? profile;
  String? lastPhone;
  List<CatalogItem> catalog = const [];
  String? accessDeniedMessage;

  /// Состояние воронки онбординга: показывается вместо ленты, пока мастера не активировали
  Map<String, dynamic>? onboarding;
  bool ready = false;
  bool forceUpdate = false;
  String? minVersion;
  String? updateMessage;
  Map<String, dynamic> features = const {};

  /// Непрочитанные уведомления — счётчик на колокольчике
  int unreadNotifications = 0;

  bool get isAuthorized => api.token != null && profile != null;
  bool get isOnboarding => api.token != null && profile == null && onboarding != null;
  String get baseUrl => api.baseUrl;

  Future<void> boot() async {
    final prefs = await SharedPreferences.getInstance();
    api.baseUrl = prefs.getString(_kBase) ?? defaultBaseUrl;
    api.token = prefs.getString(_kToken);
    lastPhone = prefs.getString(_kPhone);
    _loadCatalogCache(prefs);
    await outbox.load();
    if (api.token != null) {
      await refreshProfile(silent: true);
      await refreshConfig();
    }
    ready = true;
    notifyListeners();
  }

  Future<void> setBaseUrl(String url) async {
    final clean = url.trim().replaceAll(RegExp(r'/+$'), '');
    api.baseUrl = clean.isEmpty ? defaultBaseUrl : clean;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_kBase, api.baseUrl);
    notifyListeners();
  }

  Future<void> login(String phone, String code) async {
    await api.verify(phone, code);
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_kToken, api.token!);
    await prefs.setString(_kPhone, phone);
    lastPhone = phone;
    accessDeniedMessage = null;
    await refreshProfile();
    await refreshConfig();
    if (profile != null) await refreshCatalog();
  }

  /// Профиль тянем на старте: он же проверяет, что мастер вообще допущен на линию
  Future<void> refreshProfile({bool silent = false}) async {
    try {
      profile = MasterProfile.fromJson(await api.me());
      accessDeniedMessage = null;
    } on ApiError catch (e) {
      if (e.statusCode == 401) {
        await logout();
      } else if (e.statusCode == 403) {
        // Кандидат или заблокированный: токен валиден, но линии нет.
        // Заблокированного дальше не пускаем, остальным открываем воронку онбординга.
        accessDeniedMessage = e.message;
        profile = null;
        if (e.code != 'MASTER_BLOCKED') await refreshOnboarding();
      } else if (!e.isOffline && !silent) {
        rethrow;
      }
    }
    notifyListeners();
  }

  /// Конфигурация приложения: минимальная версия и флаги функций
  Future<void> refreshUnread() async {
    try {
      final r = await api.notifications();
      unreadNotifications = (r['unread'] as num?)?.toInt() ?? 0;
      notifyListeners();
    } on ApiError {
      // счётчик не критичен: без сети оставляем последнее известное значение
    }
  }

  Future<void> refreshConfig() async {
    try {
      final c = await api.appConfig(appVersion);
      forceUpdate = c['forceUpdate'] == true;
      minVersion = c['minVersion']?.toString();
      updateMessage = c['updateMessage']?.toString();
      features = (c['features'] as Map?)?.cast<String, dynamic>() ?? const {};
    } on ApiError {
      // офлайн или кандидат без карточки — блокировать работу из-за этого нельзя
    }
    notifyListeners();
  }

  Future<void> refreshOnboarding() async {
    try {
      onboarding = await api.onboardingStatus();
      if (onboarding?['activated'] == true) {
        // Админ активировал — перечитываем профиль, воронка больше не нужна
        onboarding = null;
        profile = MasterProfile.fromJson(await api.me());
        accessDeniedMessage = null;
      }
    } on ApiError {
      // офлайн — покажем последний известный экран воронки
    }
    notifyListeners();
  }

  Future<void> setOnline(bool value) async {
    await api.setShift(value);
    await refreshProfile();
  }

  /// Каталог кешируем: смета составляется в подвале, где сети нет (PRD-02 §6)
  Future<void> refreshCatalog() async {
    try {
      final r = await api.catalog();
      catalog = ((r['items'] as List?) ?? const [])
          .map((e) => CatalogItem.fromJson(e as Map<String, dynamic>))
          .toList();
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(_kCatalog, jsonEncode(catalog.map((c) => c.toJson()).toList()));
      notifyListeners();
    } on ApiError {
      // офлайн — работаем на прошлом кеше, это нормальный режим
    }
  }

  void _loadCatalogCache(SharedPreferences prefs) {
    final raw = prefs.getString(_kCatalog);
    if (raw == null) return;
    try {
      catalog = (jsonDecode(raw) as List).map((e) => CatalogItem.fromJson(e as Map<String, dynamic>)).toList();
    } catch (_) {
      catalog = const [];
    }
  }

  Future<void> logout() async {
    api.token = null;
    profile = null;
    accessDeniedMessage = null;
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_kToken);
    notifyListeners();
  }
}
