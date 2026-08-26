import 'dart:async';
import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../api/client.dart';
import '../i18n.dart';
import '../push/push.dart';
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
    push = PushService(api);
    // 401 разбирался только в `refreshProfile`: на действии по заявке мастер
    // получал «Сессия истекла», данные не сохранялись, а приложение делало
    // вид, что он всё ещё внутри. Теперь протухшая сессия обрабатывается
    // один раз и в одном месте — очередь при этом остаётся нетронутой
    api.onUnauthorized = () => unawaited(_sessionExpired());
  }

  /// Сессия протухла: токен снимаем, очередь и кеш не трогаем — то, что
  /// мастер успел сделать, уйдёт после повторного входа
  Future<void> _sessionExpired() async {
    if (api.token == null) return;
    api.token = null;
    profile = null;
    accessDeniedMessage = t('net.sessiyaIsteklaSohraneno');
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_kToken);
    notifyListeners();
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

  /// Канал push. Живёт рядом с сессией: токен устройства регистрируется за
  /// вошедшим мастером и снимается, когда он выходит
  late final PushService push;

  MasterProfile? profile;
  String? lastPhone;
  List<CatalogItem> catalog = const [];

  /// Почему сервер не пускает к заявкам: доступ закрыт админом либо ещё не
  /// открыт. Воронки онбординга в приложении нет — регистрирует и допускает
  /// мастера админ, приложение только показывает причину на экране входа
  String? accessDeniedMessage;
  bool ready = false;
  bool forceUpdate = false;
  String? minVersion;
  String? updateMessage;
  Map<String, dynamic> features = const {};

  /// Непрочитанные уведомления — счётчик на колокольчике
  int unreadNotifications = 0;

  bool get isAuthorized => api.token != null && profile != null;

  /// Вошёл, но к заявкам не допущен: токен есть, карточки мастера нет
  /// или доступ закрыт. Экран входа показывает причину и даёт перепроверить
  bool get isSignedInWithoutAccess => api.token != null && profile == null;
  String get baseUrl => api.baseUrl;

  /// Кто в прошлый раз работал на этом аппарате — по нему решаем, чистить ли
  /// кеш прайса при входе
  String? _lastOwner;

  /// Наценка за срочность в процентах — из параметра системы, а не из кода.
  /// null означает «конфигурацию ещё не читали»: в этом случае смета не
  /// показывает придуманную цифру, а честно говорит, что посчитает сервер
  int? urgentSurchargePercent;

  /// Телефон диспетчерской из конфигурации сервера: по нему звонят кнопки
  /// «Диспетчеру» на карточке заявки и в тупиковых ветках. Хранить его в
  /// приложении нельзя — номер меняется параметром системы без пересборки
  String? dispatcherPhone;

  Future<void> boot() async {
    final prefs = await SharedPreferences.getInstance();
    api.baseUrl = prefs.getString(_kBase) ?? defaultBaseUrl;
    api.token = prefs.getString(_kToken);
    lastPhone = prefs.getString(_kPhone);
    _lastOwner = lastPhone;
    _loadCatalogCache(prefs);
    await outbox.load();
    if (api.token != null) {
      await refreshProfile(silent: true);
      await refreshConfig();
      // Токен устройства подтверждаем на каждом старте: поставщик меняет его
      // молча, и пропущенный оффер — это заявка, ушедшая другому мастеру
      unawaited(push.register());
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
    // Вошёл другой мастер — чужая очередь и чужой кеш прайса не его дело
    await outbox.adoptOwner(phone);
    if (_lastOwner != null && _lastOwner != phone) {
      catalog = const [];
      await prefs.remove(_kCatalog);
    }
    _lastOwner = phone;
    unawaited(push.register());
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
        // Токен уже погашен в `onUnauthorized`: полный logout здесь затирал бы
        // сообщение «Сессия истекла» и второй раз снимал устройство с push
      } else if (e.statusCode == 403) {
        // Токен валиден, но к заявкам не допущены: доступ ещё не открыт
        // или закрыт админом. Две известные причины показываем своим текстом:
        // он всегда на языке мастера, а серверный перевод этих строк живёт в
        // словарях бэкенда и может отстать. Всё остальное — как прислал сервер
        accessDeniedMessage = switch (e.code) {
          'ACCESS_NOT_OPEN' || 'NOT_A_MASTER' => t('login.dostupZakryt'),
          'MASTER_BLOCKED' => t('login.dostupZakrytAdminom'),
          _ => e.message,
        };
        profile = null;
      } else if (!e.isOffline && !silent) {
        rethrow;
      }
    }
    notifyListeners();
  }

  Future<void> refreshUnread() async {
    try {
      final r = await api.notifications();
      unreadNotifications = (r['unread'] as num?)?.toInt() ?? 0;
      notifyListeners();
    } on ApiError {
      // счётчик не критичен: без сети оставляем последнее известное значение
    }
  }

  /// Конфигурация приложения: минимальная версия, флаги функций,
  /// телефон диспетчерской
  Future<void> refreshConfig() async {
    try {
      final c = await api.appConfig(appVersion);
      forceUpdate = c['forceUpdate'] == true;
      minVersion = c['minVersion']?.toString();
      updateMessage = c['updateMessage']?.toString();
      features = (c['features'] as Map?)?.cast<String, dynamic>() ?? const {};
      dispatcherPhone = c['dispatcherPhone']?.toString();
      urgentSurchargePercent = (c['urgentSurchargePercent'] as num?)?.toInt();
    } on ApiError {
      // офлайн или кандидат без карточки — блокировать работу из-за этого нельзя
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

  /// Выход из аккаунта.
  ///
  /// Чистим не только токен: на одном аппарате работают посменно, и второй
  /// мастер отправлял очередь первого своим токеном, а прайс видел из чужого
  /// кеша. Всё, что относится к человеку, уходит вместе с ним; адрес сервера
  /// и язык остаются — это настройки аппарата.
  Future<void> logout() async {
    // Сначала снимаем устройство, пока токен сессии ещё жив: после обнуления
    // запрос уйдёт без авторизации, а офферы продолжат приходить вышедшему
    await push.unregister();
    api.token = null;
    profile = null;
    accessDeniedMessage = null;
    catalog = const [];
    unreadNotifications = 0;
    features = const {};
    // Очередь не трогаем: в ней работа за день. Она привязана к телефону
    // мастера и не уйдёт под чужим токеном — за этим следит `adoptOwner`
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_kToken);
    await prefs.remove(_kCatalog);
    notifyListeners();
  }
}
