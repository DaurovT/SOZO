import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../api/client.dart';
import '../design_tokens.dart';
import '../store/outbox.dart';
import 'figma_blocks.dart';
import 'figma_icon.dart';
import '../i18n.dart';

/// Карточка-контейнер: единственный способ группировать контент (DEV-06 §4).
/// В макете карточки плоские: белое на светло-сером читается слоями и без тени.
class SozoCard extends StatelessWidget {
  const SozoCard({super.key, required this.child, this.padding, this.onTap, this.accent = false, this.leftStripe});

  final Widget child;
  final EdgeInsets? padding;
  final VoidCallback? onTap;
  final bool accent;

  /// Полоса по левому краю: аварийная заявка и другие «одним взглядом» состояния
  final Color? leftStripe;

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: BoxDecoration(
        color: SozoColors.surface,
        borderRadius: BorderRadius.circular(SozoRadius.card),
        border: accent ? Border.all(color: SozoColors.accent, width: 1.5) : null,
      ),
      child: Material(
        color: Colors.transparent,
        borderRadius: BorderRadius.circular(SozoRadius.card),
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(SozoRadius.card),
          child: Stack(
            children: [
              Padding(padding: padding ?? const EdgeInsets.all(SozoSpace.s16), child: child),
              if (leftStripe != null)
                Positioned(
                  left: 0,
                  top: 0,
                  bottom: 0,
                  child: Container(
                    width: 3,
                    decoration: BoxDecoration(
                      color: leftStripe,
                      borderRadius: const BorderRadius.horizontal(left: Radius.circular(SozoRadius.card)),
                    ),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Главная кнопка экрана (макет 41:64): янтарная заливка, скругление 16.
/// Высота не ниже 56 — под палец в перчатке (DEV-09 §5 п.1). В макете
/// внутренний отступ давал 47; на объекте в мороз этого мало.
class PrimaryButton extends StatelessWidget {
  const PrimaryButton({super.key, required this.label, this.onPressed, this.busy = false, this.danger = false});

  final String label;
  final VoidCallback? onPressed;
  final bool busy;
  final bool danger;

  @override
  Widget build(BuildContext context) {
    final fg = danger ? SozoColors.surface : SozoColors.onAccent;
    return SizedBox(
      width: double.infinity,
      child: FilledButton(
        onPressed: busy ? null : onPressed,
        style: FilledButton.styleFrom(
          backgroundColor: danger ? softDangerFg : SozoColors.accent,
          foregroundColor: fg,
          disabledBackgroundColor: SozoColors.border,
          disabledForegroundColor: SozoColors.textSecondary,
          padding: const EdgeInsets.symmetric(vertical: 14),
          minimumSize: const Size.fromHeight(SozoSize.buttonPrimary),
          elevation: 0,
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(SozoRadius.tile)),
        ),
        child: busy
            ? SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2.2, color: fg))
            : Text(
                // Две строки вместо обрезки: при системном шрифте 150–200%
                // «Принять заявку» превращалось в «Приня…»
                label,
                maxLines: 2,
                textAlign: TextAlign.center,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700),
              ),
      ),
    );
  }
}

class SecondaryButton extends StatelessWidget {
  const SecondaryButton({super.key, required this.label, this.onPressed, this.danger = false});

  final String label;
  final VoidCallback? onPressed;
  final bool danger;

  @override
  Widget build(BuildContext context) {
    final fg = danger ? softDangerFg : SozoColors.text;
    return SizedBox(
      width: double.infinity,
      child: OutlinedButton(
        onPressed: onPressed,
        style: OutlinedButton.styleFrom(
          foregroundColor: fg,
          backgroundColor: SozoColors.surface,
          disabledForegroundColor: SozoColors.textSecondary,
          padding: const EdgeInsets.symmetric(vertical: 14),
          minimumSize: const Size.fromHeight(SozoSize.buttonPrimary),
          side: BorderSide(color: danger ? softDangerFg : SozoColors.border, width: 1.5),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(SozoRadius.tile)),
        ),
        child: Text(
          label,
          maxLines: 2,
          textAlign: TextAlign.center,
          overflow: TextOverflow.ellipsis,
          style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
        ),
      ),
    );
  }
}

/// Статусный бейдж: фон — цвет статуса @ 12%, текст — сам цвет (DEV-06 §4.3)
class StatusChip extends StatelessWidget {
  const StatusChip({super.key, required this.label, required this.status, this.icon});

  final String label;
  final String status;
  final String? icon;

  @override
  Widget build(BuildContext context) {
    final c = statusColor(status);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: SozoSpace.s12, vertical: 5),
      decoration: BoxDecoration(color: c.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(SozoRadius.chip)),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (icon != null) ...[FigmaIcon(icon!, size: 13, color: c), const SizedBox(width: SozoSpace.s4)],
          Text(
            label,
            style: TextStyle(color: c, fontSize: 12.5, fontWeight: FontWeight.w600, height: 1.2),
          ),
        ],
      ),
    );
  }
}

/// Сумма денег: табличные цифры, чтобы колонки сумм выравнивались по разрядам
class Money extends StatelessWidget {
  const Money(this.text, {super.key, this.size = 15, this.color, this.weight = FontWeight.w600});

  final String text;
  final double size;
  final Color? color;
  final FontWeight weight;

  @override
  Widget build(BuildContext context) {
    return Text(
      text,
      style: TextStyle(
        fontSize: size,
        fontWeight: weight,
        color: color ?? SozoColors.text,
        fontFeatures: moneyFeatures,
        height: 1.2,
      ),
    );
  }
}

/// Плашка «что мешает следующему шагу». Причину даёт сервер — не выдумываем свою.
/// Геометрия из макета (30:52): p12, скругление 12, иконка 16, текст 12/semibold.
class BlockerNote extends StatelessWidget {
  const BlockerNote({super.key, required this.text, this.icon = 'alert-circle', this.danger = false});

  final String text;
  final String icon;

  /// Красная плашка — «нельзя», жёлтая — «мешает» (макет 30:110 и 30:52)
  final bool danger;

  @override
  Widget build(BuildContext context) {
    final bg = danger ? softDangerBg : softWarnBg;
    final fg = danger ? softDangerFg : softWarnFg;
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(SozoSpace.s12),
      decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(SozoRadius.thumb)),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          FigmaIcon(icon, size: 16, color: fg),
          const SizedBox(width: SozoSpace.s8),
          Expanded(
            child: Text(
              text,
              // 15, а не макетные 12: плашка объясняет, почему нельзя дальше,
              // и читают её на улице, часто в очках не для чтения
              style: TextStyle(fontSize: 15, fontWeight: FontWeight.w600, color: fg, height: 1.35),
            ),
          ),
        ],
      ),
    );
  }
}

/// Индикатор офлайн-очереди, три уровня (PRD-02 §6): связь есть и очередь пуста —
/// ничего; очередь копится — счётчик; операция отвергнута — красный, нужен человек.
class OfflineBar extends StatelessWidget {
  const OfflineBar({super.key, required this.outbox, this.onTap});

  final Outbox outbox;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: outbox,
      builder: (context, _) {
        if (outbox.online && outbox.depth == 0) return const SizedBox.shrink();
        final blocked = outbox.hasBlocked;
        final stuck = outbox.lastFlushError;
        final color = blocked || stuck != null
            ? SozoColors.error
            : (outbox.online ? SozoColors.warning : SozoColors.textSecondary);
        // Порядок важен: отказ по операции требует человека, неудачная
        // попытка пройдёт сама, а «отправляем» без причины — то самое
        // бесконечное обещание, из-за которого мастер переставал верить плашке
        final text = blocked
            ? t('common.ocheredOstanovlena', {'p1': outbox.ops.firstWhere((o) => o.lastError != null).lastError})
            : stuck != null
            ? t('common.ocheredNeUshla', {'p1': stuck})
            : outbox.online
            ? t('common.otpravlyaemNakoplennoe', {'p1': outbox.depth})
            : t('common.netSetiRabotaemOflayn', {
                'p1': outbox.depth > 0 ? t('common.zapyatVOcheredi', {'p1': outbox.depth}) : '',
              });
        return Material(
          color: color.withValues(alpha: 0.12),
          child: InkWell(
            onTap: onTap,
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: SozoSpace.s16, vertical: SozoSpace.s8),
              child: Row(
                children: [
                  FigmaIcon(
                    blocked ? 'alert-circle' : (outbox.online ? 'upload' : 'cloud-off'),
                    size: 17,
                    color: color,
                  ),
                  const SizedBox(width: SozoSpace.s8),
                  Expanded(
                    child: Text(
                      text,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(fontSize: 13, color: SozoColors.text, fontWeight: FontWeight.w500),
                    ),
                  ),
                  if (outbox.syncing)
                    const SizedBox(width: 14, height: 14, child: CircularProgressIndicator(strokeWidth: 2))
                  else
                    const FigmaIcon('chevron-right', size: 18, color: SozoColors.textSecondary),
                ],
              ),
            ),
          ),
        );
      },
    );
  }
}

/// Пустое состояние — одно на всё приложение (макет 36:17).
/// Белый круг 80 с иконкой 32, под ним заголовок 18/bold и пояснение 14
/// шириной 300: длинная строка на весь экран читается хуже короткой колонки.
class EmptyView extends StatelessWidget {
  const EmptyView({super.key, required this.title, this.subtitle, this.icon = 'alert-circle'});

  final String title;
  final String? subtitle;
  final String icon;

  @override
  Widget build(BuildContext context) {
    // Прокрутка, а не просто Center: пустое состояние высотой ~200 не влезает
    // в узкие места вроде вкладки внутри карточки — там оно резалось полосой
    return SingleChildScrollView(
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: SozoSpace.s32, vertical: SozoSpace.s32),
        // Center обязателен: Column ужимается по самому широкому ребёнку и без
        // него весь блок прижимался к левому краю вместо центра экрана.
        child: Center(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: 80,
                height: 80,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: SozoColors.surface,
                  borderRadius: BorderRadius.circular(40),
                  boxShadow: const [BoxShadow(color: Color(0x05000000), blurRadius: 6, offset: Offset(0, 4))],
                ),
                child: FigmaIcon(icon, size: 32, color: SozoColors.textSecondary),
              ),
              const SizedBox(height: SozoSpace.s24),
              Text(
                title,
                textAlign: TextAlign.center,
                style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700, color: SozoColors.text),
              ),
              if (subtitle != null) ...[
                const SizedBox(height: SozoSpace.s12),
                // maxWidth, а не жёсткая ширина: на узком экране текст не вылезал
                // бы за padding, а строка держится читаемой длины
                ConstrainedBox(
                  constraints: const BoxConstraints(maxWidth: 300),
                  child: Text(
                    subtitle!,
                    textAlign: TextAlign.center,
                    style: const TextStyle(fontSize: 14, color: SozoColors.textSecondary, height: 1.4),
                  ),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

/// Заголовок секции. Без CAPS: на узбекском прописные удлиняют строку ещё сильнее.
class SectionTitle extends StatelessWidget {
  const SectionTitle(this.text, {super.key, this.trailing});

  final String text;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: SozoSpace.s12, top: SozoSpace.s4),
      child: Row(
        children: [
          Expanded(
            child: Text(
              text,
              style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700, color: SozoColors.text),
            ),
          ),
          ?trailing,
        ],
      ),
    );
  }
}

/// Строка «подпись — значение» внутри карточки: единая сетка на всех экранах
class InfoRow extends StatelessWidget {
  const InfoRow({super.key, required this.label, required this.value, this.icon, this.valueColor, this.money = false});

  final String label;
  final String value;
  final String? icon;
  final Color? valueColor;
  final bool money;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (icon != null) ...[
            FigmaIcon(icon!, size: 17, color: SozoColors.textTertiary),
            const SizedBox(width: SozoSpace.s8),
          ],
          Text(label, style: const TextStyle(fontSize: 14, color: SozoColors.textSecondary)),
          const SizedBox(width: SozoSpace.s12),
          Expanded(
            child: money
                ? Align(
                    alignment: Alignment.centerRight,
                    child: Money(value, color: valueColor ?? SozoColors.text),
                  )
                : Text(
                    value,
                    textAlign: TextAlign.right,
                    style: TextStyle(
                      fontSize: 14.5,
                      fontWeight: FontWeight.w600,
                      color: valueColor ?? SozoColors.text,
                      height: 1.35,
                    ),
                  ),
          ),
        ],
      ),
    );
  }
}

/// Тост из макета (43:244): тёмная плашка #1E2235, p14, скругление 16,
/// текст 13 белым. Один вид на всё — в макете отдельного «красного» тоста нет.
void _toast(BuildContext context, String text, Duration duration) {
  ScaffoldMessenger.of(context)
    ..hideCurrentSnackBar()
    ..showSnackBar(
      SnackBar(
        content: Text(text, style: const TextStyle(color: SozoColors.surface, fontSize: 13, height: 1.4)),
        backgroundColor: toastBg,
        behavior: SnackBarBehavior.floating,
        elevation: 0,
        padding: const EdgeInsets.all(14),
        margin: const EdgeInsets.all(SozoSpace.s16),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(SozoRadius.tile)),
        duration: duration,
      ),
    );
}

/// Текст ошибки для мастера.
///
/// `'$e'` печатал в тост `PlatformException(camera_access_denied, …)` —
/// строку, из которой мастер не может понять ни что случилось, ни что делать.
/// Понятные тексты сервера пропускаем как есть, остальное сводим к причинам,
/// которые встречаются на объекте.
String humanError(Object e) {
  if (e is ApiError) return e.message;
  final raw = '$e';
  if (raw.contains('camera_access_denied') || raw.contains('photo_access_denied')) {
    return t('common.oshibkaKameraZakryta');
  }
  if (raw.contains('SocketException') || raw.contains('ClientException') || raw.contains('TimeoutException')) {
    return t('common.oshibkaNetSvyazi');
  }
  if (raw.contains('no_available_camera') || raw.contains('camera_error')) return t('common.oshibkaKameraNeOtvechaet');
  return t('common.oshibkaNeVyshloPovtorite');
}

void showError(BuildContext context, Object e) => _toast(context, humanError(e), const Duration(seconds: 4));

/// Что сказать мастеру, когда операция легла в очередь.
///
/// Причин четыре, и они не равны: пропавшая связь — норма работы, протухшая
/// сессия требует войти заново, авария шлюза пройдёт сама. Раньше все три
/// показывались как «нет сети», и мастер не понимал, почему очередь стоит.
String queuedMessage(ApiError e) {
  if (e.statusCode == 401) return t('net.sessiyaIsteklaSohraneno');
  if (e.isGateway || (e.statusCode ?? 0) >= 500) return t('net.serverNeOtvetil');
  return t('common.bezSvyaziSohraneno');
}

/// Разряды в поле суммы прямо при наборе.
///
/// Долг вносят руками, а «200000» и «2000000» на экране телефона отличаются
/// одним символом: ошибка на порядок обнаруживается уже после оплаты.
/// Наружу отдаём то же поле без пробелов — разбирает его `digitsOf`.
class ThousandsFormatter extends TextInputFormatter {
  @override
  TextEditingValue formatEditUpdate(TextEditingValue oldValue, TextEditingValue newValue) {
    final digits = digitsOf(newValue.text);
    if (digits.isEmpty) return newValue.copyWith(text: '');
    final text = groupDigits(digits);
    return TextEditingValue(
      text: text,
      selection: TextSelection.collapsed(offset: text.length),
    );
  }
}

/// Только цифры: поле суммы показывает разряды пробелами, а серверу уходит число
String digitsOf(String raw) => raw.replaceAll(RegExp(r'[^0-9]'), '');

/// Сумма из поля ввода.
///
/// `int.tryParse('150 000') ?? 0` возвращал ноль: мастер набирал сумму с
/// пробелом — привычка от денег — и запчасть уходила в заявку с нулевой
/// ценой. Чек при этом приложен, работа сделана, денег нет.
int soumsOf(String raw) => int.tryParse(digitsOf(raw)) ?? 0;

/// Разряды пробелами: 2000000 → «2 000 000»
String groupDigits(String digits) {
  final buf = StringBuffer();
  for (var i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 == 0) buf.write(' ');
    buf.write(digits[i]);
  }
  return buf.toString();
}

void showOk(BuildContext context, String text) => _toast(context, text, const Duration(seconds: 3));

/// Строка навигации в списке настроек. Не кнопка: иконка слева, подпись слева,
/// шеврон справа — глаз ведёт по левому краю, а не мечется по центру.
class NavRow extends StatelessWidget {
  const NavRow({
    super.key,
    required this.icon,
    required this.title,
    this.subtitle,
    this.trailing,
    this.onTap,
    this.danger = false,
  });

  final String icon;
  final String title;
  final String? subtitle;
  final Widget? trailing;
  final VoidCallback? onTap;
  final bool danger;

  @override
  Widget build(BuildContext context) {
    final fg = danger ? softDangerFg : SozoColors.text;
    return InkWell(
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: SozoSpace.s16, vertical: SozoSpace.s12),
        child: Row(
          children: [
            IconBadge(icon),
            const SizedBox(width: SozoSpace.s12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    title,
                    style: TextStyle(fontSize: 15, fontWeight: FontWeight.w600, color: fg),
                  ),
                  if (subtitle != null) ...[
                    const SizedBox(height: 2),
                    Text(subtitle!, style: const TextStyle(fontSize: 12, color: SozoColors.textSecondary, height: 1.3)),
                  ],
                ],
              ),
            ),
            if (trailing != null) trailing! else if (onTap != null) const FigmaIcon('chevron-right', size: 16),
          ],
        ),
      ),
    );
  }
}

/// Группа строк в одной карточке с разделителями (макет 58:334):
/// заголовок прописными 14, карточка со скруглением 24, линии во всю ширину.
class NavGroup extends StatelessWidget {
  const NavGroup({super.key, required this.children, this.title});

  final List<Widget> children;
  final String? title;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (title != null)
          Padding(
            padding: const EdgeInsets.only(left: SozoSpace.s4, top: SozoSpace.s8, bottom: SozoSpace.s4),
            child: Text(
              title!.toUpperCase(),
              style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: SozoColors.textSecondary),
            ),
          ),
        const SizedBox(height: SozoSpace.s4),
        Material(
          color: SozoColors.surface,
          borderRadius: BorderRadius.circular(SozoRadius.card),
          clipBehavior: Clip.antiAlias,
          child: Column(
            children: [
              for (var i = 0; i < children.length; i++) ...[if (i > 0) const FigmaDivider(), children[i]],
            ],
          ),
        ),
      ],
    );
  }
}

/// Переключатель языка (макет 58:428): активный — тёмная пилюля.
///
/// Общий виджет, а не метод экрана профиля: тот же переключатель стоит на
/// входе — узбекоязычный кандидат иначе обязан сперва пройти русский экран,
/// чтобы добраться до настройки языка.
///
/// setState здесь не нужен: корень приложения слушает `l10n` и перерисовывает
/// всё дерево, а не только эту пилюлю.
class LanguageSwitch extends StatelessWidget {
  const LanguageSwitch({super.key});

  @override
  Widget build(BuildContext context) {
    Widget half(String code, String label) {
      final active = l10n.code == code;
      return GestureDetector(
        onTap: () => l10n.set(code),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: SozoSpace.s4),
          decoration: BoxDecoration(
            color: active ? SozoColors.text : Colors.transparent,
            borderRadius: BorderRadius.circular(6),
          ),
          child: Text(
            label,
            style: TextStyle(
              fontSize: 12,
              fontWeight: active ? FontWeight.w700 : FontWeight.w600,
              color: active ? SozoColors.surface : SozoColors.textSecondary,
            ),
          ),
        ),
      );
    }

    return Container(
      padding: const EdgeInsets.all(2),
      decoration: BoxDecoration(color: SozoColors.bg, borderRadius: BorderRadius.circular(SozoRadius.badge)),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [half('ru', t('prof.rus')), const SizedBox(width: 2), half('uz', 'Oʻz')],
      ),
    );
  }
}
