import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../i18n.dart';
import 'common.dart';

/// Звонок и навигатор — единственные два места, где приложение мастера
/// выходит наружу.
///
/// До этого обе кнопки показывали тост-заглушку: мастер стоял у подъезда,
/// жал «Клиенту» и получал тёмную плашку. Кнопка, которая ничего не делает,
/// дороже отсутствующей — после первого выезда мастер перестаёт верить и
/// остальным кнопкам.
///
/// Номер клиента при этом по-прежнему нигде не показывается и не копируется
/// (F-59): он уходит прямо в набор номера.
Future<void> callNumber(BuildContext context, String? phone) async {
  final digits = (phone ?? '').replaceAll(RegExp(r'[^\d+]'), '');
  if (digits.isEmpty) {
    showError(context, t('order.telefonaNet'));
    return;
  }
  final ok = await launchUrl(Uri(scheme: 'tel', path: digits));
  if (!ok && context.mounted) showError(context, t('order.telefonNeOtkrylsya'));
}

/// Маршрут: отдаём координаты географической ссылкой — её понимают
/// и Яндекс.Навигатор, и Google Maps, и 2ГИС. Своего навигатора у нас нет
/// и быть не должно: у мастера уже стоит тот, которому он доверяет.
Future<void> openNavigation(BuildContext context, {double? lat, double? lng, required String address}) async {
  final geo = lat != null && lng != null
      ? Uri.parse('geo:$lat,$lng?q=$lat,$lng(${Uri.encodeComponent(address)})')
      : Uri.parse('geo:0,0?q=${Uri.encodeComponent(address)}');
  if (await canLaunchUrl(geo) && await launchUrl(geo)) return;

  // Навигатора нет — открываем карту в браузере, это всё ещё лучше тоста
  final web = Uri.parse(
    lat != null && lng != null
        ? 'https://yandex.uz/maps/?rtext=~$lat,$lng&rtt=auto'
        : 'https://yandex.uz/maps/?text=${Uri.encodeComponent(address)}',
  );
  if (await launchUrl(web, mode: LaunchMode.externalApplication)) return;
  if (context.mounted) showError(context, t('order.navigatorNeOtkrylsya', {'p1': address}));
}
