import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:url_launcher/url_launcher.dart';

import '../design_tokens.dart';
import '../i18n.dart';
import '../store/session.dart';
import 'figma_icon.dart';

/// Компоненты DEV-06 §4 в исполнении приложения «Клиент».
/// Числа берутся из токенов; локальных цветов и радиусов здесь нет.

/// Телефон диспетчерской — запасной путь, когда приложение не может помочь:
/// нет связи, отказали в камере, непонятно, куда жать. Свой у объекта телефон
/// приходит в `me.supportPhone`, этот — общий.
const sozoSupportPhone = '+998712000000';

// ============================ Карточки ============================

/// Белая карточка: p16, скругление 20, свой шаг между детьми. Тени нет.
class SozoCard extends StatelessWidget {
  const SozoCard({
    super.key,
    required this.children,
    this.gap = SozoSpace.s12,
    this.padding,
    this.onTap,
    this.border,
    this.color,
    this.radius = SozoRadius.card,
  });

  final List<Widget> children;
  final double gap;
  final EdgeInsets? padding;
  final VoidCallback? onTap;

  /// Цветная рамка: аварийная заявка, выбранный вариант доп-работы
  final Color? border;
  final Color? color;

  /// Скругление: списки настроек и адресов в макете 16, карточка техники 20.
  /// Разница видна, когда карточки стоят рядом, поэтому узел задаёт своё
  final double radius;

  @override
  Widget build(BuildContext context) {
    final body = Padding(
      padding: padding ?? const EdgeInsets.all(SozoSpace.s16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          for (var i = 0; i < children.length; i++) ...[
            if (i > 0) SizedBox(height: gap),
            children[i],
          ],
        ],
      ),
    );
    return Container(
      decoration: BoxDecoration(
        color: color ?? SozoColors.surface,
        borderRadius: BorderRadius.circular(radius),
        border: border == null ? null : Border.all(color: border!, width: 1.5),
      ),
      child: Material(
        color: Colors.transparent,
        borderRadius: BorderRadius.circular(radius),
        child: onTap == null
            ? body
            : InkWell(
                borderRadius: BorderRadius.circular(radius),
                onTap: onTap,
                child: body,
              ),
      ),
    );
  }
}

/// Заголовок карточки — 16/bold; справа может стоять янтарное действие
class CardTitle extends StatelessWidget {
  const CardTitle(this.text, {super.key, this.actionLabel, this.onAction});

  final String text;
  final String? actionLabel;
  final VoidCallback? onAction;

  @override
  Widget build(BuildContext context) {
    final title = Text(
      text,
      style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700, color: SozoColors.text),
    );
    if (actionLabel == null) return SizedBox(width: double.infinity, child: title);
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [Flexible(child: title), AmberAction(actionLabel!, onTap: onAction)],
    );
  }
}

/// Заголовок секции экрана — h2 по DEV-06
class SectionHeading extends StatelessWidget {
  const SectionHeading(this.text, {super.key, this.subtitle});

  final String text;
  final String? subtitle;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(text, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700, color: SozoColors.text)),
        if (subtitle != null) ...[
          const SizedBox(height: SozoSpace.s4),
          Text(subtitle!, style: const TextStyle(fontSize: 13, color: SozoColors.textSecondary)),
        ],
      ],
    );
  }
}

/// Текстовое действие рядом с заголовком секции: «Все», «Добавить», «Выйти».
///
/// Имя осталось от янтаря, цвет — нет. Янтарём такая надпись давала 1,75:1 на
/// белом, а тап-зона в четыре точки отступа — около восемнадцати в высоту.
/// Теперь это тот же `InlineLink`, что и остальные текст-действия приложения;
/// класс держим ради вызовов, чтобы правка не разъехалась по шести экранам.
class AmberAction extends StatelessWidget {
  const AmberAction(this.label, {super.key, this.onTap, this.fontSize = 15});

  final String label;
  final VoidCallback? onTap;
  final double fontSize;

  @override
  Widget build(BuildContext context) =>
      InlineLink(label, onTap: onTap, fontSize: fontSize);
}

class SozoDivider extends StatelessWidget {
  const SozoDivider({super.key});

  @override
  Widget build(BuildContext context) => Container(height: 1, color: SozoColors.border);
}

// ============================ Плашки ============================

enum BannerTone { neutral, info, warn, danger, success }

/// Плашка-баннер: фон цвета тона @ 12%, иконка, текст, необязательное действие.
/// Тон задаёт смысл: danger — «нельзя», warn — «мешает», success — «в вашу пользу».
class SozoBanner extends StatelessWidget {
  const SozoBanner({
    super.key,
    required this.text,
    this.icon,
    this.tone = BannerTone.neutral,
    this.actionLabel,
    this.onAction,
    this.title,
    this.onTap,
  });

  final String text;
  final String? title;
  final String? icon;
  final BannerTone tone;
  final String? actionLabel;
  final VoidCallback? onAction;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final (bg, fg) = switch (tone) {
      BannerTone.neutral => (SozoColors.chipGrey, SozoColors.textSecondary),
      BannerTone.info => (const Color(0xFFEFF6FF), SozoColors.info),
      BannerTone.warn => (softWarnBg, softWarnFg),
      BannerTone.danger => (softDangerBg, softDangerFg),
      BannerTone.success => (softSuccessBg, softSuccessFg),
    };
    final body = Container(
      width: double.infinity,
      padding: const EdgeInsets.all(SozoSpace.s12),
      decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(SozoRadius.field)),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (icon != null) ...[
            FigmaIcon(icon!, size: 18, color: fg),
            const SizedBox(width: SozoSpace.s8),
          ],
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                if (title != null) ...[
                  Text(
                    title!,
                    style: TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: fg),
                  ),
                  const SizedBox(height: 2),
                ],
                Text(text, style: TextStyle(fontSize: 13, height: 1.35, color: fg)),
              ],
            ),
          ),
          if (actionLabel != null) ...[
            const SizedBox(width: SozoSpace.s8),
            SmallButton(actionLabel!, onTap: onAction, color: fg),
          ],
        ],
      ),
    );
    if (onTap == null) return body;
    return InkWell(
      borderRadius: BorderRadius.circular(SozoRadius.field),
      onTap: onTap,
      child: body,
    );
  }
}

/// Баннер офлайна — закреплён под шапкой (DEV-08 §1)
class OfflineBar extends StatelessWidget {
  const OfflineBar({super.key});

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 36,
      width: double.infinity,
      color: softWarnBg,
      padding: const EdgeInsets.symmetric(horizontal: SozoSpace.s16),
      child: Row(
        children: [
          const FigmaIcon('cloud-off', size: 16, color: softWarnFg),
          const SizedBox(width: SozoSpace.s8),
          Expanded(
            child: Text(
              t('common.offline'),
              style: const TextStyle(fontSize: 12, color: softWarnFg),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ),
        ],
      ),
    );
  }
}

// ============================ Кнопки ============================

/// Главная кнопка экрана: янтарь, высота 56, одна на экран (DEV-08 §1)
class PrimaryButton extends StatelessWidget {
  const PrimaryButton(this.label, {super.key, this.onTap, this.busy = false, this.icon});

  final String label;
  final VoidCallback? onTap;
  final bool busy;
  final String? icon;

  @override
  Widget build(BuildContext context) {
    final enabled = onTap != null && !busy;
    return SizedBox(
      width: double.infinity,
      height: SozoSize.buttonPrimary,
      child: Material(
        color: enabled ? SozoColors.accent : SozoColors.chipGrey,
        borderRadius: BorderRadius.circular(SozoRadius.tile),
        child: InkWell(
          borderRadius: BorderRadius.circular(SozoRadius.tile),
          onTap: enabled ? onTap : null,
          child: Center(
            child: busy
                ? const SizedBox(
                    width: 20,
                    height: 20,
                    child: CircularProgressIndicator(strokeWidth: 2, color: SozoColors.onAccent),
                  )
                : Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      if (icon != null) ...[
                        FigmaIcon(icon!, size: 20, color: enabled ? SozoColors.onAccent : SozoColors.textTertiary),
                        const SizedBox(width: SozoSpace.s8),
                      ],
                      // Flexible: длинная подпись («Сообщить о поломке» с
                      // иконкой) вылезала за край кнопки
                      Flexible(
                        child: Text(
                          label,
                          textAlign: TextAlign.center,
                          style: TextStyle(
                            fontSize: 16,
                            fontWeight: FontWeight.w700,
                            color: enabled ? SozoColors.onAccent : SozoColors.textTertiary,
                          ),
                        ),
                      ),
                    ],
                  ),
          ),
        ),
      ),
    );
  }
}

/// Второстепенная кнопка: обводка, высота 48
class SecondaryButton extends StatelessWidget {
  const SecondaryButton(this.label, {super.key, this.onTap, this.icon, this.busy = false});

  final String label;
  final VoidCallback? onTap;
  final String? icon;
  final bool busy;

  @override
  Widget build(BuildContext context) {
    final enabled = onTap != null && !busy;
    return SizedBox(
      width: double.infinity,
      height: SozoSize.buttonSecondary,
      child: Material(
        color: SozoColors.surface,
        borderRadius: BorderRadius.circular(SozoRadius.tile),
        child: InkWell(
          borderRadius: BorderRadius.circular(SozoRadius.tile),
          onTap: enabled ? onTap : null,
          child: Container(
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(SozoRadius.tile),
              border: Border.all(color: SozoColors.border),
            ),
            alignment: Alignment.center,
            child: busy
                ? const SizedBox(
                    width: 18,
                    height: 18,
                    child: CircularProgressIndicator(strokeWidth: 2, color: SozoColors.textSecondary),
                  )
                : Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      if (icon != null) ...[
                        FigmaIcon(icon!, size: 18, color: enabled ? SozoColors.text : SozoColors.textTertiary),
                        const SizedBox(width: SozoSpace.s8),
                      ],
                      // Flexible: подпись бывает длинной («У меня есть код
                      // приглашения»), и без него Row с mainAxisSize.min
                      // молча вылезал за край экрана
                      Flexible(
                        child: Text(
                          label,
                          textAlign: TextAlign.center,
                          style: TextStyle(
                            fontSize: 15,
                            fontWeight: FontWeight.w600,
                            color: enabled ? SozoColors.text : SozoColors.textTertiary,
                          ),
                        ),
                      ),
                    ],
                  ),
          ),
        ),
      ),
    );
  }
}

/// Опасное действие — только текстом (DEV-06 §4.1): «Отменить заявку», «Выйти»
class DangerTextButton extends StatelessWidget {
  const DangerTextButton(this.label, {super.key, this.onTap});

  final String label;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: double.infinity,
      height: SozoSize.buttonSecondary,
      child: Material(
        color: Colors.transparent,
        borderRadius: BorderRadius.circular(SozoRadius.tile),
        child: InkWell(
          borderRadius: BorderRadius.circular(SozoRadius.tile),
          onTap: onTap,
          child: Center(
            child: Text(
              label,
              style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600, color: SozoColors.error),
            ),
          ),
        ),
      ),
    );
  }
}

/// Второстепенное действие текстом: высота 48 (тап-зона), но без веса кнопки.
/// Нужно, чтобы отказ и «отложить» не выглядели равновелико согласию.
class TextAction extends StatelessWidget {
  const TextAction(this.label, {super.key, this.onTap, this.danger = false});

  final String label;
  final VoidCallback? onTap;
  final bool danger;

  @override
  Widget build(BuildContext context) {
    final color = onTap == null
        ? SozoColors.textTertiary
        : (danger ? SozoColors.error : SozoColors.textSecondary);
    return SizedBox(
      height: SozoSize.buttonSecondary,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(SozoRadius.badge),
        child: Center(
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: SozoSpace.s12),
            child: Text(
              label,
              style: TextStyle(fontSize: 15, fontWeight: FontWeight.w500, color: color),
            ),
          ),
        ),
      ),
    );
  }
}

/// Текст-действие внутри строки: «Изменить», «Не знаю, что сломалось»,
/// «Отправить код повторно», «Есть промокод».
///
/// Два правила, ради которых это отдельный виджет.
///
/// **Цвет.** Раньше такие надписи набирались янтарём #FEB70F — 1,75:1 на белом.
/// Это не «бледновато», это нечитаемо: пожилой глаз такую надпись не находит
/// вовсе. Тёмный текст с подчёркиванием даёт 18:1 и остаётся узнаваемым как
/// ссылка без опоры на цвет.
///
/// **Размер зоны.** По макету это была голая надпись 14 sp — около 18 точек
/// высотой. Здесь она обёрнута в 48: минимум под палец, в том числе дрожащий.
class InlineLink extends StatelessWidget {
  const InlineLink(
    this.label, {
    super.key,
    this.onTap,
    this.danger = false,
    this.align = TextAlign.start,
    this.fontSize = 15,
  });

  final String label;
  final VoidCallback? onTap;
  final bool danger;
  final TextAlign align;
  final double fontSize;

  @override
  Widget build(BuildContext context) {
    final color = onTap == null
        ? SozoColors.textTertiary
        : (danger ? linkDanger : SozoColors.link);
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(SozoRadius.badge),
      child: Container(
        constraints: const BoxConstraints(minHeight: SozoSize.buttonSecondary),
        alignment: switch (align) {
          TextAlign.center => Alignment.center,
          TextAlign.end => Alignment.centerRight,
          _ => Alignment.centerLeft,
        },
        padding: const EdgeInsets.symmetric(horizontal: SozoSpace.s8, vertical: SozoSpace.s8),
        child: Text(
          label,
          textAlign: align,
          style: TextStyle(
            fontSize: fontSize,
            fontWeight: FontWeight.w600,
            color: color,
            decoration: TextDecoration.underline,
            decorationColor: color,
          ),
        ),
      ),
    );
  }
}

/// Мелкая кнопка внутри плашки или строки
/// Серая таблетка 44 во всю ширину (макет 242:100): быстрое сообщение мастеру,
/// «Перенести». Не кнопка экрана и не чип выбора — нажатие тут ничего не
/// подтверждает и ничего не выбирает, а сразу что-то отправляет
class NeutralPill extends StatelessWidget {
  const NeutralPill(this.label, {super.key, this.icon, this.onTap});

  final String label;
  final String? icon;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: neutralPillBg,
      borderRadius: BorderRadius.circular(22),
      child: InkWell(
        borderRadius: BorderRadius.circular(22),
        onTap: onTap,
        child: Container(
          height: 44,
          width: double.infinity,
          padding: const EdgeInsets.symmetric(horizontal: SozoSpace.s12),
          alignment: Alignment.center,
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (icon != null) ...[
                FigmaIcon(icon!, size: 16, color: authInk),
                const SizedBox(width: SozoSpace.s8),
              ],
              Flexible(
                child: Text(
                  label,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    fontSize: 14,
                    fontWeight: icon == null ? FontWeight.w500 : FontWeight.w600,
                    color: authInk,
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

class SmallButton extends StatelessWidget {
  const SmallButton(this.label, {super.key, this.onTap, this.color, this.icon});

  final String label;
  final VoidCallback? onTap;
  final Color? color;
  final String? icon;

  @override
  Widget build(BuildContext context) {
    final c = color ?? SozoColors.accent;
    // Подпись тёмная, а не в цвет заливки: янтарь по бледно-янтарному давал
    // 1,6:1 — надпись на кнопке была видна только тому, кто знал, что она там
    final ink = color == null ? SozoColors.text : c;
    return Material(
      color: c.withValues(alpha: 0.14),
      borderRadius: BorderRadius.circular(SozoRadius.badge),
      child: InkWell(
        borderRadius: BorderRadius.circular(SozoRadius.badge),
        onTap: onTap,
        child: Container(
          constraints: const BoxConstraints(minHeight: 44),
          padding: const EdgeInsets.symmetric(horizontal: SozoSpace.s12, vertical: SozoSpace.s8),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (icon != null) ...[
                FigmaIcon(icon!, size: 16, color: ink),
                const SizedBox(width: SozoSpace.s4),
              ],
              Text(
                label,
                style: TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: ink),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Панель с главной кнопкой, прижатая к низу поверх скролла (DEV-08 §1).
/// Верхняя граница отделяет её от контента, safe area — от жеста «домой».
class StickyFooter extends StatelessWidget {
  const StickyFooter({super.key, required this.children, this.gap = SozoSpace.s12});

  final List<Widget> children;
  final double gap;

  @override
  Widget build(BuildContext context) {
    final inset = MediaQuery.paddingOf(context).bottom;
    return Container(
      decoration: const BoxDecoration(
        color: SozoColors.surface,
        border: Border(top: BorderSide(color: SozoColors.border)),
      ),
      padding: EdgeInsets.fromLTRB(
        SozoSpace.s16,
        SozoSpace.s12,
        SozoSpace.s16,
        SozoSpace.s12 + (inset > 0 ? inset : 0),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          for (var i = 0; i < children.length; i++) ...[
            if (i > 0) SizedBox(height: gap),
            children[i],
          ],
        ],
      ),
    );
  }
}

// ============================ Чипы и бейджи ============================

/// Статус-бейдж: цвет только через statusChipColors (чек-лист DEV-08 §6 п.3)
class StatusBadge extends StatelessWidget {
  const StatusBadge(this.status, {super.key, required this.label});

  final String status;
  final String label;

  @override
  Widget build(BuildContext context) {
    final c = statusChipColors(status);
    final cancelled = status == 'cancelled';
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: SozoSpace.s8, vertical: SozoSpace.s4),
      decoration: BoxDecoration(color: c.bg, borderRadius: BorderRadius.circular(SozoRadius.badge)),
      child: Text(
        label,
        style: TextStyle(
          fontSize: 12,
          fontWeight: FontWeight.w600,
          color: c.fg,
          // «Отменена» — серый с перечёркиванием (DEV-06 §4.3)
          decoration: cancelled ? TextDecoration.lineThrough : null,
        ),
      ),
    );
  }
}

/// Нейтральный тег: признак работы, канал оплаты, уровень запчасти
class TagChip extends StatelessWidget {
  const TagChip(this.label, {super.key, this.icon, this.bg, this.fg, this.pill = false});

  final String label;
  final String? icon;
  final Color? bg;
  final Color? fg;

  /// Метка-таблетка из макета адресов (256:283): круглая, подпись мельче и жирнее.
  /// Так «Основной» читается как пометка на карточке, а не как второй заголовок
  final bool pill;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: EdgeInsets.symmetric(
        horizontal: pill ? 10 : SozoSpace.s8,
        vertical: SozoSpace.s4,
      ),
      decoration: BoxDecoration(
        color: bg ?? SozoColors.chipGrey,
        borderRadius: BorderRadius.circular(pill ? SozoRadius.chip : SozoRadius.badge),
      ),
      // Строка Row даёт тексту неограниченную ширину, и длинная подпись
      // («Работа вдвоём — цена уже включает второго мастера» в каталоге)
      // вылезала за карточку. Где ширина известна — разрешаем перенос;
      // где нет (чип поверх фото в Positioned) — Flexible нельзя, упадёт
      child: LayoutBuilder(
        builder: (context, constraints) {
          final text = Text(
            label,
            style: TextStyle(
              fontSize: pill ? 12 : 13,
              fontWeight: pill ? FontWeight.w600 : FontWeight.w600,
              color: fg ?? SozoColors.textSecondary,
            ),
          );
          return Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (icon != null) ...[
                FigmaIcon(icon!, size: 12, color: fg ?? SozoColors.textSecondary),
                const SizedBox(width: SozoSpace.s4),
              ],
              if (constraints.hasBoundedWidth) Flexible(child: text) else text,
            ],
          );
        },
      ),
    );
  }
}

/// Выбираемый чип: фильтр истории, окно приезда, категория.
/// Высота 40 — тап-зона по чек-листу §6 п.5.
class SozoChip extends StatelessWidget {
  const SozoChip(
    this.label, {
    super.key,
    required this.selected,
    this.onTap,
    this.icon,
    this.enabled = true,
    this.pill = false,
  });

  final String label;
  final bool selected;
  final VoidCallback? onTap;
  final String? icon;
  final bool enabled;

  /// Вид фильтра из макета списка заявок (248:2184): выбранный залит янтарём
  /// с белым текстом, остальные белые с серой рамкой
  final bool pill;

  @override
  Widget build(BuildContext context) {
    final fg = !enabled
        ? SozoColors.textTertiary
        : selected
            ? (pill ? SozoColors.surface : SozoColors.text)
            : (pill ? authInk : SozoColors.textSecondary);
    return Material(
      color: selected
          ? (pill ? SozoColors.accent : SozoColors.accent.withValues(alpha: 0.14))
          : SozoColors.surface,
      borderRadius: BorderRadius.circular(SozoRadius.chip),
      child: InkWell(
        borderRadius: BorderRadius.circular(SozoRadius.chip),
        onTap: enabled ? onTap : null,
        child: Container(
          height: 40,
          padding: const EdgeInsets.symmetric(horizontal: SozoSpace.s16),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(SozoRadius.chip),
            border: Border.all(
              color: selected
                  ? SozoColors.accent
                  : (pill ? chipOutline : SozoColors.border),
            ),
          ),
          alignment: Alignment.center,
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (icon != null) ...[
                FigmaIcon(icon!, size: 16, color: fg),
                const SizedBox(width: SozoSpace.s4),
              ],
              Text(
                label,
                style: TextStyle(
                  fontSize: 14,
                  fontWeight: selected ? (pill ? FontWeight.w700 : FontWeight.w600) : FontWeight.w500,
                  color: fg,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

// ============================ Строки и списки ============================

/// Строка-навигация: иконка, название, значение справа, шеврон (C-30)
class NavRow extends StatelessWidget {
  const NavRow({
    super.key,
    required this.icon,
    required this.title,
    this.value,
    this.onTap,
    this.badge,
    this.danger = false,
  });

  final String icon;
  final String title;
  final String? value;
  final VoidCallback? onTap;
  final int? badge;
  final bool danger;

  @override
  Widget build(BuildContext context) {
    final fg = danger ? SozoColors.error : authInk;
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        child: Container(
          // Ряд макета (256:31): 14 + иконка 20 + 14 = 48. Прежние 56 растягивали
          // список настроек на полтора экрана и разводили строки так, что они
          // переставали читаться как один блок
          constraints: const BoxConstraints(minHeight: SozoSize.buttonSecondary),
          padding: const EdgeInsets.symmetric(vertical: SozoSpace.s14),
          child: Row(
            children: [
              FigmaIcon(icon, size: 20, color: danger ? SozoColors.error : SozoColors.textSecondary),
              const SizedBox(width: SozoSpace.s12),
              Expanded(
                child: Text(
                  title,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(fontSize: 14, fontWeight: FontWeight.w500, color: fg),
                ),
              ),
              if ((badge ?? 0) > 0) ...[
                TagChip(
                  '${badge!}',
                  bg: SozoColors.accent.withValues(alpha: 0.18),
                  fg: SozoColors.text,
                ),
                const SizedBox(width: SozoSpace.s8),
              ],
              if (value != null) ...[
                Flexible(
                  child: Text(
                    value!,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    textAlign: TextAlign.right,
                    style: const TextStyle(fontSize: 14, color: authHint),
                  ),
                ),
                const SizedBox(width: SozoSpace.s8),
              ],
              if (onTap != null) const FigmaIcon('chevron-right', size: 16, color: SozoColors.textTertiary),
            ],
          ),
        ),
      ),
    );
  }
}

/// Строка «название — сумма» с табличными цифрами (DEV-08 §1)
class MoneyRow extends StatelessWidget {
  const MoneyRow({
    super.key,
    required this.label,
    required this.amount,
    this.sub,
    this.bold = false,
    this.color,
    this.labelMuted = false,
  });

  final String label;
  final String amount;
  final String? sub;
  final bool bold;
  final Color? color;

  /// Строка счёта (231:198): подпись серая и обычная, сумма чёрная и жирная.
  /// Смысл в том, что читают колонку сумм, а подписи только уточняют
  final bool labelMuted;

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                label,
                style: TextStyle(
                  fontSize: bold ? 15 : 14,
                  fontWeight: bold
                      ? FontWeight.w700
                      : (labelMuted ? FontWeight.w400 : FontWeight.w500),
                  color: color ?? (labelMuted ? authHint : authInk),
                ),
              ),
              if (sub != null)
                Text(sub!, style: const TextStyle(fontSize: 12, color: SozoColors.textSecondary)),
            ],
          ),
        ),
        const SizedBox(width: SozoSpace.s8),
        // Сумма тоже гибкая: «1 500 000 сум» рядом с длинной подписью не
        // помещалась даже после сжатия подписи до нуля
        Flexible(
          child: Text(
            amount,
            textAlign: TextAlign.right,
            style: TextStyle(
              fontSize: bold ? 15 : 14,
              fontWeight: FontWeight.w700,
              color: color ?? authInk,
              fontFeatures: const [FontFeature.tabularFigures()],
            ),
          ),
        ),
      ],
    );
  }
}

/// Строка со Switch. Material-виджет SwitchListTile внутри цветного контейнера
/// роняет ассерт — поэтому строка собрана вручную.
class SwitchRow extends StatelessWidget {
  const SwitchRow({
    super.key,
    required this.title,
    required this.value,
    required this.onChanged,
    this.subtitle,
    this.icon,
    this.iconColor,
    this.iconBg,
  });

  final String title;
  final String? subtitle;
  final bool value;
  final ValueChanged<bool> onChanged;
  final String? icon;
  final Color? iconColor;

  /// Подложка под иконкой: в макете аварии значок сидит в круге 36 (223:101)
  final Color? iconBg;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: () => onChanged(!value),
      child: Container(
        constraints: const BoxConstraints(minHeight: SozoSize.buttonPrimary),
        padding: const EdgeInsets.symmetric(vertical: SozoSpace.s8),
        child: Row(
          children: [
            if (icon != null) ...[
              if (iconBg != null)
                Container(
                  width: 36,
                  height: 36,
                  decoration: BoxDecoration(color: iconBg, borderRadius: BorderRadius.circular(18)),
                  alignment: Alignment.center,
                  child: FigmaIcon(icon!, size: 18, color: iconColor ?? SozoColors.textSecondary),
                )
              else
                FigmaIcon(icon!, size: 20, color: iconColor ?? SozoColors.textSecondary),
              const SizedBox(width: SozoSpace.s12),
            ],
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(title, style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w500, color: SozoColors.text)),
                  if (subtitle != null) ...[
                    const SizedBox(height: 2),
                    Text(subtitle!, style: const TextStyle(fontSize: 12, color: SozoColors.textSecondary)),
                  ],
                ],
              ),
            ),
            const SizedBox(width: SozoSpace.s8),
            Switch(
              value: value,
              onChanged: onChanged,
              activeThumbColor: SozoColors.onAccent,
              activeTrackColor: SozoColors.accent,
              inactiveTrackColor: SozoColors.chipGrey,
              inactiveThumbColor: SozoColors.textSecondary,
              trackOutlineColor: const WidgetStatePropertyAll(SozoColors.border),
            ),
          ],
        ),
      ),
    );
  }
}

/// Чекбокс со сложным текстом (согласия): галочка слева, текст переносится
class CheckboxRow extends StatelessWidget {
  const CheckboxRow({super.key, required this.value, required this.onChanged, required this.child, this.error});

  final bool value;
  final ValueChanged<bool> onChanged;
  final Widget child;

  /// Подсказка под строкой, когда согласие обязательное и не отмечено
  final String? error;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        InkWell(
          onTap: () => onChanged(!value),
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: SozoSpace.s8),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Container(
                  width: 22,
                  height: 22,
                  margin: const EdgeInsets.only(top: 2),
                  decoration: BoxDecoration(
                    color: value ? SozoColors.accent : SozoColors.surface,
                    borderRadius: BorderRadius.circular(SozoRadius.s4 + 2),
                    border: Border.all(color: value ? SozoColors.accent : SozoColors.border, width: 1.5),
                  ),
                  child: value ? const Center(child: FigmaIcon('check-12', size: 12, color: SozoColors.onAccent)) : null,
                ),
                const SizedBox(width: SozoSpace.s12),
                Expanded(child: child),
              ],
            ),
          ),
        ),
        if (error != null)
          Padding(
            padding: const EdgeInsets.only(left: 34),
            child: Text(error!, style: const TextStyle(fontSize: 12, color: SozoColors.error)),
          ),
      ],
    );
  }
}

/// Радио-карточка выбора: вариант доп-работы, срочность (C-16, C-32)
class RadioCard extends StatelessWidget {
  const RadioCard({
    super.key,
    required this.title,
    required this.selected,
    required this.onTap,
    this.subtitle,
    this.trailing,
    this.icon,
    this.iconColor,
  });

  final String title;
  final String? subtitle;
  final bool selected;
  final VoidCallback onTap;
  final String? trailing;
  final String? icon;
  final Color? iconColor;

  @override
  Widget build(BuildContext context) {
    return SozoCard(
      onTap: onTap,
      border: selected ? SozoColors.accent : SozoColors.border,
      gap: SozoSpace.s4,
      children: [
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              width: 20,
              height: 20,
              margin: const EdgeInsets.only(top: 2),
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                border: Border.all(color: selected ? SozoColors.accent : SozoColors.border, width: 2),
              ),
              child: selected
                  ? Center(
                      child: Container(
                        width: 10,
                        height: 10,
                        decoration: const BoxDecoration(color: SozoColors.accent, shape: BoxShape.circle),
                      ),
                    )
                  : null,
            ),
            const SizedBox(width: SozoSpace.s12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      if (icon != null) ...[
                        FigmaIcon(icon!, size: 16, color: iconColor ?? SozoColors.textSecondary),
                        const SizedBox(width: SozoSpace.s4),
                      ],
                      Expanded(
                        child: Text(
                          title,
                          style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600, color: SozoColors.text),
                        ),
                      ),
                      if (trailing != null)
                        Text(
                          trailing!,
                          style: const TextStyle(
                            fontSize: 14,
                            fontWeight: FontWeight.w700,
                            color: SozoColors.text,
                            fontFeatures: [FontFeature.tabularFigures()],
                          ),
                        ),
                    ],
                  ),
                  if (subtitle != null) ...[
                    const SizedBox(height: SozoSpace.s4),
                    Text(subtitle!, style: const TextStyle(fontSize: 13, height: 1.35, color: SozoColors.textSecondary)),
                  ],
                ],
              ),
            ),
          ],
        ),
      ],
    );
  }
}

/// Степпер количества «− 1 +»: кнопки ≥44 (чек-лист §6 п.5)
class QtyStepper extends StatelessWidget {
  const QtyStepper({super.key, required this.value, required this.onChanged, this.min = 1, this.max = 99});

  final int value;
  final ValueChanged<int> onChanged;
  final int min;
  final int max;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        _btn('−', value > min ? () => onChanged(value - 1) : null),
        SizedBox(
          width: 24,
          child: Text(
            '$value',
            textAlign: TextAlign.center,
            style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: authInk),
          ),
        ),
        _btn('+', value < max ? () => onChanged(value + 1) : null),
      ],
    );
  }

  /// Кнопки 44×44 со скруглением 8 на сером (223:43 рисовал 32×32).
  ///
  /// Тридцать два было признанным компромиссом «чтобы не ломать карточку»,
  /// но промах по «плюсу» здесь стоит лишней работы в смете, а сама карточка
  /// по нажатию делает противоположное — снимает выбор
  Widget _btn(String label, VoidCallback? onTap) => SizedBox(
        width: 44,
        height: 44,
        child: Material(
          color: SozoColors.bg,
          borderRadius: BorderRadius.circular(SozoRadius.badge),
          child: InkWell(
            borderRadius: BorderRadius.circular(SozoRadius.badge),
            onTap: onTap,
            child: Center(
              child: Text(
                label,
                style: TextStyle(
                  fontSize: 16,
                  fontWeight: FontWeight.w600,
                  color: onTap == null ? SozoColors.textTertiary : authInk,
                ),
              ),
            ),
          ),
        ),
      );
}

// ============================ Поля ============================

/// Поле формы: лейбл сверху, ошибка под полем без «прыжков» (DEV-06 §4.4)
class SozoField extends StatelessWidget {
  const SozoField({
    super.key,
    required this.label,
    required this.controller,
    this.hint,
    this.helper,
    this.error,
    this.keyboardType,
    this.maxLines = 1,
    this.maxLength,
    this.onChanged,
    this.prefix,
    this.enabled = true,
    this.inputFormatters,
    this.autofocus = false,
    this.flat = false,
  });

  /// Поле внутри белой карточки (231:32): серая заливка без рамки.
  /// Рамка нужна полю на фоне экрана; на белой карточке она превращает
  /// карточку в форму из двух вложенных прямоугольников
  final bool flat;

  final String label;
  final TextEditingController controller;
  final String? hint;
  final String? helper;
  final String? error;
  final TextInputType? keyboardType;
  final int maxLines;
  final int? maxLength;
  final ValueChanged<String>? onChanged;
  final Widget? prefix;
  final bool enabled;
  final List<TextInputFormatter>? inputFormatters;
  final bool autofocus;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          label,
          style: TextStyle(
            fontSize: 13,
            fontWeight: flat ? FontWeight.w500 : FontWeight.w600,
            color: flat ? authHint : SozoColors.textSecondary,
          ),
        ),
        const SizedBox(height: SozoSpace.s8),
        Container(
          constraints: BoxConstraints(minHeight: maxLines > 1 ? 96 : (flat ? 44 : SozoSize.field)),
          padding: EdgeInsets.symmetric(horizontal: flat ? SozoSpace.s16 : SozoSpace.s12),
          decoration: BoxDecoration(
            color: !enabled
                ? SozoColors.chipGrey
                : flat
                    ? SozoColors.bg
                    : fieldBg,
            borderRadius: BorderRadius.circular(flat ? 14 : SozoRadius.field),
            border: flat && error == null
                ? null
                : Border.all(color: error != null ? SozoColors.error : SozoColors.border),
          ),
          child: Row(
            crossAxisAlignment: maxLines > 1 ? CrossAxisAlignment.start : CrossAxisAlignment.center,
            children: [
              if (prefix != null) ...[prefix!, const SizedBox(width: SozoSpace.s8)],
              Expanded(
                child: TextField(
                  controller: controller,
                  enabled: enabled,
                  autofocus: autofocus,
                  keyboardType: keyboardType,
                  maxLines: maxLines,
                  maxLength: maxLength,
                  onChanged: onChanged,
                  inputFormatters: inputFormatters,
                  style: TextStyle(
                    fontSize: flat ? 14 : 15,
                    fontWeight: flat ? FontWeight.w500 : FontWeight.w400,
                    color: flat ? authInk : SozoColors.text,
                  ),
                  decoration: InputDecoration(
                    isDense: true,
                    border: InputBorder.none,
                    counterText: '',
                    contentPadding: EdgeInsets.symmetric(
                      vertical: maxLines > 1 ? SozoSpace.s12 : (flat ? SozoSpace.s12 : SozoSpace.s16),
                    ),
                    hintText: hint,
                    hintStyle: TextStyle(fontSize: flat ? 14 : 15, color: placeholderGrey),
                  ),
                ),
              ),
            ],
          ),
        ),
        // Место под подпись держится всегда: иначе появление ошибки дёргает вёрстку
        const SizedBox(height: SozoSpace.s4),
        SizedBox(
          height: 16,
          child: error != null
              ? Text(error!, style: const TextStyle(fontSize: 12, color: SozoColors.error))
              : (helper != null
                  ? Text(helper!, style: const TextStyle(fontSize: 12, color: SozoColors.textSecondary))
                  : null),
        ),
      ],
    );
  }
}

// ============================ Состояния экрана ============================

/// Пусто и ошибка — одна композиция: иконка 48 + фраза + одно действие
class EmptyState extends StatelessWidget {
  const EmptyState({super.key, required this.icon, required this.text, this.actionLabel, this.onAction});

  final String icon;
  final String text;
  final String? actionLabel;
  final VoidCallback? onAction;

  @override
  Widget build(BuildContext context) {
    return SingleChildScrollView(
      child: Padding(
        padding: const EdgeInsets.all(SozoSpace.s32),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            FigmaIcon(icon, size: 48, color: SozoColors.textTertiary),
            const SizedBox(height: SozoSpace.s16),
            Text(
              text,
              textAlign: TextAlign.center,
              style: const TextStyle(fontSize: 15, height: 1.4, color: SozoColors.textSecondary),
            ),
            if (actionLabel != null) ...[
              const SizedBox(height: SozoSpace.s24),
              SizedBox(width: 240, child: SecondaryButton(actionLabel!, onTap: onAction)),
            ],
          ],
        ),
      ),
    );
  }
}

/// Ошибка загрузки.
///
/// Не пустое состояние с серой иконкой: у ошибки другая задача. Пустой экран
/// сообщает «здесь пока ничего нет», ошибка — «что-то сломалось, вот что
/// делать». Поэтому значок в красноватом круге, заголовок отдельно от
/// объяснения, а действие — заметная кнопка, а не бледная ссылка.
///
/// Когда не отвечает сервер, добавляется вторая кнопка — «Позвонить в
/// поддержку»: человеку с прорывом трубы нужен выход из тупика, а не разбор
/// причины отказа.
///
/// Настройка адреса сервера с этого экрана убрана: строка «Изменить адрес
/// сервера» с плейсхолдером локального IP стояла на **каждом** экране ошибки
/// и в проде читалась как поломка приложения. Она осталась там же, где была
/// задумана, — под долгим нажатием, теперь по значку ошибки.
class ErrorState extends StatelessWidget {
  const ErrorState({super.key, required this.message, this.onRetry, this.onEditServer});

  final String message;
  final VoidCallback? onRetry;

  /// Правка адреса сервера — под долгим нажатием по значку, без надписи
  final VoidCallback? onEditServer;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: SingleChildScrollView(
        padding: const EdgeInsets.all(SozoSpace.s32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            GestureDetector(
              onLongPress: onEditServer,
              child: Container(
                width: 72,
                height: 72,
                decoration: const BoxDecoration(color: homeDebtBg, shape: BoxShape.circle),
                alignment: Alignment.center,
                child: const FigmaIcon('alert-circle', size: 32, color: homeDanger),
              ),
            ),
            const SizedBox(height: SozoSpace.s24),
            Text(
              t('error.title'),
              textAlign: TextAlign.center,
              style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700, color: authInk),
            ),
            const SizedBox(height: SozoSpace.s8),
            Text(
              message,
              textAlign: TextAlign.center,
              style: const TextStyle(fontSize: 16, height: 1.4, color: SozoColors.textSecondary),
            ),
            const SizedBox(height: SozoSpace.s24),
            if (onRetry != null)
              SizedBox(
                width: double.infinity,
                child: Material(
                  color: SozoColors.accent,
                  borderRadius: BorderRadius.circular(14),
                  child: InkWell(
                    borderRadius: BorderRadius.circular(14),
                    onTap: onRetry,
                    child: Padding(
                      padding: const EdgeInsets.symmetric(vertical: 14),
                      child: Text(
                        t('common.retry'),
                        textAlign: TextAlign.center,
                        style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700, color: authInk),
                      ),
                    ),
                  ),
                ),
              ),
            const SizedBox(height: SozoSpace.s12),
            SecondaryButton(
              t('error.callSupport'),
              icon: 'phone',
              onTap: () => callPhone(context, session.supportPhone ?? sozoSupportPhone),
            ),
          ],
        ),
      ),
    );
  }
}

/// Скелетон: серая плашка формы будущего контента, без шиммера (DEV-06 §7)
class Skeleton extends StatelessWidget {
  const Skeleton({super.key, this.height = 16, this.width, this.radius});

  final double height;
  final double? width;
  final double? radius;

  @override
  Widget build(BuildContext context) {
    return Container(
      height: height,
      width: width,
      decoration: BoxDecoration(
        color: SozoColors.border,
        borderRadius: BorderRadius.circular(radius ?? SozoRadius.badge),
      ),
    );
  }
}

/// Список скелетонов-карточек на время загрузки
class SkeletonList extends StatelessWidget {
  const SkeletonList({super.key, this.count = 3});

  final int count;

  @override
  Widget build(BuildContext context) {
    return ListView.separated(
      padding: const EdgeInsets.all(SozoSpace.s16),
      itemCount: count,
      separatorBuilder: (_, _) => const SizedBox(height: SozoSpace.s12),
      itemBuilder: (_, _) => const SozoCard(
        children: [
          Skeleton(height: 14, width: 140),
          Skeleton(height: 12, width: 220),
          Skeleton(height: 12, width: 180),
        ],
      ),
    );
  }
}

// ============================ Диалоги и тосты ============================

/// Тёмный тост: короткое подтверждение действия
/// Открыть печатную форму во внешнем браузере.
///
/// Именно во внешнем, а не во встроенном окне: из браузера документ печатают,
/// сохраняют в PDF и пересылают — ради этого его и открывают. Молча не
/// открывшаяся ссылка выглядит как сломанная кнопка, поэтому говорим об отказе.
/// Позвонить по номеру.
///
/// Раньше кнопки со словом «Позвонить» показывали номер тостом, а на входе —
/// просто закрывали шторку. Человеку, которому нужен диспетчер, приходилось
/// запоминать номер с экрана и набирать его руками.
Future<void> callPhone(BuildContext context, String? phone) async {
  final digits = (phone ?? '').replaceAll(RegExp(r'[^+0-9]'), '');
  if (digits.isEmpty) return;
  final ok = await launchUrl(Uri(scheme: 'tel', path: digits));
  // Планшет без SIM и симулятор звонить не умеют — тогда хотя бы номер на экран
  if (!ok && context.mounted) showSozoToast(context, digits);
}

Future<void> openDocument(BuildContext context, String url) async {
  final ok = await launchUrl(Uri.parse(url), mode: LaunchMode.externalApplication);
  if (!ok && context.mounted) showSozoToast(context, t('common.openFailed'));
}

void showSozoToast(BuildContext context, String message) {
  final messenger = ScaffoldMessenger.maybeOf(context);
  if (messenger == null) return;
  messenger.clearSnackBars();
  messenger.showSnackBar(
    SnackBar(
      content: Text(message, style: const TextStyle(fontSize: 14, color: SozoColors.surface)),
      backgroundColor: toastBg,
      behavior: SnackBarBehavior.floating,
      margin: const EdgeInsets.all(SozoSpace.s16),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(SozoRadius.field)),
      duration: const Duration(seconds: 3),
    ),
  );
}

/// Диалог подтверждения. Возвращает true, если пользователь подтвердил.
/// Опасное действие красное — «Отменить заявку», «Выйти», «Отказаться».
Future<bool> showSozoConfirm(
  BuildContext context, {
  required String title,
  required String text,
  required String confirmLabel,
  String? cancelLabel,
  bool danger = false,
}) async {
  // Геометрия из макета (234:62): карточка r24 с отступом 24, заголовок 20,
  // пояснение 12, кнопки во всю ширину со скруглением 14
  final r = await showDialog<bool>(
    context: context,
    builder: (ctx) => Dialog(
      backgroundColor: SozoColors.surface,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(24)),
      insetPadding: const EdgeInsets.all(SozoSpace.s24),
      child: Padding(
        padding: const EdgeInsets.all(SozoSpace.s24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(title, style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w700, color: authInk)),
            const SizedBox(height: SozoSpace.s12),
            // 16, а не 12 из макета: именно в этом абзаце стоит сумма, которую
            // придётся заплатить при отмене. Двенадцатым кеглем её не читают
            Text(text, style: const TextStyle(fontSize: 16, height: 1.4, color: SozoColors.text)),
            const SizedBox(height: SozoSpace.s24),
            _dialogButton(
              confirmLabel,
              bg: danger ? dangerSolid : SozoColors.accent,
              fg: danger ? SozoColors.surface : authInk,
              bold: true,
              onTap: () => Navigator.of(ctx).pop(true),
            ),
            const SizedBox(height: SozoSpace.s12),
            _dialogButton(
              cancelLabel ?? t('common.cancel'),
              bg: dialogSecondaryBg,
              fg: authInk,
              bold: false,
              onTap: () => Navigator.of(ctx).pop(false),
            ),
          ],
        ),
      ),
    ),
  );
  return r ?? false;
}

Widget _dialogButton(
  String label, {
  required Color bg,
  required Color fg,
  required bool bold,
  required VoidCallback onTap,
}) {
  return Material(
    color: bg,
    borderRadius: BorderRadius.circular(14),
    child: InkWell(
      borderRadius: BorderRadius.circular(14),
      onTap: onTap,
      child: SizedBox(
        width: double.infinity,
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 14),
          child: Text(
            label,
            textAlign: TextAlign.center,
            style: TextStyle(fontSize: 15, fontWeight: bold ? FontWeight.w700 : FontWeight.w600, color: fg),
          ),
        ),
      ),
    ),
  );
}

/// Нижний лист общего вида: ручка, заголовок, содержимое
Future<T?> showSozoSheet<T>(BuildContext context, {required String title, required Widget child}) {
  return showModalBottomSheet<T>(
    context: context,
    backgroundColor: SozoColors.surface,
    isScrollControlled: true,
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(SozoRadius.card)),
    ),
    builder: (ctx) => SafeArea(
      top: false,
      child: Padding(
        padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(ctx).bottom),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const SizedBox(height: SozoSpace.s12),
            Center(
              child: Container(
                width: 40,
                height: 4,
                decoration: BoxDecoration(
                  color: SozoColors.border,
                  borderRadius: BorderRadius.circular(SozoRadius.s4),
                ),
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(SozoSpace.s16, SozoSpace.s16, SozoSpace.s16, SozoSpace.s8),
              child: Text(
                title,
                style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w700, color: SozoColors.text),
              ),
            ),
            Flexible(child: child),
            const SizedBox(height: SozoSpace.s16),
          ],
        ),
      ),
    ),
  );
}

/// Диалог с одним полем: правка имени, короткий комментарий.
///
/// Отдельно от `showSozoConfirm`: тот отвечает «да/нет», а здесь нужен текст,
/// и подмешивать поле в диалог подтверждения значило бы получить кнопку
/// «Сохранить», которая иногда ничего не сохраняет.
Future<String?> showSozoPrompt(
  BuildContext context, {
  required String title,
  required TextEditingController controller,
  required String confirmLabel,
  String? hint,
}) {
  return showDialog<String>(
    context: context,
    builder: (ctx) => Dialog(
      backgroundColor: SozoColors.surface,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(SozoRadius.card)),
      insetPadding: const EdgeInsets.all(SozoSpace.s24),
      child: Padding(
        padding: const EdgeInsets.all(SozoSpace.s24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(title, style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w700, color: SozoColors.text)),
            const SizedBox(height: SozoSpace.s16),
            SozoField(label: title, controller: controller, hint: hint, maxLength: 80, autofocus: true),
            const SizedBox(height: SozoSpace.s24),
            PrimaryButton(confirmLabel, onTap: () => Navigator.of(ctx).pop(controller.text)),
            const SizedBox(height: SozoSpace.s8),
            SecondaryButton(t('common.cancel'), onTap: () => Navigator.of(ctx).pop()),
          ],
        ),
      ),
    ),
  );
}

/// Правка адреса сервера.
///
/// Живёт в общих виджетах, а не на экране входа: телефон ходит на компьютер по
/// адресу в Wi-Fi, тот меняется при смене сети, и человек, уже вошедший в
/// приложение, оказывался запертым — ошибка есть, поправить нечем.
Future<void> showServerAddressSheet(BuildContext context) async {
  final ctrl = TextEditingController(text: session.api.baseUrl);
  await showSozoSheet<void>(
    context,
    title: t('dev.serverTitle'),
    child: Padding(
      padding: const EdgeInsets.fromLTRB(SozoSpace.s16, 0, SozoSpace.s16, SozoSpace.s16),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          SozoField(label: t('dev.serverLabel'), controller: ctrl, hint: 'http://192.168.0.10:3000'),
          const SizedBox(height: SozoSpace.s16),
          PrimaryButton(
            t('common.save'),
            onTap: () async {
              await session.setBaseUrl(ctrl.text.trim());
              if (context.mounted) Navigator.of(context).pop();
            },
          ),
        ],
      ),
    ),
  );
  ctrl.dispose();
}
