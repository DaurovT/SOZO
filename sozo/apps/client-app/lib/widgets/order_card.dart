import 'package:flutter/material.dart';

import '../design_tokens.dart';
import '../format.dart';
import '../i18n.dart';
import 'blocks.dart';
import 'figma_icon.dart';

/// Карточка заявки (DEV-06 §4.2) — одна на главной, в истории и в лентах B2B.
///
/// Аварийная заявка отмечена левой полосой, а не только цветом текста:
/// в списке из пяти карточек цвет шрифта не читается, полоса — читается.
class OrderCard extends StatelessWidget {
  const OrderCard({super.key, required this.order, this.onTap, this.showMoney = true});

  final Map<String, dynamic> order;
  final VoidCallback? onTap;

  /// В B2B сотруднику точки суммы не показываем (настройка организации)
  final bool showMoney;

  @override
  Widget build(BuildContext context) {
    final status = (order['status'] as String?) ?? '';
    final urgency = (order['urgency'] as String?) ?? 'normal';
    final emergency = urgency == 'emergency';
    final window = order['window'] as Map<String, dynamic>?;
    final master = order['masterName'] as String?;
    final needsDecision = order['needsDecision'] == true;

    final sub = <String>[
      if (window != null) window['label']?.toString() ?? '',
      if (master != null && master.isNotEmpty) master,
    ].where((s) => s.isNotEmpty).join(' · ');

    return Container(
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(SozoRadius.card),
        // Полоса аварии слева: цвет дублируется формой (чек-лист §6 п.6)
        border: emergency ? const Border(left: BorderSide(color: SozoColors.error, width: 3)) : null,
      ),
      child: SozoCard(
        onTap: onTap,
        // Плотнее общей карточки (248:2195): в ленте их два десятка, и воздух
        // по 16 с каждой стороны съедал по заявке с экрана
        padding: const EdgeInsets.all(SozoSpace.s12),
        gap: SozoSpace.s4,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Text(
                  (order['number'] as String?) ?? '',
                  style: const TextStyle(fontSize: 14, color: authHint),
                ),
              ),
              // Статус — плашкой, а не цветным текстом (в макете 248:2198 был
              // текст). Причина простая: у «в работе» и «мастер выехал» цвет
              // текста — тот же янтарь #FEB70F, то есть 1,75:1 на белом. Две
              // самые частые строки списка были нечитаемы, а рябь от плашек —
              // меньшая беда, чем невидимый статус
              // Flexible, а не голый чип: длинная подпись статуса в Row
              // получает бесконечную ширину и уезжает за карточку
              Flexible(
                child: TagChip(
                  (order['statusLabel'] as String?) ?? status,
                  bg: statusChipColors(status).bg,
                  fg: statusChipColors(status).fg,
                ),
              ),
            ],
          ),
          Text(
            (order['category'] as String?)?.trim().isNotEmpty == true
                ? order['category'] as String
                : ((order['description'] as String?) ?? '—'),
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600, color: authInk, height: 1.35),
          ),
          // Порядок из макета (248:2203): деньги сразу под названием, метка
          // «ждёт решения» под ними, а адрес и мастер — в самом низу. Так
          // сверху карточки стоит то, ради чего в неё заходят
          if (showMoney && (order['totalFromTiyin'] as num? ?? 0) > 0)
            Text(
              range(order['totalFromTiyin'], order['totalToTiyin']),
              style: const TextStyle(
                fontSize: 16,
                fontWeight: FontWeight.w700,
                color: authInk,
                fontFeatures: moneyFeatures,
              ),
            ),
          // Wrap, а не Row: «Авария» и «Ждёт решения» вместе не помещались
          // в ширину телефона и уезжали за край — вторая метка была не видна
          if (emergency || needsDecision)
            Wrap(
              spacing: SozoSpace.s4,
              runSpacing: SozoSpace.s4,
              children: [
                if (emergency)
                  TagChip(t('order.emergency'), icon: 'alert-triangle', bg: urgentChipBg, fg: urgentChipFg),
                if (needsDecision)
                  TagChip(t('order.needsDecision'), icon: 'clock', bg: softWarnBg, fg: softWarnFg),
              ],
            ),
          Text(
            (order['address'] as String?) ?? '',
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(fontSize: 14, color: authHint),
          ),
          if (sub.isNotEmpty)
            Text(
              sub,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(fontSize: 14, color: authHint),
            ),
        ],
      ),
    );
  }
}

/// Плитка категории на главной (C-06) и в шаге 1 визарда (C-07)
class CategoryTile extends StatelessWidget {
  const CategoryTile({
    super.key,
    required this.name,
    required this.priceFromTiyin,
    this.iconKey,
    this.icon,
    this.onTap,
    this.selected = false,
  });

  /// Подпись для клиента: «Сантехника», а не «САНТЕХНИКА» из прайса
  final String name;

  /// Исходное имя категории прайса — по нему подбирается иконка,
  /// если сервер своей не прислал
  final String? iconKey;

  /// Значок категории с сервера. Он же решает, что показать: угадывание по
  /// русским подстрокам держится до первого релиза прайса с другим написанием
  final String? icon;
  final int priceFromTiyin;
  final VoidCallback? onTap;
  final bool selected;

  /// Иконка ставится только там, где глиф действительно совпадает со смыслом.
  /// Набор рисовался под приложение мастера: категорийных значков в нём нет,
  /// и «Бытовая техника» коробкой архива вводит в заблуждение сильнее,
  /// чем плитка вообще без иконки.
  static String? iconFor(String category) {
    final c = category.toLowerCase();
    if (c.contains('сантех') || c.contains('вода')) return 'wrench';
    if (c.contains('электр')) return 'bolt';
    if (c.contains('окн') || c.contains('двер') || c.contains('замок')) return 'lock';
    if (c.contains('универсал') || c.contains('мелкий') || c.contains('час')) return 'toolbox';
    if (c.contains('выезд') || c.contains('диагност') || c.contains('не знаю')) return 'search';
    return null;
  }

  @override
  Widget build(BuildContext context) {
    return Material(
      color: SozoColors.surface,
      borderRadius: BorderRadius.circular(SozoRadius.card),
      child: InkWell(
        borderRadius: BorderRadius.circular(SozoRadius.card),
        onTap: onTap,
        child: Container(
          padding: const EdgeInsets.all(SozoSpace.s12),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(SozoRadius.card),
            border: selected ? Border.all(color: SozoColors.accent, width: 1.5) : null,
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              if (icon ?? iconFor(iconKey ?? name) case final glyph?)
                Container(
                  width: 44,
                  height: 44,
                  decoration: BoxDecoration(
                    color: SozoColors.accent.withValues(alpha: 0.14),
                    borderRadius: BorderRadius.circular(SozoRadius.tile),
                  ),
                  child: Center(child: FigmaIcon(glyph, size: 22, color: SozoColors.text)),
                )
              else
                const SizedBox(height: 44),
              const SizedBox(height: SozoSpace.s8),
              Text(
                _pretty(name),
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600, color: SozoColors.text),
              ),
              const SizedBox(height: 2),
              Text(
                priceFrom(priceFromTiyin),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(fontSize: 14, color: SozoColors.textSecondary, fontFeatures: moneyFeatures),
              ),
            ],
          ),
        ),
      ),
    );
  }

  /// В прайсе категории записаны капсом. КАПС в интерфейсе запрещён (DEV-06 §7),
  /// поэтому приводим к обычному виду на показ, не трогая данные.
  static String _pretty(String name) {
    if (name != name.toUpperCase()) return name;
    final lower = name.toLowerCase();
    return lower.isEmpty ? lower : '${lower[0].toUpperCase()}${lower.substring(1)}';
  }
}
