import 'package:flutter/material.dart';

import '../main.dart';
import '../screens/notifications_screen.dart';
import '../screens/order_screen.dart';

/// Куда ведёт тап по уведомлению мастера (PRD-02 §5, колонка «Deep-link»).
///
/// Ссылки приходят от сервера: `sozo-master://order/{id}`,
/// `sozo-master://offer/{id}`, `sozo-master://wallet`, `sozo-master://feed/today`.
/// Разбирает их приложение — сервер знает событие, но не знает, какие экраны
/// есть в этой сборке.
///
/// Вкладки оболочки («Сегодня», «Деньги») открываются переключением, а не
/// новым роутом: своего `Scaffold` у них нет, и push давал прозрачный фон,
/// наложенный текст и экран без таббара. Отдельные экраны — заявка и лента
/// уведомлений — по-прежнему открываются поверх.
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

  /// Вернуться к оболочке и показать нужную вкладку
  void openTab(int index) {
    nav.popUntil((r) => r.isFirst);
    shellTab.value = index;
  }

  switch (parts.first) {
    case 'order':
      // Подпути (/estimate, /payment, /upsell) ведут на карточку заявки:
      // рабочий конвейер мастера собран на ней целиком, и вкладки внутри
      // открываются в один тап уже с загруженной заявкой
      if (parts.length >= 2) {
        await nav.push(MaterialPageRoute(builder: (_) => OrderScreen(orderId: parts[1])));
      } else {
        openTab(0);
      }
    case 'offer':
    case 'feed':
      openTab(0);
    case 'wallet':
      openTab(3);
    default:
      // Незнакомая ссылка — из уведомления, которого эта версия приложения
      // не знает. Лента показывает событие целиком: это лучше, чем не
      // открыть ничего в ответ на тап
      await nav.push(MaterialPageRoute(builder: (_) => const NotificationsScreen()));
  }
}
