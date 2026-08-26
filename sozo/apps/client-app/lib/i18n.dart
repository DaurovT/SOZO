import 'dart:convert';
import 'dart:ui' show PlatformDispatcher, TextDirection;

import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

import 'i18n/dict_en.dart';
import 'i18n/dict_ru.dart';
import 'i18n/dict_uz.dart';

/// Словарь приложения «Клиент» (DEV-08 §1, чек-лист §6 п.1).
///
/// Своя мини-реализация вместо генератора ARB: зависимость от кодогенерации
/// усложняет сборку, а выигрыша при плоском словаре нет. Ключи — как в DEV-08:
/// `экран.элемент`. Отсутствующий ключ показывает русский вариант, а не пустоту.
///
/// **Языки делятся на два сорта.** Русский, узбекский и английский собраны
/// внутрь приложения: это языки Ташкента, на них приходит подавляющее
/// большинство, и первый экран обязан открыться без сети. Остальные семь
/// весят вместе больше, чем весь остальной код приложения, а нужны единицам —
/// поэтому лежат на сервере и приезжают при выборе языка, один раз, после
/// чего живут в кеше устройства.
///
/// Из этого следует вся асинхронность ниже: `set` для встроенного языка
/// срабатывает мгновенно, а для догружаемого возвращает будущее и по дороге
/// сообщает о ходе загрузки через `status`, чтобы экран показал лоадер, а не
/// замер без объяснений.
enum LocaleStatus { idle, loading, failed }

class L10n extends ChangeNotifier {
  static const _keyCode = 'sozo_client_locale';
  static const _keyDict = 'sozo_client_locale_dict_';
  static const _keyRev = 'sozo_client_locale_rev_';
  static const _keyBase = 'sozo_client_base'; // тот же ключ, что у сессии

  static const _defaultBase =
      String.fromEnvironment('SOZO_API', defaultValue: 'https://api.sozo.uz');

  String _code = 'ru';
  Map<String, String>? _remote;
  LocaleStatus _status = LocaleStatus.idle;
  String? _loadingCode;

  /// Языки приложения. Русский — язык-основа: на нём написаны ключи,
  /// и он же служит запасным вариантом, когда перевода нет.
  static const codes = ['ru', 'uz', 'en', 'tr', 'tg', 'ar', 'fr', 'de', 'zh', 'ko'];

  /// Языки, собранные внутрь приложения. Порядок тот же, что в `codes`.
  static const builtIn = {'ru', 'uz', 'en'};

  /// Подпись языка в выборе — на самом языке, а не по-русски. Человек,
  /// которому нужен корейский, ищет глазами «한국어», а не слово «Корейский»,
  /// написанное алфавитом, которого он не знает.
  static const names = <String, String>{
    'ru': 'Русский',
    'uz': 'Oʻzbekcha',
    'en': 'English',
    'tr': 'Türkçe',
    'tg': 'Тоҷикӣ',
    'ar': 'العربية',
    'fr': 'Français',
    'de': 'Deutsch',
    'zh': '中文',
    'ko': '한국어',
  };

  /// Двухбуквенный код для компактного переключателя на экране входа.
  static const shortNames = <String, String>{
    'ru': 'RU',
    'uz': 'UZ',
    'en': 'EN',
    'tr': 'TR',
    'tg': 'TJ',
    'ar': 'AR',
    'fr': 'FR',
    'de': 'DE',
    'zh': 'ZH',
    'ko': 'KO',
  };

  /// Языки справа налево. Пока такой один, но список честнее булева поля:
  /// фарси и иврит добавляются сюда, а не правкой условия по всему коду.
  static const rtlCodes = {'ar'};

  static const _builtInDicts = <String, Map<String, String>>{
    'uz': uzDict,
    'en': enDict,
  };

  String get code => _code;
  bool get isUz => _code == 'uz';
  bool get isEn => _code == 'en';

  /// Идёт ли сейчас загрузка словаря и какого языка — читает переключатель
  LocaleStatus get status => _status;
  String? get loadingCode => _loadingCode;

  /// Догружается ли язык. По этому признаку переключатель решает, показывать
  /// ли рядом с языком значок «нужна сеть».
  static bool isRemote(String code) => !builtIn.contains(code);

  /// Направление письма выбранного языка. Читают его `MaterialApp` и экраны,
  /// где раскладка задана вручную и `Directionality` сама её не перевернёт.
  TextDirection get direction =>
      rtlCodes.contains(_code) ? TextDirection.rtl : TextDirection.ltr;

  bool get isRtl => rtlCodes.contains(_code);

  String get name => names[_code] ?? _code;

  /// Язык устройства, если приложение его знает.
  ///
  /// Первый запуск обязан открыться на языке телефона: узбекоязычный человек
  /// не должен искать переключатель, чтобы прочитать первый экран. Смотрим
  /// весь список системных языков по порядку — на телефоне их обычно два, и
  /// второй бывает единственным, который мы поддерживаем.
  ///
  /// Догружаемые языки сюда не годятся: словаря для них ещё нет на устройстве,
  /// а запуск не должен ждать сети. Такой человек выберет язык руками — и со
  /// следующего запуска он поднимется из кеша.
  static String? _systemCode() {
    for (final l in PlatformDispatcher.instance.locales) {
      final code = l.languageCode.toLowerCase();
      if (builtIn.contains(code)) return code;
    }
    return null;
  }

  /// Восстановление языка при запуске.
  ///
  /// Догружаемый язык поднимаем из кеша, а не из сети: запуск не должен
  /// зависеть от связи. Если кеша нет — человек переустановил приложение или
  /// почистил данные — честно откатываемся на русский, а не показываем пустой
  /// интерфейс в ожидании ответа сервера.
  Future<void> load() async {
    final prefs = await SharedPreferences.getInstance();
    final saved = prefs.getString(_keyCode);
    if (saved == null || !codes.contains(saved)) {
      // Выбора ещё не было — берём язык телефона. Записываем сразу: иначе
      // человек, сменивший язык системы после установки, получил бы другой
      // интерфейс, ничего у себя не меняя
      _code = _systemCode() ?? 'ru';
      await prefs.setString(_keyCode, _code);
      notifyListeners();
      return;
    }
    if (builtIn.contains(saved)) {
      _code = saved;
      notifyListeners();
      return;
    }
    final cached = _readCache(prefs, saved);
    if (cached != null) {
      _code = saved;
      _remote = cached;
    } else {
      _code = 'ru';
      await prefs.setString(_keyCode, 'ru');
    }
    notifyListeners();
  }

  /// Смена языка. Встроенный применяется мгновенно (C-30), догружаемый —
  /// после загрузки словаря; `false` означает, что язык не сменился и экран
  /// должен показать причину.
  Future<bool> set(String code) async {
    if (!codes.contains(code) || code == _code) return true;
    final prefs = await SharedPreferences.getInstance();

    if (builtIn.contains(code)) {
      _code = code;
      _remote = null;
      _status = LocaleStatus.idle;
      await prefs.setString(_keyCode, code);
      notifyListeners();
      return true;
    }

    // Кеш есть — применяем сразу, не заставляя ждать сеть ради того, что
    // уже лежит на устройстве. Обновление отпечатка проверим следующим разом
    final cached = _readCache(prefs, code);
    if (cached != null) {
      _code = code;
      _remote = cached;
      _status = LocaleStatus.idle;
      await prefs.setString(_keyCode, code);
      notifyListeners();
      return true;
    }

    _status = LocaleStatus.loading;
    _loadingCode = code;
    notifyListeners();

    final dict = await _download(prefs, code);
    _loadingCode = null;
    if (dict == null) {
      _status = LocaleStatus.failed;
      notifyListeners();
      return false;
    }

    _code = code;
    _remote = dict;
    _status = LocaleStatus.idle;
    await prefs.setString(_keyCode, code);
    notifyListeners(); // C-30: язык применяется без перезапуска
    return true;
  }

  /// Сбросить сообщение об ошибке — экран зовёт при закрытии листа выбора
  void clearError() {
    if (_status != LocaleStatus.failed) return;
    _status = LocaleStatus.idle;
    notifyListeners();
  }

  Map<String, String>? _readCache(SharedPreferences prefs, String code) {
    final raw = prefs.getString('$_keyDict$code');
    if (raw == null) return null;
    try {
      final decoded = (jsonDecode(raw) as Map).cast<String, dynamic>();
      return decoded.map((k, v) => MapEntry(k, '$v'));
    } catch (_) {
      // Кеш побился — ведём себя так, будто его нет, и качаем заново
      return null;
    }
  }

  /// Адрес сервера берём из тех же настроек, что и сессия, но читаем сами:
  /// язык выбирают на экране входа, когда сессии ещё нет, а тянуть её сюда
  /// значило бы завязать словарь на авторизацию, которой он не требует.
  Future<Map<String, String>?> _download(SharedPreferences prefs, String code) async {
    final base = (prefs.getString(_keyBase) ?? _defaultBase).replaceAll(RegExp(r'/+$'), '');
    try {
      final r = await http
          .get(Uri.parse('$base/v1/public/app-locale/$code'))
          .timeout(const Duration(seconds: 20));
      if (r.statusCode != 200) return null;
      final body = jsonDecode(utf8.decode(r.bodyBytes)) as Map<String, dynamic>;
      final strings = (body['strings'] as Map).cast<String, dynamic>();
      if (strings.isEmpty) return null;
      final dict = strings.map((k, v) => MapEntry(k, '$v'));
      await prefs.setString('$_keyDict$code', jsonEncode(dict));
      await prefs.setString('$_keyRev$code', '${body['rev'] ?? ''}');
      return dict;
    } catch (_) {
      // Сеть, таймаут, недоступный сервер — для человека это одно и то же:
      // язык сейчас не поставить. Разбирать причину незачем
      return null;
    }
  }

  /// Обновление словарей в фоне: сверяем отпечаток и перекачиваем, если
  /// перевод правили. Вызывается после входа, когда сеть заведомо есть.
  ///
  /// Ошибки глотаем молча: человек пользуется приложением на языке, который
  /// у него уже есть, и мешать ему сообщением о неудавшейся проверке нечем.
  Future<void> refreshInBackground() async {
    if (builtIn.contains(_code)) return;
    final prefs = await SharedPreferences.getInstance();
    final base = (prefs.getString(_keyBase) ?? _defaultBase).replaceAll(RegExp(r'/+$'), '');
    try {
      final r = await http
          .get(Uri.parse('$base/v1/public/app-locale'))
          .timeout(const Duration(seconds: 10));
      if (r.statusCode != 200) return;
      final list = (jsonDecode(utf8.decode(r.bodyBytes)) as List).cast<Map<String, dynamic>>();
      final fresh = list.firstWhere((e) => e['code'] == _code, orElse: () => const {});
      if (fresh.isEmpty) return;
      if (prefs.getString('$_keyRev$_code') == fresh['rev']) return;
      final dict = await _download(prefs, _code);
      if (dict != null) {
        _remote = dict;
        notifyListeners();
      }
    } catch (_) {
      // см. комментарий выше
    }
  }

  /// Словарь выбранного языка. Русского здесь нет намеренно — русский и есть
  /// значение по умолчанию, поэтому `ruDict` стоит последним звеном в `t`.
  Map<String, String>? get _dict => _builtInDicts[_code] ?? _remote;

  /// Подстановка параметров ICU-стиля: t('x', {'sum': '120 000 сум'})
  ///
  /// Пропущенный перевод отдаёт русскую строку, а не пустоту и не ключ:
  /// незнакомое слово на чужом языке человек хотя бы сможет узнать по виду,
  /// «c14.quickTitle» — нет.
  String t(String key, [Map<String, Object?>? args]) {
    var s = _dict?[key] ?? ruDict[key] ?? key;
    if (args != null) {
      args.forEach((k, v) => s = s.replaceAll('{$k}', '${v ?? ''}'));
    }
    return s;
  }
}

/// Единственный экземпляр: язык — свойство приложения, а не экрана
final l10n = L10n();

String t(String key, [Map<String, Object?>? args]) => l10n.t(key, args);
