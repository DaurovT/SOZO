import 'package:flutter/material.dart';

import '../screens/building_screens.dart';
import '../screens/notifications_screen.dart';
import '../screens/order_screen.dart';

/// Куда ведёт тап по уведомлению (PRD-01 §5, колонка «Deep-link»).
///
/// Ссылки приходят от сервера в виде `sozo-client://order/{id}/estimate`.
/// Разбирает их приложение, а не сервер: сервер знает событие и заявку, но
/// не знает, какой экран сейчас существует в этой версии приложения, — а
/// уведомление обязано открыть хоть что-то осмысленное и в прошлогодней
/// сборке тоже.
///
/// Подпути (`/estimate`, `/act`, `/payment`) пока приводят на карточку
/// заявки. Это не заглушка: экраны решений принимают саму заявку, а не её
/// идентификатор, и загружает её именно карточка. Открыть подтверждение
/// сметы, не прочитав заявку, всё равно невозможно — с карточки оно в один
/// тап, и человек видит, о чём речь.
Future<void> openDeepLink(NavigatorState nav, String raw) async {
  final uri = Uri.tryParse(raw);
  if (uri == null || uri.scheme != 'sozo-client') return;

  // В `sozo-client://order/{id}` хост — это «order», а идентификатор уже в
  // сегментах пути: разбирать надо оба, иначе первая часть ссылки теряется
  final parts = [uri.host, ...uri.pathSegments].where((s) => s.isNotEmpty).toList();
  if (parts.isEmpty) return;

  Widget? screen;
  if (parts.first == 'order' && parts.length >= 2) {
    screen = OrderScreen(orderId: parts[1]);
  } else if (parts.first == 'approval' && parts.length >= 2) {
    // Утверждение сметы (C-36) живёт на той же карточке: решение принимают,
    // глядя на состав работ, а не на одну сумму
    screen = OrderScreen(orderId: parts[1]);
  } else if (parts.first == 'home' && parts.length >= 2 && parts[1] == 'shutdowns') {
    screen = const BuildingShutdownsScreen();
  } else {
    // Незнакомая ссылка — из уведомления, которое эта версия приложения не
    // знает. Лента показывает событие целиком, и это лучше, чем ничего не
    // открыть: человек уже нажал и ждёт результата
    screen = const NotificationsScreen();
  }

  await nav.push(MaterialPageRoute(builder: (_) => screen!));
}
