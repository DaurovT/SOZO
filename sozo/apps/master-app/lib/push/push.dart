import 'dart:async';

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';

import '../api/client.dart';

/// Push-уведомления приложения «Мастер» (ТЗ §11, PRD-02 §5).
///
/// Слой устроен так, чтобы приложение работало и без Firebase. Это не
/// осторожность ради осторожности: проекта Firebase у SOZO пока нет, и сборка
/// без `google-services.json` — сегодняшняя норма, а не исключение. Если
/// инициализация не удалась, приложение ведёт себя ровно как прежде: офферы
/// и изменения ленты видно на экране «Сегодня», просто о них не сообщают.
///
/// Цена отсутствия канала здесь выше, чем у клиента: оффер живёт шестьдесят
/// секунд, и мастер, не открывший приложение, его не увидит. Это и есть та
/// работа, которую push закрывает, — но отказ канала всё равно не должен
/// мешать мастеру работать, поэтому ни одна ошибка отсюда не всплывает на
/// экран.
class PushService {
  PushService(this._api);

  final ApiClient _api;

  FirebaseMessaging? _messaging;
  String? _registered;
  StreamSubscription<String>? _refresh;
  StreamSubscription<RemoteMessage>? _opened;
  StreamSubscription<RemoteMessage>? _foreground;

  /// Инициализация канала. Регистрация устройства её дожидается: раньше обе
  /// уходили параллельно, и на быстрой сети `register()` спрашивал токен у
  /// ещё не поднятого Firebase — мастер оставался без офферов до перезапуска
  final _ready = Completer<void>();

  /// Ссылка из уведомления, по которому запустили приложение.
  ///
  /// Холодный старт разбирается внутри `init()`, а обработчик ставится после
  /// возврата из неё — тап по пушу открывал «Сегодня» вместо заявки. Ссылку
  /// придерживаем до появления обработчика.
  String? _pendingDeepLink;

  void Function(String deepLink)? _onDeepLink;

  /// Куда вести человека по тапу. Ставится приложением при старте: сам слой
  /// не знает ни про экраны, ни про навигацию.
  set onDeepLink(void Function(String deepLink)? handler) {
    _onDeepLink = handler;
    final pending = _pendingDeepLink;
    if (handler != null && pending != null) {
      _pendingDeepLink = null;
      handler(pending);
    }
  }

  /// Уведомление пришло, пока приложение открыто. Экран решает сам — показать
  /// плашку, обновить карточку заявки или промолчать.
  void Function(String title, String body, String? deepLink)? onForeground;

  bool get available => _messaging != null;

  /// Поднять канал. Зовётся один раз при старте приложения — до входа:
  /// разрешение и токен нужны и тому, кто ещё не вошёл, иначе первое
  /// уведомление после входа опоздает на один запуск.
  Future<void> init() async {
    try {
      await Firebase.initializeApp();
      final messaging = FirebaseMessaging.instance;
      _messaging = messaging;

      // Android 13+ и iOS спрашивают разрешение явно. Отказ — не ошибка:
      // человек вправе не хотеть уведомлений, и приложение обязано работать
      await messaging.requestPermission();

      // На iOS уведомление на переднем плане система по умолчанию не
      // показывает вовсе — считается, что приложение покажет его само.
      // Экрана для этого у нас нет, поэтому просим показать баннер: иначе
      // пришедший оффер выглядел бы как «ничего не произошло»
      await messaging.setForegroundNotificationPresentationOptions(alert: true, badge: true, sound: true);

      _refresh = messaging.onTokenRefresh.listen((token) {
        // Токен меняет сам поставщик — при переустановке, очистке данных,
        // иногда при обновлении. Молчаливая смена означает, что уведомления
        // просто перестанут приходить, поэтому регистрируем заново сразу
        unawaited(_send(token));
      });

      _opened = FirebaseMessaging.onMessageOpenedApp.listen(_handleOpened);
      _foreground = FirebaseMessaging.onMessage.listen(_handleForeground);

      // Приложение запустили тапом по уведомлению из холодного старта
      final initial = await messaging.getInitialMessage();
      if (initial != null) _handleOpened(initial);
    } catch (e) {
      // Нет конфигурации Firebase, нет Google-сервисов на устройстве, нет
      // сети при инициализации — всё это означает одно: канала не будет.
      // Приложению это не мешает
      _messaging = null;
      debugPrint('push unavailable: $e');
    } finally {
      if (!_ready.isCompleted) _ready.complete();
    }
  }

  /// Зарегистрировать устройство за вошедшим человеком.
  ///
  /// Зовётся после входа и при каждом старте с живой сессией: сервер хранит
  /// токен за телефоном, и если аппаратом стал пользоваться другой человек,
  /// строка обязана переехать на него.
  Future<void> register() async {
    // Ждём инициализацию: без этого первая попытка выходила впустую на
    // непрогретом Firebase, а второй в этой сессии уже не было
    await _ready.future;
    final messaging = _messaging;
    if (messaging == null || _api.token == null) return;
    try {
      /**
       * На iOS токен FCM не существует, пока Apple не выдала свой.
       *
       * Порядок такой: система регистрирует приложение в APNs, отдаёт токен
       * устройства, и только после этого Firebase может обменять его на свой.
       * Спросить раньше — получить null, и это самый частый способ получить
       * приложение, которое «не получает уведомления на айфонах»: первый
       * запуск проходит впустую, а второго может не случиться неделю.
       *
       * Поэтому ждём APNs. Не бесконечно: разрешение могли и не дать, и тогда
       * ждать нечего.
       */
      if (defaultTargetPlatform == TargetPlatform.iOS) {
        for (var i = 0; i < 10 && await messaging.getAPNSToken() == null; i++) {
          await Future<void>.delayed(const Duration(seconds: 1));
        }
      }
      // Токен может не выдаться с первого раза: сеть, прогрев сервисов,
      // только что выданное разрешение. Пропущенная регистрация — это
      // пропущенные офферы на всю смену, поэтому пробуем трижды
      for (var attempt = 0; attempt < 3; attempt++) {
        final token = await messaging.getToken();
        if (token != null) {
          await _send(token);
          return;
        }
        await Future<void>.delayed(Duration(seconds: 2 * (attempt + 1)));
      }
      debugPrint('device token not obtained after 3 attempts');
    } catch (e) {
      debugPrint('device token not obtained: $e');
    }
  }

  /// Убедиться, что устройство зарегистрировано. Зовётся при возврате в
  /// приложение: если регистрация не удалась при старте, второй попытки
  /// раньше не было вовсе
  Future<void> ensureRegistered() async {
    if (_registered != null || _api.token == null) return;
    await register();
  }

  /// Снять устройство при выходе. Иначе уведомления по чужим заявкам
  /// продолжат приходить на аппарат, с которого человек вышел.
  Future<void> unregister() async {
    final token = _registered;
    if (token == null || _api.token == null) return;
    _registered = null;
    try {
      await _api.revokeDevice(token);
    } catch (e) {
      debugPrint('device token not revoked: $e');
    }
  }

  Future<void> _send(String token) async {
    if (_api.token == null) return;
    try {
      await _api.registerDevice(
        token: token,
        app: 'master',
        platform: defaultTargetPlatform == TargetPlatform.iOS ? 'ios' : 'android',
      );
      _registered = token;
    } catch (e) {
      // Сеть пропала, сервер ответил ошибкой — повторим при следующем старте
      // или на обновлении токена. Ронять вход из-за этого нельзя
      debugPrint('device not registered: $e');
    }
  }

  void _handleOpened(RemoteMessage m) {
    final deepLink = m.data['deepLink'] as String?;
    if (deepLink == null || deepLink.isEmpty) return;
    final handler = _onDeepLink;
    if (handler == null) {
      _pendingDeepLink = deepLink; // обработчик ещё не поставлен — придержим
      return;
    }
    handler(deepLink);
  }

  void _handleForeground(RemoteMessage m) {
    final n = m.notification;
    if (n == null) return;
    onForeground?.call(n.title ?? '', n.body ?? '', m.data['deepLink'] as String?);
  }

  void dispose() {
    unawaited(_refresh?.cancel());
    unawaited(_opened?.cancel());
    unawaited(_foreground?.cancel());
  }
}
