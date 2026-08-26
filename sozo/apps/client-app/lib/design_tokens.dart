import 'package:flutter/material.dart';

/// Токены дизайна — единственное место с hex-значениями (DEV-06 §2).
/// В коде экранов запрещены Color(0xFF...), Colors.* (кроме transparent),
/// числовые радиусы и EdgeInsets вне шкалы.
///
/// Палитра выведена из фирменного знака: янтарь #FEB70F на почти-чёрном #141518.
abstract final class SozoColors {
  /// Фон страницы — холодный светло-серый, чтобы белые карточки читались как слои
  static const bg = Color(0xFFF4F5F7);
  static const surface = Color(0xFFFFFFFF);
  static const text = Color(0xFF141518);

  /// Второй уровень. Был #8E939F — 3,0:1 на белом: подписи с ценой и окном
  /// приезда физически не читались пожилым глазом. Поднят до 5,9:1
  static const textSecondary = Color(0xFF5E6472);

  /// Третий уровень: единицы измерения, счётчики, служебные подписи.
  /// Был #B4B4BD — 2,1:1; поднят до 4,8:1 (аудит клиентского приложения, п.7)
  static const textTertiary = Color(0xFF6B7280);

  /// Акцент из знака: главная кнопка экрана, активная вкладка, деньги мастера.
  ///
  /// **Только заливка, не текст.** Янтарь на белом даёт 1,75:1 — надпись им
  /// не читается вовсе. Для текста-действия есть `SozoColors.link`
  static const accent = Color(0xFFFEB70F);
  static const accentPressed = Color(0xFFE0A00A);

  /// Текст на янтарном фоне: янтарь слишком светлый, белое по нему не читается
  static const onAccent = Color(0xFF141518);

  static const success = Color(0xFF2FA36B);
  static const warning = Color(0xFFF08C1E);
  static const error = Color(0xFFE0483D);

  /// Синий — «принято»: состояние подтверждено кем-то снаружи
  static const info = Color(0xFF3D6BF5);

  /// Фиолетовый — «новое»: требует внимания, но не тревожное
  static const fresh = Color(0xFF7A5AF8);

  /// Текст-действие: ссылка, «Изменить», «Не знаю, что сломалось».
  /// Тёмный с подчёркиванием вместо янтаря — 18:1 против 1,75:1
  static const link = Color(0xFF141518);

  static const border = Color(0xFFE5E7EB);

  /// Разделитель внутри карточки — светлее внешней границы
  static const divider = Color(0xFFF2F2F5);

  /// Подложка мелких тегов и рамка QR-контейнера (макет 43:40)
  static const chipGrey = Color(0xFFF0F1F5);
}

/// Скругления. Одна лестница на всё приложение:
/// карточка и модалка 20 → кнопка и плитка 16 → поле и плашка 12 → бейдж 8.
/// В макете скругления карточек гуляли от 12 до 24 — свели к 20,
/// иначе соседние экраны выглядят собранными из разных приложений.
abstract final class SozoRadius {
  static const card = 20.0;
  static const button = 14.0;
  static const field = 12.0;
  static const chip = 999.0;

  /// Плашка-заметка и миниатюра в карточке заявки
  static const thumb = 12.0;

  /// Кнопка, плитка показателя, активная вкладка тоггла
  static const tile = 16.0;
  static const toggleTab = 9.0;

  /// Мелкий бейдж внутри карточки (макет 26:229)
  static const badge = 8.0;

  /// Флажок (макет 41:57)
  static const s4 = 4.0;
}

/// Тень плавающей карточки над картой: 0 8 12 при 10% (макет 26:224)
const sozoFloatShadow = [
  BoxShadow(color: Color(0x1A000000), blurRadius: 12, offset: Offset(0, 8)),
];

/// Тень пина на карте: 0 4 4 при 20% (макет 26:220)
const sozoMarkerShadow = [
  BoxShadow(color: Color(0x33000000), blurRadius: 4, offset: Offset(0, 4)),
];

/// Шкала отступов; промежуточные значения (10, 14, 20) запрещены (DEV-06 §2.3)
abstract final class SozoSpace {
  static const s4 = 4.0;
  static const s8 = 8.0;
  static const s12 = 12.0;

  /// Вертикаль ряда меню в макете профиля (256:4): 14 + иконка 20 + 14 = 48
  static const s14 = 14.0;
  static const s16 = 16.0;

  /// Зазор между секциями настроек (256:4) — шире внутреннего, чтобы блоки
  /// «Настройки», «Мои данные», «Деньги» читались как отдельные, а не как один
  /// длинный список
  static const s20 = 20.0;
  static const s24 = 24.0;
  static const s32 = 32.0;
}

/// Высоты интерактивных элементов: под палец в перчатке (DEV-09 §5 п.1)
abstract final class SozoSize {
  static const buttonPrimary = 56.0;
  static const buttonSecondary = 48.0;
  static const field = 56.0;
  static const thumb = 64.0;
  static const shutter = 72.0;
  static const preview = 56.0;
}

/// Единая функция статусных цветов — одна на все продукты (DEV-06 §4.3)
Color statusColor(String status) {
  switch (status) {
    case 'new':
      return SozoColors.fresh; // новая — требует внимания
    case 'estimated':
    case 'pending_approval':
      return SozoColors.textSecondary; // ждём решения снаружи
    case 'approved':
    case 'assigned':
      return SozoColors.info; // принято и зафиксировано
    case 'master_departed':
    case 'in_progress':
    case 'addwork_approval':
      return SozoColors.accent; // работа идёт
    case 'completed':
    case 'verified':
    case 'awaiting_payment':
    case 'closed':
    case 'rated':
      return SozoColors.success;
    case 'dispute':
      return SozoColors.error;
    case 'cancelled':
      return SozoColors.textSecondary;
    default:
      return SozoColors.textSecondary;
  }
}

/// Пары «фон / текст» статусных бейджей.
/// Пастель здесь намеренная: на белой карточке три статуса должны различаться
/// с расстояния вытянутой руки, одной насыщенности для этого мало.
///
/// Текст затемнён относительно макета: там пары давали 3,1–3,6:1, и «в работе»
/// на жёлтой плашке пропадало. Теперь каждая пара — не меньше 4,7:1.
({Color bg, Color fg}) statusChipColors(String status) {
  switch (status) {
    case 'assigned':
    case 'approved':
      return (bg: const Color(0xFFEFF6FF), fg: const Color(0xFF1D4ED8));
    case 'master_departed':
      return (bg: const Color(0xFFFFF7ED), fg: const Color(0xFFC2410C));
    case 'in_progress':
    case 'addwork_approval':
      return (bg: const Color(0xFFFFFBEB), fg: const Color(0xFFA16207));
    case 'completed':
    case 'verified':
    case 'closed':
    case 'rated':
      return (bg: const Color(0xFFECFDF5), fg: const Color(0xFF047857));
    case 'dispute':
      return (bg: const Color(0xFFFEE2E2), fg: const Color(0xFFB91C1C));
    case 'new':
      return (bg: const Color(0xFFF5F3FF), fg: const Color(0xFF6D28D9));
    default:
      return (bg: const Color(0xFFF4F5F7), fg: const Color(0xFF5E6472));
  }
}

/// Срочность — та же пастельная пара, но всегда красная (макет 21:66)
const urgentChipBg = Color(0xFFFEE2E2);
const urgentChipFg = Color(0xFFB91C1C);

/// Пастельные плашки-заметки внутри карточек (макет 30:52, 30:110, 30:83).
/// Те же три пары, что и у статусных бейджей: жёлтая — «мешает», красная —
/// «нельзя», зелёная — «сделано».
const softWarnBg = Color(0xFFFFFBEB);
const softWarnFg = Color(0xFFA16207);
const softDangerBg = Color(0xFFFEE2E2);
const softDangerFg = Color(0xFFB91C1C);
const softSuccessBg = Color(0xFFECFDF5);
const softSuccessFg = Color(0xFF047857);

/// Карточка дохода: градиент слева направо (макет 25:213)
const earningsGradient = [Color(0xFF1E2235), Color(0xFF2D3250)];
const earningsCaption = Color(0xFF9CA3AF);
const earningsSub = Color(0xFF6B7280);

/// Тост: тёмная плашка из макета (43:244)
const toastBg = Color(0xFF1E2235);

/// Кошелёк (макет 51:16): начисления зелёным, дорожка прогресса светло-серая
const incomeGreen = Color(0xFF24A148);
const trackGrey = Color(0xFFE5E5EA);

/// Тень удостоверения на тёмном фоне (макет 58:669): карточку надо
/// «оторвать» от фона, иначе она читается как часть экрана
const badgeShadow = [BoxShadow(color: Color(0x4D000000), blurRadius: 32, offset: Offset(0, 12))];

/// Плашка-объяснение правила (макет 53:746): тёплая, не тревожная
const adminNoteBg = Color(0xFFFDF6EC);
const adminNoteBorder = Color(0xFFFBECDD);
const adminNoteFg = Color(0xFFB25E09);

/// Рамка жёлтой плашки-предупреждения и кнопки «+» (макет 53:634)
const bannerBorder = Color(0xFFFDE68A);

/// Красная заливка кнопки-предупреждения (макет 58:812). Отличается
/// от softDangerFg: у заливки текст белый, и нужен тон потемнее
const dangerSolid = Color(0xFFD94545);

/// Аватар на удостоверении — кремовый, а не янтарный: под ним белая обводка,
/// и полный янтарь спорил бы с шапкой (макет 58:675)
const badgeAvatarBg = Color(0xFFFFF7DF);

/// Полосы в разбивке рейтинга (макет 58:599): зелёная — норма,
/// оранжевая — то, что тянет балл вниз
const barTrackGood = Color(0xFFDCFCE7);
const barTrackWeak = Color(0xFFFFE5D9);
const barWeak = Color(0xFFF97316);

/// Подсказка роста до следующего грейда (макет 58:590)
const growthBg = Color(0xFFFEF9E6);
const growthBorder = Color(0xFFFDEAA6);

/// Поля и календарь в модалках (макет 58:133): подложка чуть холоднее белой,
/// чтобы поле читалось на белой карточке без жирной рамки
const fieldBg = Color(0xFFFAFBFC);
const placeholderGrey = Color(0xFF6B7280);
const dayOutside = Color(0xFFC1C6D0);

/// Кнопка «Отмена» в модалке (макет 58:250)
const cancelBg = Color(0xFFFFF8EB);
const cancelFg = Color(0xFF9A6700);

/// Бейдж «на рассмотрении» — фиолетовый: решение принимает не мастер (макет 51:201)
const pendingBadgeBg = Color(0xFFEFEFFC);
const pendingBadgeFg = Color(0xFF6458F5);

/// Активная вкладка тоггла «Сегодня / Завтра» (макет 21:37)
const toggleActiveBg = Color(0xFFFFF7E6);

// ---------- Вход: макет клиента 161:1569, 165:15, 167:1587 ----------
//
// Макет входа нарисован отдельной палитрой, и сводить её к общим токенам
// нельзя: янтарь на заставке светлее фирменного (#FFBB1C против #FEB70F),
// а текст — синевато-чёрный #1E2235 вместо #141518. Это видно рядом, поэтому
// значения перенесены как есть, а не «примерно тем же цветом».

/// Заставка: кнопка «Войти / Регистрация» и активный язык (162:23, 165:5)
const authAmber = Color(0xFFFFBB1C);

/// Заголовки, подписи кнопок и цифры кода (162:24, 165:27)
const authInk = Color(0xFF1E2235);

/// Подпись под логотипом и неактивные языки (162:19, 165:12)
const authMuted = Color(0xFF63656B);

/// Плитка преимущества на заставке (162:28)
const authFeatureBg = Color(0xFFFFFBF2);
const authFeatureBorder = Color(0xFFFFEFC4);

/// Подпись поля и плейсхолдер на экране телефона (165:32, 165:36).
/// Затемнён с #8E93A3 (3,1:1): по этой подписи человек понимает, что вводит
const authLabel = Color(0xFF5E6472);

/// Служебные строки на экране кода: «Отправили код…», таймер (167:1623).
///
/// Второй по массовости цвет приложения: им набраны цены «от», окно приезда,
/// адрес и номер заявки. В макете #8F94A3 — 3,0:1 на белом, то есть ниже
/// порога для текста любого размера. Поднят до 5,9:1
const authHint = Color(0xFF5E6472);

/// Текст согласий в карточке (167:1655)
const authBodyInk = Color(0xFF1F2126);
const authCheckboxBorder = Color(0xFFD1D4DB);

/// Разделитель внутри карточки согласий (167:1656) — светлее общего border
const authCardDivider = Color(0xFFEBEDF0);

/// Кнопка, пока условия не выполнены (165:41)
const authDisabledBg = Color(0xFFDCDFE6);
const authDisabledFg = Color(0xFF90939F);

/// Ячейка кода: 0 2 8 при 6% (167:1642)
const authCodeShadow = [
  BoxShadow(color: Color(0x0F000000), blurRadius: 8, offset: Offset(0, 2)),
];

/// Денежные суммы — табличные цифры: колонки сумм выравниваются по разрядам
const moneyFeatures = [FontFeature.tabularFigures()];

/// Тёмной темы в MVP нет — darkTheme не закладывать (DEV-06 §5)
ThemeData sozoTheme() {
  return ThemeData(
    useMaterial3: true,
    scaffoldBackgroundColor: SozoColors.bg,
    colorScheme: ColorScheme.fromSeed(
      seedColor: SozoColors.accent,
      primary: SozoColors.accent,
      onPrimary: SozoColors.onAccent,
      surface: SozoColors.surface,
      error: SozoColors.error,
    ),
    fontFamily: null, // только системные шрифты (DEV-06 §3)
    appBarTheme: const AppBarTheme(
      backgroundColor: SozoColors.bg,
      surfaceTintColor: Colors.transparent,
      foregroundColor: SozoColors.text,
      elevation: 0,
      scrolledUnderElevation: 0,
      centerTitle: true,
      titleTextStyle: TextStyle(fontSize: 17, fontWeight: FontWeight.w600, color: SozoColors.text),
    ),
    dividerTheme: const DividerThemeData(color: SozoColors.divider, thickness: 1, space: 1),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: SozoColors.surface,
      contentPadding: const EdgeInsets.all(SozoSpace.s12),
      labelStyle: const TextStyle(color: SozoColors.textSecondary, fontSize: 14),
      hintStyle: const TextStyle(color: SozoColors.textSecondary, fontSize: 14),
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(SozoRadius.field),
        borderSide: const BorderSide(color: SozoColors.border),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(SozoRadius.field),
        borderSide: const BorderSide(color: SozoColors.border),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(SozoRadius.field),
        borderSide: const BorderSide(color: SozoColors.accent, width: 1.5),
      ),
      errorBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(SozoRadius.field),
        borderSide: const BorderSide(color: SozoColors.error),
      ),
    ),
    segmentedButtonTheme: SegmentedButtonThemeData(
      style: ButtonStyle(
        backgroundColor: WidgetStateProperty.resolveWith(
          (s) => s.contains(WidgetState.selected) ? SozoColors.accent.withValues(alpha: 0.16) : SozoColors.surface,
        ),
        foregroundColor: WidgetStateProperty.resolveWith(
          (s) => s.contains(WidgetState.selected) ? SozoColors.text : SozoColors.textSecondary,
        ),
        side: WidgetStateProperty.all(const BorderSide(color: SozoColors.border)),
        textStyle: WidgetStateProperty.all(const TextStyle(fontSize: 14, fontWeight: FontWeight.w600)),
        shape: WidgetStateProperty.all(RoundedRectangleBorder(borderRadius: BorderRadius.circular(SozoRadius.button))),
      ),
    ),
    chipTheme: ChipThemeData(
      backgroundColor: SozoColors.surface,
      selectedColor: SozoColors.accent.withValues(alpha: 0.16),
      side: const BorderSide(color: SozoColors.border),
      labelStyle: const TextStyle(fontSize: 14, color: SozoColors.text),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(SozoRadius.chip)),
    ),
    listTileTheme: const ListTileThemeData(iconColor: SozoColors.textSecondary),
    progressIndicatorTheme: const ProgressIndicatorThemeData(color: SozoColors.accent),
    dialogTheme: DialogThemeData(
      backgroundColor: SozoColors.surface,
      surfaceTintColor: Colors.transparent,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(SozoRadius.card)),
    ),
    bottomSheetTheme: const BottomSheetThemeData(
      backgroundColor: SozoColors.surface,
      surfaceTintColor: Colors.transparent,
    ),
  );
}

// ---------------------------------------------------------------------------
// Главная (макет 190:5). Цвета взяты из узла как есть — там своя палитра
// красного и зелёного, отличная от общесистемной на несколько единиц.
// Держим их отдельными константами, а не подгоняем токены: экран сверяется
// с макетом пиксель в пиксель, а общие статусы живут своей жизнью.
const homeDanger = Color(0xFFDF3838);
const homeDebtBg = Color(0xFFFDEEF0);
const homeDebtIconBg = Color(0xFFFAD0D5);
const homeEmergencyBg = Color(0xFFFEEBEB);
const homeOkChipBg = Color(0xFFEBFBEE);
const homeOkChipFg = Color(0xFF22C55E);

/// Оформление заявки (макет 223:4): рамка невыбранного чекбокса
const wizardCheckboxBorder = Color(0xFFD1D6E0);

/// Диалоги (макет 234:69): фон второй кнопки
const dialogSecondaryBg = Color(0xFFF0F1F4);

/// Перенос времени (макет 242:181): плашка «мастер будет назначен заново»
const rescheduleWarnBg = Color(0xFFFFF8E1);
const rescheduleWarnFg = Color(0xFF9A5A0F);

/// Список заявок (макет 248:2186): рамка невыбранного фильтра
const chipOutline = Color(0xFFE0E0E0);

/// Серая таблетка карточки заявки (242:100): быстрые сообщения и «Перенести».
/// Нейтральная намеренно — это подсказки, а не действие экрана
const neutralPillBg = Color(0xFFF0F0F2);

/// Нижние ссылки карточки заявки (242:110): жалоба серая, отмена красная.
/// Разный вес не случаен: пожаловаться можно и передумать, отменить — нет
const linkMuted = Color(0xFF5E6472);
const linkDanger = Color(0xFFC62828);

/// Бейдж «платили в прошлый раз» на выборе оплаты (макет 264:27)
const payLastUsedBg = Color(0xFFEBF5FF);
const payLastUsedFg = Color(0xFF2563EB);

/// Плашка-пояснение про платёжного провайдера (264:63): холодная серо-синяя,
/// чтобы не спорить с янтарём выбранного способа
const payNoteBg = Color(0xFFEBF1F5);
const payNoteFg = Color(0xFF475569);

/// Рамка радиокнопки способа оплаты (264:30) и невыбранного чипа техники
const radioOutline = Color(0xFFD1D6E0);
