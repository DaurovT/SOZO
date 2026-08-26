import 'dart:async';

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';

import '../api/client.dart';

/// Push-уведомления приложения «Клиент» (ТЗ §11, PRD-01 §5).
///
/// Слой устроен так, чтобы приложение работало и без Firebase. Это не
/// осторожность ради осторожности: проекта Firebase у SOZO пока нет, и сборка
/// без `google-services.json` — сегодняшняя норма, а не исключение. Если
/// инициализация не удалась, приложение ведёт себя ровно как прежде: события
/// видно в ленте уведомлений, просто о них не сообщают заранее.
///
/// Второе следствие того же правила: ни один отказ отсюда не должен всплыть
/// на экран. Человек открыл приложение чтобы вызвать мастера, а не чтобы
/// узнать, что регистрация токена вернула 502.
class PushService {
  PushService(this._api);

  final ApiClient _api;

  FirebaseMessaging? _messaging;
  String? _registered;
  StreamSubscription<String>? _refresh;
  StreamSubscription<RemoteMessage>? _opened;
  StreamSubscription<RemoteMessage>? _foreground;

  /// Куда вести человека по тапу. Ставится приложением при старте: сам слой
  /// не знает ни про экраны, ни про навигацию.
  ///
  /// Ссылка из холодного старта приходит **внутри** `init()`, то есть до того,
  /// как приложение успевает сюда что-то присвоить: `_startPush` ставит колбэк
  /// строкой ниже `await init()`. Из-за этого тап по «смета готова,
  /// подтвердите» при убитом приложении открывал главную. Поэтому ссылка не
  /// теряется, а ждёт получателя — и уходит ему в момент присваивания.
  void Function(String deepLink)? get onDeepLink => _onDeepLink;

  set onDeepLink(void Function(String deepLink)? handler) {
    _onDeepLink = handler;
    final pending = _pendingDeepLink;
    if (handler != null && pending != null) {
      _pendingDeepLink = null;
      handler(pending);
    }
  }

  void Function(String deepLink)? _onDeepLink;

  /// Ссылка из холодного старта, для которой ещё нет получателя
  String? _pendingDeepLink;

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
    }
  }

  /// Зарегистрировать устройство за вошедшим человеком.
  ///
  /// Зовётся после входа и при каждом старте с живой сессией: сервер хранит
  /// токен за телефоном, и если аппаратом стал пользоваться другой человек,
  /// строка обязана переехать на него.
  Future<void> register() async {
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
      final token = await messaging.getToken();
      if (token != null) await _send(token);
    } catch (e) {
      debugPrint('device token not obtained: $e');
    }
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
        app: 'client',
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
    if (handler != null) {
      handler(deepLink);
    } else {
      // Получателя ещё нет — придержим до присваивания (см. `onDeepLink`)
      _pendingDeepLink = deepLink;
    }
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
