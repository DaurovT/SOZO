import 'package:flutter/material.dart';

import '../design_tokens.dart';
import '../i18n.dart';
import 'figma_icon.dart';

/// Шапка и таббар — единые на всех экранах (DEV-12 правило 2).
/// Геометрия общая с приложением мастера: два приложения одного бренда
/// не могут иметь разные шапки.

/// Высота шапки: 12 сверху + кнопка 36 + 12 снизу
const double kSozoAppBarHeight = 60;

/// Кнопка «назад»: серая коробка 36, внутри янтарный круг 30 и стрелка 20
class SozoBackButton extends StatelessWidget {
  const SozoBackButton({super.key, this.onTap});

  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: 36,
      height: 36,
      child: Material(
        color: SozoColors.bg,
        borderRadius: BorderRadius.circular(18),
        child: InkWell(
          borderRadius: BorderRadius.circular(18),
          onTap: onTap ?? () => Navigator.of(context).maybePop(),
          child: Center(
            child: Container(
              width: 30,
              height: 30,
              decoration: const BoxDecoration(color: SozoColors.accent, shape: BoxShape.circle),
              alignment: Alignment.center,
              child: const FigmaIcon('arrow-left', size: 20),
            ),
          ),
        ),
      ),
    );
  }
}

/// Круглая кнопка в правом слоте шапки: иконка 20 в поле 36
class SozoAppBarAction extends StatelessWidget {
  const SozoAppBarAction({
    super.key,
    required this.icon,
    this.onTap,
    this.color,
    this.badge,
    this.filled = false,
  });

  final String icon;
  final VoidCallback? onTap;
  final Color? color;

  /// Янтарный кружок под иконкой — как у кнопки «назад» (242:16)
  final bool filled;

  /// Счётчик поверх иконки: 0 — не рисуем
  final int? badge;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: 36,
      height: 36,
      child: Material(
        color: filled ? SozoColors.accent : Colors.transparent,
        borderRadius: BorderRadius.circular(SozoRadius.chip),
        child: InkWell(
          borderRadius: BorderRadius.circular(SozoRadius.chip),
          onTap: onTap,
          child: Stack(
            children: [
              Center(child: FigmaIcon(icon, size: filled ? 16 : 20, color: filled ? authInk : color)),
              if ((badge ?? 0) > 0)
                Positioned(right: 2, top: 2, child: _CountDot(count: badge!)),
            ],
          ),
        ),
      ),
    );
  }
}

class _CountDot extends StatelessWidget {
  const _CountDot({required this.count});

  final int count;

  @override
  Widget build(BuildContext context) {
    return Container(
      constraints: const BoxConstraints(minWidth: 16),
      height: 16,
      padding: const EdgeInsets.symmetric(horizontal: SozoSpace.s4),
      decoration: BoxDecoration(
        color: SozoColors.accent,
        borderRadius: BorderRadius.circular(SozoRadius.chip),
      ),
      alignment: Alignment.center,
      child: Text(
        count > 99 ? '99+' : '$count',
        style: const TextStyle(fontSize: 10, fontWeight: FontWeight.w700, color: SozoColors.onAccent),
      ),
    );
  }
}

/// Шапка экрана: «назад» слева, заголовок 17/bold по центру, слот справа.
/// Правый слот всегда занимает 36 — иначе заголовок съезжает с центра.
class SozoAppBar extends StatelessWidget implements PreferredSizeWidget {
  const SozoAppBar({
    this.titleSize = 17,
    super.key,
    required this.title,
    this.subtitle,
    this.action,
    this.leading,
    this.onBack,
    this.showBack = true,
    this.bottom,
    this.onTitleTap,
  });

  final String title;

  /// Подзаголовок под названием: тип утверждения, шаг визарда
  final String? subtitle;
  final Widget? action;

  /// Размер заголовка: на карточке заявки он 16 (242:15)
  final double titleSize;

  /// Замена кнопки «назад»: крестик закрытия визарда, логотип на главной
  final Widget? leading;
  final VoidCallback? onBack;
  final bool showBack;

  /// Полоса под шапкой (офлайн-баннер): в высоту заголовка не входит
  final Widget? bottom;

  /// Тап по заголовку: на главной ведёт к выбору роли и точки
  final VoidCallback? onTitleTap;

  /// Подзаголовок добавляет вторую строку — бар становится выше.
  /// Держать одну высоту на оба случая нельзя: текст не влезает и обрезается.
  double get _barHeight => subtitle == null ? kSozoAppBarHeight : kSozoAppBarHeight + 16;

  @override
  Size get preferredSize => Size.fromHeight(_barHeight + (bottom == null ? 0 : 36));

  @override
  Widget build(BuildContext context) {
    return Material(
      color: SozoColors.surface,
      child: SafeArea(
        bottom: false,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              height: _barHeight,
              padding: const EdgeInsets.symmetric(horizontal: SozoSpace.s16, vertical: SozoSpace.s12),
              decoration: const BoxDecoration(
                border: Border(bottom: BorderSide(color: SozoColors.border)),
              ),
              child: Row(
                children: [
                  leading ??
                      (showBack
                          ? SozoBackButton(onTap: onBack)
                          : const SizedBox(width: 36, height: 36)),
                  Expanded(
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        // Заголовок-переключатель: у человека с несколькими ролями
                        // смена контекста — частое действие, и прятать его
                        // третьим пунктом профиля неправильно
                        InkWell(
                          onTap: onTitleTap,
                          borderRadius: BorderRadius.circular(SozoRadius.badge),
                          child: Row(
                            mainAxisAlignment: MainAxisAlignment.center,
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Flexible(
                                child: Text(
                                  title,
                                  textAlign: TextAlign.center,
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                  style: TextStyle(
                                    fontSize: titleSize,
                                    fontWeight: FontWeight.w700,
                                    color: authInk,
                                  ),
                                ),
                              ),
                              if (onTitleTap != null) ...[
                                const SizedBox(width: SozoSpace.s4),
                                const FigmaIcon('chevron-right', size: 14, color: SozoColors.textSecondary),
                              ],
                            ],
                          ),
                        ),
                        if (subtitle != null)
                          Text(
                            subtitle!,
                            textAlign: TextAlign.center,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(fontSize: 11, color: SozoColors.textSecondary),
                          ),
                      ],
                    ),
                  ),
                  action ?? const SizedBox(width: 36, height: 36),
                ],
              ),
            ),
            ?bottom,
          ],
        ),
      ),
    );
  }
}

/// Шапка входа (макет 165:23, 167:1633).
///
/// Отдельный класс, а не локальный вариант в экране: правило «одна шапка на
/// приложение» про то, что копии не заводят по экранам, — здесь одна шапка на
/// весь вход. Геометрия у макета входа своя и заметно другая: бар 64 вместо 60,
/// кнопка «назад» — янтарный квадрат 40 со скруглением 20, а не круг 30 в поле
/// 36, заголовок 18 вместо 17, фон — фон экрана, а не белый.
class SozoAuthAppBar extends StatelessWidget implements PreferredSizeWidget {
  const SozoAuthAppBar({super.key, required this.title, this.onBack});

  final String title;
  final VoidCallback? onBack;

  @override
  Size get preferredSize => const Size.fromHeight(64);

  @override
  Widget build(BuildContext context) {
    return Material(
      color: SozoColors.bg,
      child: SafeArea(
        bottom: false,
        child: Container(
          height: 64,
          padding: const EdgeInsets.symmetric(horizontal: 20, vertical: SozoSpace.s12),
          decoration: const BoxDecoration(
            border: Border(bottom: BorderSide(color: SozoColors.border)),
          ),
          child: Stack(
            children: [
              // Заголовок центрируется по экрану, а не по остатку строки:
              // иначе он съезжает на ширину кнопки «назад»
              Center(
                child: Text(
                  title,
                  style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700, color: authInk),
                ),
              ),
              Align(
                alignment: Alignment.centerLeft,
                child: Material(
                  color: SozoColors.accent,
                  borderRadius: BorderRadius.circular(20),
                  child: InkWell(
                    borderRadius: BorderRadius.circular(20),
                    onTap: onBack ?? () => Navigator.of(context).maybePop(),
                    child: const SizedBox(
                      width: 40,
                      height: 40,
                      child: Center(child: FigmaIcon('chevron-left-20', size: 20)),
                    ),
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

/// Шапка вкладки: тот же бар, но без «назад» — из вкладки возвращаться некуда,
/// стрелка была бы ложным обещанием.
class SozoTabHeader extends StatelessWidget {
  const SozoTabHeader(this.title, {super.key, this.action, this.leading, this.onTitleTap});

  final String title;
  final Widget? action;
  final Widget? leading;
  final VoidCallback? onTitleTap;

  @override
  Widget build(BuildContext context) => SozoAppBar(
        title: title,
        showBack: false,
        action: action,
        leading: leading,
        onTitleTap: onTitleTap,
      );
}

/// Описание вкладки таббара
typedef SozoTab = ({String icon, String label, double size});

/// Таббар: белый, верхняя граница, активная вкладка — янтарная пилюля 48×32.
class SozoTabBar extends StatelessWidget {
  const SozoTabBar({
    super.key,
    required this.tabs,
    required this.index,
    required this.onSelect,
    this.badges,
    this.onCreate,
  });

  final List<SozoTab> tabs;
  final int index;
  final ValueChanged<int> onSelect;

  /// Создание заявки — кнопка в центре, а не шестая вкладка.
  ///
  /// Вкладка означает «место, куда можно вернуться», а создание — действие,
  /// после которого возвращаться некуда. Поэтому она круглая, янтарная и не
  /// подсвечивается как выбранная.
  final VoidCallback? onCreate;

  /// Счётчики на вкладках: индекс → число (центр утверждений, C-41)
  final Map<int, int>? badges;

  @override
  Widget build(BuildContext context) {
    // На устройстве с индикатором «домой» системного отступа может не хватать —
    // берём его, но не меньше 20
    final inset = MediaQuery.paddingOf(context).bottom;
    return Container(
      decoration: const BoxDecoration(
        color: SozoColors.surface,
        border: Border(top: BorderSide(color: authCardDivider)),
      ),
      // Высота 82 при отступах pt8/pb20 (190:71); на устройстве с индикатором
      // «домой» системного отступа может не хватать — берём его, но не меньше 20
      padding: EdgeInsets.only(top: SozoSpace.s8, bottom: inset < 20 ? 20 : inset),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceEvenly,
        children: [
          for (var i = 0; i < tabs.length; i++) ...[
            // Ровно посередине: при четырёх вкладках это между второй и третьей
            if (onCreate != null && i == tabs.length ~/ 2) _createButton(),
            _item(i),
          ],
        ],
      ),
    );
  }

  Widget _createButton() {
    return SizedBox(
      width: 70,
      // Align с heightFactor, а не Center: Center в Row тянется на всю
      // доступную высоту, таббар забирал весь экран, и телу вкладки
      // оставалось ноль — после входа человек видел пустую страницу
      child: Align(
        alignment: Alignment.center,
        heightFactor: 1,
        child: Semantics(
          button: true,
          label: t('tab.create'),
          child: Material(
            color: Colors.transparent,
            shape: const CircleBorder(),
            child: InkWell(
              customBorder: const CircleBorder(),
              onTap: onCreate,
              child: const SizedBox(
                width: 52,
                height: 52,
                child: FigmaIcon('plus-circle', size: 52),
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _item(int i) {
    final tab = tabs[i];
    final active = i == index;
    final badge = badges?[i] ?? 0;
    return SizedBox(
      width: 70,
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: () => onSelect(i),
          child: Padding(
            padding: const EdgeInsets.only(top: SozoSpace.s4),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Stack(
                  clipBehavior: Clip.none,
                  children: [
                    // Плитка 40×32 со скруглением 12 и янтарём на десятой
                    // доле прозрачности (190:73) — не сплошная заливка
                    Container(
                      width: 40,
                      height: 32,
                      alignment: Alignment.center,
                      decoration: active
                          ? BoxDecoration(
                              color: SozoColors.accent.withValues(alpha: 0.1),
                              borderRadius: BorderRadius.circular(12),
                            )
                          : null,
                      // Цвет задаём здесь: часть иконок выгружена из макета
                      // с зашитой белой обводкой
                      child: FigmaIcon(
                        tab.icon,
                        size: tab.size,
                        color: active ? SozoColors.accent : authHint,
                      ),
                    ),
                    if (badge > 0) Positioned(right: 0, top: -2, child: _CountDot(count: badge)),
                  ],
                ),
                const SizedBox(height: SozoSpace.s4),
                Text(
                  tab.label,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    fontSize: 10,
                    fontWeight: active ? FontWeight.w700 : FontWeight.w500,
                    color: active ? authInk : authHint,
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
