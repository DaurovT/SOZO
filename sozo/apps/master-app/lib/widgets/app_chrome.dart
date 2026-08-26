import 'package:flutter/material.dart';

import '../design_tokens.dart';
import 'figma_icon.dart';
import '../i18n.dart';

/// Шапка и таббар — единые на всех экранах (DEV-11 правило 3).
///
/// Геометрия снята с макета: header-bar 30:11, header 74:11, header-layer 26:173.
/// Все три узла совпадают до пикселя, поэтому вариант в приложении ровно один.

/// Высота шапки: 12 сверху + кнопка 48 + 12 снизу.
/// Кнопки в шапке нажимают в перчатке и на ходу, поэтому поле нажатия 48,
/// а нарисованный кружок остаётся макетным
const double kSozoAppBarHeight = 72;

/// Кнопка «назад» из макета: янтарный круг 30 в сером поле.
/// Поле нажатия 48 вместо макетных 36 — минимальный тач-таргет.
class SozoBackButton extends StatelessWidget {
  const SozoBackButton({super.key, this.onTap});

  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: SozoSize.tap,
      height: SozoSize.tap,
      child: Material(
        color: SozoColors.bg,
        borderRadius: BorderRadius.circular(SozoSize.tap / 2),
        child: InkWell(
          borderRadius: BorderRadius.circular(SozoSize.tap / 2),
          onTap: onTap ?? () => Navigator.of(context).maybePop(),
          child: Center(
            child: Container(
              width: 32,
              height: 32,
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

/// Круглая кнопка в правом слоте шапки: иконка 20 в поле 48
class SozoAppBarAction extends StatelessWidget {
  const SozoAppBarAction({super.key, required this.icon, this.onTap, this.color});

  final String icon;
  final VoidCallback? onTap;

  /// Цвет иконки. Нужен там, где в самом SVG зашит цвет из макета,
  /// а на конкретном экране он выбивается из шапки
  final Color? color;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: SozoSize.tap,
      height: SozoSize.tap,
      child: Material(
        color: Colors.transparent,
        borderRadius: BorderRadius.circular(SozoRadius.chip),
        child: InkWell(
          borderRadius: BorderRadius.circular(SozoRadius.chip),
          onTap: onTap,
          child: Center(child: FigmaIcon(icon, size: 20, color: color)),
        ),
      ),
    );
  }
}

/// Шапка экрана: «назад» слева, заголовок 17/bold по центру, слот справа.
/// Правый слот всегда занимает 48 — иначе заголовок съезжает с центра.
class SozoAppBar extends StatelessWidget implements PreferredSizeWidget {
  const SozoAppBar({super.key, required this.title, this.action, this.onBack, this.showBack = true, this.bottom});

  final String title;
  final Widget? action;
  final VoidCallback? onBack;
  final bool showBack;

  /// Полоса под шапкой (офлайн-очередь): в высоту заголовка не входит
  final Widget? bottom;

  @override
  Size get preferredSize => Size.fromHeight(kSozoAppBarHeight + (bottom == null ? 0 : 36));

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
              height: kSozoAppBarHeight,
              padding: const EdgeInsets.symmetric(horizontal: SozoSpace.s16, vertical: SozoSpace.s12),
              decoration: const BoxDecoration(
                border: Border(bottom: BorderSide(color: SozoColors.border)),
              ),
              child: Row(
                children: [
                  showBack ? SozoBackButton(onTap: onBack) : const SizedBox(width: SozoSize.tap, height: SozoSize.tap),
                  Expanded(
                    child: Text(
                      title,
                      textAlign: TextAlign.center,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w700, color: SozoColors.text),
                    ),
                  ),
                  action ?? const SizedBox(width: SozoSize.tap, height: SozoSize.tap),
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

/// Шапка вкладки: тот же бар, что и везде, но без кнопки «назад» —
/// из вкладки возвращаться некуда, стрелка была бы ложным обещанием.
/// Макет рисует её и высотой 45 (график, профиль), и 48 (кошелёк);
/// берём один вариант, иначе шапка «прыгает» при переключении вкладок.
class SozoTabHeader extends StatelessWidget {
  const SozoTabHeader(this.title, {super.key, this.action});

  final String title;
  final Widget? action;

  @override
  Widget build(BuildContext context) => SozoAppBar(title: title, showBack: false, action: action);
}

/// Пять вкладок макета. Размер иконки задан в макете поштучно
/// (home 20, остальные 22) и от активности не зависит.
/// Геттер, а не константа: подписи вкладок переводятся, а язык меняется
/// на ходу — константа осталась бы на языке, который был при запуске.
List<({String icon, String label, double size})> get sozoTabs => [
  (icon: 'home', label: t('common.glavnaya'), size: 20.0),
  (icon: 'list', label: t('common.zayavki'), size: 22.0),
  (icon: 'calendar', label: t('prof.grafik'), size: 22.0),
  (icon: 'credit-card', label: t('common.dengi'), size: 22.0),
  (icon: 'user', label: t('prof.profil'), size: 22.0),
];

/// Таббар: белый, верхняя граница, вкладки поровну по ширине экрана,
/// активная — янтарная пилюля 48×32 со скруглением 16 (макет 29:4).
class SozoTabBar extends StatelessWidget {
  const SozoTabBar({super.key, required this.index, required this.onSelect});

  final int index;
  final ValueChanged<int> onSelect;

  @override
  Widget build(BuildContext context) {
    // В макете под подписями 20 px пустоты. На устройстве с индикатором
    // «домой» этого мало — берём системный отступ, но не меньше макетных 20.
    final inset = MediaQuery.paddingOf(context).bottom;
    return Container(
      decoration: const BoxDecoration(
        color: SozoColors.surface,
        border: Border(top: BorderSide(color: SozoColors.border)),
      ),
      padding: EdgeInsets.only(top: SozoSpace.s8, bottom: inset < 20 ? 20 : inset),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [for (var i = 0; i < sozoTabs.length; i++) Expanded(child: _item(i))],
      ),
    );
  }

  Widget _item(int i) {
    final tab = sozoTabs[i];
    final active = i == index;
    // Ширина от экрана (Expanded выше), а не макетные 70: при системном
    // шрифте 150–200% подписи «Заявки» и «Профиль» не помещались в коробку
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: () => onSelect(i),
        child: Padding(
          padding: const EdgeInsets.only(top: SozoSpace.s4),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: 48,
                height: 32,
                alignment: Alignment.center,
                decoration: active
                    ? BoxDecoration(color: SozoColors.accent, borderRadius: BorderRadius.circular(16))
                    : null,
                // Цвет задаём здесь, а не берём из файла: иконки выгружены
                // из разных состояний макета, у части внутри белая обводка
                child: FigmaIcon(
                  tab.icon,
                  size: tab.size,
                  color: active ? SozoColors.onAccent : SozoColors.textSecondary,
                ),
              ),
              const SizedBox(height: SozoSpace.s4),
              Text(
                tab.label,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  fontSize: 12,
                  fontWeight: active ? FontWeight.w600 : FontWeight.w500,
                  color: active ? SozoColors.text : SozoColors.textSecondary,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
