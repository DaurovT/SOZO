import 'package:flutter/material.dart';

import '../api/client.dart';
import '../api/models.dart';
import '../design_tokens.dart';
import '../widgets/app_chrome.dart';
import '../main.dart';
import '../widgets/common.dart';
import '../widgets/home_blocks.dart';
import 'order_screen.dart';
import '../i18n.dart';

/// «Мои заявки» (M-08): активные и история. История нужна не для отчётности,
/// а чтобы вернуться к прошлой работе на том же адресе — типовой случай в B2B.
class OrdersScreen extends StatefulWidget {
  const OrdersScreen({super.key});

  @override
  State<OrdersScreen> createState() => _OrdersScreenState();
}

class _OrdersScreenState extends State<OrdersScreen> with SingleTickerProviderStateMixin {
  late final _tabs = TabController(length: 2, vsync: this);
  List<OrderCard> _active = const [];
  List<OrderCard> _history = const [];
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _tabs.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final j = await session.api.orders();
      if (!mounted) return;
      setState(() {
        _active = ((j['active'] as List?) ?? const [])
            .map((e) => OrderCard.fromJson(e as Map<String, dynamic>))
            .toList();
        _history = ((j['history'] as List?) ?? const [])
            .map((e) => OrderCard.fromJson(e as Map<String, dynamic>))
            .toList();
        _loading = false;
        _error = null;
      });
    } on ApiError catch (e) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = e.message;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) return const Center(child: CircularProgressIndicator());
    return Column(
      children: [
        SozoTabHeader(t('list.moiZayavki')),
        Container(
          color: SozoColors.bg,
          child: TabBar(
            controller: _tabs,
            labelColor: SozoColors.text,
            unselectedLabelColor: SozoColors.textSecondary,
            indicatorColor: SozoColors.accent,
            indicatorWeight: 2.5,
            indicatorSize: TabBarIndicatorSize.label,
            dividerColor: SozoColors.border,
            labelStyle: const TextStyle(fontSize: 14.5, fontWeight: FontWeight.w600),
            unselectedLabelStyle: const TextStyle(fontSize: 14.5, fontWeight: FontWeight.w500),
            tabs: [
              Tab(text: t('list.aktivnye', {'p1': _active.length})),
              Tab(text: t('list.istoriya', {'p1': _history.length})),
            ],
          ),
        ),
        Expanded(
          child: TabBarView(
            controller: _tabs,
            children: [_list(_active, t('list.aktivnyhZayavokNet')), _list(_history, t('list.istoriyaPokaPusta'))],
          ),
        ),
      ],
    );
  }

  Widget _list(List<OrderCard> items, String emptyTitle) {
    if (items.isEmpty) {
      return EmptyView(title: emptyTitle, subtitle: _error, icon: 'list');
    }
    // Та же карточка, что на «Главной»: одна сущность — один вид на всех вкладках
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView.separated(
        padding: const EdgeInsets.fromLTRB(SozoSpace.s16, SozoSpace.s16, SozoSpace.s16, SozoSpace.s32),
        itemCount: items.length,
        separatorBuilder: (context, index) => const SizedBox(height: SozoSpace.s12),
        itemBuilder: (context, i) => WorkOrderCard(
          order: items[i],
          onTap: () async {
            await Navigator.of(context).push(MaterialPageRoute(builder: (_) => OrderScreen(orderId: items[i].id)));
            if (mounted) await _load();
          },
        ),
      ),
    );
  }
}
