import 'dart:async';
import 'dart:ui' show Locale;

import 'package:geocoding/geocoding.dart';
import 'package:geolocator/geolocator.dart';

import 'i18n.dart';

/// Место человека и название этого места (шаг C-10 «Где и когда»).
///
/// Слой тонкий намеренно: экран не должен разбираться в семи состояниях
/// разрешения и в том, чем `deniedForever` отличается от `denied`. Он задаёт
/// один вопрос — «где я и как это называется» — и получает либо результат,
/// либо причину, которую можно показать человеку словами.
///
/// **Ни один отказ отсюда не блокирует заявку.** Нет разрешения, выключен
/// GPS, молчит геокодер — человек по-прежнему двигает карту пальцем и
/// печатает адрес руками, как делал до появления этого файла. Место и
/// название — ускорители, а не условие.
enum GeoFailure {
  /// Человек отказал в доступе в этот раз
  denied,

  /// Отказал насовсем — спрашивать снова система не даст, только настройки
  deniedForever,

  /// Геолокация выключена на самом устройстве
  serviceOff,

  /// Не успели или не смогли определить точку
  unavailable,
}

/// Результат: либо точка, либо причина её отсутствия
class GeoResult {
  const GeoResult.found(this.latitude, this.longitude) : failure = null;
  const GeoResult.failed(this.failure) : latitude = null, longitude = null;

  final double? latitude;
  final double? longitude;
  final GeoFailure? failure;

  bool get ok => latitude != null && longitude != null;
}

/// Строка для человека по коду отказа
String geoFailureText(GeoFailure f) => switch (f) {
      GeoFailure.denied => t('geo.denied'),
      GeoFailure.deniedForever => t('geo.deniedForever'),
      GeoFailure.serviceOff => t('geo.serviceOff'),
      GeoFailure.unavailable => t('geo.unavailable'),
    };

/// Где человек сейчас.
///
/// Разрешение спрашиваем здесь, а не при запуске приложения: вопрос про
/// геолокацию посреди первого экрана человек отклоняет не глядя, и второго
/// раза система не даст. Спрошенный в момент «Найти меня» он понятен.
///
/// Таймаут свой: `getCurrentPosition` в помещении со слабым сигналом может
/// ждать минутами, а человек к этому времени уже наберёт адрес руками.
Future<GeoResult> currentPlace({Duration timeout = const Duration(seconds: 12)}) async {
  try {
    if (!await Geolocator.isLocationServiceEnabled()) {
      return const GeoResult.failed(GeoFailure.serviceOff);
    }
    var permission = await Geolocator.checkPermission();
    if (permission == LocationPermission.denied) {
      permission = await Geolocator.requestPermission();
    }
    if (permission == LocationPermission.deniedForever) {
      return const GeoResult.failed(GeoFailure.deniedForever);
    }
    if (permission == LocationPermission.denied) {
      return const GeoResult.failed(GeoFailure.denied);
    }
    final pos = await Geolocator.getCurrentPosition().timeout(timeout);
    return GeoResult.found(pos.latitude, pos.longitude);
  } on TimeoutException {
    return const GeoResult.failed(GeoFailure.unavailable);
  } catch (_) {
    // Геолокация — не тот случай, где стоит разбирать причину: для человека
    // «не смогли определить» одинаково означает «наберите адрес сами»
    return const GeoResult.failed(GeoFailure.unavailable);
  }
}

/// Где человек сейчас — но **только если разрешение уже дано**.
///
/// Отдельно от `currentPlace`, потому что разница принципиальна: эта функция
/// никогда не показывает системный запрос. Ею открывают карту на шаге адреса —
/// человеку, который однажды разрешил доступ, незачем каждый раз жать «Найти
/// меня», а тому, кто не разрешал, незачем видеть диалог, которого он не
/// просил. Молчит и когда разрешения нет, и когда точка не далась.
Future<GeoResult> currentPlaceIfAllowed(
    {Duration timeout = const Duration(seconds: 8)}) async {
  try {
    if (!await Geolocator.isLocationServiceEnabled()) {
      return const GeoResult.failed(GeoFailure.serviceOff);
    }
    final permission = await Geolocator.checkPermission();
    final granted = permission == LocationPermission.always ||
        permission == LocationPermission.whileInUse;
    if (!granted) return const GeoResult.failed(GeoFailure.denied);
    final pos = await Geolocator.getCurrentPosition().timeout(timeout);
    return GeoResult.found(pos.latitude, pos.longitude);
  } catch (_) {
    return const GeoResult.failed(GeoFailure.unavailable);
  }
}

/// Название места по координатам. `null`, если геокодер молчит или не знает.
///
/// Собираем строку сами, а не берём готовую: системный геокодер отдаёт
/// разложенные поля, и порядок «улица, дом — район» для Ташкента понятнее,
/// чем страна с индексом, которыми отвечает платформа по умолчанию.
Future<String?> placeName(double lat, double lng,
    {Duration timeout = const Duration(seconds: 8)}) async {
  try {
    final geocoding = Geocoding();
    // Геокодера может не быть вовсе: на Android он приходит с сервисами
    // Google, а на аппаратах без них его нет. Спрашиваем заранее, чтобы
    // получить `null`, а не исключение
    if (!await geocoding.isPresent().timeout(timeout)) return null;
    // Язык передаём в сам вызов, а не в конструктор: конструктор `Geocoding`
    // в 5.0.0 свой параметр `locale` теряет — до платформы доезжает только
    // тот, что передан методу
    final marks = await geocoding
        .placemarkFromCoordinates(lat, lng, locale: Locale(l10n.code))
        .timeout(timeout);
    if (marks.isEmpty) return null;
    final p = marks.first;
    // `street` у платформ уже склеен («Amir Temur ko'chasi 12»), но не везде;
    // где его нет, собираем из улицы и номера дома
    final street = (p.street ?? '').trim().isNotEmpty
        ? p.street!.trim()
        : [p.thoroughfare, p.subThoroughfare]
            .where((v) => (v ?? '').trim().isNotEmpty)
            .join(' ')
            .trim();
    final parts = <String>[
      if (street.isNotEmpty) street,
      if ((p.subLocality ?? '').trim().isNotEmpty) p.subLocality!.trim(),
      if ((p.locality ?? '').trim().isNotEmpty) p.locality!.trim(),
    ];
    // Только город — это не адрес: мастеру такая строка не поможет, а человеку
    // покажется, что приложение уже всё заполнило
    if (parts.isEmpty || (parts.length == 1 && street.isEmpty)) return null;
    return parts.join(', ');
  } catch (_) {
    return null;
  }
}
