import 'package:flutter/material.dart';

import '../api/models.dart';
import '../design_tokens.dart';
import 'figma_icon.dart';
import '../i18n.dart';

/// Блоки главного экрана — верстка 1:1 с макетом (node 21:5).
/// Размеры и цвета взяты из макета как есть, без округления «на глаз».

/// Шапка: аватар 40, имя 15/bold, роль 12, колокольчик 40 (node 21:13)
class ProfileHeader extends StatelessWidget {
  const ProfileHeader({super.key, required this.name, required this.role, required this.bell});

  final String name;
  final String role;
  final Widget bell;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: SozoSpace.s8),
      child: Row(
        children: [
          Container(
            width: 40,
            height: 40,
            decoration: BoxDecoration(color: SozoColors.accent, borderRadius: BorderRadius.circular(20)),
            alignment: Alignment.center,
            child: Text(
              name.trim().isEmpty ? '?' : name.trim()[0].toUpperCase(),
              style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: SozoColors.text),
            ),
          ),
          const SizedBox(width: SozoSpace.s12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  name,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700, color: SozoColors.text),
                ),
                const SizedBox(height: 2),
                Text(role, style: const TextStyle(fontSize: 12, color: SozoColors.textSecondary)),
              ],
            ),
          ),
          bell,
        ],
      ),
    );
  }
}

/// Карточка дохода: градиент, сумма 24/bold, круглая кнопка 44 (node 25:213)
class EarningsCard extends StatelessWidget {
  const EarningsCard({super.key, required this.amount, this.onTap});

  final String amount;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      borderRadius: BorderRadius.circular(SozoRadius.card),
      child: Ink(
        decoration: BoxDecoration(
          gradient: const LinearGradient(colors: earningsGradient),
          borderRadius: BorderRadius.circular(SozoRadius.card),
        ),
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(SozoRadius.card),
          child: Padding(
            padding: const EdgeInsets.all(SozoSpace.s16),
            child: Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        t('today.zarabotanoSegodnya'),
                        style: TextStyle(fontSize: 12, fontWeight: FontWeight.w500, color: earningsCaption),
                      ),
                      const SizedBox(height: SozoSpace.s4),
                      Text(
                        amount,
                        style: const TextStyle(
                          fontSize: 24,
                          fontWeight: FontWeight.w700,
                          color: SozoColors.surface,
                          fontFeatures: moneyFeatures,
                        ),
                      ),
                      const SizedBox(height: SozoSpace.s4),
                      Text(t('today.zaTekuschiyDen'), style: TextStyle(fontSize: 11, color: earningsSub)),
                    ],
                  ),
                ),
                Container(
                  width: 44,
                  height: 44,
                  decoration: BoxDecoration(color: SozoColors.accent, borderRadius: BorderRadius.circular(22)),
                  alignment: Alignment.center,
                  child: const FigmaIcon('arrow-right', size: 20),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// Плитка показателя: значение 22/bold, подпись 11 (node 21:23)
class MetricCard extends StatelessWidget {
  const MetricCard({super.key, required this.value, required this.label});

  final String value;
  final String label;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(SozoSpace.s12),
      decoration: BoxDecoration(color: SozoColors.surface, borderRadius: BorderRadius.circular(SozoRadius.tile)),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            value,
            maxLines: 1,
            style: const TextStyle(
              fontSize: 22,
              fontWeight: FontWeight.w700,
              color: SozoColors.text,
              fontFeatures: moneyFeatures,
            ),
          ),
          const SizedBox(height: SozoSpace.s4),
          Text(
            label,
            style: const TextStyle(
              fontSize: 11,
              fontWeight: FontWeight.w500,
              color: SozoColors.textSecondary,
              height: 1.2,
            ),
          ),
        ],
      ),
    );
  }
}

/// Пилюля фильтра: активная янтарная с точкой, обычная белая (node 25:220)
class FilterPill extends StatelessWidget {
  const FilterPill({super.key, required this.label, required this.active, this.icon, this.onTap});

  final String label;
  final bool active;

  /// Иконка набора у неактивной пилюли. Эмодзи здесь были бы единственным
  /// местом в навигации, где картинку рисует шрифт системы
  final String? icon;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: active ? SozoColors.accent : SozoColors.surface,
      borderRadius: BorderRadius.circular(100),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(100),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: SozoSpace.s16, vertical: SozoSpace.s12),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (active)
                const FigmaIcon('ellipse', size: 8)
              else if (icon != null)
                FigmaIcon(icon!, size: 14, color: SozoColors.textSecondary),
              const SizedBox(width: 6),
              Text(
                label,
                style: TextStyle(
                  fontSize: 14,
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

/// Тоггл «Сегодня / Завтра» + кнопка карты (node 21:35)
class DayToggle extends StatelessWidget {
  const DayToggle({super.key, required this.tab, required this.onTab, required this.onMap});

  final int tab;
  final ValueChanged<int> onTab;
  final VoidCallback onMap;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Expanded(
          child: Container(
            height: 40,
            padding: const EdgeInsets.all(3),
            decoration: BoxDecoration(color: SozoColors.surface, borderRadius: BorderRadius.circular(SozoRadius.thumb)),
            child: Row(
              children: [
                Expanded(child: _tab(t('today.segodnya'), 0)),
                Expanded(child: _tab(t('today.zavtra'), 1)),
              ],
            ),
          ),
        ),
        const SizedBox(width: SozoSpace.s12),
        Material(
          color: SozoColors.surface,
          borderRadius: BorderRadius.circular(SozoRadius.thumb),
          child: InkWell(
            onTap: onMap,
            borderRadius: BorderRadius.circular(SozoRadius.thumb),
            child: const SizedBox(width: 40, height: 40, child: Center(child: FigmaIcon('map', size: 20))),
          ),
        ),
      ],
    );
  }

  Widget _tab(String label, int index) {
    final active = tab == index;
    return GestureDetector(
      onTap: () => onTab(index),
      behavior: HitTestBehavior.opaque,
      child: Container(
        decoration: active
            ? BoxDecoration(color: toggleActiveBg, borderRadius: BorderRadius.circular(SozoRadius.toggleTab))
            : null,
        alignment: Alignment.center,
        child: Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            if (active) ...[const FigmaIcon('check', size: 14), const SizedBox(width: 6)],
            Text(
              label,
              style: TextStyle(
                fontSize: 13,
                fontWeight: active ? FontWeight.w700 : FontWeight.w500,
                color: active ? SozoColors.text : SozoColors.textSecondary,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Карточка заявки: номер + статус, название + адрес + иконка 44,
/// линия, метки слева и доля справа (node 21:48)
class WorkOrderCard extends StatelessWidget {
  const WorkOrderCard({super.key, required this.order, this.onTap, this.highlight = false});

  final OrderCard order;
  final VoidCallback? onTap;
  final bool highlight;

  @override
  Widget build(BuildContext context) {
    final chip = statusChipColors(order.status);
    return Material(
      color: SozoColors.surface,
      borderRadius: BorderRadius.circular(SozoRadius.card),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(SozoRadius.card),
        child: Container(
          padding: const EdgeInsets.all(SozoSpace.s16),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(SozoRadius.card),
            border: highlight ? Border.all(color: SozoColors.accent, width: 1.5) : null,
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Text(
                    order.number,
                    style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w500, color: SozoColors.textSecondary),
                  ),
                  const Spacer(),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: SozoSpace.s4),
                    decoration: BoxDecoration(color: chip.bg, borderRadius: BorderRadius.circular(100)),
                    child: Text(
                      order.statusTitle,
                      style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: chip.fg),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: SozoSpace.s16),
              Row(
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          order.description,
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700, color: SozoColors.text),
                        ),
                        const SizedBox(height: 6),
                        Row(
                          children: [
                            const FigmaIcon('map-pin', size: 14),
                            const SizedBox(width: SozoSpace.s4),
                            Expanded(
                              child: Text(
                                order.address,
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: const TextStyle(fontSize: 13, color: SozoColors.textSecondary),
                              ),
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(width: SozoSpace.s12),
                  Container(
                    width: 44,
                    height: 44,
                    decoration: BoxDecoration(
                      color: SozoColors.bg,
                      borderRadius: BorderRadius.circular(SozoRadius.thumb),
                    ),
                    alignment: Alignment.center,
                    child: const FigmaIcon('toolbox', size: 20),
                  ),
                ],
              ),
              const SizedBox(height: SozoSpace.s16),
              const Divider(height: 1, thickness: 1, color: SozoColors.border),
              const SizedBox(height: SozoSpace.s16),
              Row(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  if (order.isUrgent)
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: SozoSpace.s8, vertical: SozoSpace.s4),
                      decoration: BoxDecoration(color: urgentChipBg, borderRadius: BorderRadius.circular(SozoSpace.s8)),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Text('⚡', style: TextStyle(fontSize: 11)),
                          SizedBox(width: SozoSpace.s4),
                          Text(
                            t('common.srochno'),
                            style: TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: urgentChipFg),
                          ),
                        ],
                      ),
                    ),
                  const Spacer(),
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.end,
                    children: [
                      Text(t('common.vashaDolya'), style: TextStyle(fontSize: 11, color: SozoColors.textSecondary)),
                      const SizedBox(height: 2),
                      Text(
                        order.myShareTiyin > 0 ? formatSoums(order.myShareTiyin) : t('today.poSmete'),
                        style: const TextStyle(
                          fontSize: 13,
                          fontWeight: FontWeight.w700,
                          color: SozoColors.text,
                          fontFeatures: moneyFeatures,
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Загрузка дня: заголовок 15/bold, полоса 6, подпись 13 (node 21:118)
class DayLoadCard extends StatelessWidget {
  const DayLoadCard({super.key, required this.percent, required this.caption});

  final int percent;
  final String caption;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(SozoSpace.s16),
      decoration: BoxDecoration(color: SozoColors.surface, borderRadius: BorderRadius.circular(SozoRadius.card)),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            t('today.zagruzkaDnya'),
            style: TextStyle(fontSize: 15, fontWeight: FontWeight.w700, color: SozoColors.text),
          ),
          const SizedBox(height: SozoSpace.s12),
          ClipRRect(
            borderRadius: BorderRadius.circular(3),
            child: LinearProgressIndicator(
              value: (percent / 100).clamp(0.0, 1.0),
              minHeight: 6,
              backgroundColor: SozoColors.bg,
              valueColor: const AlwaysStoppedAnimation(SozoColors.accent),
            ),
          ),
          const SizedBox(height: SozoSpace.s12),
          Text(
            caption,
            style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w500, color: SozoColors.text),
          ),
        ],
      ),
    );
  }
}

/// Заголовок раздела: 17/bold (node 21:46)
class HomeSectionTitle extends StatelessWidget {
  const HomeSectionTitle(this.text, {super.key});

  final String text;

  @override
  Widget build(BuildContext context) {
    return Text(
      text,
      style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w700, color: SozoColors.text),
    );
  }
}
