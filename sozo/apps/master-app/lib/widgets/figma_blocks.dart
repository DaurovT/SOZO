import 'package:flutter/material.dart';

import '../design_tokens.dart';
import 'figma_icon.dart';
import '../i18n.dart';

/// Блоки из макета, повторяющиеся на всех экранах (DEV-11).
/// Числа здесь — из Figma, а не подобранные на глаз; менять их можно
/// только вместе с макетом.

/// Белая карточка: p16, скругление 20, свой шаг между детьми.
/// Тени нет — в макете карточки плоские.
class FigmaCard extends StatelessWidget {
  const FigmaCard({super.key, required this.children, this.gap = SozoSpace.s12, this.padding, this.onTap});

  final List<Widget> children;
  final double gap;
  final EdgeInsets? padding;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final body = Padding(
      padding: padding ?? const EdgeInsets.all(SozoSpace.s16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          for (var i = 0; i < children.length; i++) ...[if (i > 0) SizedBox(height: gap), children[i]],
        ],
      ),
    );
    return Material(
      color: SozoColors.surface,
      borderRadius: BorderRadius.circular(SozoRadius.card),
      child: onTap == null
          ? body
          : InkWell(borderRadius: BorderRadius.circular(SozoRadius.card), onTap: onTap, child: body),
    );
  }
}

/// Заголовок карточки — 16/bold. Справа может стоять янтарное действие.
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
      children: [
        title,
        AmberAction(actionLabel!, onTap: onAction),
      ],
    );
  }
}

/// Текстовое действие янтарём — 14/semibold. Кнопкой не оформляется:
/// в макете это подпись у правого края строки.
class AmberAction extends StatelessWidget {
  const AmberAction(this.label, {super.key, this.onTap, this.fontSize = 14});

  final String label;
  final VoidCallback? onTap;
  final double fontSize;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(SozoRadius.badge),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: SozoSpace.s4, vertical: 2),
        child: Text(
          label,
          style: TextStyle(
            fontSize: fontSize,
            fontWeight: FontWeight.w600,
            color: onTap == null ? SozoColors.textTertiary : SozoColors.accent,
          ),
        ),
      ),
    );
  }
}

/// Линия-разделитель внутри карточки: 1 px #E5E7EB во всю ширину
class FigmaDivider extends StatelessWidget {
  const FigmaDivider({super.key});

  @override
  Widget build(BuildContext context) => Container(height: 1, color: SozoColors.border);
}

/// Пастельная плашка с иконкой: «мешает», «нельзя», «сделано» (макет 30:52)
class NoteBox extends StatelessWidget {
  const NoteBox({super.key, required this.icon, required this.text, required this.tone});

  final String icon;
  final String text;
  final NoteTone tone;

  @override
  Widget build(BuildContext context) {
    final (bg, fg) = switch (tone) {
      NoteTone.warn => (softWarnBg, softWarnFg),
      NoteTone.danger => (softDangerBg, softDangerFg),
      NoteTone.success => (softSuccessBg, softSuccessFg),
    };
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
              style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: fg, height: 1.35),
            ),
          ),
        ],
      ),
    );
  }
}

enum NoteTone { warn, danger, success }

/// Плитка быстрого действия: иконка 16 над подписью 12 (макет 30:34)
class ActionTile extends StatelessWidget {
  const ActionTile({super.key, required this.icon, required this.label, this.onTap});

  final String icon;
  final String label;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: SozoColors.bg,
      borderRadius: BorderRadius.circular(SozoRadius.tile),
      child: InkWell(
        borderRadius: BorderRadius.circular(SozoRadius.tile),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: SozoSpace.s12),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              FigmaIcon(icon, size: 16),
              const SizedBox(height: 6),
              Text(
                label,
                style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: SozoColors.text),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Иконка в серой подложке: круг 36 у адреса, квадрат 36/r10 в списках
class IconBadge extends StatelessWidget {
  const IconBadge(
    this.icon, {
    super.key,
    this.size = 36,
    this.iconSize = 18,
    this.radius = 10,
    this.round = false,
    this.background,
  });

  final String icon;
  final double size;
  final double iconSize;
  final double radius;
  final bool round;
  final Color? background;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: size,
      height: size,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        color: background ?? SozoColors.bg,
        borderRadius: BorderRadius.circular(round ? size / 2 : radius),
      ),
      child: FigmaIcon(icon, size: iconSize),
    );
  }
}

/// Строка списка «Ещё по заявке»: значок 36, заголовок 14/bold,
/// пояснение 10 и шеврон 16 (макет 35:7)
class FigmaNavRow extends StatelessWidget {
  const FigmaNavRow({super.key, required this.icon, required this.title, this.subtitle, this.onTap, this.trailing});

  final String icon;
  final String title;
  final String? subtitle;
  final VoidCallback? onTap;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: SozoSpace.s12),
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
                    style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: SozoColors.text),
                  ),
                  if (subtitle != null) ...[
                    const SizedBox(height: 2),
                    Text(subtitle!, style: const TextStyle(fontSize: 10, color: SozoColors.textSecondary, height: 1.3)),
                  ],
                ],
              ),
            ),
            trailing ?? (onTap == null ? const SizedBox.shrink() : const FigmaIcon('chevron-right', size: 16)),
          ],
        ),
      ),
    );
  }
}

/// Список строк с линиями между ними — без внешней карточки,
/// чтобы вкладывать внутрь FigmaCard
class RowGroup extends StatelessWidget {
  const RowGroup({super.key, required this.children});

  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        for (var i = 0; i < children.length; i++) ...[if (i > 0) const FigmaDivider(), children[i]],
      ],
    );
  }
}

/// Метка шага конвейера: 24 с кружком-состоянием (макет 30:83)
enum SozoStepState { done, current, pending }

class StepMarker extends StatelessWidget {
  const StepMarker(this.state, {super.key});

  final SozoStepState state;

  @override
  Widget build(BuildContext context) {
    return switch (state) {
      SozoStepState.done => Container(
        width: 24,
        height: 24,
        alignment: Alignment.center,
        decoration: BoxDecoration(color: softSuccessBg, borderRadius: BorderRadius.circular(12)),
        child: const FigmaIcon('check-done', size: 12),
      ),
      SozoStepState.current => Container(
        width: 24,
        height: 24,
        alignment: Alignment.center,
        decoration: BoxDecoration(color: softWarnBg, borderRadius: BorderRadius.circular(12)),
        child: Container(
          width: 8,
          height: 8,
          decoration: const BoxDecoration(color: SozoColors.accent, shape: BoxShape.circle),
        ),
      ),
      SozoStepState.pending => Container(
        width: 24,
        height: 24,
        alignment: Alignment.center,
        decoration: BoxDecoration(color: SozoColors.bg, borderRadius: BorderRadius.circular(12)),
        child: Container(
          width: 6,
          height: 6,
          decoration: const BoxDecoration(color: SozoColors.textSecondary, shape: BoxShape.circle),
        ),
      ),
    };
  }
}

/// Кнопка шага: py14, скругление 16, три вида (макет 30:114…30:118).
/// Янтарной заливки у шагов нет — доступный шаг обведён янтарём.
enum BigButtonKind { primary, secondary, disabled }

class BigButton extends StatelessWidget {
  const BigButton({
    super.key,
    required this.label,
    this.onPressed,
    this.kind = BigButtonKind.primary,
    this.busy = false,
  });

  final String label;
  final VoidCallback? onPressed;
  final BigButtonKind kind;
  final bool busy;

  @override
  Widget build(BuildContext context) {
    final effective = onPressed == null ? BigButtonKind.disabled : kind;
    final (bg, border, fg, weight) = switch (effective) {
      BigButtonKind.primary => (SozoColors.surface, SozoColors.accent, SozoColors.text, FontWeight.w700),
      BigButtonKind.secondary => (SozoColors.surface, SozoColors.border, SozoColors.text, FontWeight.w600),
      BigButtonKind.disabled => (SozoColors.border, SozoColors.border, SozoColors.textSecondary, FontWeight.w700),
    };
    return Material(
      color: bg,
      borderRadius: BorderRadius.circular(SozoRadius.tile),
      child: InkWell(
        borderRadius: BorderRadius.circular(SozoRadius.tile),
        onTap: busy ? null : onPressed,
        child: Container(
          width: double.infinity,
          constraints: const BoxConstraints(minHeight: SozoSize.buttonPrimary),
          padding: const EdgeInsets.symmetric(vertical: 14),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(SozoRadius.tile),
            border: Border.all(color: border, width: 1.5),
          ),
          alignment: Alignment.center,
          child: busy
              ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2.2))
              : Text(
                  label,
                  style: TextStyle(fontSize: 16, fontWeight: weight, color: fg),
                ),
        ),
      ),
    );
  }
}

/// Опасное действие строкой: красный текст 14, без рамки (макет 30:120)
class DangerTextButton extends StatelessWidget {
  const DangerTextButton({super.key, required this.label, this.onPressed});

  final String label;
  final VoidCallback? onPressed;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onPressed,
      borderRadius: BorderRadius.circular(SozoRadius.tile),
      child: Container(
        width: double.infinity,
        padding: const EdgeInsets.symmetric(vertical: SozoSpace.s12),
        alignment: Alignment.center,
        child: Text(
          label,
          style: TextStyle(
            fontSize: 14,
            fontWeight: FontWeight.w600,
            color: onPressed == null ? SozoColors.textTertiary : softDangerFg,
          ),
        ),
      ),
    );
  }
}

/// Кнопка-контур с янтарной рамкой: «+ Добавить материал» (макет 30:58)
class OutlineAmberButton extends StatelessWidget {
  const OutlineAmberButton({super.key, required this.label, this.onPressed});

  final String label;
  final VoidCallback? onPressed;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onPressed,
      borderRadius: BorderRadius.circular(SozoRadius.thumb),
      child: Container(
        width: double.infinity,
        constraints: const BoxConstraints(minHeight: SozoSize.buttonPrimary),
        padding: const EdgeInsets.symmetric(vertical: SozoSpace.s12),
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(SozoRadius.thumb),
          border: Border.all(color: SozoColors.accent, width: 1.5),
        ),
        alignment: Alignment.center,
        child: Text(
          label,
          style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: SozoColors.accent),
        ),
      ),
    );
  }
}

/// Пилюля выбора (макет 41:29): невыбранная — белая с серой границей,
/// выбранная — жёлтая подложка, янтарная граница и галочка слева
class ChoicePill extends StatelessWidget {
  const ChoicePill({super.key, required this.label, required this.selected, this.onTap});

  final String label;
  final bool selected;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: selected ? softWarnBg : SozoColors.surface,
      borderRadius: BorderRadius.circular(SozoRadius.chip),
      child: InkWell(
        borderRadius: BorderRadius.circular(SozoRadius.chip),
        onTap: onTap,
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: SozoSpace.s12, vertical: SozoSpace.s8),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(SozoRadius.chip),
            border: Border.all(color: selected ? SozoColors.accent : SozoColors.border),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (selected) ...[const FigmaIcon('check-12', size: 12), const SizedBox(width: 6)],
              Text(
                label,
                style: TextStyle(
                  fontSize: 13,
                  fontWeight: selected ? FontWeight.w600 : FontWeight.w400,
                  color: SozoColors.text,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Поле входа с подписью на рамке (макет 77:24). Подпись не уезжает при
/// наборе и не занимает строку внутри поля — на экране входа это важно:
/// поле одно, и оно должно читаться сразу, а не после тапа.
class FloatingLabelField extends StatelessWidget {
  const FloatingLabelField({
    super.key,
    required this.label,
    required this.controller,
    this.icon,
    this.active = false,
    this.enabled = true,
    this.keyboardType,
    this.maxLength,
    this.autofocus = false,
    this.onChanged,
  });

  final String label;
  final TextEditingController controller;
  final String? icon;

  /// Активное поле обведено янтарём — им же подсвечена подпись
  final bool active;
  final bool enabled;
  final TextInputType? keyboardType;
  final int? maxLength;
  final bool autofocus;
  final ValueChanged<String>? onChanged;

  @override
  Widget build(BuildContext context) {
    final accent = active ? SozoColors.accent : SozoColors.border;
    return Stack(
      clipBehavior: Clip.none,
      children: [
        Container(
          height: SozoSize.field,
          padding: const EdgeInsets.symmetric(horizontal: SozoSpace.s16),
          decoration: BoxDecoration(
            color: SozoColors.surface,
            borderRadius: BorderRadius.circular(SozoRadius.field),
            border: Border.all(color: accent, width: 1.5),
          ),
          child: Row(
            children: [
              if (icon != null) ...[FigmaIcon(icon!, size: 20), const SizedBox(width: SozoSpace.s12)],
              Expanded(
                child: TextField(
                  controller: controller,
                  enabled: enabled,
                  keyboardType: keyboardType,
                  maxLength: maxLength,
                  autofocus: autofocus,
                  onChanged: onChanged,
                  style: TextStyle(
                    fontSize: 16,
                    fontWeight: FontWeight.w500,
                    color: enabled ? SozoColors.text : SozoColors.textSecondary,
                  ),
                  decoration: const InputDecoration(
                    isDense: true,
                    filled: false,
                    counterText: '',
                    border: InputBorder.none,
                    enabledBorder: InputBorder.none,
                    focusedBorder: InputBorder.none,
                    disabledBorder: InputBorder.none,
                    contentPadding: EdgeInsets.zero,
                  ),
                ),
              ),
            ],
          ),
        ),
        Positioned(
          left: 10.5,
          top: -11.5,
          child: Container(
            color: SozoColors.surface,
            padding: const EdgeInsets.symmetric(horizontal: 6),
            child: Text(
              label,
              style: TextStyle(
                fontSize: 12,
                fontWeight: FontWeight.w600,
                color: active ? SozoColors.accent : SozoColors.textSecondary,
              ),
            ),
          ),
        ),
      ],
    );
  }
}

/// Счётчик под полем (макет 77:67): сколько цифр набрано из скольких
class FieldCounter extends StatelessWidget {
  const FieldCounter({super.key, required this.current, required this.total});

  final int current;
  final int total;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(top: SozoSpace.s4, right: SozoSpace.s8),
      child: Align(
        alignment: Alignment.centerRight,
        child: Text(
          '$current/$total',
          style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w500, color: SozoColors.textSecondary),
        ),
      ),
    );
  }
}

/// Строка с флажком на серой подложке (макет 41:55)
class CheckboxRow extends StatelessWidget {
  const CheckboxRow({super.key, required this.label, required this.value, required this.onChanged});

  final String label;
  final bool value;
  final ValueChanged<bool> onChanged;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: SozoColors.bg,
      borderRadius: BorderRadius.circular(SozoRadius.thumb),
      child: InkWell(
        borderRadius: BorderRadius.circular(SozoRadius.thumb),
        onTap: () => onChanged(!value),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: SozoSpace.s12, vertical: 10),
          child: Row(
            children: [
              Expanded(
                child: Text(
                  label,
                  style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w500, color: SozoColors.text),
                ),
              ),
              const SizedBox(width: SozoSpace.s12),
              Container(
                width: 20,
                height: 20,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: value ? SozoColors.accent : SozoColors.surface,
                  borderRadius: BorderRadius.circular(SozoRadius.s4),
                  border: Border.all(color: value ? SozoColors.accent : SozoColors.border, width: 2),
                ),
                child: value ? const FigmaIcon('check-12', size: 12) : null,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Тумблер из макета (73:11): дорожка 44×24, ручка 20.
/// Системный Switch не используем: он тянет свою палитру и требует Material
/// над собой — внутри цветных панелей это даёт невидимые нажатия.
class SozoSwitch extends StatelessWidget {
  const SozoSwitch({super.key, required this.value, required this.onChanged});

  final bool value;
  final ValueChanged<bool> onChanged;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: () => onChanged(!value),
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 150),
        width: 44,
        height: 24,
        padding: const EdgeInsets.all(2),
        decoration: BoxDecoration(
          color: value ? SozoColors.accent : SozoColors.border,
          borderRadius: BorderRadius.circular(SozoRadius.thumb),
        ),
        alignment: value ? Alignment.centerRight : Alignment.centerLeft,
        child: Container(
          width: 20,
          height: 20,
          decoration: BoxDecoration(color: SozoColors.surface, borderRadius: BorderRadius.circular(10)),
        ),
      ),
    );
  }
}

/// Счётчик количества (макет 53:556): кружки 28 со знаками «−» и «+».
/// Знаки набраны текстом — так они и нарисованы в макете, отдельных иконок нет.
class QtyStepper extends StatelessWidget {
  const QtyStepper({super.key, required this.qty, required this.onMinus, required this.onPlus});

  final int qty;
  final VoidCallback onMinus;
  final VoidCallback onPlus;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        _btn('−', onMinus, plus: false),
        const SizedBox(width: 14),
        Text(
          '$qty',
          style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700, color: SozoColors.text),
        ),
        const SizedBox(width: 14),
        _btn('+', onPlus, plus: true),
      ],
    );
  }

  Widget _btn(String sign, VoidCallback onTap, {required bool plus}) {
    return Material(
      color: plus ? softWarnBg : SozoColors.bg,
      borderRadius: BorderRadius.circular(14),
      child: InkWell(
        borderRadius: BorderRadius.circular(14),
        onTap: onTap,
        child: Container(
          width: 28,
          height: 28,
          alignment: Alignment.center,
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(14),
            border: Border.all(color: plus ? bannerBorder : SozoColors.border),
          ),
          child: Text(
            sign,
            style: TextStyle(
              fontSize: 16,
              fontWeight: FontWeight.w600,
              color: plus ? SozoColors.text : SozoColors.textSecondary,
            ),
          ),
        ),
      ),
    );
  }
}

/// Мелкая кнопка на жёлтой подложке: «Снять» у строки фото (макет 41:53)
class SmallChipButton extends StatelessWidget {
  const SmallChipButton({super.key, required this.label, this.onTap});

  final String label;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: softWarnBg,
      borderRadius: BorderRadius.circular(SozoRadius.badge),
      child: InkWell(
        borderRadius: BorderRadius.circular(SozoRadius.badge),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: SozoSpace.s12, vertical: 6),
          child: Text(
            label,
            style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: SozoColors.text),
          ),
        ),
      ),
    );
  }
}

/// Заголовок раздела над карточкой — 18/bold (макет 41:26)
class ScreenHeading extends StatelessWidget {
  const ScreenHeading(this.text, {super.key});

  final String text;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: double.infinity,
      child: Text(
        text,
        style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700, color: SozoColors.text),
      ),
    );
  }
}

/// Прилипшая снизу панель с главным действием (макет 41:63)
class StickyFooter extends StatelessWidget {
  const StickyFooter({super.key, required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: const BoxDecoration(
        color: SozoColors.surface,
        border: Border(top: BorderSide(color: SozoColors.border)),
      ),
      padding: const EdgeInsets.fromLTRB(SozoSpace.s16, SozoSpace.s12, SozoSpace.s16, SozoSpace.s24),
      child: SafeArea(top: false, child: child),
    );
  }
}

/// Кнопка-контур с иконкой: «Техники нет — закрыть шаг» (макет 41:21)
class OutlineIconButton extends StatelessWidget {
  const OutlineIconButton({super.key, required this.icon, required this.label, this.onPressed, this.amber = true});

  final String icon;
  final String label;
  final VoidCallback? onPressed;

  /// Янтарная рамка — предлагаемое действие; серая — равноправное (макет 43:26)
  final bool amber;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: SozoColors.surface,
      borderRadius: BorderRadius.circular(SozoRadius.tile),
      child: InkWell(
        borderRadius: BorderRadius.circular(SozoRadius.tile),
        onTap: onPressed,
        child: Container(
          width: double.infinity,
          constraints: const BoxConstraints(minHeight: SozoSize.buttonPrimary),
          padding: EdgeInsets.symmetric(horizontal: SozoSpace.s16, vertical: amber ? SozoSpace.s12 : 14),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(SozoRadius.tile),
            border: Border.all(color: amber ? SozoColors.accent : SozoColors.border, width: 1.5),
          ),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              FigmaIcon(icon, size: amber ? 16 : 18),
              const SizedBox(width: SozoSpace.s8),
              Text(
                label,
                style: TextStyle(fontSize: amber ? 14 : 15, fontWeight: FontWeight.w600, color: SozoColors.text),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Строка «документ — состояние» (макет 53:712): значок 40, название,
/// состояние словом и цветом, справа — галочка, если всё в порядке
enum StatusTone { ok, pending, bad }

class StatusListRow extends StatelessWidget {
  const StatusListRow({
    super.key,
    required this.icon,
    required this.title,
    required this.status,
    required this.tone,
    this.titleBold = false,
    this.onTap,
  });

  final String icon;
  final String title;
  final String status;
  final StatusTone tone;
  final bool titleBold;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final fg = switch (tone) {
      StatusTone.ok => softSuccessFg,
      StatusTone.pending => SozoColors.textSecondary,
      StatusTone.bad => softDangerFg,
    };
    return InkWell(
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.all(SozoSpace.s16),
        child: Row(
          children: [
            IconBadge(icon, size: 40, iconSize: 20),
            const SizedBox(width: SozoSpace.s12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    title,
                    style: TextStyle(
                      fontSize: titleBold ? 15 : 12,
                      fontWeight: titleBold ? FontWeight.w700 : FontWeight.w600,
                      color: SozoColors.text,
                    ),
                  ),
                  const SizedBox(height: SozoSpace.s4),
                  Text(
                    status,
                    style: TextStyle(
                      fontSize: titleBold ? 12 : 13,
                      fontWeight: FontWeight.w500,
                      color: titleBold ? SozoColors.textSecondary : fg,
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(width: SozoSpace.s12),
            if (tone == StatusTone.ok)
              Container(
                width: 22,
                height: 22,
                alignment: Alignment.center,
                decoration: BoxDecoration(color: softSuccessFg, borderRadius: BorderRadius.circular(11)),
                child: const FigmaIcon('check-white', size: 12),
              )
            else
              FigmaIcon(tone == StatusTone.bad ? 'alert-triangle' : 'alert-circle', size: 20),
          ],
        ),
      ),
    );
  }
}

/// Спокойная плашка «так устроено» (макет 53:746): не блокер и не ошибка,
/// а объяснение правила — поэтому тёплый бежевый, а не жёлтый
class AdminNote extends StatelessWidget {
  const AdminNote({super.key, required this.icon, required this.text});

  final String icon;
  final String text;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(SozoSpace.s16),
      decoration: BoxDecoration(
        color: adminNoteBg,
        borderRadius: BorderRadius.circular(SozoRadius.tile),
        border: Border.all(color: adminNoteBorder),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          FigmaIcon(icon, size: 16),
          const SizedBox(width: SozoSpace.s12),
          Expanded(
            child: Text(
              text,
              style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w500, color: adminNoteFg, height: 18 / 13),
            ),
          ),
        ],
      ),
    );
  }
}

/// Тёмная кнопка (макет 53:688): используется там, где действие ведёт
/// в отдельный процесс, а не завершает экран
class DarkButton extends StatelessWidget {
  const DarkButton({super.key, required this.label, this.onPressed});

  final String label;
  final VoidCallback? onPressed;

  @override
  Widget build(BuildContext context) {
    final on = onPressed != null;
    return Material(
      color: on ? SozoColors.text : SozoColors.border,
      borderRadius: BorderRadius.circular(SozoRadius.tile),
      child: InkWell(
        borderRadius: BorderRadius.circular(SozoRadius.tile),
        onTap: onPressed,
        child: Container(
          constraints: const BoxConstraints(minHeight: SozoSize.buttonPrimary),
          padding: const EdgeInsets.symmetric(vertical: 14),
          child: Center(
            child: Text(
              label,
              style: TextStyle(
                fontSize: 15,
                fontWeight: FontWeight.w700,
                color: on ? SozoColors.surface : SozoColors.textSecondary,
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// Жёлтая плашка с кружком «i» (макет 53:634). В отличие от NoteBox
/// это предупреждение по экрану целиком, а не по одному полю.
class WarningBanner extends StatelessWidget {
  const WarningBanner(this.text, {super.key});

  final String text;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(SozoSpace.s12),
      decoration: BoxDecoration(
        color: softWarnBg,
        borderRadius: BorderRadius.circular(SozoRadius.thumb),
        border: Border.all(color: bannerBorder),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 18,
            height: 18,
            alignment: Alignment.center,
            decoration: const BoxDecoration(color: SozoColors.accent, shape: BoxShape.circle),
            child: const Text(
              'i',
              style: TextStyle(fontSize: 11, fontWeight: FontWeight.w800, color: SozoColors.onAccent, height: 1.1),
            ),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              text,
              style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w500, color: SozoColors.text, height: 1.4),
            ),
          ),
        ],
      ),
    );
  }
}

/// Значок «всё в порядке» справа в строке меню (макет 58:379).
/// Плотный — когда состояние проверено кем-то, мягкий — когда просто «пусто».
class DoneBadge extends StatelessWidget {
  const DoneBadge({super.key, this.soft = false});

  final bool soft;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 20,
      height: 20,
      alignment: Alignment.center,
      decoration: BoxDecoration(color: soft ? softSuccessBg : softSuccessFg, borderRadius: BorderRadius.circular(10)),
      child: FigmaIcon(soft ? 'check-done' : 'check-white', size: 12),
    );
  }
}

/// Жёлтая полоса-подсказка без иконки (макет 43:117): p12, скругление 12,
/// текст 13/medium. От NoteBox отличается тем, что ничего не блокирует.
class InfoBanner extends StatelessWidget {
  const InfoBanner(this.text, {super.key});

  final String text;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(SozoSpace.s12),
      decoration: BoxDecoration(color: softWarnBg, borderRadius: BorderRadius.circular(SozoRadius.thumb)),
      child: Text(
        'ⓘ $text',
        style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w500, color: softWarnFg, height: 1.35),
      ),
    );
  }
}

/// Диалог подтверждения (макет 43:197): затемнение 40%, карточка r24 p24,
/// заголовок 20/bold, текст 14, «Отмена» текстом и янтарная «Принял».
Future<bool?> showSozoConfirm(
  BuildContext context, {
  required String title,
  required String body,
  required String confirmLabel,

  /// Подпись отмены по умолчанию берётся из словаря, а не из значения
  /// параметра: значение по умолчанию обязано быть константой, а перевод
  /// зависит от выбранного языка.
  String? cancelLabel,
}) {
  final cancel = cancelLabel ?? t('common.otmena');
  return showDialog<bool>(
    context: context,
    barrierColor: const Color(0x66000000),
    builder: (ctx) => Dialog(
      insetPadding: const EdgeInsets.all(20),
      backgroundColor: SozoColors.surface,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(SozoRadius.card)),
      child: Padding(
        padding: const EdgeInsets.all(SozoSpace.s24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              title,
              style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w700, color: SozoColors.text),
            ),
            const SizedBox(height: 20),
            Text(body, style: const TextStyle(fontSize: 14, color: SozoColors.textSecondary, height: 1.4)),
            const SizedBox(height: 20),
            Row(
              mainAxisAlignment: MainAxisAlignment.end,
              children: [
                InkWell(
                  onTap: () => Navigator.of(ctx).pop(false),
                  child: Padding(
                    padding: const EdgeInsets.symmetric(horizontal: SozoSpace.s16, vertical: 10),
                    child: Text(
                      cancel,
                      style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600, color: softWarnFg),
                    ),
                  ),
                ),
                const SizedBox(width: SozoSpace.s12),
                Material(
                  color: SozoColors.accent,
                  borderRadius: BorderRadius.circular(SozoRadius.thumb),
                  child: InkWell(
                    borderRadius: BorderRadius.circular(SozoRadius.thumb),
                    onTap: () => Navigator.of(ctx).pop(true),
                    child: Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 10),
                      child: Text(
                        confirmLabel,
                        style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600, color: SozoColors.onAccent),
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    ),
  );
}

/// Серый тег-категория (макет 43:40): px10 py4, скругление 8, текст 11
class TagChip extends StatelessWidget {
  const TagChip(this.label, {super.key});

  final String label;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: SozoSpace.s4),
      decoration: BoxDecoration(color: SozoColors.chipGrey, borderRadius: BorderRadius.circular(SozoRadius.badge)),
      child: Text(
        label,
        style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w500, color: SozoColors.textSecondary),
      ),
    );
  }
}

/// Карточка с границей вместо заливки: списки магазинов, документов (макет 43:31)
class OutlinedCard extends StatelessWidget {
  const OutlinedCard({super.key, required this.children, this.gap = SozoSpace.s8, this.onTap});

  final List<Widget> children;
  final double gap;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final body = Container(
      width: double.infinity,
      padding: const EdgeInsets.all(SozoSpace.s16),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(SozoRadius.card),
        border: Border.all(color: SozoColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          for (var i = 0; i < children.length; i++) ...[if (i > 0) SizedBox(height: gap), children[i]],
        ],
      ),
    );
    return Material(
      color: SozoColors.surface,
      borderRadius: BorderRadius.circular(SozoRadius.card),
      child: onTap == null
          ? body
          : InkWell(borderRadius: BorderRadius.circular(SozoRadius.card), onTap: onTap, child: body),
    );
  }
}

/// Статусный бейдж макета: пастельная пара, px10 py4, скругление 100
class FigmaStatusChip extends StatelessWidget {
  const FigmaStatusChip({super.key, required this.label, required this.status});

  final String label;
  final String status;

  @override
  Widget build(BuildContext context) {
    final c = statusChipColors(status);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: SozoSpace.s4),
      decoration: BoxDecoration(color: c.bg, borderRadius: BorderRadius.circular(SozoRadius.chip)),
      child: Text(
        label,
        style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: c.fg),
      ),
    );
  }
}
