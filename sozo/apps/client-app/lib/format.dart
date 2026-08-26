import 'i18n.dart';

/// Форматы денег и дат (DEV-08 §1). Единственное место, где числа сервера
/// превращаются в текст: иначе «1250000 UZS» рано или поздно вылезет на экран.

const _nbsp = ' '; // неразрывный пробел: сумма не должна рваться переносом

/// Сумма из тиынов: «1 250 000 сум». Копеек нет — округляем до целого сума.
///
/// **До сотни округлять нельзя.** Так было раньше, и на экране оплаты это
/// давало прямую ложь: к списанию 128 950, на экране «129 000», списывалось
/// 128 950. Сервер считает точно (`client-orders.controller`, `amountTiyin`),
/// приложение мастера показывает точно — расходился только клиент, и ровно
/// там, где человек читает число как обещание. Разница в полсотни сумов
/// ничего не стоит, а «мне показали не ту сумму» стоит доверия к чеку.
String soums(Object? tiyin, {bool withUnit = true}) {
  final v = _num(tiyin);
  if (v == null) return '—';
  final rounded = (v / 100).round(); // тиыны → сумы, копеек в обороте нет
  final sign = rounded < 0 ? '−' : ''; // именно минус, а не дефис (DEV-08 §1)
  final digits = rounded.abs().toString();
  final buf = StringBuffer();
  for (var i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 == 0) buf.write(_nbsp);
    buf.write(digits[i]);
  }
  return '$sign$buf${withUnit ? '$_nbsp${t('common.soums')}' : ''}';
}

/// Цена «от»: «от 80 000 сум» по-русски, «80 000 soʻmdan» по-узбекски.
///
/// Через ключ-фразу, а не склейкой «предлог + сумма»: в узбекском «от» — это
/// суффикс `-dan`, и склейка спереди давала «dan 80 000 soʻm». Строка эта —
/// самая частая в приложении, она стоит на каждой плитке каталога.
String priceFrom(Object? tiyin) => t('common.priceFrom', {'p1': soums(tiyin)});

/// Вилка «от 150 000 до 300 000 сум»; при равных краях — просто сумма.
///
/// Нулевая вилка — не «от 0 сум», а прочерк: ноль в строке «Итого» человек
/// читает как обещание бесплатной работы. Пустой состав заявки объясняется
/// словами на самом экране, а не суммой (см. C-13).
String range(Object? fromTiyin, Object? toTiyin) {
  final f = _num(fromTiyin), tt = _num(toTiyin);
  if (f == null) return '—';
  if (f <= 0 && (tt == null || tt <= 0)) return '—';
  if (tt == null || tt <= f) return priceFrom(f);
  return t('common.priceRange', {'p1': soums(f, withUnit: false), 'p2': soums(tt)});
}

num? _num(Object? v) => v is num ? v : (v == null ? null : num.tryParse('$v'));

// ---------------------------------------------------------------------------
// Время. Одно правило на весь файл, а не два разных.
//
// Раньше половина функций резала ISO-строку по символам (`substring(11, 16)`),
// половина парсила её в `DateTime`, а `window` склеивала оба подхода. Пока
// сервер отдавал местное время без смещения, результат совпадал — и совпадение
// это держалось на честном слове. Как только на сервере появляется явный
// Ташкент (`common/tz.ts`) и строки приезжают с `Z` или `+05:00`, срез строки
// показывает час по Гринвичу, а `DateTime` — по часам устройства: окно приезда
// уезжает на пять часов, а дата — на сутки у всех, кто читает вечером.
//
// Поэтому всё идёт через одну функцию: строка приводится к ташкентскому
// настенному времени, и только потом из него достаются часы, дата и разница.

/// Ташкент — UTC+5 круглый год: перевод часов в Узбекистане отменён в 1995-м,
/// летнего времени нет. Поэтому смещение — константа, а не база часовых поясов:
/// тянуть `timezone` ради одного города дороже, чем эта строка.
const _tashkent = Duration(hours: 5);

/// Настенные часы Ташкента как `DateTime`.
///
/// Помечаем результат как UTC — не потому, что это UTC, а чтобы обе стороны
/// вычитания были одного сорта: разница между «UTC-меченым» и локальным
/// временем считается по абсолютной шкале и даёт лишние пять часов.
DateTime _wall(DateTime d) => DateTime.utc(d.year, d.month, d.day, d.hour, d.minute, d.second);

/// Разбор ISO-строки в ташкентское настенное время.
///
/// Со смещением (`Z`, `+05:00`) `DateTime.parse` отдаёт UTC — переводим в
/// Ташкент. Без смещения сервер прислал уже ташкентское время — берём как есть.
DateTime? tashkent(Object? iso) {
  final d = DateTime.tryParse(iso?.toString() ?? '');
  if (d == null) return null;
  return _wall(d.isUtc ? d.add(_tashkent) : d);
}

/// «Сейчас» по Ташкенту, независимо от часового пояса устройства: человек в
/// командировке смотрит на окно приезда мастера, а не на свои часы
DateTime nowTashkent() => _wall(DateTime.now().toUtc().add(_tashkent));

/// «16:00» из ISO-строки
String hhmm(Object? iso) {
  final d = tashkent(iso);
  return d == null ? '—' : '${_two(d.hour)}:${_two(d.minute)}';
}

/// «2026-08-24» — машинный вид даты для запросов и ключей
String ymd(Object? iso) {
  final d = tashkent(iso);
  return d == null ? '—' : '${d.year}-${_two(d.month)}-${_two(d.day)}';
}

String _two(int v) => v.toString().padLeft(2, '0');

/// Месяц в форме, в которой он стоит в дате: «25 июля», «25-iyul».
/// Из словаря, а не из константы в коде: русские месяцы посреди узбекского
/// интерфейса — самая заметная строка, которая выдаёт непереведённое приложение
String monthName(int month) => t('date.month${month < 1 || month > 12 ? 1 : month}');

/// «25 июля» / «25 июля 2026» — год добавляется только для прошлого года
String dayMonth(Object? iso, {bool withYear = false}) {
  final d = tashkent(iso);
  if (d == null) return '—';
  final s = t('date.dayMonth', {'d': d.day, 'month': monthName(d.month)});
  return withYear || d.year != nowTashkent().year ? t('date.withYear', {'date': s, 'year': d.year}) : s;
}

/// «сегодня», «завтра», «25 июля» — относительный формат DEV-08 §1
String relativeDay(Object? iso) {
  final d = tashkent(iso);
  if (d == null) return '—';
  final now = nowTashkent();
  final days = DateTime.utc(d.year, d.month, d.day)
      .difference(DateTime.utc(now.year, now.month, now.day))
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
  final d = tashkent(iso);
  if (d == null) return '—';
  final mins = d.difference(nowTashkent()).inMinutes;
  if (mins <= 0) return t('common.verySoon');
  if (mins < 60) return t('common.inMinutes', {'n': mins});
  return t('common.aboutAt', {'time': hhmm(iso)});
}

/// Счётное существительное из словаря: «1 заявка / 2 заявки / 5 заявок»,
/// «1 ta ariza / 5 ta ariza», «1 request / 5 requests».
///
/// Формы лежат в словаре тремя ключами `<key>.one|few|many` — русское правило
/// выбирает между всеми тремя, остальные языки различают только единственное
/// и множественное. Раньше формы стояли строками прямо в вызове, и на
/// узбекском интерфейсе счётчики оставались русскими.
String plural(int n, String key) => t('$key.${_pluralForm(n)}', {'n': n});

String _pluralForm(int n) {
  if (l10n.code != 'ru') return n == 1 ? 'one' : 'many';
  final n10 = n % 10, n100 = n % 100;
  if (n10 == 1 && n100 != 11) return 'one';
  if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) return 'few';
  return 'many';
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
