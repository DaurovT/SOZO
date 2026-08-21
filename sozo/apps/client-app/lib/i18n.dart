import 'dart:ui' show TextDirection;

import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'i18n/dict_ar.dart';
import 'i18n/dict_de.dart';
import 'i18n/dict_en.dart';
import 'i18n/dict_fr.dart';
import 'i18n/dict_ko.dart';
import 'i18n/dict_ru.dart';
import 'i18n/dict_tg.dart';
import 'i18n/dict_tr.dart';
import 'i18n/dict_uz.dart';
import 'i18n/dict_zh.dart';

/// Словарь приложения «Клиент» (DEV-08 §1, чек-лист §6 п.1).
///
/// Своя мини-реализация вместо генератора ARB: зависимость от кодогенерации
/// усложняет сборку, а выигрыша при плоском словаре нет. Ключи — как в DEV-08:
/// `экран.элемент`. Отсутствующий ключ показывает русский вариант, а не пустоту.
///
/// Каждый язык лежит отдельным файлом в `lib/i18n/`. Так было не всегда: пока
/// языков было три, они помещались в один файл. На десяти он вырос бы до девяти
/// тысяч строк, где правка одного языка задевает все остальные.
///
/// Новую строку добавляют сразу во все словари. Если перевода нет, экран
/// покажет русский — это лучше пустоты, но считается недоделкой.
class L10n extends ChangeNotifier {
  static const _key = 'sozo_client_locale';
  String _code = 'ru';

  /// Языки приложения. Русский — язык-основа: на нём написаны ключи,
  /// и он же служит запасным вариантом, когда перевода нет.
  static const codes = ['ru', 'uz', 'en', 'tr', 'tg', 'ar', 'fr', 'de', 'zh', 'ko'];

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

  static const _dicts = <String, Map<String, String>>{
    'uz': uzDict,
    'en': enDict,
    'tr': trDict,
    'tg': tgDict,
    'ar': arDict,
    'fr': frDict,
    'de': deDict,
    'zh': zhDict,
    'ko': koDict,
  };

  String get code => _code;
  bool get isUz => _code == 'uz';
  bool get isEn => _code == 'en';

  /// Направление письма выбранного языка. Читают его `MaterialApp` и экраны,
  /// где раскладка задана вручную и `Directionality` сама её не перевернёт.
  TextDirection get direction =>
      rtlCodes.contains(_code) ? TextDirection.rtl : TextDirection.ltr;

  bool get isRtl => rtlCodes.contains(_code);

  String get name => names[_code] ?? _code;

  Future<void> load() async {
    final prefs = await SharedPreferences.getInstance();
    final saved = prefs.getString(_key);
    _code = codes.contains(saved) ? saved! : 'ru';
    notifyListeners();
  }

  Future<void> set(String code) async {
    if (!codes.contains(code) || code == _code) return;
    _code = code;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_key, code);
    notifyListeners(); // C-30: язык применяется мгновенно, без перезапуска
  }

  /// Словарь выбранного языка. Русского словаря здесь нет намеренно — русский
  /// и есть значение по умолчанию, поэтому `ruDict` стоит последним звеном в `t`.
  Map<String, String>? get _dict => _dicts[_code];

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
