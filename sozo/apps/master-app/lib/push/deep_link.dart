import 'package:flutter/material.dart';

import '../screens/notifications_screen.dart';
import '../screens/order_screen.dart';
import '../screens/today_screen.dart';
import '../screens/wallet_screen.dart';

/// Куда ведёт тап по уведомлению мастера (PRD-02 §5, колонка «Deep-link»).
///
/// Ссылки приходят от сервера: `sozo-master://order/{id}`,
/// `sozo-master://offer/{id}`, `sozo-master://wallet`, `sozo-master://feed/today`.
/// Разбирает их приложение — сервер знает событие, но не знает, какие экраны
/// есть в этой сборке.
///
/// Оффер — особый случай. Его карточка живёт всплывающим листом поверх
/// «Сегодня» и показывается сама, когда оффер приходит в открытое приложение
/// (M-09). Поэтому ссылка на оффер ведёт на ленту дня: если таймер ещё идёт,
/// мастер увидит карточку там; если истёк — увидит ленту, а не пустой экран
/// с истёкшим предложением.
Future<void> openDeepLink(NavigatorState nav, String raw) async {
  final uri = Uri.tryParse(raw);
  if (uri == null || uri.scheme != 'sozo-master') return;

  final parts = [uri.host, ...uri.pathSegments].where((s) => s.isNotEmpty).toList();
  if (parts.isEmpty) return;

  Widget screen;
  switch (parts.first) {
    case 'order':
      // Подпути (/estimate, /payment, /upsell) ведут на карточку заявки:
      // рабочий конвейер мастера собран на ней целиком, и вкладки внутри
      // открываются в один тап уже с загруженной заявкой
      screen = parts.length >= 2 ? OrderScreen(orderId: parts[1]) : const TodayScreen();
    case 'offer':
    case 'feed':
      screen = const TodayScreen();
    case 'wallet':
      screen = const WalletScreen();
    default:
      // Незнакомая ссылка — из уведомления, которого эта версия приложения
      // не знает. Лента показывает событие целиком: это лучше, чем не
      // открыть ничего в ответ на тап
      screen = const NotificationsScreen();
  }

  await nav.push(MaterialPageRoute(builder: (_) => screen));
}
