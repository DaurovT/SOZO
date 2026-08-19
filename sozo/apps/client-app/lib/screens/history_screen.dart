import 'package:flutter/material.dart';

import '../design_tokens.dart';
import '../i18n.dart';
import '../store/session.dart';
import '../widgets/async_view.dart';
import '../widgets/blocks.dart';
import '../widgets/order_card.dart';
import 'create/wizard.dart';
import 'order_screen.dart';
import 'shell.dart';

/// C-24. История заявок. Карточка закрытой (C-25) — тот же экран итога,
/// что и у выполненной: клиенту незачем два разных вида одного акта.
class HistoryScreen extends StatefulWidget {
  const HistoryScreen({super.key});

  @override
  State<HistoryScreen> createState() => _HistoryScreenState();
}

class _HistoryScreenState extends State<HistoryScreen> {
  final _key = GlobalKey<AsyncViewState<Map<String, dynamic>>>();
  String _filter = 'all';

  @override
  void initState() {
    super.initState();
    // Пришли по карточке с главной — открываемся сразу на нужном срезе
    _applyExternalFilter();
    historyFilter.addListener(_applyExternalFilter);
  }

  @override
  void dispose() {
    historyFilter.removeListener(_applyExternalFilter);
    super.dispose();
  }

  void _applyExternalFilter() {
    final external = historyFilter.value;
    if (external == null) return;
    historyFilter.value = null; // одноразовый: фильтр не должен прилипать
    if (!mounted) return;
    setState(() => _filter = external);
    _key.currentState?.reload();
  }

  static const _filters = [
    ('all', 'c24.all'),
    ('active', 'c24.active'),
    ('closed', 'c24.closed'),
    ('dispute', 'c24.disputes'),
    ('warranty', 'c24.warranty'),
  ];

  @override
  Widget build(BuildContext context) {
    return TabScaffold(
      title: t('tab.history'),
      child: Column(
        children: [
          SizedBox(
            height: 56,
            child: ListView.separated(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.symmetric(horizontal: SozoSpace.s16, vertical: SozoSpace.s8),
              itemCount: _filters.length,
              separatorBuilder: (_, _) => const SizedBox(width: SozoSpace.s8),
              itemBuilder: (context, i) => SozoChip(
                t(_filters[i].$2),
                pill: true,
                selected: _filter == _filters[i].$1,
                onTap: () {
                  setState(() => _filter = _filters[i].$1);
                  _key.currentState?.reload();
                },
              ),
            ),
          ),
          Expanded(
            child: AsyncView<Map<String, dynamic>>(
              key: _key,
              load: () => session.api.orders(filter: _filter == 'all' ? null : _filter),
              builder: (context, data, reload) {
                final orders = ((data['orders'] as List?) ?? const []).cast<Map<String, dynamic>>();
                if (orders.isEmpty) {
                  return EmptyState(
                    icon: 'archive',
                    text: t('c24.empty'),
                    actionLabel: t('c06.callMaster'),
                    onAction: () async {
                      final created = await Navigator.of(context).push<String>(
                        MaterialPageRoute<String>(builder: (_) => const CreateOrderFlow()),
                      );
                      await reload();
                      if (created != null && context.mounted) {
                        await Navigator.of(context).push(
                          MaterialPageRoute<void>(builder: (_) => OrderScreen(orderId: created)),
                        );
                        await reload();
                      }
                    },
                  );
                }
                return ListView.separated(
                  padding: const EdgeInsets.fromLTRB(SozoSpace.s16, SozoSpace.s8, SozoSpace.s16, SozoSpace.s24),
                  itemCount: orders.length,
                  separatorBuilder: (_, _) => const SizedBox(height: SozoSpace.s12),
                  itemBuilder: (context, i) => OrderCard(
                    order: orders[i],
                    onTap: () async {
                      await Navigator.of(context).push(
                        MaterialPageRoute<void>(
                          builder: (_) => OrderScreen(orderId: orders[i]['id'] as String),
                        ),
                      );
                      await reload();
                    },
                  ),
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}
