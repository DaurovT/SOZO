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
  static const textSecondary = Color(0xFF8E939F);

  /// Третий уровень: единицы измерения, счётчики, служебные подписи
  static const textTertiary = Color(0xFFB4B4BD);

  /// Акцент из знака: главная кнопка экрана, активная вкладка, деньги мастера
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
const sozoFloatShadow = [BoxShadow(color: Color(0x1A000000), blurRadius: 12, offset: Offset(0, 8))];

/// Тень пина на карте: 0 4 4 при 20% (макет 26:220)
const sozoMarkerShadow = [BoxShadow(color: Color(0x33000000), blurRadius: 4, offset: Offset(0, 4))];

/// Шкала отступов; промежуточные значения (10, 14, 20) запрещены (DEV-06 §2.3)
abstract final class SozoSpace {
  static const s4 = 4.0;
  static const s8 = 8.0;
  static const s12 = 12.0;
  static const s16 = 16.0;
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

/// Пары «фон / текст» статусных бейджей — взяты из макета как есть.
/// Пастель здесь намеренная: на белой карточке три статуса должны различаться
/// с расстояния вытянутой руки, одной насыщенности для этого мало.
({Color bg, Color fg}) statusChipColors(String status) {
  switch (status) {
    case 'assigned':
    case 'approved':
      return (bg: const Color(0xFFEFF6FF), fg: const Color(0xFF3B82F6));
    case 'master_departed':
      return (bg: const Color(0xFFFFF7ED), fg: const Color(0xFFEA580C));
    case 'in_progress':
    case 'addwork_approval':
      return (bg: const Color(0xFFFFFBEB), fg: const Color(0xFFD97706));
    case 'completed':
    case 'verified':
    case 'closed':
    case 'rated':
      return (bg: const Color(0xFFECFDF5), fg: const Color(0xFF059669));
    case 'dispute':
      return (bg: const Color(0xFFFEE2E2), fg: const Color(0xFFEF4444));
    case 'new':
      return (bg: const Color(0xFFF5F3FF), fg: const Color(0xFF7C3AED));
    default:
      return (bg: const Color(0xFFF4F5F7), fg: const Color(0xFF8E939F));
  }
}

/// Срочность — та же пастельная пара, но всегда красная (макет 21:66)
const urgentChipBg = Color(0xFFFEE2E2);
const urgentChipFg = Color(0xFFEF4444);

/// Пастельные плашки-заметки внутри карточек (макет 30:52, 30:110, 30:83).
/// Те же три пары, что и у статусных бейджей: жёлтая — «мешает», красная —
/// «нельзя», зелёная — «сделано».
const softWarnBg = Color(0xFFFFFBEB);
const softWarnFg = Color(0xFFD97706);
const softDangerBg = Color(0xFFFEE2E2);
const softDangerFg = Color(0xFFEF4444);
const softSuccessBg = Color(0xFFECFDF5);
const softSuccessFg = Color(0xFF10B981);

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
const placeholderGrey = Color(0xFFA1A6B5);
const dayOutside = Color(0xFFC1C6D0);

/// Кнопка «Отмена» в модалке (макет 58:250)
const cancelBg = Color(0xFFFFF8EB);
const cancelFg = Color(0xFFD99400);

/// Бейдж «на рассмотрении» — фиолетовый: решение принимает не мастер (макет 51:201)
const pendingBadgeBg = Color(0xFFEFEFFC);
const pendingBadgeFg = Color(0xFF6458F5);

/// Активная вкладка тоггла «Сегодня / Завтра» (макет 21:37)
const toggleActiveBg = Color(0xFFFFF7E6);

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
