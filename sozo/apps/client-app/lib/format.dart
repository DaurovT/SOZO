import 'i18n.dart';

/// Форматы денег и дат (DEV-08 §1). Единственное место, где числа сервера
/// превращаются в текст: иначе «1250000 UZS» рано или поздно вылезет на экран.

const _nbsp = ' '; // неразрывный пробел: сумма не должна рваться переносом

/// Сумма из тиынов: «1 250 000 сум». Копеек нет, округление до 100 сум.
String soums(Object? tiyin, {bool withUnit = true}) {
  final v = _num(tiyin);
  if (v == null) return '—';
  final rounded = (v / 10000).round() * 100; // тиыны → сумы с округлением до сотни
  final sign = rounded < 0 ? '−' : ''; // именно минус, а не дефис (DEV-08 §1)
  final digits = rounded.abs().toString();
  final buf = StringBuffer();
  for (var i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 == 0) buf.write(_nbsp);
    buf.write(digits[i]);
  }
  return '$sign$buf${withUnit ? '$_nbsp${t('common.soums')}' : ''}';
}

/// Вилка «от 150 000 до 300 000 сум»; при равных краях — просто сумма
String range(Object? fromTiyin, Object? toTiyin) {
  final f = _num(fromTiyin), tt = _num(toTiyin);
  if (f == null) return '—';
  if (tt == null || tt <= f) return '${t('common.from')}$_nbsp${soums(f)}';
  return '${t('common.from')}$_nbsp${soums(f, withUnit: false)} до ${soums(tt)}';
}

num? _num(Object? v) => v is num ? v : (v == null ? null : num.tryParse('$v'));

/// «16:00» из ISO-строки. Обрезаем строку, а не парсим в DateTime:
/// сервер отдаёт местное время Ташкента, а перевод в UTC сдвинул бы окно.
String hhmm(Object? iso) {
  final s = iso?.toString() ?? '';
  return s.length >= 16 ? s.substring(11, 16) : '—';
}

String ymd(Object? iso) {
  final s = iso?.toString() ?? '';
  return s.length >= 10 ? s.substring(0, 10) : '—';
}

const _months = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
];

/// «25 июля» / «25 июля 2026» — год добавляется только для прошлого года
String dayMonth(Object? iso, {bool withYear = false}) {
  final d = DateTime.tryParse(iso?.toString() ?? '');
  if (d == null) return '—';
  final s = '${d.day} ${_months[d.month - 1]}';
  return withYear || d.year != DateTime.now().year ? '$s ${d.year}' : s;
}

/// «сегодня», «завтра», «25 июля» — относительный формат DEV-08 §1
String relativeDay(Object? iso) {
  final d = DateTime.tryParse(iso?.toString() ?? '');
  if (d == null) return '—';
  final now = DateTime.now();
  final days = DateTime(d.year, d.month, d.day)
      .difference(DateTime(now.year, now.month, now.day))
      .inDays;
  if (days == 0) return t('common.today');
  if (days == 1) return t('common.tomorrow');
  return dayMonth(iso);
}

/// «сегодня 16:00–18:00» — окно приезда мастера
String window(Object? fromIso, Object? toIso) {
  if (fromIso == null) return '—';
  final day = relativeDay(fromIso);
  final to = toIso == null ? null : hhmm(toIso);
  return to == null ? '$day ${hhmm(fromIso)}' : '$day ${hhmm(fromIso)}–$to';
}

/// «через 15 мин» / «~16:40» — прогноз приезда
String eta(Object? iso) {
  final d = DateTime.tryParse(iso?.toString() ?? '');
  if (d == null) return '—';
  final mins = d.difference(DateTime.now()).inMinutes;
  if (mins <= 0) return 'уже скоро';
  if (mins < 60) return 'через $mins мин';
  return '~${hhmm(iso)}';
}

/// Русские формы множественного числа: 1 заявка / 2 заявки / 5 заявок
String plural(int n, String one, String few, String many) {
  final n10 = n % 10, n100 = n % 100;
  if (n10 == 1 && n100 != 11) return '$n $one';
  if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) return '$n $few';
  return '$n $many';
}

/// «+998 90 123-45-67» из «+998901234567»
String prettyPhone(String? phone) {
  final digits = (phone ?? '').replaceAll(RegExp(r'\D'), '');
  if (digits.length != 12) return phone ?? '';
  final d = digits.substring(3);
  return '+998 ${d.substring(0, 2)} ${d.substring(2, 5)}-${d.substring(5, 7)}-${d.substring(7)}';
}

/// Маскированный номер для экрана кода: «+998 90 ···-··-45»
String maskedPhone(String? phone) {
  final digits = (phone ?? '').replaceAll(RegExp(r'\D'), '');
  if (digits.length != 12) return phone ?? '';
  final d = digits.substring(3);
  return '+998 ${d.substring(0, 2)} ···-··-${d.substring(7)}';
}
