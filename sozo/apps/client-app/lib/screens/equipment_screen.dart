import 'package:flutter/material.dart';

import '../api/client.dart';
import '../design_tokens.dart';
import '../format.dart';
import '../i18n.dart';
import '../store/session.dart';
import '../widgets/app_chrome.dart';
import '../widgets/async_view.dart';
import '../widgets/blocks.dart';
import '../widgets/figma_icon.dart';
import 'create/wizard.dart';
import 'order_screen.dart';

/// C-28. Моя техника (фаза 2).
///
/// Единицы техники заводит мастер на объекте — клиент их не вводит руками.
/// Отсюда растут регламентные напоминания: «пора чистить, прошло полгода».
class EquipmentScreen extends StatelessWidget {
  const EquipmentScreen({super.key});

  /// Периодичность обслуживания по типу техники — основание для напоминания
  static int _periodDays(String type) {
    final t = type.toLowerCase();
    if (t.contains('кондицион')) return 180;
    if (t.contains('водонагрев') || t.contains('бойлер')) return 365;
    if (t.contains('котёл') || t.contains('котел')) return 365;
    return 365;
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: SozoColors.bg,
      appBar: SozoAppBar(title: t('c28.title')),
      body: SafeArea(
        child: AsyncView<Map<String, dynamic>>(
          load: () => session.api.equipment(),
          builder: (context, data, reload) {
            final items = ((data['items'] as List?) ?? const []).cast<Map<String, dynamic>>();
            if (items.isEmpty) {
              return EmptyState(icon: 'toolbox', text: (data['empty'] as String?) ?? t('c28.empty'));
            }
            return ListView.separated(
              padding: const EdgeInsets.fromLTRB(SozoSpace.s16, SozoSpace.s12, SozoSpace.s16, 40),
              itemCount: items.length,
              separatorBuilder: (_, _) => const SizedBox(height: SozoSpace.s16),
              itemBuilder: (context, i) => _card(context, items[i], reload),
            );
          },
        ),
      ),
    );
  }

  /// Иконка по типу техники: кондиционер — снежинка, водогрей — капля.
  /// Общий ящик с инструментами на всех единицах превращал список в
  /// одинаковые строки, которые не различишь взглядом
  static String _typeIcon(String type) {
    final v = type.toLowerCase();
    if (v.contains('кондицион') || v.contains('сплит')) return 'snowflake';
    if (v.contains('водонагрев') || v.contains('бойлер') || v.contains('насос')) return 'droplet';
    if (v.contains('котёл') || v.contains('котел') || v.contains('колонка')) return 'flame';
    if (v.contains('щит') || v.contains('электр')) return 'zap';
    return 'toolbox';
  }

  Widget _card(BuildContext context, Map<String, dynamic> a, Future<void> Function() reload) {
    final type = (a['type'] as String?) ?? '';
    final history = ((a['history'] as List?) ?? const []).cast<Map<String, dynamic>>();
    final last = a['lastServiceAt'] as String?;
    final period = _periodDays(type);
    final sinceDays = last == null
        ? null
        : DateTime.now().difference(DateTime.tryParse(last) ?? DateTime.now()).inDays;
    final due = sinceDays != null && sinceDays >= period;
    final linked = ((a['linkedWork'] as List?) ?? const []).cast<String>();

    return SozoCard(
      gap: SozoSpace.s16,
      children: [
        Row(
          children: [
            Container(
              width: 40,
              height: 40,
              decoration: const BoxDecoration(color: SozoColors.bg, shape: BoxShape.circle),
              child: Center(child: FigmaIcon(_typeIcon(type), size: 20, color: authInk)),
            ),
            const SizedBox(width: SozoSpace.s12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    [type, a['brand'], a['model']].where((v) => (v as String?)?.isNotEmpty ?? false).join(' '),
                    style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700, color: authInk),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    [
                      if (a['year'] != null) t('c28.year', {'y': a['year']}),
                      if (last != null) t('c28.lastService', {'date': dayMonth(last)}),
                    ].join(' · '),
                    style: const TextStyle(fontSize: 13, height: 1.3, color: authHint),
                  ),
                ],
              ),
            ),
          ],
        ),

        // Шильдик не читался — мастер отметил это на месте, данные могут быть неточны
        if (a['plateUnreadable'] == true) _plateNote(context, a, reload),

        // Регламент подошёл. В макете этой плашки нет, но напоминание —
        // весь смысл раздела: без него список техники ничего не делает
        if (due)
          SozoBanner(
            icon: 'clock',
            tone: BannerTone.warn,
            title: t('c28.dueTitle'),
            text: t('c28.dueText', {'days': plural(sinceDays, 'день', 'дня', 'дней')}),
            actionLabel: t('c28.book'),
            onAction: () async {
              await Navigator.of(context).push<String>(
                MaterialPageRoute<String>(builder: (_) => const CreateOrderFlow()),
              );
              await reload();
            },
          ),

        if (linked.isNotEmpty)
          Wrap(
            spacing: SozoSpace.s8,
            runSpacing: SozoSpace.s8,
            children: [for (final w in linked) _workChip(w)],
          ),

        if (history.isNotEmpty)
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                t('c28.history'),
                style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: authHint),
              ),
              for (final h in history.take(5)) _historyRow(context, h),
            ],
          ),

        // Ссылка правки — по центру и серым: это оговорка, а не действие экрана
        Padding(
          padding: const EdgeInsets.only(top: SozoSpace.s8),
          child: Center(
            child: InkWell(
              onTap: () => _edit(context, a, reload),
              borderRadius: BorderRadius.circular(SozoRadius.badge),
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: SozoSpace.s8, vertical: SozoSpace.s4),
                child: Text(
                  t('c28.edit'),
                  style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w500, color: authHint),
                ),
              ),
            ),
          ),
        ),
      ],
    );
  }

  /// Работа, привязанная к этой единице техники (256:324)
  Widget _workChip(String label) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: SozoSpace.s12, vertical: 6),
      decoration: BoxDecoration(
        color: SozoColors.bg,
        borderRadius: BorderRadius.circular(SozoRadius.badge),
        border: Border.all(color: authCardDivider),
      ),
      child: Text(
        label,
        style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w500, color: authInk),
      ),
    );
  }

  /// Строка истории работ (256:330): название и дата слева, сумма справа
  Widget _historyRow(BuildContext context, Map<String, dynamic> h) {
    return InkWell(
      onTap: () => Navigator.of(context).push(
        MaterialPageRoute<void>(builder: (_) => OrderScreen(orderId: h['id'] as String)),
      ),
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: SozoSpace.s12),
        decoration: const BoxDecoration(
          border: Border(bottom: BorderSide(color: authCardDivider)),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    (h['title'] as String?) ?? '',
                    style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w500, color: authInk),
                  ),
                  const SizedBox(height: SozoSpace.s4),
                  Text(dayMonth(h['at']), style: const TextStyle(fontSize: 12, color: authHint)),
                ],
              ),
            ),
            const SizedBox(width: SozoSpace.s8),
            Text(
              soums(h['totalTiyin']),
              style: const TextStyle(
                fontSize: 15,
                fontWeight: FontWeight.w700,
                color: authInk,
                fontFeatures: moneyFeatures,
              ),
            ),
          ],
        ),
      ),
    );
  }

  /// Оговорка про нечитаемый шильдик (256:353). Серая, не жёлтая: это не
  /// предупреждение об опасности, а признание, что данные записаны со слов
  Widget _plateNote(BuildContext context, Map<String, dynamic> a, Future<void> Function() reload) {
    return Container(
      padding: const EdgeInsets.all(SozoSpace.s12),
      decoration: BoxDecoration(
        color: SozoColors.bg,
        borderRadius: BorderRadius.circular(SozoRadius.thumb),
      ),
      child: Row(
        children: [
          const FigmaIcon('info', size: 18, color: authHint),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              t('c28.plateUnreadable'),
              style: const TextStyle(fontSize: 10, height: 1.3, color: authInk),
            ),
          ),
          const SizedBox(width: 10),
          InkWell(
            onTap: () => _edit(context, a, reload),
            borderRadius: BorderRadius.circular(SozoRadius.badge),
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: SozoSpace.s12, vertical: 6),
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(SozoRadius.badge),
                border: Border.all(color: authHint),
              ),
              child: Text(
                t('common.change'),
                style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: authInk),
              ),
            ),
          ),
        ],
      ),
    );
  }

  /// Поправить карточку техники.
  ///
  /// Мастер вписывает данные с шильдика, а шильдик выцветает и заклеивается.
  /// Владелец знает марку и год точнее — раньше исправить их было негде.
  Future<void> _edit(BuildContext context, Map<String, dynamic> a, Future<void> Function() reload) async {
    final type = TextEditingController(text: (a['type'] as String?) ?? '');
    final brand = TextEditingController(text: (a['brand'] as String?) ?? '');
    final model = TextEditingController(text: (a['model'] as String?) ?? '');
    final year = TextEditingController(text: a['year']?.toString() ?? '');

    final saved = await showSozoSheet<bool>(
      context,
      title: t('c28.editTitle'),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(SozoSpace.s16, 0, SozoSpace.s16, SozoSpace.s16),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            SozoField(label: t('c28.type'), controller: type),
            const SizedBox(height: SozoSpace.s12),
            SozoField(label: t('c28.brand'), controller: brand),
            const SizedBox(height: SozoSpace.s12),
            SozoField(label: t('c28.model'), controller: model),
            const SizedBox(height: SozoSpace.s12),
            SozoField(label: t('c28.yearLabel'), controller: year, keyboardType: TextInputType.number),
            const SizedBox(height: SozoSpace.s16),
            PrimaryButton(t('common.save'), onTap: () => Navigator.of(context).pop(true)),
          ],
        ),
      ),
    );
    if (saved != true) return;
    try {
      await session.api.updateEquipment(a['id'] as String, {
        'type': type.text.trim(),
        'brand': brand.text.trim(),
        'model': model.text.trim(),
        'year': int.tryParse(year.text.trim()),
      });
      await reload();
    } on ApiError catch (e) {
      if (context.mounted) showSozoToast(context, e.message);
    }
  }
}
